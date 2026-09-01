// Starting points for an average user to riff on — addresses "blank slate is
// no fun" feedback. Also callable by the agent via the load_preset tool.

const PRESETS = [
  {
    id: 'warm_pad',
    name: 'Warm Pad',
    oscillators: [
      { waveform: 'triangle', level: 0.8, detune: 0, semitone: 0 },
      { waveform: 'sine', level: 0.6, detune: 7, semitone: 0 },
      { waveform: 'sine', level: 0.4, detune: -7, semitone: -12 },
    ],
    filter: { cutoff: 1400, resonance: 1 },
    envelope: { attack: 0.6, decay: 0.4, sustain: 0.8, release: 1.4 },
    effect: { enabled: true, mix: 0.35 },
  },
  {
    id: 'punchy_bass',
    name: 'Punchy Bass',
    oscillators: [
      { waveform: 'sawtooth', level: 0.9, detune: 0, semitone: 0 },
      { waveform: 'square', level: 0.3, detune: 0, semitone: 0 },
      { waveform: 'sine', level: 0.7, detune: 0, semitone: -12 },
    ],
    filter: { cutoff: 900, resonance: 3 },
    envelope: { attack: 0.002, decay: 0.15, sustain: 0.3, release: 0.15 },
    effect: { enabled: false, mix: 0.2 },
  },
  {
    id: 'lofi_beat',
    name: 'Lo-Fi Beat',
    oscillators: [
      { waveform: 'triangle', level: 0.8, detune: 12, semitone: 0 },
      { waveform: 'square', level: 0.4, detune: -14, semitone: 0 },
      { waveform: 'sine', level: 0.3, detune: 0, semitone: -12 },
    ],
    filter: { cutoff: 1100, resonance: 2 },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.5 },
    effect: { enabled: true, mix: 0.4 },
  },
  {
    id: 'bright_pluck',
    name: 'Bright Pluck',
    oscillators: [
      { waveform: 'sawtooth', level: 0.9, detune: 0, semitone: 0 },
      { waveform: 'square', level: 0.25, detune: 5, semitone: 12 },
      { waveform: 'sine', level: 0, detune: 0, semitone: 0 },
    ],
    filter: { cutoff: 6500, resonance: 4 },
    envelope: { attack: 0.001, decay: 0.25, sustain: 0.1, release: 0.2 },
    effect: { enabled: true, mix: 0.2 },
  },
  {
    id: 'ambient_drone',
    name: 'Ambient Drone',
    oscillators: [
      { waveform: 'sine', level: 0.7, detune: 0, semitone: 0 },
      { waveform: 'triangle', level: 0.6, detune: 10, semitone: 7 },
      { waveform: 'sine', level: 0.5, detune: -10, semitone: -12 },
    ],
    filter: { cutoff: 1800, resonance: 0.5 },
    envelope: { attack: 1.8, decay: 0.8, sustain: 0.9, release: 2.5 },
    effect: { enabled: true, mix: 0.55 },
  },
  {
    id: 'retro_lead',
    name: 'Retro Lead',
    oscillators: [
      { waveform: 'square', level: 0.8, detune: 0, semitone: 0 },
      { waveform: 'square', level: 0.6, detune: 15, semitone: 0 },
      { waveform: 'sawtooth', level: 0.3, detune: -15, semitone: 0 },
    ],
    filter: { cutoff: 3200, resonance: 5 },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.25 },
    effect: { enabled: true, mix: 0.25 },
  },
];
