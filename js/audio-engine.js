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

class SynthEngine {
  constructor() {
    this.ctx = null;
    this.oscillators = DEFAULT_OSCILLATORS.map((o) => ({ ...o }));
    this.filterFreq = 2000;
    this.filterQ = 1;
    this.envelope = { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.3 };
    this.effect = { enabled: false, mix: 0.3 };
    this.activeVoice = null;
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
    this.delayNode.delayTime.value = 0.28;
    this.feedbackGain = ctx.createGain();
    this.feedbackGain.gain.value = 0.35;
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
  }

  setEnvelope({ attack, decay, sustain, release } = {}) {
    if (attack != null) this.envelope.attack = attack;
    if (decay != null) this.envelope.decay = decay;
    if (sustain != null) this.envelope.sustain = sustain;
    if (release != null) this.envelope.release = release;
  }

  setEffect({ enabled, mix } = {}) {
    if (enabled != null) this.effect.enabled = enabled;
    if (mix != null) this.effect.mix = mix;
    if (this.wetGain) {
      const target = this.effect.enabled ? this.effect.mix : 0;
      this.wetGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
  }

  loadPreset(preset) {
    if (preset.oscillators) {
      preset.oscillators.forEach((o, i) => this.setOscillator(i, o));
      this.oscillators = preset.oscillators.map((o) => ({ ...o }));
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
