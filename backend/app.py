import os
import json
from flask import Flask, session, redirect, request, jsonify, url_for
import google.generativeai as genai
import requests
from google_auth_oauthlib.flow import Flow

# Cargar variables de entorno desde un archivo .env para desarrollo local
from dotenv import load_dotenv
load_dotenv()

# --- Configuración de la Aplicación y APIs ---
app = Flask(__name__)
# Clave secreta para la seguridad de la sesión. Render la generará por ti.
app.secret_key = os.environ.get("SECRET_KEY")
# Permite HTTP para el desarrollo local. Render usará HTTPS automáticamente.
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"

# Configuración de la API de Gemini
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("La variable de entorno GEMINI_API_KEY no está configurada.")
genai.configure(api_key=GEMINI_API_KEY)

# --- Configuración de Google OAuth ---
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
FRONTEND_URL = os.environ.get("FRONTEND_URL")

# Verifica que todas las variables necesarias estén presentes
if not all([GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FRONTEND_URL]):
    raise ValueError("Las variables de entorno de Google OAuth no están configuradas (CLIENT_ID, CLIENT_SECRET, FRONTEND_URL).")

# Configuración del cliente OAuth que se usará para la autenticación
client_config = {
    "web": {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [],  # Se establecerá dinámicamente en la ruta /login
    }
}
SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]

# --- Rutas de Autenticación ---

@app.route('/login')
def login():
    """ Inicia el flujo de autenticación de Google. """
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        redirect_uri=url_for('authorize', _external=True, _scheme='https')
    )
    authorization_url, state = flow.authorization_url()
    session['state'] = state
    return redirect(authorization_url)

@app.route('/authorize')
def authorize():
    """ Ruta a la que Google redirige después de que el usuario se autentica. """
    state = session.pop('state', None)
    flow = Flow.from_client_config(
        client_config,
        scopes=SCOPES,
        state=state,
        redirect_uri=url_for('authorize', _external=True, _scheme='https')
    )
    # Intercambia el código de autorización por credenciales de acceso
    flow.fetch_token(authorization_response=request.url)
    credentials = flow.credentials
    
    # Usa las credenciales para obtener la información del perfil del usuario
    userinfo_response = requests.get(
        "https://www.googleapis.com/oauth2/v1/userinfo",
        headers={'Authorization': f'Bearer {credentials.token}'}
    )

    if userinfo_response.ok:
        user_info = userinfo_response.json()
        session['user_profile'] = {
            'name': user_info.get('name'),
            'picture': user_info.get('picture'),
        }
        # Redirige al usuario de vuelta al frontend
        return redirect(FRONTEND_URL)
    
    return "Error al obtener la información del usuario.", 400

@app.route('/logout')
def logout():
    """ Cierra la sesión del usuario. """
    session.clear()
    return redirect(FRONTEND_URL)

# --- Rutas de la API ---

@app.route('/api/session', methods=['GET'])
def get_session():
    """ Permite al frontend verificar si hay una sesión activa. """
    user_profile = session.get('user_profile')
    if user_profile:
        return jsonify(user_profile)
    return jsonify({'error': 'No autenticado'}), 401

@app.route('/api/compose', methods=['POST'])
def compose_music():
    """ Endpoint seguro que llama a la API de Gemini. """
    if not session.get('user_profile'):
        return jsonify({'error': 'No autorizado'}), 401

    prompt = request.json.get('prompt')
    if not prompt:
        return jsonify({'error': 'El prompt es requerido'}), 400

    try:
        model = genai.GenerativeModel(
            'gemini-2.5-flash',
            system_instruction="""Eres un asistente experto en composición musical. Tu tarea es generar una pieza musical corta basada en la petición del usuario.
            La salida debe ser un objeto JSON válido.
            - Interpreta la petición del usuario (género, ánimo, escala, notas específicas) para crear una secuencia coherente.
            - La secuencia debe tener entre 4 y 16 notas.
            - El JSON debe tener dos claves: 'instrument' (un string con un instrumento General MIDI en formato snake_case) y 'notes' (un array de objetos, cada uno con 'pitch' y 'duration').
            - Los 'pitch' deben ser notas válidas (ej. 'C4', 'G#5'). Para acordes, usa un array de strings.
            - Las 'duration' deben ser válidas (ej. '1', '2', '4', '8', 'd4')."""
        )
        
        response = model.generate_content(
            f'Petición del usuario: "{prompt}"',
            generation_config={"response_mime_type": "application/json"}
        )

        # Carga la respuesta de texto como JSON
        parsed_json = json.loads(response.text)
        
        # Validación básica para asegurar que la respuesta tiene la estructura esperada
        if not parsed_json.get('instrument') or not isinstance(parsed_json.get('notes'), list):
            raise ValueError("La estructura del JSON recibido de la API no es válida.")

        return jsonify(parsed_json)

    except Exception as e:
        app.logger.error(f"Error al llamar a la API de Gemini: {e}")
        return jsonify({'error': 'Error al generar la música desde el modelo de IA.'}), 500

# Esta parte solo se ejecuta si corres el archivo directamente (para desarrollo local)
if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
