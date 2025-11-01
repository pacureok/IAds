import { MidiData } from '../types';

export async function generateMusicComposition(prompt: string): Promise<MidiData> {
  try {
    const response = await fetch('/api/compose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (response.status === 401) {
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'The server returned an error.');
    }

    const result = await response.json();
    return result as MidiData;

  } catch (error) {
    console.error('Error calling backend API:', error);
    if (error instanceof Error) {
        throw error; // Re-throw the original error to be handled by the component
    }
    throw new Error('Failed to generate music. Please check your connection.');
  }
}
