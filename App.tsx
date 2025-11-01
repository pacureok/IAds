
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, MessageRole, UserProfile } from './types';
import ChatInput from './components/ChatInput';
import ChatMessage from './components/ChatMessage';
import { generateMusicComposition } from './services/geminiService';
import { MusicIcon } from './components/icons/MusicIcon';

// This is a global type from the Google script, we declare it to satisfy TypeScript
declare global {
  interface Window {
    google: any;
  }
}

// IMPORTANT: Replace this with your actual Google Client ID from the Google Cloud Console.
// The previous ID was invalid, causing the "client ID is not found" error.
// You can create one here: https://console.cloud.google.com/apis/credentials
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'initial',
      role: MessageRole.ASSISTANT,
      content: "Hello! Once you sign in, I can be your AI Music Composer. Give me a starting note, a genre, or a mood, and I'll create a short MIDI composition for you.",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthInitialized, setIsAuthInitialized] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const headerSignInRef = useRef<HTMLDivElement>(null);
  const mainSignInRef = useRef<HTMLDivElement>(null);

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
  }, []);

  // Initialize Google Auth script
  useEffect(() => {
    const storedUser = sessionStorage.getItem('userProfile');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    const checkGoogle = () => {
      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          use_fedcm_for_prompt: false, // This disables FedCM to prevent errors in embedded environments
        });
        setIsAuthInitialized(true);
      } else {
        setTimeout(checkGoogle, 100);
      }
    };
    checkGoogle();
  }, [handleCredentialResponse]);

  // Render Google Button when auth is ready and user is logged out
  useEffect(() => {
    if (isAuthInitialized && !user && window.google) {
      if (headerSignInRef.current) {
        window.google.accounts.id.renderButton(headerSignInRef.current, {
          theme: 'outline', size: 'large', type: 'standard', text: 'signin_with',
        });
      }
      if (mainSignInRef.current) {
        window.google.accounts.id.renderButton(mainSignInRef.current, {
          theme: 'filled_black', size: 'large', text: 'continue_with',
        });
      }
      window.google.accounts.id.prompt(); // One Tap prompt
    }
  }, [isAuthInitialized, user]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !user) return;

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

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
      <header className="flex items-center justify-between p-4 border-b border-gray-700/50 bg-gray-900/80 backdrop-blur-sm z-10">
        <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          Gemini MIDI Composer
        </h1>
        {user ? (
          <div className="flex items-center space-x-4">
            <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full border-2 border-gray-600" />
            <span className="text-sm font-medium hidden sm:block">{user.name}</span>
            <button onClick={handleLogout} className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-blue-500 transition-colors">
              Sign Out
            </button>
          </div>
        ) : (
          <div ref={headerSignInRef}></div>
        )}
      </header>
      
      {user ? (
        <>
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
        </>
      ) : (
        <main className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <div className="w-16 h-16 mb-6 text-purple-400">
                <MusicIcon />
            </div>
            <h2 className="text-3xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
              Welcome to the AI Music Composer
            </h2>
            <p className="text-gray-400 max-w-md mb-8">
              Sign in with your Google account to start creating beautiful MIDI compositions with the power of Gemini.
            </p>
            <div ref={mainSignInRef} className="flex justify-center"></div>
        </main>
      )}
    </div>
  );
};

export default App;
