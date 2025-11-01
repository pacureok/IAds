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
    
    const sendIconSVG = sendButton.innerHTML;

    const GEMINI_ICON_SVG = `
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 5.41663C19.0712 5.41663 18.3333 6.15453 18.3333 7.08329C18.3333 8.01205 19.0712 8.74996 20 8.74996C20.9288 8.74996 21.6667 8.01205 21.6667 7.08329C21.6667 6.15453 20.9288 5.41663 20 5.41663Z" fill="url(#paint0_linear_1_2)"/>
            <path d="M32.9167 18.3333C32.9167 17.4045 32.1788 16.6666 31.25 16.6666C30.3212 16.6666 29.5833 17.4045 29.5833 18.3333C29.5833 19.262 30.3212 20 31.25 20C32.1788 20 32.9167 19.262 32.9167 18.3333Z" fill="url(#paint1_linear_1_2)"/>
            <path d="M8.75 18.3333C8.75 17.4045 7.98795 16.6666 7.08333 16.6666C6.15458 16.6666 5.41667 17.4045 5.41667 18.3333C5.41667 19.262 6.15458 20 7.08333 20C7.98795 20 8.75 19.262 8.75 18.3333Z" fill="url(#paint2_linear_1_2)"/>
            <path d="M20 29.5833C19.0712 29.5833 18.3333 30.3212 18.3333 31.25C18.3333 32.1788 19.0712 32.9166 20 32.9166C20.9288 32.9166 21.6667 32.1788 21.6667 31.25C21.6667 30.3212 20.9288 29.5833 20 29.5833Z" fill="url(#paint3_linear_1_2)"/>
            <defs>
            <linearGradient id="paint0_linear_1_2" x1="20" y1="5.41663" x2="20" y2="8.74996" gradientUnits="userSpaceOnUse"><stop stop-color="#8E83EE"/><stop offset="1" stop-color="#5E83F5"/></linearGradient>
            <linearGradient id="paint1_linear_1_2" x1="31.25" y1="16.6666" x2="31.25" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#5E83F5"/><stop offset="1" stop-color="#42D7F0"/></linearGradient>
            <linearGradient id="paint2_linear_1_2" x1="7.08333" y1="16.6666" x2="7.08333" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="#F5C54F"/><stop offset="1" stop-color="#F2A84E"/></linearGradient>
            <linearGradient id="paint3_linear_1_2" x1="20" y1="29.5833" x2="20" y2="32.9166" gradientUnits="userSpaceOnUse"><stop stop-color="#F2A84E"/><stop offset="1" stop-color="#F25E5E"/></linearGradient>
            </defs>
        </svg>
    `;

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
                const userData = await response.json();
                user = userData;
                renderLoggedInState(user);
                showView('app');
                addInitialView();
            } else {
                user = null;
                renderLoggedOutState();
                showView('logged-out');
            }
        } catch (err) {
            console.error("Failed to check session:", err);
            showError("Could not connect to the server to check your session.");
            renderLoggedOutState();
            showView('logged-out');
        }
    };

    const renderLoggedInState = (userData) => {
        userInfoContainer.innerHTML = `
            <img src="${userData.picture}" alt="${userData.name}" class="user-avatar" />
            <span class="user-name">${userData.name}</span>
            <button id="logout-button" class="logout-button">Sign Out</button>
        `;
        document.getElementById('logout-button').addEventListener('click', () => {
            window.location.href = '/logout';
        });
        messageInput.disabled = false;
        messageInput.placeholder = "Describe the music you want to create...";
        sendButton.disabled = true;
        micButton.disabled = false;
    };

    const renderLoggedOutState = () => {
        userInfoContainer.innerHTML = '';
        messageInput.disabled = true;
        messageInput.placeholder = "Please sign in to start composing...";
        sendButton.disabled = true;
        micButton.disabled = true;
    };
    
    loginButton.addEventListener('click', () => {
        window.location.href = '/login';
    });

    // --- VIEW MANAGEMENT ---
    
    const showView = (viewName) => {
        authLoaderView.classList.toggle('visible', viewName === 'auth-loader');
        loggedOutView.classList.toggle('visible', viewName === 'logged-out');
        appView.classList.toggle('visible', viewName === 'app');
    };
    
    const addInitialView = () => {
        chatContainer.innerHTML = ''; // Clear previous content
        
        const welcomeHTML = `
            <div class="initial-view">
                <div class="initial-view-header">
                    <div class="gemini-icon-large">${GEMINI_ICON_SVG.replace(/40/g, '80')}</div>
                    <h1>Hello, ${user ? user.name.split(' ')[0] : ''}!</h1>
                    <p>What music are we creating today?</p>
                </div>
                <div class="suggestion-chips">
                    <button class="suggestion-chip" data-prompt="A simple, happy melody on a music box">Simple melody on a music box</button>
                    <button class="suggestion-chip" data-prompt="A spooky theme for a Halloween video using a church organ">Spooky Halloween theme</button>
                    <button class="suggestion-chip" data-prompt="Create an 8-bit chiptune track for a retro game">8-bit chiptune track</button>
                    <button class="suggestion-chip" data-prompt="A lo-fi hip hop beat with an electric piano">Lo-fi hip hop beat</button>
                </div>
            </div>
        `;
        chatContainer.innerHTML = welcomeHTML;
    };

    // --- CHAT LOGIC ---

    const handleSubmit = async (e) => {
        e.preventDefault();
        const prompt = messageInput.value.trim();
        if (!prompt || isLoading || !user) return;

        // Clear initial view if it exists
        const initialView = chatContainer.querySelector('.initial-view');
        if (initialView) {
            chatContainer.innerHTML = '';
        }
       
        addMessageToChat('user', prompt);
        messageInput.value = '';
        resizeTextarea();
        setLoading(true);
        showError(null);

        try {
            const result = await generateMusicComposition(prompt);
            const content = `Here is a composition based on your request. I've used the ${result.instrument.replace(/_/g, ' ')}. You can download the MIDI file below.`;
            addMessageToChat('assistant', content, result);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
            if (errorMessage === 'Unauthorized') {
                addMessageToChat('assistant', 'Your session has expired. Please sign in again to continue creating.');
                showError("Your session has expired. Please sign in again.");
                user = null;
                setTimeout(() => {
                    renderLoggedOutState();
                    showView('logged-out');
                    chatContainer.innerHTML = '';
                }, 3000);
            } else {
                showError(`Sorry, I couldn't generate the music. ${errorMessage}`);
                addMessageToChat('assistant', 'Sorry, I had trouble generating the music. Please try a different prompt.');
            }
        } finally {
            setLoading(false);
        }
    };
    
    chatForm.addEventListener('submit', handleSubmit);

    const addMessageToChat = (role, content, midiData = null) => {
        const isUser = role === 'user';
        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${isUser ? 'user' : 'assistant'}`;

        let messageHTML = `
            <div class="avatar-container">
                ${isUser ? `<img src="${user.picture}" alt="${user.name}" />` : GEMINI_ICON_SVG}
            </div>
            <div class="message-content-wrapper">
                <div class="message-content">
                    <p>${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        `;

        if (midiData) {
            const midiString = JSON.stringify(midiData).replace(/'/g, "&apos;");
            messageHTML += `
                <div class="midi-card">
                    <div class="midi-details">
                        <p>Instrument: <span>${midiData.instrument.replace(/_/g, ' ')}</span></p>
                        <button class="download-button" data-midi='${midiString}'>
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>
                            <span>Download MIDI</span>
                        </button>
                    </div>
                </div>
            `;
        }

        messageHTML += `</div></div>`;
        messageWrapper.innerHTML = messageHTML;
        chatContainer.appendChild(messageWrapper);
        scrollToBottom();
    };
    
    const setLoading = (state) => {
        isLoading = state;
        sendButton.disabled = isLoading || !messageInput.value.trim();
        micButton.disabled = isLoading;
        messageInput.disabled = isLoading;
        
        if (isLoading) {
            const existingLoader = document.getElementById('loading-indicator');
            if (existingLoader) existingLoader.remove();
            
            const loaderDiv = document.createElement('div');
            loaderDiv.id = 'loading-indicator';
            loaderDiv.className = 'message-wrapper assistant';
            loaderDiv.innerHTML = `
                 <div class="avatar-container">
                    ${GEMINI_ICON_SVG}
                </div>
                <div class="message-content-wrapper">
                    <div class="loading-dots">
                        <div></div><div></div><div></div>
                    </div>
                </div>
            `;
            chatContainer.appendChild(loaderDiv);
            scrollToBottom();
            sendButton.innerHTML = `<div class="loader-spinner-small"></div>`;
        } else {
            const loader = document.getElementById('loading-indicator');
            if (loader) loader.remove();
            sendButton.innerHTML = sendIconSVG;
        }
    };

    // --- API & SERVICES ---
    
    async function generateMusicComposition(prompt) {
        const response = await fetch('/api/compose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
        });

        if (response.status === 401) throw new Error('Unauthorized');
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'The server returned an error.');
        }
        return await response.json();
    }
    
    const instrumentNameToProgramNumber = {
      acoustic_grand_piano: 1, bright_acoustic_piano: 2, electric_grand_piano: 3, honky_tonk_piano: 4, electric_piano_1: 5, electric_piano_2: 6, harpsichord: 7, clavi: 8, celesta: 9, glockenspiel: 10, music_box: 11, vibraphone: 12, marimba: 13, xylophone: 14, tubular_bells: 15, dulcimer: 16, drawbar_organ: 17, percussive_organ: 18, rock_organ: 19, church_organ: 20, reed_organ: 21, accordion: 22, harmonica: 23, tango_accordion: 24, acoustic_guitar_nylon: 25, acoustic_guitar_steel: 26, electric_guitar_jazz: 27, electric_guitar_clean: 28, electric_guitar_muted: 29, overdriven_guitar: 30, distortion_guitar: 31, guitar_harmonics: 32, acoustic_bass: 33, electric_bass_finger: 34, electric_bass_pick: 35, fretless_bass: 36, slap_bass_1: 37, slap_bass_2: 38, synth_bass_1: 39, synth_bass_2: 40, violin: 41, viola: 42, cello: 43, contrabass: 44, tremolo_strings: 45, pizzicato_strings: 46, orchestral_harp: 47, timpani: 48, string_ensemble_1: 49, string_ensemble_2: 50, synth_strings_1: 51, synth_strings_2: 52, choir_aahs: 53, voice_oohs: 54, synth_voice: 55, orchestra_hit: 56, trumpet: 57, trombone: 58, tuba: 59, muted_trumpet: 60, french_horn: 61, brass_section: 62, synth_brass_1: 63, synth_brass_2: 64, soprano_sax: 65, alto_sax: 66, tenor_sax: 67, baritone_sax: 68, oboe: 69, english_horn: 70, bassoon: 71, clarinet: 72, piccolo: 73, flute: 74, recorder: 75, pan_flute: 76, blown_bottle: 77, shakuhachi: 78, whistle: 79, ocarina: 80,
    };

    const generateAndDownloadMidi = (midiData, fileName = 'composition.mid') => {
        if (!window.MidiWriter) {
            console.error('midi-writer-js is not loaded.');
            alert('MIDI library not available. Please refresh the page.');
            return;
        }
        
        const track = new window.MidiWriter.Track();
        const programNumber = instrumentNameToProgramNumber[midiData.instrument] || 1;
        track.addEvent(new window.MidiWriter.ProgramChangeEvent({ instrument: programNumber }));

        midiData.notes.forEach(note => {
            track.addEvent(new window.MidiWriter.NoteEvent({
                pitch: note.pitch,
                duration: note.duration,
            }));
        });

        const write = new window.MidiWriter.Writer([track]);
        const dataUri = write.dataUri();
        
        const link = document.createElement('a');
        link.href = dataUri;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };
    
    chatContainer.addEventListener('click', (e) => {
        // Handle suggestion chip clicks
        const chip = e.target.closest('.suggestion-chip');
        if (chip && !isLoading) {
            messageInput.value = chip.dataset.prompt;
            resizeTextarea();
            messageInput.focus();
            sendButton.disabled = false;
            // Optionally auto-submit:
            // chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            return;
        }

        // Handle download button clicks
        const downloadButton = e.target.closest('.download-button');
        if (downloadButton && downloadButton.dataset.midi) {
            try {
                const midiData = JSON.parse(downloadButton.dataset.midi);
                generateAndDownloadMidi(midiData);
            } catch(err) {
                console.error("Failed to parse MIDI data:", err);
                showError("Could not download MIDI file due to invalid data.");
            }
        }
    });

    // --- SPEECH RECOGNITION ---
    
    const setupSpeechRecognition = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            micButton.style.display = 'none';
            return;
        }

        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            messageInput.value = transcript;
            messageInput.dispatchEvent(new Event('input')); 
        };
        recognition.onerror = (event) => console.error('Speech recognition error:', event.error);
        recognition.onend = () => {
            isListening = false;
            micButton.classList.remove('listening');
            if (user) {
                messageInput.placeholder = "Describe the music you want to create...";
            }
        };
    };

    micButton.addEventListener('click', () => {
        if (isLoading || !recognition) return;
        if (isListening) {
            recognition.stop();
        } else {
            recognition.start();
            isListening = true;
            micButton.classList.add('listening');
            messageInput.placeholder = "Listening...";
        }
    });

    // --- UTILITIES ---
    
    const scrollToBottom = () => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };
    
    const showError = (message) => {
        errorMessageElement.textContent = message || '';
        errorMessageElement.style.display = message ? 'block' : 'none';
    };
    
    const resizeTextarea = () => {
        messageInput.style.height = 'auto';
        const newHeight = Math.min(messageInput.scrollHeight, 160); // Max height 160px
        messageInput.style.height = `${newHeight}px`;
    };
    
    messageInput.addEventListener('input', () => {
        resizeTextarea();
        sendButton.disabled = !messageInput.value.trim() || isLoading;
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
    });
    
    init();
});
