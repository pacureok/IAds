import React, { useState, useRef, useEffect } from 'react';
import { Message, MessageRole, UserProfile } from './types';
import ChatInput from './components/ChatInput';
import ChatMessage from './components/ChatMessage';
import { generateMusicComposition } from './services/geminiService';
import { MusicIcon } from './components/icons/MusicIcon';
import { GoogleIcon } from './components/icons/GoogleIcon';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    window.location.href = '/logout';
  };
  
  const handleLogin = () => {
    window.location.href = '/login';
  }

  // Check for active session on component mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch('/api/session');
        if (response.ok) {
          const userData: UserProfile = await response.json();
          setUser(userData);
          setMessages([
            {
              id: 'initial',
              role: MessageRole.ASSISTANT,
              content: `Welcome back, ${userData.name.split(' ')[0]}! Let's create some music.`,
            },
          ]);
        } else {
          setUser(null);
          setMessages([
            {
              id: 'initial-logged-out',
              role: MessageRole.ASSISTANT,
              content: `Hello! Please sign in to begin creating music.`,
            },
          ]);
        }
      } catch (err) {
        console.error("Failed to check session:", err);
        setError("Could not connect to the server to check your session.");
        setUser(null);
      } finally {
        setIsAuthLoading(false);
      }
    };
    checkSession();
  }, []);

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
      if ((err as Error).message === 'Unauthorized') {
        // Session expired or invalid, force logout
        setError("Your session has expired. Please sign in again.");
        setUser(null);
         setMessages([
            {
              id: 'session-expired',
              role: MessageRole.ASSISTANT,
              content: `Your session has expired. Please sign in again to continue creating.`,
            },
          ]);
      } else {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Sorry, I couldn't generate the music. ${errorMessage}`);
        const errorResponseMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: MessageRole.ASSISTANT,
          content: `Sorry, I had trouble generating the music. Please try a different prompt.`,
        };
        setMessages((prev) => [...prev, errorResponseMessage]);
      }
    } finally {
      setIsLoading(false);
    }
  };
  
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

  // Logged out view
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-white p-4">
        <div className="w-full max-w-sm text-center">
            <div className="w-12 h-12 mx-auto mb-4 text-purple-400">
                 <MusicIcon />
            </div>
            <h1 className="text-2xl font-bold mb-4">Welcome to Gemini MIDI Composer</h1>
            
            <button 
                onClick={handleLogin}
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
