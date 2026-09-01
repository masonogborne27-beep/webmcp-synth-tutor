// Core Web Audio synth engine. No DOM references here — pure audio logic
// so both the UI and the WebMCP tools can drive the same functions.

const NOTE_FREQS = {
  C4: 261.63, 'C#4': 277.18, D4: 293.66, 'D#4': 311.13, E4: 329.63,
  F4: 349.23, 'F#4': 369.99, G4: 392.00, 'G#4': 415.30, A4: 440.00,
  'A#4': 466.16, B4: 493.88, C5: 523.25,
};

class SynthEngine {
  constructor() {
    this.ctx = null;
    this.waveform = 'sawtooth';
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
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(ctx.destination);

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

  setWaveform(waveform) {
    this.waveform = waveform;
    if (this.activeVoice) this.activeVoice.osc.type = waveform;
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

  noteOn(freq) {
    const ctx = this.ensureContext();
    // Cut off any currently-sounding voice immediately (monophonic).
    this._killActiveVoice();

    const osc = ctx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.value = freq;

    const envGain = ctx.createGain();
    envGain.gain.value = 0;

    osc.connect(envGain);
    envGain.connect(this.filterNode);
    osc.start();

    const now = ctx.currentTime;
    const { attack, decay, sustain } = this.envelope;
    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(1, now + Math.max(attack, 0.001));
    envGain.gain.linearRampToValueAtTime(
      Math.max(sustain, 0.0001),
      now + attack + Math.max(decay, 0.001)
    );

    this.activeVoice = { osc, envGain };
  }

  noteOff() {
    if (!this.activeVoice || !this.ctx) return;
    const { osc, envGain } = this.activeVoice;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const release = Math.max(this.envelope.release, 0.02);

    envGain.gain.cancelScheduledValues(now);
    envGain.gain.setValueAtTime(envGain.gain.value, now);
    envGain.gain.linearRampToValueAtTime(0, now + release);

    osc.stop(now + release + 0.05);
    osc.addEventListener('ended', () => {
      osc.disconnect();
      envGain.disconnect();
    });

    this.activeVoice = null;
  }

  _killActiveVoice() {
    if (!this.activeVoice) return;
    const { osc, envGain } = this.activeVoice;
    try {
      osc.stop();
    } catch (e) {
      /* already stopped */
    }
    osc.disconnect();
    envGain.disconnect();
    this.activeVoice = null;
  }
}
