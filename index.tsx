import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- TYPES AND CONSTANTS ---
declare global {
    // FIX: Augment the existing AIStudio type to include the 'auth' property.
    // This resolves conflicts with a global type definition for window.aistudio.
    interface AIStudio {
        auth: {
            getAuthToken: () => Promise<string>;
            getProfile: () => Promise<{ name: string; picture: string; email: string; }>;
            signIn: () => void;
            signOut: () => void;
        };
    }
    interface Window {
        MidiWriter: any;
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
        // FIX: Removed readonly modifier to match existing global declarations.
        aistudio: AIStudio;
    }
}

type AuthState = 'loading' | 'loggedIn' | 'loggedOut';
type User = { name: string; picture: string; };
type Message = {
    role: 'user' | 'assistant';
    content: string;
    midiData?: any;
    isError?: boolean;
};

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

const instrumentNameToProgramNumber = { acoustic_grand_piano: 1, bright_acoustic_piano: 2, electric_grand_piano: 3, honky_tonk_piano: 4, electric_piano_1: 5, electric_piano_2: 6, harpsichord: 7, clavi: 8, celesta: 9, glockenspiel: 10, music_box: 11, vibraphone: 12, marimba: 13, xylophone: 14, tubular_bells: 15, dulcimer: 16, drawbar_organ: 17, percussive_organ: 18, rock_organ: 19, church_organ: 20, reed_organ: 21, accordion: 22, harmonica: 23, tango_accordion: 24, acoustic_guitar_nylon: 25, acoustic_guitar_steel: 26, electric_guitar_jazz: 27, electric_guitar_clean: 28, electric_guitar_muted: 29, overdriven_guitar: 30, distortion_guitar: 31, guitar_harmonics: 32, acoustic_bass: 33, electric_bass_finger: 34, electric_bass_pick: 35, fretless_bass: 36, slap_bass_1: 37, slap_bass_2: 38, synth_bass_1: 39, synth_bass_2: 40, violin: 41, viola: 42, cello: 43, contrabass: 44, tremolo_strings: 45, pizzicato_strings: 46, orchestral_harp: 47, timpani: 48, string_ensemble_1: 49, string_ensemble_2: 50, synth_strings_1: 51, synth_strings_2: 52, choir_aahs: 53, voice_oohs: 54, synth_voice: 55, orchestra_hit: 56, trumpet: 57, trombone: 58, tuba: 59, muted_trumpet: 60, french_horn: 61, brass_section: 62, synth_brass_1: 63, synth_brass_2: 64, soprano_sax: 65, alto_sax: 66, tenor_sax: 67, baritone_sax: 68, oboe: 69, english_horn: 70, bassoon: 71, clarinet: 72, piccolo: 73, flute: 74, recorder: 75, pan_flute: 76, blown_bottle: 77, shakuhachi: 78, whistle: 79, ocarina: 80, };
const validInstruments = Object.keys(instrumentNameToProgramNumber).join(', ');

// --- Gemini API Logic ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
const responseSchema = {
    type: Type.OBJECT,
    properties: {
        instrument: { type: Type.STRING, description: `The General MIDI instrument for the composition. Must be one of: ${validInstruments}` },
        notes: {
            type: Type.ARRAY,
            description: "A sequence of musical notes.",
            items: {
                type: Type.OBJECT,
                properties: {
                    pitch: { type: Type.STRING, description: "The musical pitch, e.g., 'C4', 'F#5'. Use 'rest' for a pause." },
                    duration: { type: Type.STRING, description: "The note duration, e.g., '4' for quarter, '8' for eighth, 'd16' for dotted 16th." }
                },
                required: ["pitch", "duration"]
            }
        }
    },
    required: ["instrument", "notes"]
};

const systemInstruction = `You are an expert MIDI music composer. Your task is to generate a musical composition based on the user's prompt.
You must return a single JSON object that strictly adheres to the provided schema.
The JSON object must contain two keys: "instrument" and "notes".
The "instrument" must be a valid General MIDI instrument name from the allowed list.
The "notes" array must contain a sequence of note objects, each with a "pitch" and a "duration".
- Pitch should be in scientific pitch notation (e.g., 'C4', 'F#5'). Use 'rest' for silence.
- Duration should be a string representing the note length (e.g., '1' for whole, '2' for half, '4' for quarter, '8' for eighth). Use 'd' for dotted notes (e.g., 'd4').
Example: { "instrument": "music_box", "notes": [{"pitch": "C4", "duration": "4"}, {"pitch": "E4", "duration": "4"}, {"pitch": "G4", "duration": "4"}] }
Keep the composition relatively short and simple, around 10-20 notes, unless the user asks for something longer.
`;

async function generateMusicComposition(prompt: string): Promise<any> {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        const jsonText = response.text.trim();
        return JSON.parse(jsonText);
    } catch (error) {
        console.error("Error generating music composition:", error);
        throw new Error("Failed to parse response from AI. Please try a different prompt.");
    }
}

// --- App Component ---
const App = () => {
    // --- STATE ---
    const [authState, setAuthState] = useState<AuthState>('loading');
    const [user, setUser] = useState<User | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // --- REFS ---
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const recognitionRef = useRef<any>(null);

    // --- EFFECTS ---
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const token = await window.aistudio.auth.getAuthToken();
                if (token) {
                    const profile = await window.aistudio.auth.getProfile();
                    setUser(profile);
                    setAuthState('loggedIn');
                } else {
                    setAuthState('loggedOut');
                }
            } catch (err) {
                console.error("Auth check failed:", err);
                setAuthState('loggedOut');
            }
        };
        checkAuth();
    }, []);
    
    useEffect(() => {
        setupSpeechRecognition();
    }, []);

    useEffect(() => {
        chatContainerRef.current?.scrollTo(0, chatContainerRef.current.scrollHeight);
    }, [messages, isLoading]);

    useEffect(() => {
        resizeTextarea();
    }, [input]);

    // --- HANDLERS ---
    const handleLogin = () => window.aistudio.auth.signIn();
    const handleLogout = async () => {
        await window.aistudio.auth.signOut();
        setUser(null);
        setMessages([]);
        setAuthState('loggedOut');
    };

    const handleSubmit = async (e?: FormEvent) => {
        e?.preventDefault();
        const prompt = input.trim();
        if (!prompt || isLoading || !user) return;

        setMessages(prev => [...prev, { role: 'user', content: prompt }]);
        setInput("");
        setIsLoading(true);
        setError(null);

        try {
            const result = await generateMusicComposition(prompt);
            const content = `Here is a composition based on your request. I've used the ${result.instrument.replace(/_/g, ' ')}. You can download the MIDI file below.`;
            setMessages(prev => [...prev, { role: 'assistant', content, midiData: result }]);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
            setError(`Sorry, I couldn't generate the music. ${errorMessage}`);
            setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, I had trouble generating the music. Please try a different prompt.`, isError: true }]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleDownload = (midiData: any) => {
        if (!window.MidiWriter) {
            console.error('midi-writer-js is not loaded.');
            setError('MIDI library not available. Please refresh the page.');
            return;
        }
        try {
            const track = new window.MidiWriter.Track();
            const programNumber = instrumentNameToProgramNumber[midiData.instrument as keyof typeof instrumentNameToProgramNumber] || 1;
            track.addEvent(new window.MidiWriter.ProgramChangeEvent({ instrument: programNumber }));

            midiData.notes.forEach((note: { pitch: string | string[], duration: string }) => {
                track.addEvent(new window.MidiWriter.NoteEvent({
                    pitch: note.pitch === 'rest' ? null : note.pitch,
                    duration: note.duration,
                    wait: note.pitch === 'rest' ? note.duration : undefined,
                }));
            });

            const write = new window.MidiWriter.Writer([track]);
            const link = document.createElement('a');
            link.href = write.dataUri();
            link.download = `composition-${Date.now()}.mid`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error("Failed to generate MIDI file:", err);
            setError("Could not generate MIDI file. The data may be invalid.");
        }
    };
    
    const handleSuggestionClick = (prompt: string) => {
        setInput(prompt);
        textareaRef.current?.focus();
    };

    // --- SPEECH RECOGNITION ---
    const setupSpeechRecognition = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => setInput(event.results[0][0].transcript);
        recognition.onerror = (event: any) => console.error('Speech recognition error:', event.error);
        recognition.onend = () => setIsListening(false);
        recognitionRef.current = recognition;
    };
    
    const handleMicClick = () => {
        if (isLoading || !recognitionRef.current) return;
        if (isListening) {
            recognitionRef.current.stop();
        } else {
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    // --- UTILITIES ---
    const resizeTextarea = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const newHeight = Math.min(textareaRef.current.scrollHeight, 160);
            textareaRef.current.style.height = `${newHeight}px`;
        }
    };

    // --- RENDER ---
    if (authState === 'loading') {
        return <div className="view visible"><div className="loader-spinner"></div></div>;
    }

    if (authState === 'loggedOut') {
        return (
            <div className="view visible">
                <div className="login-container">
                    <div className="login-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                            <path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>
                        </svg>
                    </div>
                    <h1 className="login-title">Welcome to Gemini MIDI Composer</h1>
                    <p className="login-subtitle">Your AI partner in music creation.</p>
                    <button id="login-button" className="google-login-button" onClick={handleLogin}>
                        <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 48 48">
                            <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12 c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24 c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657 C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36 c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.574l6.19,5.238 C42.732,36.216,44,30.651,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                        </svg>
                        <span>Continue with Google</span>
                    </button>
                    <p className="login-tos">By signing in, you agree to our imaginary Terms of Service and Privacy Policy.</p>
                </div>
            </div>
        );
    }
    
    return (
        <div className="view visible">
            <div className="app-container">
                <header className="app-header">
                    <h1 className="app-title">Gemini MIDI Composer</h1>
                    <div id="user-info" className="user-info">
                        <img src={user?.picture} alt={user?.name} className="user-avatar" />
                        <span className="user-name">{user?.name}</span>
                        <button id="logout-button" className="logout-button" onClick={handleLogout}>Sign Out</button>
                    </div>
                </header>

                <main id="chat-container" className="chat-container" ref={chatContainerRef}>
                    {messages.length === 0 && (
                         <div className="initial-view">
                            <div className="initial-view-header">
                                <div className="gemini-icon-large" dangerouslySetInnerHTML={{ __html: GEMINI_ICON_SVG.replace(/40/g, '80') }} />
                                <h1>Hello, {user?.name.split(' ')[0]}!</h1>
                                <p>What music are we creating today?</p>
                            </div>
                            <div className="suggestion-chips">
                                <button className="suggestion-chip" onClick={() => handleSuggestionClick("A simple, happy melody on a music box")}>Simple melody on a music box</button>
                                <button className="suggestion-chip" onClick={() => handleSuggestionClick("A spooky theme for a Halloween video using a church organ")}>Spooky Halloween theme</button>
                                <button className="suggestion-chip" onClick={() => handleSuggestionClick("Create an 8-bit chiptune track for a retro game")}>8-bit chiptune track</button>
                                <button className="suggestion-chip" onClick={() => handleSuggestionClick("A lo-fi hip hop beat with an electric piano")}>Lo-fi hip hop beat</button>
                            </div>
                        </div>
                    )}

                    {messages.map((msg, index) => (
                        <div key={index} className={`message-wrapper ${msg.role}`}>
                            <div className="avatar-container" dangerouslySetInnerHTML={{ __html: msg.role === 'user' ? `<img src="${user?.picture}" alt="${user?.name}" />` : GEMINI_ICON_SVG }} />
                            <div className="message-content-wrapper">
                                <div className="message-content" style={{ padding: msg.role === 'assistant' ? 0 : '1rem', background: msg.role === 'assistant' ? 'transparent' : '' }}>
                                    <p>{msg.content}</p>
                                    {msg.midiData && (
                                        <div className="midi-card">
                                            <div className="midi-details">
                                                <p>Instrument: <span>{msg.midiData.instrument.replace(/_/g, ' ')}</span></p>
                                                <button className="download-button" onClick={() => handleDownload(msg.midiData)}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>
                                                    <span>Download MIDI</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    
                    {isLoading && (
                        <div className="message-wrapper assistant">
                            <div className="avatar-container" dangerouslySetInnerHTML={{ __html: GEMINI_ICON_SVG }} />
                            <div className="message-content-wrapper">
                                <div className="loading-dots"><div></div><div></div><div></div></div>
                            </div>
                        </div>
                    )}

                </main>

                <footer className="app-footer">
                    {error && <p id="error-message" className="error-message" style={{display: 'block'}}>{error}</p>}
                    <div className="chat-input-wrapper">
                        <form id="chat-form" className="chat-form" onSubmit={handleSubmit}>
                            <button type="button" id="mic-button" className={`mic-button ${isListening ? 'listening' : ''}`} aria-label="Start listening" onClick={handleMicClick} disabled={isLoading}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
                            </button>
                            <textarea
                                id="message-input"
                                ref={textareaRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e as any) }}
                                placeholder={isListening ? "Listening..." : "Describe the music you want to create..."}
                                className="message-input"
                                rows={1}
                                disabled={isLoading}
                            />
                            <button type="submit" id="send-button" className="send-button" aria-label="Send message" disabled={isLoading || !input.trim()}>
                               {isLoading ? <div className="loader-spinner-small"></div> : <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>}
                            </button>
                        </form>
                    </div>
                </footer>
            </div>
        </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
