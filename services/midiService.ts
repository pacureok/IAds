
import { MidiData, MidiNote } from '../types';

// This function assumes midi-writer-js is loaded from a CDN and available on the window object.
declare const window: any;

const instrumentNameToProgramNumber: { [key: string]: number } = {
  acoustic_grand_piano: 1,
  bright_acoustic_piano: 2,
  electric_grand_piano: 3,
  honky_tonk_piano: 4,
  electric_piano_1: 5,
  electric_piano_2: 6,
  harpsichord: 7,
  clavi: 8,
  celesta: 9,
  glockenspiel: 10,
  music_box: 11,
  vibraphone: 12,
  marimba: 13,
  xylophone: 14,
  tubular_bells: 15,
  dulcimer: 16,
  drawbar_organ: 17,
  percussive_organ: 18,
  rock_organ: 19,
  church_organ: 20,
  reed_organ: 21,
  accordion: 22,
  harmonica: 23,
  tango_accordion: 24,
  acoustic_guitar_nylon: 25,
  acoustic_guitar_steel: 26,
  electric_guitar_jazz: 27,
  electric_guitar_clean: 28,
  electric_guitar_muted: 29,
  overdriven_guitar: 30,
  distortion_guitar: 31,
  guitar_harmonics: 32,
  acoustic_bass: 33,
  electric_bass_finger: 34,
  electric_bass_pick: 35,
  fretless_bass: 36,
  slap_bass_1: 37,
  slap_bass_2: 38,
  synth_bass_1: 39,
  synth_bass_2: 40,
  violin: 41,
  viola: 42,
  cello: 43,
  contrabass: 44,
  tremolo_strings: 45,
  pizzicato_strings: 46,
  orchestral_harp: 47,
  timpani: 48,
  string_ensemble_1: 49,
  string_ensemble_2: 50,
  synth_strings_1: 51,
  synth_strings_2: 52,
  choir_aahs: 53,
  voice_oohs: 54,
  synth_voice: 55,
  orchestra_hit: 56,
  trumpet: 57,
  trombone: 58,
  tuba: 59,
  muted_trumpet: 60,
  french_horn: 61,
  brass_section: 62,
  synth_brass_1: 63,
  synth_brass_2: 64,
  soprano_sax: 65,
  alto_sax: 66,
  tenor_sax: 67,
  baritone_sax: 68,
  oboe: 69,
  english_horn: 70,
  bassoon: 71,
  clarinet: 72,
  piccolo: 73,
  flute: 74,
  recorder: 75,
  pan_flute: 76,
  blown_bottle: 77,
  shakuhachi: 78,
  whistle: 79,
  ocarina: 80,
};

export const generateAndDownloadMidi = (midiData: MidiData, fileName: string = 'composition.mid') => {
  if (!window.MidiWriter) {
    console.error('midi-writer-js is not loaded.');
    alert('MIDI library not available. Please refresh the page.');
    return;
  }
  
  const track = new window.MidiWriter.Track();
  
  const programNumber = instrumentNameToProgramNumber[midiData.instrument] || 1; // Default to piano
  track.addEvent(new window.MidiWriter.ProgramChangeEvent({ instrument: programNumber }));

  midiData.notes.forEach((note: MidiNote) => {
    track.addEvent(new window.MidiWriter.NoteEvent({
        pitch: note.pitch,
        duration: note.duration,
    }));
  });

  const write = new window.MidiWriter.Writer([track]);
  const dataUri = write.dataUri();
  
  const link = document.createElement('a');
  link.href = dataUri;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
