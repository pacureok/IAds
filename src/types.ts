export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export interface MidiNote {
  pitch: string | string[];
  duration: string;
}

export interface MidiData {
  instrument: string;
  notes: MidiNote[];
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  midiData?: MidiData;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  picture: string;
}