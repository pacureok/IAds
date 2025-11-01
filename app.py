import os
import json
from flask import Flask, session, request, redirect, url_for, jsonify, render_template
from google_auth_oauthlib.flow import Flow
import google.generativeai as genai
import requests

# --- Configuración ---
app = Flask(__name__, static_folder='.', static_url_path='')
# La SECRET_KEY se obtiene de las variables de entorno de Render
app.secret_key = os.environ.get("SECRET_KEY") 

# --- Configuración de Google OAuth2 ---
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
# La URL de tu aplicación en Render.com
RENDER_EXTERNAL_URL = os.environ.get('RENDER_EXTERNAL_URL') 

# Define el archivo de secretos del cliente.
# Lo crearemos dinámicamente si no existe para que funcione en Render.
client_secrets_file = 'client_secret.json'

redirect_uri = f"{RENDER_EXTERNAL_URL}/callback" if RENDER_EXTERNAL_URL else "http://127.0.0.1:5000/callback"

# Crea el archivo client_secret.json dinámicamente
client_config = {
    "web": {
        "client_id": GOOGLE_CLIENT_ID,
        "project_id": "gemini-midi-composer", # Puedes cambiar esto
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uris": [redirect_uri]
    }
}
with open(client_secrets_file, 'w') as f:
    json.dump(client_config, f)

# Los scopes definen el nivel de acceso que solicitas al usuario.
SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile']

# --- Configuración de la API de Gemini ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

# --- Definición del Modelo Gemini ---
instrument_names = [ "acoustic_grand_piano", "bright_acoustic_piano", "electric_grand_piano", "honky_tonk_piano", "electric_piano_1", "electric_piano_2", "harpsichord", "clavi", "celesta", "glockenspiel", "music_box", "vibraphone", "marimba", "xylophone", "tubular_bells", "dulcimer", "drawbar_organ", "percussive_organ", "rock_organ", "church_organ", "reed_organ", "accordion", "harmonica", "tango_accordion", "acoustic_guitar_nylon", "acoustic_guitar_steel", "electric_guitar_jazz", "electric_guitar_clean", "electric_guitar_muted", "overdriven_guitar", "distortion_guitar", "guitar_harmonics", "acoustic_bass", "electric_bass_finger", "electric_bass_pick", "fretless_bass", "slap_bass_1", "slap_bass_2", "synth_bass_1", "synth_bass_2", "violin", "viola", "cello", "contrabass", "tremolo_strings", "pizzicato_strings", "orchestral_harp", "timpani", "string_ensemble_1", "string_ensemble_2", "synth_strings_1", "synth_strings_2", "choir_aahs", "voice_oohs", "synth_voice", "orchestra_hit", "trumpet", "trombone", "tuba", "muted_trumpet", "french_horn", "brass_section", "synth_brass_1", "synth_brass_2", "soprano_sax", "alto_sax", "tenor_sax", "baritone_sax", "oboe", "english_horn", "bassoon", "clarinet", "piccolo", "flute", "recorder", "pan_flute", "blown_bottle", "shakuhachi", "whistle", "ocarina" ]
valid_instruments = ", ".join(instrument_names)

system_instruction = f"""You are an expert MIDI music composer. Your task is to generate a musical composition based on the user's prompt.
You must return a single JSON object that strictly adheres to the provided schema.
The JSON object must contain two keys: "instrument" and "notes".
The "instrument" must be a valid General MIDI instrument name from the allowed list.
The "notes" array must contain a sequence of note objects, each with a "pitch" and a "duration".
- Pitch should be in scientific pitch notation (e.g., 'C4', 'F#5'). Use 'rest' for silence.
- Duration should be a string representing the note length (e.g., '1' for whole, '2' for half, '4' for quarter, '8' for eighth). Use 'd' for dotted notes (e.g., 'd4').
Example: {{ "instrument": "music_box", "notes": [{{"pitch": "C4", "duration": "4"}}, {{"pitch": "E4", "duration": "4"}}, {{"pitch": "G4", "duration": "4"}}] }}
Keep the composition relatively short and simple, around 10-20 notes, unless the user asks for something longer.
"""

model = genai.GenerativeModel(
    model_name='gemini-2.5-flash',
    system_instruction=system_instruction,
    generation_config={"response_mime_type": "application/json"}
)

# --- Rutas de la Aplicación ---

@app.route('/')
def index():
    # Sirve el archivo HTML principal
    return render_template('index.html')

@app.route('/login')
def login():
    flow = Flow.from_client_secrets_file(
        client_secrets_file=client_secrets_file,
        scopes=SCOPES,
        redirect_uri=url_for('callback', _external=True)
    )
    authorization_url, state = flow.authorization_url()
    session['state'] = state
    return redirect(authorization_url)

@app.route('/callback')
def callback():
    state = session.get('state')
    if not state:
        return "Error: Invalid state.", 400
        
    flow = Flow.from_client_secrets_file(
        client_secrets_file=client_secrets_file,
        scopes=SCOPES,
        state=state,
        redirect_uri=url_for('callback', _external=True)
    )
    
    flow.fetch_token(authorization_response=request.url)
    credentials = flow.credentials
    
    # Obtener información del usuario
    userinfo_response = requests.get(
        'https://www.googleapis.com/oauth2/v1/userinfo',
        headers={'Authorization': f'Bearer {credentials.token}'}
    )
    user_info = userinfo_response.json()
    session['user'] = user_info
    
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

@app.route('/api/session')
def api_session():
    if 'user' in session:
        return jsonify(session['user'])
    else:
        return jsonify({'error': 'Not logged in'}), 401

@app.route('/api/compose', methods=['POST'])
def api_compose():
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    prompt = data.get('prompt')

    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    try:
        response = model.generate_content(prompt)
        result_json = json.loads(response.text)
        return jsonify(result_json)
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return jsonify({'error': 'Failed to generate composition from AI.'}), 500

if __name__ == '__main__':
    # Usar el puerto que Render proporciona, o 8080 para pruebas locales
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=False, host='0.0.0.0', port=port)
