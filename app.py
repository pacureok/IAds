import os
import json
import requests
from flask import Flask, redirect, request, session, url_for, jsonify, render_template
from google_auth_oauthlib.flow import Flow
import google.generativeai as genai
from google.generativeai.types import FunctionDeclaration, Tool
import google.auth.transport.requests
import google.oauth2.id_token
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
    redirect_uri = 'https://ia-pacus.onrender.com/callback'
else:
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
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

# --- Definición de Herramientas para Gemini (Function Calling) ---
tools = Tool(function_declarations=[
    FunctionDeclaration(
        name='compose_music',
        description="Genera una composición musical simple en un formato estructurado.",
        parameters={
            "type": "object",
            "properties": {
                "instrument": {"type": "string", "description": "El nombre del instrumento General MIDI (ej. 'acoustic_grand_piano', 'violin')."},
                "notes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "pitch": {"type": "string", "description": "La nota musical (ej. 'C4', 'G#5')."},
                            "duration": {"type": "string", "description": "La duración de la nota (ej. '8', '4', '2', '1')."}
                        }, "required": ["pitch", "duration"]
                    }
                }
            }, "required": ["instrument", "notes"]
        }
    ),
    FunctionDeclaration(
        name='play_on_youtube',
        description="Busca y muestra un video en YouTube.",
        parameters={ "type": "object", "properties": { "query": {"type": "string", "description": "El término de búsqueda para YouTube."} }, "required": ["query"] }
    ),
    FunctionDeclaration(
        name='search_google',
        description="Realiza una búsqueda en Google.",
        parameters={ "type": "object", "properties": { "query": {"type": "string", "description": "El término de búsqueda para Google."} }, "required": ["query"] }
    ),
    FunctionDeclaration(name='create_google_doc', description="Abre la página para crear un nuevo Google Doc."),
    FunctionDeclaration(name='create_google_sheet', description="Abre la página para crear una nueva hoja de cálculo de Google Sheets."),
    FunctionDeclaration(name='create_google_slides', description="Abre la página para crear una nueva presentación de Google Slides."),
    FunctionDeclaration(name='create_calendar_event', description="Abre Google Calendar para crear un nuevo evento."),
])

model = genai.GenerativeModel('gemini-1.5-flash', tools=[tools])

# --- Rutas de la Aplicación ---
@app.route('/')
def index():
    return render_template('index.html')

# --- Rutas de Autenticación ---
@app.route('/login')
def login():
    authorization_url, state = flow.authorization_url()
    session["state"] = state
    return redirect(authorization_url)

@app.route('/callback')
def callback():
    try:
        flow.fetch_token(authorization_response=request.url)
        if "state" not in session or session["state"] != request.args.get("state"): return "State does not match!", 400
        credentials = flow.credentials
        token_request = google.auth.transport.requests.Request(session=requests.session())
        id_info = google.oauth2.id_token.verify_oauth2_token(id_token=credentials.id_token, request=token_request, audience=GOOGLE_CLIENT_ID)
        session["google_id"], session["name"], session["picture"] = id_info.get("sub"), id_info.get("name"), id_info.get("picture")
        return redirect(url_for('index'))
    except Exception as e:
        print(f"Error during OAuth callback: {e}")
        return "Authentication failed.", 500

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# --- Rutas de la API ---
@app.route('/api/session')
def get_session():
    if "google_id" in session:
        return jsonify({"name": session.get("name"), "picture": session.get("picture")})
    return jsonify({"error": "Unauthorized"}), 401

@app.route('/api/chat', methods=['POST'])
def chat():
    if "google_id" not in session: return jsonify({"error": "Unauthorized"}), 401
    prompt = request.json.get('prompt')
    if not prompt: return jsonify({"error": "Prompt is required"}), 400

    try:
        response = model.generate_content(prompt)
        response_part = response.candidates[0].content.parts[0]
        
        if hasattr(response_part, 'function_call') and response_part.function_call:
            fc = response_part.function_call
            function_args = {key: value for key, value in fc.args.items()}
            
            if fc.name == 'compose_music':
                return jsonify({"midiData": function_args})
            else:
                return jsonify({"tool_calls": [{"name": fc.name, "args": function_args}]})
        else:
            return jsonify({"text": response.text})

    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        return jsonify({"error": "An error occurred with the AI model."}), 500

@app.route('/api/wikipedia-summary', methods=['GET'])
def wikipedia_summary():
    if "google_id" not in session: return jsonify({"error": "Unauthorized"}), 401
    query = request.args.get('q')
    if not query: return jsonify({"error": "Query parameter 'q' is required."}), 400
    
    WIKIPEDIA_API_URL = "https://es.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "format": "json",
        "prop": "extracts|info",
        "inprop": "url",
        "exintro": True,
        "explaintext": True,
        "redirects": 1,
        "titles": query
    }
    
    try:
        response = requests.get(WIKIPEDIA_API_URL, params=params, headers={'User-Agent': 'pacure.ai/1.0'})
        response.raise_for_status()
        data = response.json()
        pages = data['query']['pages']
        page_id = next(iter(pages))
        
        if page_id == "-1":
            return jsonify({"text": f"Lo siento, no pude encontrar ninguna información sobre '{query}' en Wikipedia."})
            
        page = pages[page_id]
        summary = page.get('extract', 'No se encontró un resumen.')
        
        return jsonify({
            "text": summary,
            "source": { "title": page.get('title'), "url": page.get('fullurl') }
        })
        
    except Exception as e:
        print(f"Error fetching from Wikipedia: {e}")
        return jsonify({"error": "Failed to fetch summary from Wikipedia."}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
