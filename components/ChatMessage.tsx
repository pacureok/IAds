
import React from 'react';
import { Message, MessageRole } from '../types';
import { generateAndDownloadMidi } from '../services/midiService';
import { MusicIcon } from './icons/MusicIcon';
import { DownloadIcon } from './icons/DownloadIcon';

interface ChatMessageProps {
  message?: Message;
  isLoading?: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex items-start space-x-4 max-w-3xl mx-auto">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
            <div className="w-6 h-6 text-white">
                <MusicIcon />
            </div>
        </div>
        <div className="flex items-center space-x-2 p-4 bg-gray-800 rounded-xl">
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0s'}}></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
        </div>
      </div>
    );
  }

  if (!message) return null;

  const isUser = message.role === MessageRole.USER;

  const handleDownload = () => {
    if (message.midiData) {
      generateAndDownloadMidi(message.midiData);
    }
  };

  return (
    <div className={`flex items-start space-x-4 max-w-3xl mx-auto ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
          <div className="w-6 h-6 text-white">
              <MusicIcon />
          </div>
        </div>
      )}
      <div
        className={`p-4 rounded-xl max-w-lg ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-none'
            : 'bg-gray-800 text-gray-200 rounded-bl-none'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.midiData && (
          <div className="mt-4 p-4 bg-gray-700/50 rounded-lg">
            <h3 className="text-md font-semibold text-blue-300 mb-2">Generated Composition</h3>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-300">
                Instrument: <span className="font-mono">{message.midiData.instrument.replace(/_/g, ' ')}</span>
              </p>
              <button
                onClick={handleDownload}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
                aria-label="Download MIDI file"
              >
                <DownloadIcon />
                <span>Download</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
