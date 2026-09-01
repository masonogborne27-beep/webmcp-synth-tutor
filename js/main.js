const engine = new SynthEngine();

initKeyboard(engine);
initWaveformButtons(engine, (waveform) => addReasoningLogEntry('waveform', ''));
const filterUI = initFilterControls(engine, () => addReasoningLogEntry('filter', ''));
const envelopeUI = initEnvelopeControls(engine, () => addReasoningLogEntry('envelope', ''));
const effectUI = initEffectControls(engine, () => addReasoningLogEntry('effect', ''));

// Sync engine to the sliders' default values so audio matches what's shown.
engine.setFilter({ cutoff: 2000, resonance: 1 });
filterUI.setCutoff(2000);
engine.setEnvelope({ attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.3 });
engine.setEffect({ enabled: false, mix: 0.3 });

const mcpReady = registerWebMcpTools({ engine, filterUI, envelopeUI, effectUI });
setMcpStatus(mcpReady);
