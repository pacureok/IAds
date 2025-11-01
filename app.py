import os
import json
from flask import Flask, session, request, redirect, url_for, jsonify, render_template
from google_auth_oauthlib.flow import Flow
import google.generativeai as genai
import requests

# --- Inicialización de la Aplicación ---
# Verifica la SECRET_KEY al inicio para prevenir errores en tiempo de ejecución.
# Render.com generará este valor. Para desarrollo local, lo establecerías en un archivo .env.
SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("No se ha configurado la SECRET_KEY para la aplicación Flask. Por favor, establécela en tus variables de entorno.")

# Inicializa la aplicación Flask
# template_folder='.' le dice a Flask que busque index.html en el directorio raíz.
# static_folder='.' le dice a Flask que sirva archivos estáticos (como script.js, style.css) desde la raíz.
app = Flask(__name__, static_folder='.', static_url_path='', template_folder='.')
app.secret_key = SECRET_KEY

# --- Configuración de Google OAuth2 ---
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
# La URL externa de tu aplicación en Render.com
RENDER_EXTERNAL_URL = os.environ.get('RENDER_EXTERNAL_URL') 

# Crea dinámicamente el archivo client_secret.json que necesita la librería de Google OAuth.
# Esto evita tener que subir un archivo de secretos a tu repositorio.
client_secrets_file = 'client_secret.json'

# Construye la URI de redirección dependiendo de si la app corre en Render o localmente.
redirect_uri = f"{RENDER_EXTERNAL_URL}/callback" if RENDER_EXTERNAL_URL else "http://127.0.0.1:5000/callback"

# Crea la estructura JSON para el archivo de secretos del cliente.
client_config = {
    "web": {
        "client_id": GOOGLE_CLIENT_ID,
        "project_id": "pacure-ai", # Nombre del proyecto actualizado
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uris": [redirect_uri]
    }
}
with open(client_secrets_file, 'w') as f:
    json.dump(client_config, f)

# Define los scopes (permisos) que solicitamos al usuario.
SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile']

# --- Configuración de la API de Gemini ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("No se ha configurado la GEMINI_API_KEY. Por favor, establécela en tus variables de entorno.")
genai.configure(api_key=GEMINI_API_KEY)

# --- Definición del Modelo Gemini ---
# Instrucción de sistema para guiar el comportamiento del modelo de IA.
system_instruction = f"""Eres un compositor de música MIDI experto llamado Pacure AI. Tu tarea es generar una composición musical basada en la petición del usuario.
Debes devolver un único objeto JSON que se adhiera estrictamente al esquema proporcionado.
El objeto JSON debe contener dos claves: "instrument" y "notes".
El "instrument" debe ser un nombre de instrumento General MIDI válido.
El array "notes" debe contener una secuencia de objetos de nota, cada uno con un "pitch" y una "duration".
- El Pitch debe estar en notación científica de tono (ej., 'C4', 'F#5'). Usa 'rest' para silencios.
- La Duration debe ser una cadena que represente la duración de la nota (ej., '1' para redonda, '2' para blanca, '4' para negra, '8' para corchea). Usa 'd' para notas con puntillo (ej., 'd4').
Ejemplo: {{ "instrument": "music_box", "notes": [{{"pitch": "C4", "duration": "4"}}, {{"pitch": "E4", "duration": "4"}}, {{"pitch": "G4", "duration": "4"}}] }}
Mantén la composición relativamente corta y simple, de unas 10-20 notas, a menos que el usuario pida algo más largo.
"""

model = genai.GenerativeModel(
    model_name='gemini-2.5-flash',
    system_instruction=system_instruction,
    generation_config={"response_mime_type": "application/json"}
)

# --- Rutas de la Aplicación ---

@app.route('/')
def index():
    """Sirve el archivo principal index.html."""
    return render_template('index.html')

@app.route('/login')
def login():
    """Inicia el flujo de inicio de sesión de Google OAuth."""
    flow = Flow.from_client_secrets_file(
        client_secrets_file=client_secrets_file,
        scopes=SCOPES,
        redirect_uri=url_for('callback', _external=True)
    )
    # Genera un token de estado para prevenir ataques CSRF.
    authorization_url, state = flow.authorization_url()
    # Guarda el estado en la sesión para verificarlo en el callback.
    session['state'] = state
    return redirect(authorization_url)

@app.route('/callback')
def callback():
    """Maneja la redirección de Google después de la autenticación."""
    # Verifica el token de estado para asegurar que la solicitud es legítima.
    state = session.get('state')
    if not state or state != request.args.get('state'):
        return "Error: Parámetro de estado inválido. ¿Posible ataque CSRF?", 400
        
    flow = Flow.from_client_secrets_file(
        client_secrets_file=client_secrets_file,
        scopes=SCOPES,
        state=state,
        redirect_uri=url_for('callback', _external=True)
    )
    
    # Intercambia el código de autorización por un token de acceso.
    flow.fetch_token(authorization_response=request.url)
    credentials = flow.credentials
    
    # Usa el token de acceso para obtener la información del perfil del usuario.
    userinfo_response = requests.get(
        'https://www.googleapis.com/oauth2/v1/userinfo',
        headers={'Authorization': f'Bearer {credentials.token}'}
    )
    user_info = userinfo_response.json()
    # Guarda la información del usuario en la sesión para mantenerlo conectado.
    session['user'] = user_info
    
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    """Cierra la sesión del usuario limpiando la sesión."""
    session.clear()
    return redirect(url_for('index'))

# --- Endpoints de la API ---

@app.route('/api/session')
def api_session():
    """Endpoint para que el frontend verifique si un usuario ha iniciado sesión."""
    if 'user' in session:
        return jsonify(session['user'])
    else:
        return jsonify({'error': 'No ha iniciado sesión'}), 401

@app.route('/api/compose', methods=['POST'])
def api_compose():
    """Endpoint para generar música. Requiere que el usuario haya iniciado sesión."""
    if 'user' not in session:
        return jsonify({'error': 'No autorizado'}), 401
    
    data = request.get_json()
    prompt = data.get('prompt')

    if not prompt:
        return jsonify({'error': 'Se requiere un prompt'}), 400

    try:
        response = model.generate_content(prompt)
        # La API de Gemini devuelve una cadena JSON, así que la devolvemos directamente
        # con la cabecera de tipo de contenido correcta.
        return response.text, 200, {'Content-Type': 'application/json'}
    except Exception as e:
        # Registra el error para depuración en el servidor.
        print(f"Error al llamar a la API de Gemini: {e}")
        return jsonify({'error': 'No se pudo generar la composición desde la IA.'}), 500

if __name__ == '__main__':
    # Obtiene el puerto de la variable de entorno (proporcionada por Render).
    # Por defecto, 8080 para desarrollo local.
    port = int(os.environ.get('PORT', 8080))
    # Ejecuta la aplicación. debug=False es importante para producción.
    # host='0.0.0.0' la hace accesible desde fuera del contenedor.
    app.run(debug=False, host='0.0.0.0', port=port)
