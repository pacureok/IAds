import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, MessageRole, UserProfile } from './types';
import ChatInput from './components/ChatInput';
import ChatMessage from './components/ChatMessage';
import { generateMusicComposition } from './services/geminiService';
import { MusicIcon } from './components/icons/MusicIcon';
import { GoogleIcon } from './components/icons/GoogleIcon';
import { WarningIcon } from './components/icons/WarningIcon';

declare global {
  interface Window {
    google: any;
  }
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleCredentialResponse = useCallback((response: any) => {
    try {
      const payload = JSON.parse(atob(response.credential.split('.')[1]));
      const userProfile: UserProfile = {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
      };
      setUser(userProfile);
      sessionStorage.setItem('userProfile', JSON.stringify(userProfile));
       setMessages([
        {
          id: 'initial',
          role: MessageRole.ASSISTANT,
          content: `Hello ${userProfile.name.split(' ')[0]}! I'm your AI Music Composer. Give me a starting note, a genre, or a mood, and I'll create a MIDI composition for you.`,
        },
      ]);
    } catch (e) {
      console.error("Failed to decode credential response:", e);
      setError("There was an issue signing you in.");
    }
  }, []);

  const handleLogout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('userProfile');
    if (window.google) {
      window.google.accounts.id.disableAutoSelect();
    }
    setMessages([
      {
        id: 'initial-logged-out',
        role: MessageRole.ASSISTANT,
        content: `You've been signed out. Sign in again to continue creating music.`,
      },
    ]);
  }, []);

  // Initialize Google Auth and check for stored session
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')) {
      setConfigError(
        'This error indicates the Client ID is missing, invalid, or a placeholder.\n\n' +
        'Please follow these steps:\n' +
        '1. Go to the Google Cloud Console and select your project.\n' +
        '2. Navigate to "APIs & Services" > "Credentials".\n' +
        '3. Create an "OAuth 2.0 Client ID" for a "Web application".\n' +
        '4. Add your app\'s URL to the "Authorized JavaScript origins". For local development, this is often `http://localhost:5173` or the URL provided by your development server.\n' +
        '5. Copy the generated Client ID.\n' +
        '6. Set this ID as the `VITE_GOOGLE_CLIENT_ID` environment variable in your project setup.'
      );
      setIsAuthLoading(false);
      return;
    }

    const storedUser = sessionStorage.getItem('userProfile');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      setMessages([
        {
          id: 'initial',
          role: MessageRole.ASSISTANT,
          content: `Welcome back, ${parsedUser.name.split(' ')[0]}! Let's create some music.`,
        },
      ]);
    } else {
        setMessages([
        {
            id: 'initial-logged-out',
            role: MessageRole.ASSISTANT,
            content: `Hello! Please sign in to begin creating music.`,
        },
        ]);
    }

    const checkGoogle = () => {
      if (window.google && window.google.accounts) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          use_fedcm_for_prompt: false,
        });
        setIsAuthLoading(false);
      } else {
        setTimeout(checkGoogle, 100);
      }
    };
    checkGoogle();
  }, [handleCredentialResponse]);
  
  const handleLoginClick = () => {
      if (window.google && window.google.accounts) {
          window.google.accounts.id.prompt();
      } else {
          setError("Google Sign-In is not ready yet. Please try again in a moment.");
      }
  };


  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !user) return;
    
    if (messages.length === 1 && messages[0].id.startsWith('initial')) {
        setMessages([]);
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: MessageRole.USER,
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const result = await generateMusicComposition(input);
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: MessageRole.ASSISTANT,
        content: `Here is a composition based on your request. I've used the ${result.instrument.replace(/_/g, ' ')}. You can download the MIDI file below.`,
        midiData: result,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Sorry, I couldn't generate the music. ${errorMessage}`);
      const errorResponseMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: MessageRole.ASSISTANT,
        content: `Sorry, I had trouble generating the music. Please try a different prompt.`,
      };
      setMessages((prev) => [...prev, errorResponseMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  if (configError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-white p-6">
        <div className="w-full max-w-2xl text-left bg-gray-800 p-8 rounded-lg border border-yellow-500/50 shadow-2xl">
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 mr-3 text-yellow-400">
                <WarningIcon />
            </div>
            <h1 className="text-2xl font-bold text-yellow-400">Configuration Required</h1>
          </div>
          <p className="text-gray-300 mb-4">
            The Google Client ID for this application is missing or invalid. Please configure it to enable Google Sign-In.
          </p>
          <div className="bg-gray-900 p-4 rounded-md text-gray-400 text-sm">
            <pre className="whitespace-pre-wrap font-mono">{configError}</pre>
          </div>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-block px-6 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
          >
            Open Google Cloud Credentials
          </a>
        </div>
      </div>
    );
  }
  
  if (isAuthLoading) {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-gray-900">
             <div className="w-16 h-16 border-4 border-t-transparent border-blue-500 rounded-full animate-spin"></div>
        </div>
    )
  }

  if (user) {
    return (
        <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
          <header className="flex items-center justify-between p-4 border-b border-gray-700/50 bg-gray-900/80 backdrop-blur-sm z-10">
            <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
              Gemini MIDI Composer
            </h1>
            <div className="flex items-center space-x-4">
                <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full border-2 border-gray-600" />
                <span className="text-sm font-medium hidden sm:block">{user.name}</span>
                <button onClick={handleLogout} className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors">
                Sign Out
                </button>
            </div>
          </header>
          
          <main ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isLoading && <ChatMessage isLoading />}
          </main>
          <footer className="p-4 md:p-6 bg-gray-900/80 backdrop-blur-sm">
            {error && <p className="text-red-400 text-center mb-2">{error}</p>}
            <div className="max-w-3xl mx-auto">
              <ChatInput
                input={input}
                setInput={setInput}
                handleSubmit={handleSubmit}
                isLoading={isLoading}
                isDisabled={!user}
              />
            </div>
          </footer>
        </div>
    );
  }

  // Logged out view (ChatGPT Style)
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-white p-4">
        <div className="w-full max-w-sm text-center">
            <div className="w-12 h-12 mx-auto mb-4 text-purple-400">
                 <MusicIcon />
            </div>
            <h1 className="text-2xl font-bold mb-4">Welcome to Gemini MIDI Composer</h1>
            
            <button 
                onClick={handleLoginClick}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 mb-4 font-semibold text-gray-800 bg-white rounded-lg hover:bg-gray-200 transition-colors shadow-md"
            >
                <GoogleIcon />
                Continue with Google
            </button>

            <p className="text-xs text-gray-500">
                By signing in, you agree to our imaginary Terms of Service and Privacy Policy.
            </p>
        </div>
    </div>
  );
};

export default App;
