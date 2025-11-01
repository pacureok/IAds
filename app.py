# app.py (Código completo para Pacure AI con Gemini Live)

import os
import json
import requests
from flask import Flask, session, request, redirect, url_for, jsonify, render_template, Response
from authlib.integrations.flask_client import OAuth
import google.generativeai as genai
from functools import wraps
import base64
from io import BytesIO
# midiutil debe estar en requirements.txt
from midiutil.MidiFile import MIDIFile
from typing import Dict, Any

# ---------------------------------------------------------------------
# Configuración de Flask
# ---------------------------------------------------------------------

# La clave secreta es OBLIGATORIA para las sesiones de Flask.
# Esta comprobación detendrá la aplicación si la clave no está configurada en Render,
# mostrando un error claro en los logs.
FLASK_SECRET_KEY = os.environ.get('FLASK_SECRET_KEY')
if not FLASK_SECRET_KEY:
    raise ValueError("Error Crítico: La variable de entorno FLASK_SECRET_KEY no está configurada. Por favor, añádela en tu panel de control de Render.")

app = Flask(__name__, static_folder='.', static_url_path='', template_folder='.')
app.secret_key = FLASK_SECRET_KEY

# ---------------------------------------------------------------------
# Configuración de OAuth (Google Login) - USANDO AUTHLIB
# ---------------------------------------------------------------------
oauth = OAuth(app)
oauth.register(
    name='google',
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    # Usamos la URL de metadatos para la auto-configuración, es más robusto.
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    # Solicitamos los scopes (permisos) necesarios para obtener el perfil y email.
    client_kwargs={'scope': 'openid email profile'}
)

# ---------------------------------------------------------------------
# Configuración de la API de Gemini (para la generación de música)
# ---------------------------------------------------------------------
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("ADVERTENCIA: No se ha configurado la GEMINI_API_KEY. La API de composición fallará.")
else:
    genai.configure(api_key=GEMINI_API_KEY)

# Instrucción de sistema para guiar el comportamiento del modelo de IA al componer.
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

# Inicialización del modelo con configuración para que devuelva JSON.
model = genai.GenerativeModel(
    model_name='gemini-2.5-flash',
    system_instruction=system_instruction,
    generation_config={"response_mime_type": "application/json"}
)

# ---------------------------------------------------------------------
# Funciones Auxiliares
# ---------------------------------------------------------------------

def login_required(f):
    """Decorador para proteger rutas. Si el usuario no está en sesión, devuelve un error 401."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return jsonify({'error': 'No autorizado. Por favor, inicie sesión.'}), 401
        return f(*args, **kwargs)
    return decorated_function

def parse_duration(duration_str: str) -> float:
    """Convierte la notación de duración MIDI (ej. 'd4') a beats (ej. 1.5)."""
    duration_map = {'1': 4.0, '2': 2.0, 'd2': 3.0, '4': 1.0, 'd4': 1.5, '8': 0.5, 'd8': 0.75, '16': 0.25}
    return duration_map.get(duration_str, 1.0) # Devuelve 1.0 (negra) si la duración no es válida

def pitch_to_midi(pitch: str) -> int:
    """Convierte notación de tono (ej. 'C4') a número MIDI (ej. 60)."""
    if pitch.lower() == 'rest': return -1
    notes = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
    try:
        note_name = pitch[:-1].upper()
        octave = int(pitch[-1])
        return notes[note_name] + (octave + 1) * 12
    except (KeyError, ValueError, IndexError):
        return 60 # Devuelve C4 (Do central) si el tono no es válido

def create_midi_file(composition_data: Dict[str, Any]) -> str:
    """Crea un archivo MIDI en base64 a partir de los datos de la IA."""
    mf = MIDIFile(1)
    track, time, tempo = 0, 0, 120
    mf.addTempo(track, time, tempo)
    mf.addProgramChange(track, 0, time, 0) # Programa/instrumento 0 (Piano Acústico)

    for note_obj in composition_data.get('notes', []):
        pitch_str = note_obj.get('pitch', 'rest')
        duration = parse_duration(note_obj.get('duration', '4'))
        midi_pitch = pitch_to_midi(pitch_str)
        
        if midi_pitch != -1: # No añade la nota si es un silencio ('rest')
            mf.addNote(track, 0, midi_pitch, time, duration, 100)
        
        time += duration

    with BytesIO() as bin_file:
        mf.writeFile(bin_file)
        bin_file.seek(0)
        return base64.b64encode(bin_file.read()).decode('utf-8')

# ---------------------------------------------------------------------
# Rutas de la Aplicación
# ---------------------------------------------------------------------

@app.route('/')
def index():
    """Sirve el archivo principal index.html."""
    return render_template('index.html')

@app.route('/images.ico')
def favicon():
    """Sirve un recurso vacío para el favicon y evitar errores 404 en la consola."""
    return Response(status=204)

# --- Rutas de Autenticación de Authlib ---

@app.route('/login')
def login():
    """Inicia el flujo de inicio de sesión de Google OAuth."""
    # Forzamos https para la URL de callback, que es lo que Google espera en producción (Render).
    redirect_uri = url_for('callback', _external=True, _scheme='https')
    return oauth.google.authorize_redirect(redirect_uri)

@app.route('/callback')
def callback():
    """Maneja la redirección de Google después de la autenticación."""
    try:
        token = oauth.google.authorize_access_token()
        # Authlib obtiene la información del usuario y la guardamos en la sesión.
        session['user'] = token.get('userinfo')
    except Exception as e:
        print(f"Error durante el proceso de callback de OAuth: {e}")
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    """Cierra la sesión del usuario limpiando la sesión."""
    session.pop('user', None)
    return redirect(url_for('index'))

# --- Endpoints de la API ---

@app.route('/api/session')
def api_session():
    """Endpoint para que el frontend verifique si un usuario ha iniciado sesión."""
    if 'user' in session and session['user']:
        return jsonify({'logged_in': True, 'user': session['user']})
    return jsonify({'logged_in': False})

@app.route('/api/gemini-key')
@login_required
def get_gemini_key():
    """Endpoint seguro para proporcionar la clave de API de Gemini al cliente."""
    return jsonify({'apiKey': GEMINI_API_KEY})

@app.route('/api/compose', methods=['POST'])
@login_required
def api_compose():
    """Endpoint para generar música (llamado como una herramienta por la IA)."""
    if not GEMINI_API_KEY:
        return jsonify({'error': 'La API de Gemini no está configurada en el servidor.'}), 500
        
    data = request.get_json()
    prompt = data.get('prompt')

    if not prompt:
        return jsonify({'error': 'Se requiere un prompt de la IA.'}), 400

    try:
        response = model.generate_content(prompt)
        composition_data = json.loads(response.text)
        midi_base64 = create_midi_file(composition_data)
        
        return jsonify({'midi_data': f"data:audio/midi;base64,{midi_base64}"})
        
    except Exception as e:
        print(f"Error al llamar a la API de Gemini o al generar MIDI: {e}")
        return jsonify({'error': 'No se pudo generar la composición desde la IA.'}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=False, host='0.0.0.0', port=port)
