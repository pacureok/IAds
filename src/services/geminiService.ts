import { GoogleGenAI, Type } from '@google/genai';
import { MidiData } from '../types';

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const musicCompositionSchema = {
  type: Type.OBJECT,
  properties: {
    instrument: {
      type: Type.STRING,
      description: 'The General MIDI instrument name for the track, e.g., acoustic_grand_piano. Use snake_case.',
    },
    notes: {
      type: Type.ARRAY,
      description: 'An array of musical notes.',
      items: {
        type: Type.OBJECT,
        properties: {
          pitch: {
            type: Type.STRING,
            description: "The note's pitch. For single notes, use scientific pitch notation (e.g., 'C4', 'F#5'). For chords, use a JSON string representation of an array (e.g., '[\"C4\", \"E4\", \"G4\"]'). Use sharps for accidentals.",
          },
          duration: {
            type: Type.STRING,
            description: "The note's duration. Use '1' for whole, '2' for half, '4' for quarter, '8' for eighth, 'd4' for dotted quarter, 't' for triplet.",
          },
        },
        required: ['pitch', 'duration'],
      },
    },
  },
  required: ['instrument', 'notes'],
};

export async function generateMusicComposition(prompt: string): Promise<MidiData> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `User prompt: "${prompt}"`,
      config: {
        systemInstruction: `You are an expert music composition assistant. Your task is to generate a short musical piece based on the user's prompt. 
        The output must be a valid JSON object that adheres to the provided schema. 
        - Interpret the user's request (e.g., genre, mood, scale, specific notes) to create a coherent and musical sequence.
        - The sequence should be between 4 and 16 notes long.
        - Ensure pitches are valid musical notes (e.g., 'C4', 'G#5'). For chords, provide a JSON string array like '["C4", "E4"]'.
        - Durations must be from the allowed set ('1', '2', '4', '8', 'd4', 't', etc.).
        - Choose a suitable General MIDI instrument in snake_case format.`,
        responseMimeType: 'application/json',
        responseSchema: musicCompositionSchema,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("The AI model returned an empty response.");
    }
    const jsonString = text.trim();
    const parsedJson = JSON.parse(jsonString);

    // Post-process pitches: Convert stringified arrays into actual arrays
    parsedJson.notes.forEach((note: any) => {
        if (typeof note.pitch === 'string' && note.pitch.startsWith('[')) {
            try {
                note.pitch = JSON.parse(note.pitch);
            } catch (e) {
                console.error("Failed to parse chord pitch:", note.pitch);
                // Keep it as a string if parsing fails
            }
        }
    });


    // Basic validation
    if (!parsedJson.instrument || !Array.isArray(parsedJson.notes)) {
        throw new Error("Invalid JSON structure received from API.");
    }

    return parsedJson as MidiData;

  } catch (error) {
    console.error('Error calling Gemini API:', error);
    throw new Error('Failed to generate music from AI. The model may have returned an invalid format.');
  }
}
