import os
import json
from flask import Flask, redirect, request, session, url_for, jsonify, render_template
from google_auth_oauthlib.flow import Flow
import google.generativeai as genai
import google.auth.transport.requests
import google.oauth2.id_token
import requests
from dotenv import load_dotenv

# Cargar variables de entorno para desarrollo local
load_dotenv()

# --- Configuración de Flask ---
# Le decimos a Flask que busque los templates y archivos estáticos en el directorio raíz ('.')
app = Flask(__name__, template_folder='.', static_folder='.')
app.secret_key = os.environ.get("SECRET_KEY")

# --- Configuración de Google OAuth ---
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

# Asegúrate de que la URL de redirección sea HTTPS en producción
if 'RENDER' in os.environ:
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '0'
    # Usando la URL de los logs de error del usuario
    redirect_uri = 'https://ia-pacus.onrender.com/callback'
else:
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1' # Permite HTTP para desarrollo local
    redirect_uri = 'http://127.0.0.1:5000/callback'

client_secrets_dict = {
    "web": {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uris": [redirect_uri],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

flow = Flow.from_client_config(
    client_config=client_secrets_dict,
    scopes=[
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "openid"
    ],
    redirect_uri=redirect_uri
)

# --- Configuración de Gemini API ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("No GEMINI_API_KEY set for Flask application")
genai.configure(api_key=GEMINI_API_KEY)


# --- Rutas de la Aplicación ---

@app.route('/')
def index():
    """Sirve la página principal de la aplicación."""
    return render_template('index.html')

# --- Rutas de Autenticación ---

@app.route('/login')
def login():
    """Redirige al usuario a la página de consentimiento de Google."""
    authorization_url, state = flow.authorization_url()
    session["state"] = state
    return redirect(authorization_url)

@app.route('/callback')
def callback():
    """Maneja la respuesta de Google después de la autenticación."""
    try:
        flow.fetch_token(authorization_response=request.url)

        if "state" not in session or session["state"] != request.args.get("state"):
            return "State does not match!", 400

        credentials = flow.credentials
        request_session = requests.session()
        token_request = google.auth.transport.requests.Request(session=request_session)

        id_info = google.oauth2.id_token.verify_oauth2_token(
            id_token=credentials.id_token,
            request=token_request,
            audience=GOOGLE_CLIENT_ID
        )

        session["google_id"] = id_info.get("sub")
        session["name"] = id_info.get("name")
        session["picture"] = id_info.get("picture")
        
        return redirect(url_for('index'))
    except Exception as e:
        # Log del error para depuración
        print(f"Error during OAuth callback: {e}")
        return "Authentication failed.", 500


@app.route('/logout')
def logout():
    """Limpia la sesión del usuario."""
    session.clear()
    return redirect(url_for('index'))

# --- Rutas de la API ---

@app.route('/api/session')
def get_session():
    """Verifica si el usuario tiene una sesión activa."""
    if "google_id" in session:
        return jsonify({
            "name": session.get("name"),
            "picture": session.get("picture"),
        })
    else:
        return jsonify({"error": "Unauthorized"}), 401
        
@app.route('/api/compose', methods=['POST'])
def compose_music():
    """Endpoint para generar música usando Gemini."""
    if "google_id" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    prompt = data.get('prompt')
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400

    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        response = model.generate_content(
            f"Analyze the following user request and generate a simple, short, single-track musical composition in the specified JSON format. The composition should be between 10 to 20 notes. User request: '{prompt}'",
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": {
                    "type": "object",
                    "properties": {
                        "instrument": {
                            "type": "string",
                            "description": "The General MIDI instrument name (e.g., 'acoustic_grand_piano', 'electric_guitar_clean', 'violin')."
                        },
                        "notes": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "pitch": {
                                        "type": "string",
                                        "description": "The musical note (e.g., 'C4', 'G#5')."
                                    },
                                    "duration": {
                                        "type": "string",
                                        "description": "The duration of the note (e.g., '8', '4', '2', '1' for eighth, quarter, half, whole)."
                                    }
                                },
                                "required": ["pitch", "duration"]
                            }
                        }
                    },
                    "required": ["instrument", "notes"]
                }
            }
        )
        
        composition_data = json.loads(response.text)
        return jsonify(composition_data)

    except Exception as e:
        print(f"Error generating composition: {e}")
        return jsonify({"error": "Failed to generate music from the prompt."}), 500


if __name__ == '__main__':
    # El puerto se obtiene de la variable de entorno PORT, común en servicios como Render
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
