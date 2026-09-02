// Core Web Audio synth engine. No DOM references here — pure audio logic
// so both the UI and the WebMCP tools can drive the same functions.

// Equal-temperament frequency table, generated rather than hand-typed so the
// keyboard can span multiple octaves (A4 = 440Hz, MIDI note 69).
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_FREQS = {};
for (let octave = 0; octave <= 7; octave++) {
  NOTE_NAMES.forEach((name, i) => {
    const midi = (octave + 1) * 12 + i;
    NOTE_FREQS[`${name}${octave}`] = 440 * Math.pow(2, (midi - 69) / 12);
  });
}

const DEFAULT_OSCILLATORS = [
  { waveform: 'sawtooth', level: 1, detune: 0, semitone: 0 },
  { waveform: 'square', level: 0, detune: 6, semitone: 0 },
  { waveform: 'sine', level: 0, detune: 0, semitone: -12 },
];

// The delay line's own fixed characteristics — not user-adjustable (only
// enabled/mix are), but real values the UI reads to describe and visualize
// the echo, rather than a second copy of these numbers hardcoded in ui.js.
const DELAY_TIME_S = 0.28;
const DELAY_FEEDBACK = 0.35;

// The canonical list of things that can carry a value, an annotation bubble,
// and a line in the agent's reply. Keyed the same everywhere.
const MODULE_PARAMS = ['oscillator-0', 'oscillator-1', 'oscillator-2', 'filter', 'envelope', 'effect'];
const MODULE_LABELS = {
  'oscillator-0': 'OSC 1',
  'oscillator-1': 'OSC 2',
  'oscillator-2': 'OSC 3',
  filter: 'Filter',
  envelope: 'Envelope',
  effect: 'Delay',
};

// THE single place engine state becomes a human-readable number string.
// Every number the user can see — annotation bubbles, the agent's chat reply,
// tool return values fed back to the model — is produced by this function
// reading live engine state at the moment of rendering. Nothing caches a
// formatted value, so nothing can survive past the state it described.
function describeModule(engine, param) {
  if (param.startsWith('oscillator-')) {
    const osc = engine.oscillators[Number(param.slice('oscillator-'.length))];
    if (!osc) return '';
    if (osc.level <= 0.001) return 'off (level 0.00)';
    const tune = `${osc.semitone >= 0 ? '+' : ''}${osc.semitone}`;
    return `${osc.waveform}, level ${osc.level.toFixed(2)}, tune ${tune} st, detune ${osc.detune}¢`;
  }
  if (param === 'filter') {
    return `cutoff ${Math.round(engine.filterFreq)} Hz, resonance ${engine.filterQ.toFixed(1)}`;
  }
  if (param === 'envelope') {
    const e = engine.envelope;
    return `attack ${e.attack.toFixed(2)}s, decay ${e.decay.toFixed(2)}s, ` +
      `sustain ${e.sustain.toFixed(2)}, release ${e.release.toFixed(2)}s`;
  }
  if (param === 'effect') {
    return `${engine.effect.enabled ? 'on' : 'off'}, mix ${engine.effect.mix.toFixed(2)}`;
  }
  return '';
}

// The same patch, said in the words a beginner would actually reach for.
// Purely rule-based off live parameter values — the teaching angle in
// miniature: it shows that "warm" and "plucky" are not vibes, they are the
// cutoff and the envelope, and it moves the instant you turn the knob.
// Three slots: how bright it is, what character the filter/mix give it, and
// how it behaves over the life of a note.
function describePatchCharacter(engine) {
  const { filterFreq: cutoff, filterQ: q, envelope: env, oscillators: oscs } = engine;
  const words = [];

  if (cutoff < 500) words.push('DARK');
  else if (cutoff < 1200) words.push('WARM');
  else if (cutoff < 3000) words.push('MELLOW');
  else if (cutoff < 8000) words.push('BRIGHT');
  else words.push('SHARP');

  const audible = oscs.filter((o) => o.level > 0.05);
  const spread = audible.some((o) => Math.abs(o.detune) > 4) ||
    new Set(audible.map((o) => o.semitone)).size > 1;
  if (q >= 10) words.push('SCREAMING');
  else if (q >= 5) words.push('SQUELCHY');
  else if (q >= 2.5) words.push('VOCAL');
  else if (audible.length >= 3 || (audible.length >= 2 && spread)) words.push('THICK');
  else if (audible.length >= 2) words.push('FULL');
  else words.push('ROUND');

  const wet = engine.effect.enabled ? engine.effect.mix : 0;
  if (env.attack >= 0.5) words.push('SWELLING');
  else if (env.release >= 1.2 || wet >= 0.5) words.push('CAVERNOUS');
  else if (env.sustain <= 0.25 && env.decay <= 0.35) words.push('PLUCKY');
  else if (env.attack <= 0.02 && env.sustain <= 0.6) words.push('PUNCHY');
  else if (wet >= 0.3) words.push('SPACIOUS');
  else words.push('SUSTAINED');

  return words;
}

// One word for what a single oscillator is contributing to the mix — the
// same "translate the numbers into beginner language" idea as
// describePatchCharacter, scoped to one oscillator's own waveform/tune/level
// rather than the whole patch.
function describeOscCharacter(osc) {
  if (!osc || osc.level <= 0.001) return 'OFF';
  if (osc.semitone <= -7) return 'SUB';
  if (osc.semitone >= 12) return 'HIGH';
  switch (osc.waveform) {
    case 'sawtooth': return osc.semitone >= 5 ? 'BRIGHT' : 'BUZZY';
    case 'square': return 'HOLLOW';
    case 'triangle': return 'SOFT';
    case 'sine':
    default: return osc.semitone >= 5 ? 'THIN' : 'PURE';
  }
}

// A full readout of every module, used to diff engine state across an agent
// turn. Diffing actual state is how we know what "changed" — no bookkeeping
// inside the tools to get out of sync, and a value overwritten later in the
// turn contributes only its final form.
function snapshotState(engine) {
  return Object.fromEntries(MODULE_PARAMS.map((p) => [p, describeModule(engine, p)]));
}

class SynthEngine {
  constructor() {
    this.ctx = null;
    this.oscillators = DEFAULT_OSCILLATORS.map((o) => ({ ...o }));
    this.filterFreq = 2000;
    this.filterQ = 1;
    this.envelope = { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.3 };
    this.effect = { enabled: false, mix: 0.3 };
    this.activeVoice = null;
    // Name of the last preset actually loaded, so a reply that names a preset
    // can be checked against the one that really got applied.
    this.lastPresetName = null;
    this._changeListeners = [];
    this._noteListeners = [];
  }

  // Note on/off, so a visualisation can follow the envelope in real time
  // against the same trigger that starts the sound.
  onNote(fn) {
    this._noteListeners.push(fn);
    return () => {
      this._noteListeners = this._noteListeners.filter((f) => f !== fn);
    };
  }

  _notifyNote(type) {
    this._noteListeners.forEach((fn) => fn(type));
  }

  // Any mutation announces which module it touched. Annotation bubbles
  // subscribe to this and re-derive their numbers, so a bubble written by an
  // earlier tool call cannot keep displaying a value that a later call, a
  // preset load, or a knob turn has since replaced.
  onChange(fn) {
    this._changeListeners.push(fn);
    return () => {
      this._changeListeners = this._changeListeners.filter((f) => f !== fn);
    };
  }

  _notifyChange(param) {
    this._changeListeners.forEach((fn) => fn(param));
  }

  // Audio context must be created/resumed from a user gesture.
  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._buildGraph();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.filterNode = ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.value = this.filterFreq;
    this.filterNode.Q.value = this.filterQ;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.7;

    // Limiter: 3 mixed oscillators plus resonance can push well past 0dB
    // (agent-driven or preset combos included) — catch it before it clips.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 2;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.1;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // Dry path: filter output straight to master.
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.filterNode.connect(this.dryGain);
    this.dryGain.connect(this.masterGain);

    // Wet path: filter output -> delay (with feedback) -> wetGain -> master.
    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = DELAY_TIME_S;
    this.feedbackGain = ctx.createGain();
    this.feedbackGain.gain.value = DELAY_FEEDBACK;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0;

    this.filterNode.connect(this.delayNode);
    this.delayNode.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.wetGain);
    this.wetGain.connect(this.masterGain);
  }

  setOscillator(index, { waveform, level, detune, semitone } = {}) {
    const osc = this.oscillators[index];
    if (!osc) return;
    if (waveform != null) osc.waveform = waveform;
    if (level != null) osc.level = level;
    if (detune != null) osc.detune = detune;
    if (semitone != null) osc.semitone = semitone;

    const live = this.activeVoice?.voices[index];
    if (live) {
      if (waveform != null) live.osc.type = waveform;
      if (level != null) live.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.01);
      if (detune != null) live.osc.detune.setTargetAtTime(detune, this.ctx.currentTime, 0.01);
      if (semitone != null) {
        live.osc.frequency.setTargetAtTime(
          this.activeVoice.baseFreq * Math.pow(2, osc.semitone / 12),
          this.ctx.currentTime,
          0.01
        );
      }
    }
    this._notifyChange(`oscillator-${index}`);
  }

  setFilter({ cutoff, resonance } = {}) {
    if (cutoff != null) {
      this.filterFreq = cutoff;
      if (this.filterNode) {
        this.filterNode.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.01);
      }
    }
    if (resonance != null) {
      this.filterQ = resonance;
      if (this.filterNode) {
        this.filterNode.Q.setTargetAtTime(resonance, this.ctx.currentTime, 0.01);
      }
    }
    this._notifyChange('filter');
  }

  setEnvelope({ attack, decay, sustain, release } = {}) {
    if (attack != null) this.envelope.attack = attack;
    if (decay != null) this.envelope.decay = decay;
    if (sustain != null) this.envelope.sustain = sustain;
    if (release != null) this.envelope.release = release;
    this._notifyChange('envelope');
  }

  setEffect({ enabled, mix } = {}) {
    if (enabled != null) this.effect.enabled = enabled;
    if (mix != null) this.effect.mix = mix;
    if (this.wetGain) {
      const target = this.effect.enabled ? this.effect.mix : 0;
      this.wetGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
    this._notifyChange('effect');
  }

  loadPreset(preset) {
    this.lastPresetName = preset.name || null;
    if (preset.oscillators) {
      preset.oscillators.forEach((o, i) => this.setOscillator(i, o));
      this.oscillators = preset.oscillators.map((o) => ({ ...o }));
      // setOscillator ran against the pre-replacement array above; re-announce
      // now that this.oscillators holds the preset's real values, or listeners
      // would read one-change-behind state.
      preset.oscillators.forEach((o, i) => this._notifyChange(`oscillator-${i}`));
    }
    if (preset.filter) this.setFilter(preset.filter);
    if (preset.envelope) this.setEnvelope(preset.envelope);
    if (preset.effect) this.setEffect(preset.effect);
  }

  noteOn(freq) {
    const ctx = this.ensureContext();
    this._killActiveVoice();

    const mixNode = ctx.createGain();
    mixNode.gain.value = 1;
    mixNode.connect(this.filterNode);

    const voices = this.oscillators.map((oscDef) => {
      const osc = ctx.createOscillator();
      osc.type = oscDef.waveform;
      osc.frequency.value = freq * Math.pow(2, oscDef.semitone / 12);
      osc.detune.value = oscDef.detune;

      const gain = ctx.createGain();
      gain.gain.value = oscDef.level;

      osc.connect(gain);
      gain.connect(mixNode);
      osc.start();
      return { osc, gain };
    });

    const envGain = ctx.createGain();
    envGain.gain.value = 0;
    mixNode.disconnect();
    mixNode.connect(envGain);
    envGain.connect(this.filterNode);

    const now = ctx.currentTime;
    const { attack, decay, sustain } = this.envelope;
    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(1, now + Math.max(attack, 0.001));
    envGain.gain.linearRampToValueAtTime(
      Math.max(sustain, 0.0001),
      now + attack + Math.max(decay, 0.001)
    );

    this.activeVoice = { voices, mixNode, envGain, baseFreq: freq };
    this._notifyNote('on');
  }

  // Play a short note on the synth's own initiative, so an agent-driven
  // change demonstrates itself: same noteOn/noteOff path a key press takes,
  // so the scope and the envelope playhead both respond exactly as usual.
  // Held long enough to show attack and decay land and the plateau begin,
  // then released so the tail is shown too — capped so a very slow attack
  // doesn't leave a note ringing.
  auditionNote(freq = NOTE_FREQS.C4) {
    const { attack, decay } = this.envelope;
    const hold = Math.min(attack + decay + 0.9, 2.5);
    clearTimeout(this._auditionTimer);
    this.noteOn(freq);
    this._auditionTimer = setTimeout(() => this.noteOff(), hold * 1000);
  }

  noteOff() {
    if (!this.activeVoice || !this.ctx) return;
    const { voices, mixNode, envGain } = this.activeVoice;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const release = Math.max(this.envelope.release, 0.02);

    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(envGain.gain.value, now);
    envGain.gain.linearRampToValueAtTime(0, now + release);

    const stopAt = now + release + 0.05;
    voices.forEach(({ osc }) => {
      osc.stop(stopAt);
      osc.addEventListener('ended', () => osc.disconnect());
    });
    setTimeout(() => {
      voices.forEach(({ gain }) => gain.disconnect());
      mixNode.disconnect();
      envGain.disconnect();
    }, (release + 0.1) * 1000);

    this.activeVoice = null;
    this._notifyNote('off');
  }

  _killActiveVoice() {
    if (!this.activeVoice) return;
    const { voices, mixNode, envGain } = this.activeVoice;
    voices.forEach(({ osc, gain }) => {
      try {
        osc.stop();
      } catch (e) {
        /* already stopped */
      }
      osc.disconnect();
      gain.disconnect();
    });
    mixNode.disconnect();
    envGain.disconnect();
    this.activeVoice = null;
  }

  // Time-domain samples for the oscilloscope, -1..1 range.
  getScopeSamples() {
    if (!this.analyser) return null;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    return data;
  }
}
