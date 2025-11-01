# app.py (Código completo y corregido con Authlib)

import os
import json
import requests
from flask import Flask, session, request, redirect, url_for, jsonify, render_template, abort, Response
from authlib.integrations.flask_client import OAuth 
import google.generativeai as genai
from google.generativeai import types
from bs4 import BeautifulSoup
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import sent_tokenize, word_tokenize
from collections import defaultdict
from string import punctuation
from io import BytesIO 
from functools import wraps 
import base64
from midiutil.MidiFile import MIDIFile
from typing import Dict, Any, List

# ---------------------------------------------------------------------
# Configuración de Flask
# ---------------------------------------------------------------------
app = Flask(__name__, static_folder='.', static_url_path='', template_folder='.')
# CLAVE SECRETA OBLIGATORIA PARA SESIONES DE FLASK
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'FALLBACK_CLAVE_SECRETA_LARGA_DEBES_CAMBIARLA') 

# ---------------------------------------------------------------------
# Configuración de OAuth (Google Login) - USANDO AUTHLIB
# ---------------------------------------------------------------------
oauth = OAuth(app)
oauth.register(
    name='google',
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    # Usamos la URL de metadatos para la auto-configuración
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    # Solicitamos los scopes necesarios
    client_kwargs={'scope': 'openid email profile'}
)

# ---------------------------------------------------------------------
# Configuración de la API de Gemini
# ---------------------------------------------------------------------
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("ADVERTENCIA: No se ha configurado la GEMINI_API_KEY. La API de composición fallará.")
else:
    # Usamos genai.Client() si la versión de la librería lo soporta
    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
    except AttributeError:
        # Fallback para versiones antiguas
        genai.configure(api_key=GEMINI_API_KEY)
        client = genai # Usamos la librería configurada directamente

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

# Inicialización del modelo con configuración de JSON
try:
    model = client.models.get('gemini-2.5-flash')
    model = client.models.get(
        model_name='gemini-2.5-flash',
        system_instruction=system_instruction,
        generation_config={"response_mime_type": "application/json"}
    )
except Exception:
    # Fallback si genai.Client no está disponible o la sintaxis es diferente
    model = genai.GenerativeModel(
        model_name='gemini-2.5-flash',
        system_instruction=system_instruction,
        generation_config={"response_mime_type": "application/json"}
    )
    
# ---------------------------------------------------------------------
# Funciones Auxiliares
# ---------------------------------------------------------------------

def login_required(f):
    """Decorador para proteger rutas, asegurando que el usuario esté en sesión."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            # Si la petición no es AJAX, redirige. Para API, devuelve 401.
            if request.path.startswith('/api'):
                return jsonify({'error': 'No autorizado. Inicie sesión.'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def parse_duration(duration_str: str) -> float:
    """Convierte la notación de duración MIDI (ej. 'd4') a beats (ej. 1.5)."""
    if duration_str == '1': return 4.0
    if duration_str == '2': return 2.0
    if duration_str == 'd2': return 3.0
    if duration_str == '4': return 1.0
    if duration_str == 'd4': return 1.5
    if duration_str == '8': return 0.5
    if duration_str == 'd8': return 0.75
    if duration_str == '16': return 0.25
    return 1.0

def pitch_to_midi(pitch: str) -> int:
    """Convierte notación de tono (ej. 'C4') a número MIDI (ej. 60)."""
    if pitch.lower() == 'rest': return -1
    
    notes = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 
             'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
    
    try:
        note_name = pitch[:-1].upper()
        octave = int(pitch[-1])
        return notes[note_name] + (octave + 1) * 12
    except (KeyError, ValueError, IndexError):
        # Valor por defecto si falla el parseo
        return 60 

def create_midi_file(composition_data: Dict[str, Any]) -> str:
    """Crea un archivo MIDI en base64 a partir de los datos de la IA."""
    if not MIDIFile:
        return "Error: midiutil no está instalado en este entorno."
        
    mf = MIDIFile(1)  # Una pista
    track = 0
    time = 0 
    tempo = 120  # BPM
    
    mf.addTempo(track, time, tempo)
    
    # Mapeo de instrumentos MIDI (usando un valor por defecto si no se reconoce)
    # Por simplicidad, se puede definir un diccionario de mapeo más completo
    instrument_name = composition_data.get('instrument', 'Piano')
    # Se recomienda usar un valor MIDI numérico, aquí se usa 0 (Piano Acústico) por defecto
    program = 0 
    mf.addProgramChange(track, 0, time, program) 

    notes = composition_data.get('notes', [])
    
    for note_obj in notes:
        pitch_str = note_obj.get('pitch', 'C4')
        duration_str = note_obj.get('duration', '4')
        
        duration = parse_duration(duration_str)
        volume = 100 
        
        if pitch_str.lower() != 'rest':
            midi_pitch = pitch_to_midi(pitch_str)
            if midi_pitch != -1:
                mf.addNote(track, 0, midi_pitch, time, duration, volume)
        
        # El tiempo avanza por la duración de la nota o silencio
        time += duration
        
    # Guardar en un buffer
    bin_file = BytesIO()
    mf.writeFile(bin_file)
    bin_file.seek(0)
    
    # Codificar a base64 para enviarlo al frontend
    return base64.b64encode(bin_file.read()).decode('utf-8')

# ---------------------------------------------------------------------
# Implementación de Resumen de Texto (Necesario para la ruta /api/summarize)
# ---------------------------------------------------------------------

# Inicializar NLTK si es necesario (solo para el resumen, no para la IA)
try:
    nltk.data.find('tokenizers/punkt')
    nltk.data.find('corpora/stopwords')
except nltk.downloader.DownloadError:
    print("Descargando recursos de NLTK (punkt, stopwords)...")
    nltk.download('punkt', quiet=True)
    nltk.download('stopwords', quiet=True)

SPANISH_STOPWORDS = set(stopwords.words('spanish'))

def summarize_text(text: str, n_sentences: int = 3) -> str:
    """Implementación simple de resumen por frecuencia de palabras."""
    if not text: return "No hay texto para resumir."
    
    sentences = sent_tokenize(text, language='spanish')
    if len(sentences) <= n_sentences: return text

    word_frequencies = defaultdict(int)
    for word in word_tokenize(text.lower(), language='spanish'):
        if word not in SPANISH_STOPWORDS and word not in punctuation and word.isalnum():
            word_frequencies[word] += 1

    if not word_frequencies: return "No se pudo generar el resumen (contenido vacío o no procesable)."

    # Normalizar frecuencias
    max_frequency = max(word_frequencies.values())
    for word in word_frequencies.keys():
        word_frequencies[word] = (word_frequencies[word] / max_frequency)

    # Calcular puntajes de las oraciones
    sentence_scores = defaultdict(int)
    for sentence in sentences:
        for word in word_tokenize(sentence.lower(), language='spanish'):
            if word in word_frequencies:
                sentence_scores[sentence] += word_frequencies[word]

    # Ordenar y seleccionar las mejores oraciones
    scored_sentences = sorted(sentence_scores.items(), key=lambda x: x[1], reverse=True)
    
    # Preservar el orden original en el resumen
    summary_sentences = []
    original_order_set = {sentence[0] for sentence in scored_sentences[:n_sentences]}
    for sentence in sentences:
        if sentence in original_order_set:
            summary_sentences.append(sentence)

    return ' '.join(summary_sentences)

# ---------------------------------------------------------------------
# Rutas de la Aplicación
# ---------------------------------------------------------------------

@app.route('/')
def index():
    """Sirve el archivo principal index.html."""
    return render_template('index.html')

# --- Rutas de Autenticación de Authlib ---

@app.route('/login')
def login():
    """Inicia el flujo de inicio de sesión de Google OAuth (Authlib)."""
    # La URI de redirección se genera automáticamente por url_for('callback')
    # y se fuerza a HTTPS para Render.
    return oauth.google.authorize_redirect(url_for('callback', _external=True, _scheme='https'))

@app.route('/callback')
def callback():
    """Maneja la redirección de Google después de la autenticación (Authlib)."""
    try:
        # Authlib se encarga de intercambiar el código por el token y verificar el estado
        token = oauth.google.authorize_access_token()
        
        # Obtener información del usuario usando el token (con la URL de Google OAuth)
        userinfo_response = requests.get('https://www.googleapis.com/oauth2/v3/userinfo', 
                                         headers={'Authorization': f'Bearer {token["access_token"]}'})
        userinfo_response.raise_for_status()
        user_info = userinfo_response.json()

        # Almacenar la información en la sesión de Flask
        session['user'] = {
            'id': user_info.get('sub'),
            'name': user_info.get('name'),
            'email': user_info.get('email')
        }
        
    except Exception as e:
        print(f"Error durante el proceso de callback de OAuth: {e}")
        # Redirigir a la página principal con un error o a una página de error
        return redirect(url_for('index', error="Auth_Failed"))

    # Redirigir a la página principal
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    """Cierra la sesión del usuario limpiando la sesión."""
    session.pop('user', None)
    return redirect(url_for('index'))

# --- Endpoints de la API ---

@app.route('/api/session')
def api_session():
    """
    Endpoint para que el frontend verifique si un usuario ha iniciado sesión.
    Devuelve la estructura esperada por script.js.
    """
    if 'user' in session:
        return jsonify({
            'logged_in': True,
            'user': session['user']
        })
    else:
        return jsonify({
            'logged_in': False,
            'user': {'name': 'Invitado'}
        })

@app.route('/api/compose', methods=['POST'])
@login_required # Protege la ruta: solo usuarios logueados pueden componer
def api_compose():
    """Endpoint para generar música."""
    if not GEMINI_API_KEY:
        return jsonify({'error': 'La API de Gemini no está configurada en el servidor.'}), 500
        
    data = request.get_json()
    prompt = data.get('prompt')

    if not prompt:
        return jsonify({'error': 'Se requiere un prompt'}), 400

    try:
        # El modelo ya está configurado para devolver JSON
        response = model.generate_content(prompt)
        
        # Parsear la respuesta JSON del modelo
        composition_data = json.loads(response.text)
        
        # Generar el archivo MIDI en base64
        midi_base64 = create_midi_file(composition_data)

        # Devolver la respuesta en formato JSON
        return jsonify({
            'response': "Composición generada con éxito. ¡A disfrutar!",
            'midi_data': f"data:audio/midi;base64,{midi_base64}"
        })
        
    except Exception as e:
        print(f"Error al llamar a la API de Gemini o al generar MIDI: {e}")
        return jsonify({'error': 'No se pudo generar la composición desde la IA. Intente de nuevo.'}), 500

@app.route('/api/summarize', methods=['POST']) # No usamos @login_required
def api_summarize():
    """Ruta para resumir una URL."""
    data = request.get_json()
    url = data.get('url')
    if not url: return jsonify({'error': 'URL no proporcionada'}), 400

    try:
        # Lógica de resumen (requests y BeautifulSoup)
        headers = {'User-Agent': 'Mozilla/5.0 (compatible; Render-IA-App/1.0)'}
        response = requests.get(url, timeout=15, headers=headers)
        response.raise_for_status() 
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Extraer todo el texto de los párrafos
        paragraphs = soup.find_all('p')
        text = ' '.join([p.get_text() for p in paragraphs])
        
        summary = summarize_text(text, n_sentences=5)

        if len(summary) < 50: 
            return jsonify({'error': 'No se pudo extraer suficiente contenido para resumir. Intenta con otra URL o una página con más texto.'}), 400
            
        return jsonify({'url': url, 'summary': summary})

    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Error al acceder a la URL: {str(e)}. Verifica el formato de la URL o si la página existe.'}), 500
    except Exception as e:
        return jsonify({'error': f'Error interno en el resumen: {str(e)}'}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=False, host='0.0.0.0', port=port)
