document.addEventListener('DOMContentLoaded', () => {
    // --- STATE ---
    let user = null;
    let isLoading = false;
    let isListening = false;
    let recognition = null;

    // --- DOM ELEMENTS ---
    const authLoaderView = document.getElementById('auth-loader-view');
    const loggedOutView = document.getElementById('logged-out-view');
    const appView = document.getElementById('app-view');
    const loginButton = document.getElementById('login-button');
    const userInfoContainer = document.getElementById('user-info');
    const chatContainer = document.getElementById('chat-container');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const micButton = document.getElementById('mic-button');
    const errorMessageElement = document.getElementById('error-message');
    const newChatButton = document.querySelector('.new-chat-button');

    // --- INITIALIZATION ---
    const init = async () => {
        showView('auth-loader');
        setupSpeechRecognition();
        await checkSession();
    };

    // --- AUTHENTICATION ---
    const checkSession = async () => {
        try {
            const response = await fetch('/api/session');
            if (response.ok) {
                user = await response.json();
                renderLoggedInState();
                showView('app');
            } else {
                user = null;
                renderLoggedOutState();
                showView('logged-out');
            }
        } catch (err) {
            console.error("Failed to check session:", err);
            showError("Could not connect to the server.");
            renderLoggedOutState();
            showView('logged-out');
        }
    };

    loginButton.addEventListener('click', () => {
        window.location.href = '/login';
    });

    const renderLoggedInState = () => {
        userInfoContainer.innerHTML = `
            <img src="${user.picture}" alt="User avatar" class="user-avatar" />
            <div class="user-details">
                <span class="user-name">${user.name}</span>
                <button id="logout-button" class="logout-button">Sign Out</button>
            </div>
        `;
        document.getElementById('logout-button').addEventListener('click', () => window.location.href = '/logout');
        renderWelcomeScreen();
    };

    const renderLoggedOutState = () => {
        userInfoContainer.innerHTML = '';
        chatContainer.innerHTML = '';
    };
    
    // --- VIEW MANAGEMENT ---
    const showView = (viewName) => {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('visible'));
        document.getElementById(`${viewName}-view`).classList.add('visible');
    };

    const renderWelcomeScreen = () => {
        chatContainer.innerHTML = `
            <div class="welcome-screen">
                <h1 class="welcome-title">Hello, ${user.name.split(' ')[0]}</h1>
                <h2 class="welcome-subtitle">How can I help you today?</h2>
            </div>
        `;
    };

    // --- CHAT LOGIC ---
    const handleSubmit = async (e) => {
        e.preventDefault();
        const prompt = messageInput.value.trim();
        if (!prompt || isLoading || !user) return;

        if (chatContainer.querySelector('.welcome-screen')) {
            chatContainer.innerHTML = '';
        }
       
        addMessageToChat('user', { text: prompt });
        messageInput.value = '';
        resizeTextarea();
        setLoading(true);
        showError(null);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });

            if (!response.ok) {
                if(response.status === 401) throw new Error('Unauthorized');
                const errData = await response.json();
                throw new Error(errData.error || 'Server returned an error.');
            }
            
            const result = await response.json();
            addMessageToChat('assistant', result);

        } catch (err) {
            handleApiError(err);
        } finally {
            setLoading(false);
        }
    };
    
    chatForm.addEventListener('submit', handleSubmit);
    newChatButton.addEventListener('click', renderWelcomeScreen);

    const addMessageToChat = (role, data) => {
        const isUser = role === 'user';
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${role}`;

        const avatarSrc = isUser ? user.picture : '/imagres.ico';
        const senderName = isUser ? user.name : 'pacure ai';

        messageWrapper.innerHTML = `
            <div class="avatar-container">
                <img src="${avatarSrc}" alt="${senderName} avatar" />
            </div>
            <div class="message-content">
                <p class="message-sender">${senderName}</p>
                ${generateMessageContent(data)}
            </div>
        `;

        chatContainer.appendChild(messageWrapper);
        attachEventListeners(messageWrapper);
        scrollToBottom();
    };

    const generateMessageContent = (data) => {
        if (data.text) {
            return `<p>${data.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
        }
        if (data.midiData) {
            const midiString = JSON.stringify(data.midiData).replace(/'/g, "&apos;");
            return `
                <p>Here is the composition you requested. I've used the ${data.midiData.instrument.replace(/_/g, ' ')}.</p>
                <div class="card">
                    <div class="card-title"><span class="material-symbols-outlined">music_note</span>Composition</div>
                    <div class="card-content">
                        <span class="card-text">${data.midiData.instrument.replace(/_/g, ' ')}</span>
                        <button class="card-button download-button" data-midi='${midiString}'>
                            <span class="material-symbols-outlined">download</span> Download
                        </button>
                    </div>
                </div>
            `;
        }
        if (data.tool_calls) {
            return data.tool_calls.map(call => {
                executeToolCall(call);
                const actionText = getToolActionText(call);
                return `<p>${actionText}</p>`;
            }).join('');
        }
        return '<p>Sorry, I received an empty response.</p>';
    };
    
    const getToolActionText = (call) => {
        switch(call.name) {
            case 'play_on_youtube': return `Searching YouTube for "${call.args.query}"...`;
            case 'search_google': return `Searching Google for "${call.args.query}"...`;
            case 'create_google_doc': return 'Opening a new Google Doc...';
            case 'create_google_sheet': return 'Opening a new Google Sheet...';
            case 'create_google_slides': return 'Opening a new Google Slides presentation...';
            case 'create_calendar_event': return 'Opening Google Calendar to create a new event...';
            default: return `Performing an unknown action: ${call.name}`;
        }
    };

    const executeToolCall = (call) => {
        const { name, args } = call;
        switch(name) {
            case 'play_on_youtube':
                window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`, '_blank');
                break;
            case 'search_google':
                window.open(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`, '_blank');
                break;
            case 'create_google_doc':
                window.open('https://docs.new', '_blank');
                break;
            case 'create_google_sheet':
                 window.open('https://sheets.new', '_blank');
                break;
            case 'create_google_slides':
                 window.open('https://slides.new', '_blank');
                break;
            case 'create_calendar_event':
                 window.open('https://cal.new', '_blank');
                break;
            default:
                console.warn(`Unknown tool call: ${name}`);
        }
    };

    const setLoading = (state) => {
        isLoading = state;
        sendButton.disabled = isLoading || !messageInput.value.trim();
        micButton.disabled = isLoading;
        messageInput.disabled = isLoading;
        
        const existingLoader = document.getElementById('loading-indicator');
        if(existingLoader) existingLoader.remove();
        
        if (isLoading) {
            const loaderDiv = document.createElement('div');
            loaderDiv.id = 'loading-indicator';
            loaderDiv.className = 'message-wrapper assistant';
            loaderDiv.innerHTML = `
                <div class="avatar-container"><img src="/imagres.ico" alt="Assistant avatar" /></div>
                <div class="message-content">
                    <p class="message-sender">pacure ai</p>
                    <div class="loading-dots"><div></div><div></div><div></div></div>
                </div>
            `;
            chatContainer.appendChild(loaderDiv);
            scrollToBottom();
        }
    };
    
    const handleApiError = (err) => {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        if (errorMessage === 'Unauthorized') {
            showError("Your session has expired. Redirecting to login...");
            setTimeout(() => window.location.href = '/', 3000);
        } else {
            showError(`Error: ${errorMessage}`);
            addMessageToChat('assistant', { text: `Sorry, I ran into a problem: ${errorMessage}` });
        }
    };

    // --- MIDI & Event Handlers ---
    const instrumentNameToProgramNumber = { acoustic_grand_piano: 1, bright_acoustic_piano: 2, electric_grand_piano: 3, honky_tonk_piano: 4, electric_piano_1: 5, electric_piano_2: 6, harpsichord: 7, clavi: 8, celesta: 9, glockenspiel: 10, music_box: 11, vibraphone: 12, marimba: 13, xylophone: 14, tubular_bells: 15, dulcimer: 16, drawbar_organ: 17, percussive_organ: 18, rock_organ: 19, church_organ: 20, reed_organ: 21, accordion: 22, harmonica: 23, tango_accordion: 24, acoustic_guitar_nylon: 25, acoustic_guitar_steel: 26, electric_guitar_jazz: 27, electric_guitar_clean: 28, electric_guitar_muted: 29, overdriven_guitar: 30, distortion_guitar: 31, guitar_harmonics: 32, acoustic_bass: 33, electric_bass_finger: 34, electric_bass_pick: 35, fretless_bass: 36, slap_bass_1: 37, slap_bass_2: 38, synth_bass_1: 39, synth_bass_2: 40, violin: 41, viola: 42, cello: 43, contrabass: 44, tremolo_strings: 45, pizzicato_strings: 46, orchestral_harp: 47, timpani: 48, string_ensemble_1: 49, string_ensemble_2: 50, synth_strings_1: 51, synth_strings_2: 52, choir_aahs: 53, voice_oohs: 54, synth_voice: 55, orchestra_hit: 56, trumpet: 57, trombone: 58, tuba: 59, muted_trumpet: 60, french_horn: 61, brass_section: 62, synth_brass_1: 63, synth_brass_2: 64, soprano_sax: 65, alto_sax: 66, tenor_sax: 67, baritone_sax: 68, oboe: 69, english_horn: 70, bassoon: 71, clarinet: 72, piccolo: 73, flute: 74, recorder: 75, pan_flute: 76, blown_bottle: 77, shakuhachi: 78, whistle: 79, ocarina: 80 };

    const generateAndDownloadMidi = (midiData) => {
        if (!window.MidiWriter) return showError('MIDI library not available.');
        try {
            const track = new window.MidiWriter.Track();
            track.addEvent(new window.MidiWriter.ProgramChangeEvent({ instrument: instrumentNameToProgramNumber[midiData.instrument] || 1 }));
            midiData.notes.forEach(note => track.addEvent(new window.MidiWriter.NoteEvent(note)));
            const write = new window.MidiWriter.Writer([track]);
            const link = document.createElement('a');
            link.href = write.dataUri();
            link.download = 'composition.mid';
            link.click();
        } catch (err) {
            console.error("Error generating MIDI file:", err);
            showError("Failed to generate MIDI file.");
        }
    };
    
    const attachEventListeners = (element) => {
        const downloadButton = element.querySelector('.download-button');
        if (downloadButton) {
            downloadButton.addEventListener('click', () => {
                try {
                    const midiData = JSON.parse(downloadButton.dataset.midi);
                    generateAndDownloadMidi(midiData);
                } catch(err) {
                    showError("Could not download MIDI: Invalid data.");
                }
            });
        }
    };

    // --- SPEECH RECOGNITION ---
    const setupSpeechRecognition = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) { micButton.style.display = 'none'; return; }
        recognition = new SpeechRecognition();
        recognition.continuous = false; recognition.interimResults = false;
        // Try to get browser language, fallback to English
        recognition.lang = navigator.language || 'en-US'; 
        
        recognition.onresult = (e) => {
            messageInput.value = e.results[0][0].transcript;
            messageInput.dispatchEvent(new Event('input'));
        };
        recognition.onerror = (e) => console.error('Speech recognition error:', e.error);
        recognition.onend = () => {
            isListening = false; micButton.classList.remove('listening');
            messageInput.placeholder = "Describe what you want to do...";
        };
    };

    micButton.addEventListener('click', () => {
        if (isLoading || !recognition) return;
        if (isListening) { recognition.stop(); } 
        else {
            try {
                recognition.start(); isListening = true;
                micButton.classList.add('listening');
                messageInput.placeholder = "Listening...";
            } catch (err) {
                console.error("Could not start recognition:", err);
                showError("Microphone access might be blocked.");
            }
        }
    });

    // --- UTILITIES ---
    const scrollToBottom = () => chatContainer.scrollTop = chatContainer.scrollHeight;
    const showError = (msg) => {
        errorMessageElement.textContent = msg || '';
        errorMessageElement.style.display = msg ? 'block' : 'none';
    };
    const resizeTextarea = () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = `${Math.min(messageInput.scrollHeight, 200)}px`;
    };
    
    messageInput.addEventListener('input', () => {
        resizeTextarea();
        sendButton.disabled = !messageInput.value.trim() || isLoading;
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    });
    
    init();
});
