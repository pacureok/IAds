document.addEventListener('DOMContentLoaded', () => {
    // --- STATE ---
    let user = null;
    let geminiAI = null;
    let liveSession = null;
    let isListeningForWakeWord = false;
    let isSessionActive = false;
    let wakeWordRecognition = null;
    let inputAudioContext, outputAudioContext, inputNode, outputNode;
    let nextStartTime = 0;
    const sources = new Set();
    let currentTurn = { user: '', assistant: '' };
    
    // --- DOM ELEMENTS ---
    const authLoaderView = document.getElementById('auth-loader-view');
    const loggedOutView = document.getElementById('logged-out-view');
    const appView = document.getElementById('app-view');
    const loginButton = document.getElementById('login-button');
    const userInfoContainer = document.getElementById('user-info');
    const transcriptContainer = document.getElementById('transcript-container');
    const orbButton = document.getElementById('orb-button');
    const statusText = document.getElementById('status-text');

    // --- INITIALIZATION ---
    const init = async () => {
        showView('auth-loader');
        await checkSession();
    };

    // --- AUTHENTICATION ---
    const checkSession = async () => {
        try {
            const response = await fetch('/api/session');
            const sessionData = await response.json();
            
            if (sessionData.logged_in) {
                user = sessionData.user;
                renderLoggedInState(user);
                showView('app');
                await setupGemini();
                setupWakeWordRecognition();
                // Automatically start listening after login
                startWakeWordListening();
            } else {
                user = null;
                showView('logged-out');
            }
        } catch (err) {
            console.error("Failed to check session:", err);
            showView('logged-out');
        }
    };
    
    async function setupGemini() {
        try {
            const response = await fetch('/api/gemini-key');
            if (!response.ok) throw new Error('Could not fetch API key.');
            const { apiKey } = await response.json();
            if (!apiKey) throw new Error('API key is missing.');
            geminiAI = new genai.GoogleGenAI({ apiKey });
        } catch (error) {
            console.error('Failed to initialize Gemini:', error);
            statusText.textContent = "Error: Could not connect to the AI service.";
            orbButton.disabled = true;
        }
    }
    
    const renderLoggedInState = (userData) => {
        const initial = userData.name ? userData.name.charAt(0).toUpperCase() : '?';
        userInfoContainer.innerHTML = `
            <div class="user-avatar-placeholder">${initial}</div>
            <span class="user-name">${userData.name}</span>
            <button id="logout-button" class="logout-button">Sign Out</button>
        `;
        document.getElementById('logout-button').addEventListener('click', () => {
            window.location.href = '/logout';
        });
    };
    
    loginButton.addEventListener('click', () => { window.location.href = '/login'; });

    // --- VIEW MANAGEMENT ---
    const showView = (viewName) => {
        authLoaderView.classList.toggle('visible', viewName === 'auth-loader');
        loggedOutView.classList.toggle('visible', viewName === 'logged-out');
        appView.classList.toggle('visible', viewName === 'app');
    };
    
    const updateUIState = (state, message) => {
        orbButton.dataset.state = state; // idle, listening, thinking, speaking
        statusText.textContent = message;
    };

    // --- WAKE WORD DETECTION ---
    const setupWakeWordRecognition = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            updateUIState('idle', "Speech recognition is not supported by your browser.");
            orbButton.disabled = true;
            return;
        }

        wakeWordRecognition = new SpeechRecognition();
        wakeWordRecognition.continuous = true;
        wakeWordRecognition.interimResults = false;
        wakeWordRecognition.lang = 'en-US';

        wakeWordRecognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript.trim().toLowerCase();
                if (transcript.includes("hey ai") || transcript.includes("okay ai")) {
                    console.log("Wake word detected!");
                    stopWakeWordListening();
                    startLiveSession();
                }
            }
        };
        wakeWordRecognition.onerror = (event) => {
            console.error('Wake word recognition error:', event.error);
            // Handle common errors like 'not-allowed' for microphone permissions
            if (event.error === 'not-allowed') {
                 updateUIState('idle', 'Microphone access denied. Please enable it in your browser settings.');
                 orbButton.disabled = true;
            } else if (event.error === 'no-speech') {
                 // Restart recognition if no speech is detected, to keep it "always-on"
                 if(isListeningForWakeWord) {
                    wakeWordRecognition.stop();
                 }
            }
        };
        wakeWordRecognition.onend = () => {
            // Automatically restart recognition to keep it "always-on"
            if (isListeningForWakeWord) {
                try {
                    wakeWordRecognition.start();
                } catch (e) {
                    console.error("Could not restart wake word recognition:", e);
                }
            }
        };
    };

    const startWakeWordListening = () => {
        if (!wakeWordRecognition || isSessionActive || isListeningForWakeWord) return;
        isListeningForWakeWord = true;
        updateUIState('listening', 'Listening for "Hey AI" or "Okay AI"...');
        try {
           wakeWordRecognition.start();
        } catch (e) {
            console.error("Could not start wake word listening:", e);
            // This can happen if it's already started.
        }
    };

    const stopWakeWordListening = () => {
        if (wakeWordRecognition && isListeningForWakeWord) {
            isListeningForWakeWord = false;
            wakeWordRecognition.stop();
        }
    };

    orbButton.addEventListener('click', () => {
        if (isSessionActive) {
            endLiveSession();
        }
        // No action if not in a session, as listening is automatic.
    });

    // --- GEMINI LIVE SESSION ---
    
    const createMusicFunctionDeclaration = {
        name: 'create_music_composition',
        parameters: {
            type: 'OBJECT',
            description: 'Generates a MIDI music composition based on a textual description.',
            properties: {
                prompt: {
                    type: 'STRING',
                    description: 'A detailed description of the music to be created, including mood, instruments, tempo, or style. For example: "a sad and slow piano melody in a minor key".',
                },
            },
            required: ['prompt'],
        },
    };

    const startLiveSession = async () => {
        if (!geminiAI) return;
        isSessionActive = true;
        transcriptContainer.innerHTML = '';
        currentTurn = { user: '', assistant: '' };
        updateUIState('thinking', 'Connecting to Pacure AI...');

        try {
            inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
            outputNode = outputAudioContext.createGain();
            outputNode.connect(outputAudioContext.destination);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const sessionPromise = geminiAI.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                    outputAudioTranscription: {},
                    inputAudioTranscription: {},
                    tools: [{ functionDeclarations: [createMusicFunctionDeclaration] }],
                },
                callbacks: { onmessage: handleLiveMessage, onerror: handleLiveError, onclose: endLiveSession },
            });
            
            liveSession = await sessionPromise;
            
            updateUIState('listening', "I'm listening...");
            const source = inputAudioContext.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                if (!isSessionActive) return;
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                liveSession.sendRealtimeInput({ media: createBlob(inputData) });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContext.destination);

        } catch (error) {
            console.error("Failed to start live session:", error);
            updateUIState('idle', 'Error: Could not start the session. Check microphone permissions.');
            isSessionActive = false;
            startWakeWordListening(); // Go back to listening for wake word
        }
    };
    
    const handleLiveMessage = async (message) => {
        if (message.serverContent) {
            const { inputTranscription, outputTranscription, modelTurn, turnComplete, interrupted } = message.serverContent;
            if (inputTranscription) currentTurn.user += inputTranscription.text;
            if (outputTranscription) currentTurn.assistant += outputTranscription.text;
            
            if (modelTurn) updateUIState('speaking', "Pacure AI is speaking...");
            
            const audioData = modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
                playAudio(audioData);
            }
            if (interrupted) {
                for (const source of sources.values()) source.stop();
                sources.clear();
                nextStartTime = 0;
            }
            if (turnComplete) {
                addTurnToTranscript();
                currentTurn = { user: '', assistant: '' };
                updateUIState('listening', "I'm listening...");
            }
        }
        if (message.toolCall) {
            for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'create_music_composition') {
                    updateUIState('thinking', 'Composing your music...');
                    const result = await handleMusicCompositionTool(fc.args);
                     liveSession.sendToolResponse({
                        functionResponses: { id : fc.id, name: fc.name, response: { result: JSON.stringify(result) } }
                    });
                }
            }
        }
    };
    
    const handleLiveError = (e) => {
        console.error('Live session error:', e);
        updateUIState('idle', 'A connection error occurred. Please try again.');
        endLiveSession();
    };

    const endLiveSession = () => {
        if (!isSessionActive) return;
        isSessionActive = false;
        if (liveSession) liveSession.close();
        if (inputAudioContext) inputAudioContext.close();
        if (outputAudioContext) outputAudioContext.close();
        liveSession = null;
        updateUIState('idle', 'Session ended.');
        // Go back to listening for the wake word
        startWakeWordListening();
    };
    
    const addTurnToTranscript = () => {
        if (!currentTurn.user && !currentTurn.assistant) return;

        const turnDiv = document.createElement('div');
        turnDiv.className = 'transcript-turn';
        turnDiv.innerHTML = `
            <p class="transcript-user"><strong>You:</strong> ${currentTurn.user || '...'}</p>
            <p class="transcript-assistant"><strong>Pacure AI:</strong> ${currentTurn.assistant || '...'}</p>
        `;
        transcriptContainer.appendChild(turnDiv);
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    };

    // --- TOOL CALL HANDLING ---
    async function handleMusicCompositionTool(args) {
        try {
            const response = await fetch('/api/compose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: args.prompt }),
            });
            const responseData = await response.json();
            if (!response.ok) throw new Error(responseData.error || 'Failed to compose music.');

            const downloadLink = document.createElement('a');
            downloadLink.href = responseData.midi_data;
            downloadLink.download = `pacure-ai-composition-${Date.now()}.mid`;
            downloadLink.textContent = 'Download your MIDI file';
            downloadLink.className = 'download-link';
            
            const toolResponseDiv = document.createElement('div');
            toolResponseDiv.className = 'tool-response';
            toolResponseDiv.innerHTML = `<p>Your music is ready!</p>`;
            toolResponseDiv.appendChild(downloadLink);
            transcriptContainer.appendChild(toolResponseDiv);
            transcriptContainer.scrollTop = transcriptContainer.scrollHeight;

            return { status: 'success', message: 'MIDI file created and download link provided.' };
        } catch (error) {
            console.error('Music composition tool error:', error);
            const errorDiv = document.createElement('div');
            errorDiv.className = 'tool-response error';
            errorDiv.innerHTML = `<p>Sorry, I failed to create the music. Please try again.</p>`;
            transcriptContainer.appendChild(errorDiv);
            return { status: 'error', message: error.message };
        }
    }

    // --- AUDIO UTILITIES ---
    const playAudio = async (base64Audio) => {
        nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
        const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
        const source = outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputNode);
        source.addEventListener('ended', () => { sources.delete(source); });
        source.start(nextStartTime);
        nextStartTime += audioBuffer.duration;
        sources.add(source);
    };

    function createBlob(data) {
        const int16 = new Int16Array(data.length);
        for (let i = 0; i < data.length; i++) {
            int16[i] = data[i] * 32768;
        }
        return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
    }

    function decode(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        return bytes;
    }
    
    async function decodeAudioData(data, ctx, sampleRate, numChannels) {
        const dataInt16 = new Int16Array(data.buffer);
        const frameCount = dataInt16.length / numChannels;
        const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
        for (let channel = 0; channel < numChannels; channel++) {
            const channelData = buffer.getChannelData(channel);
            for (let i = 0; i < frameCount; i++) {
                channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
            }
        }
        return buffer;
    }

    function encode(bytes) {
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    init();
});
