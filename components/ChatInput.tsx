import React, { useState, useRef, useEffect } from 'react';
import { SendIcon } from './icons/SendIcon';
import { MicIcon } from './icons/MicIcon';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  isDisabled?: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ input, setInput, handleSubmit, isLoading, isDisabled }) => {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) {
      console.log('Speech recognition not supported');
      return;
    }

    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };
    
    recognition.onend = () => {
        setIsListening(false);
    }

    recognitionRef.current = recognition;
  }, [setInput]);

  const handleMicClick = () => {
    if (isLoading || isDisabled) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center w-full p-2 bg-gray-800 rounded-xl border border-gray-700 shadow-lg focus-within:ring-2 focus-within:ring-blue-500 transition-shadow"
    >
      <button
        type="button"
        onClick={handleMicClick}
        disabled={isLoading || !recognitionRef.current || isDisabled}
        className={`flex-shrink-0 p-2 rounded-full hover:bg-gray-700 transition-colors disabled:opacity-50 ${isListening ? 'text-red-500 animate-pulse' : 'text-gray-400'}`}
        aria-label={isListening ? 'Stop listening' : 'Start listening'}
      >
        <MicIcon />
      </button>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isDisabled ? "Please sign in to start composing..." : isListening ? "Listening..." : "Describe the music you want to create..."}
        className="flex-grow bg-transparent text-gray-100 placeholder-gray-500 focus:outline-none resize-none mx-2 max-h-40"
        rows={1}
        disabled={isLoading || isDisabled}
      />
      <button
        type="submit"
        disabled={isLoading || !input.trim() || isDisabled}
        className="flex-shrink-0 p-2 rounded-full bg-blue-600 text-white hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        aria-label="Send message"
      >
        {isLoading ? (
          <div className="w-5 h-5 border-2 border-t-transparent border-white rounded-full animate-spin"></div>
        ) : (
          <SendIcon />
        )}
      </button>
    </form>
  );
};

export default ChatInput;
