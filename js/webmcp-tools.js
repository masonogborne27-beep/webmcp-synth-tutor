// Tool definitions shared by two callers: the WebMCP registration (for
// agentic browsers like ChatGPT's in-app browser or Chrome+flag) and our own
// built-in Agent panel (js/agent.js), which drives the exact same execute()
// functions from a plain LLM function-calling loop. One source of truth so
// "the agent" behaves identically regardless of which path invoked it.

const PARAM_EXPLANATIONS = {
  oscillator:
    'This synth mixes up to 3 oscillators before anything else happens to the sound. Each ' +
    'has its own waveform (the harmonic character — sine is pure/smooth, triangle is soft ' +
    'with a little more bite, sawtooth is bright/buzzy and full of harmonics, square is ' +
    'hollow/reedy with only odd harmonics), a level (how loud that oscillator sits in the ' +
    'mix — 0 mutes it), and a tune offset in semitones (shift it up/down an octave or a ' +
    'fifth to build a chord-like stack, or drop one an octave for a sub-bass layer). ' +
    'Layering oscillators is how real analog/subtractive synths get thickness: e.g. a ' +
    'sawtooth plus a detuned square is a classic "fat" unison lead; a sawtooth plus a ' +
    'sub-sine an octave down is a classic bass patch.',
  filter:
    'The lowpass filter cuts everything above its cutoff frequency, so lowering cutoff ' +
    'removes high-end sparkle and makes a sound feel warmer, darker, or more muffled; ' +
    'raising it lets more high frequencies through for a brighter, thinner, more present ' +
    'tone. Resonance boosts the frequencies right at the cutoff point — a little adds a ' +
    'characterful "wah" or nasal edge, a lot gets squelchy or even self-oscillates into a whistle.',
  envelope:
    'ADSR shapes volume over the life of a note. Attack is how long it takes to reach full ' +
    'volume after a key press — fast attack sounds punchy/plucky, slow attack sounds like a ' +
    'swell or a pad fading in. Decay is how long it takes to fall from the attack peak down ' +
    'to the sustain level. Sustain is the level held while the key stays down (not a time). ' +
    'Release is how long the sound takes to fade out after the key is released — short ' +
    'release is abrupt/staccato, long release lingers and feels ambient.',
  effect:
    'This synth\'s single effect is a delay (echo): it repeats the signal after a short gap ' +
    'and feeds some of that repeat back in, building a trail of echoes. Short delay times ' +
    'give a tight "slapback" thickening; longer times feel spacious or dubby. The mix ' +
    'controls the balance between the dry (unprocessed) and wet (delayed) signal — more ' +
    'mix means a more washed-out, atmospheric sound; less keeps it tight and direct.',
};

const REASON_FIELD = {
  type: 'string',
  description:
    'A short (1-2 sentence) plain-language explanation of why you are making this change, ' +
    'written for a beginner. Always include this — it is shown directly in the UI next to ' +
    'the module you just changed, and read back to the user as your reply.',
};

// Returns the tool definitions as plain data + execute functions, independent
// of WebMCP. Both registerWebMcpTools() and the Agent panel consume this.
function buildToolDefs({ engine, oscUIs, filterUI, envelopeUI, effectUI }) {
  // "applied" is always read back from live engine state AFTER the change is
  // made — never from the LLM's own args — so the number shown next to the
  // model's prose explanation is provably the same value that was actually
  // set, not a second, independently-generated value that can drift from it.
  const withReason = (parameter, reason, applied) => {
    if (reason) addReasoningLogEntry(parameter, reason, applied);
  };

  // Every tool call is logged with its raw args exactly as the LLM sent them,
  // so a mismatch between what the model *said* and what it *sent* is
  // verifiable from devtools rather than taken on faith.
  const logCall = (name, args, applied) => {
    console.debug(`[tool call] ${name}`, { args, applied });
  };

  return [
    {
      name: 'set_oscillator',
      description:
        'Configure one of the synth\'s 3 mixable oscillators (oscillator: 1, 2, or 3). This ' +
        'is the primary way to shape tone color and thickness. waveform sets harmonic ' +
        'character: "warmer"/"softer"/"purer"/"flute-like" -> sine or triangle; "brighter"/' +
        '"fuller"/"analog"/"buzzy"/"classic synth" -> sawtooth; "hollow"/"retro"/"video-game"/' +
        '"reedy" -> square. level (0-1) sets how loud that oscillator sits in the mix — set an ' +
        'unused oscillator to 0 rather than leaving it at a stale value. semitone (-24 to 24, ' +
        'integer) coarse-tunes that oscillator relative to the note played: -12 makes a sub-bass ' +
        'layer an octave down, +7/+12 stacks a fifth/octave above for a fuller chord-like tone. ' +
        'detune (-50 to 50 cents) is a small pitch offset used for classic analog "unison" ' +
        'thickening/chorus-like width when two oscillators share a waveform with opposite detune. ' +
        'For "thicker"/"fatter"/"wider" requests, raise a second oscillator\'s level and detune it ' +
        'slightly opposite the first. For "simpler"/"cleaner" requests, lower unused oscillators to 0.',
      inputSchema: {
        type: 'object',
        properties: {
          oscillator: { type: 'integer', enum: [1, 2, 3], description: 'Which oscillator (1-3) to edit.' },
          waveform: { type: 'string', enum: ['sine', 'square', 'sawtooth', 'triangle'] },
          level: { type: 'number', minimum: 0, maximum: 1 },
          detune: { type: 'number', minimum: -50, maximum: 50, description: 'Fine detune in cents.' },
          semitone: { type: 'integer', minimum: -24, maximum: 24, description: 'Coarse tune in semitones.' },
          reason: REASON_FIELD,
        },
        required: ['oscillator'],
      },
      execute: async ({ oscillator, waveform, level, detune, semitone, reason }) => {
        const index = oscillator - 1;
        engine.setOscillator(index, { waveform, level, detune, semitone });
        oscUIs[index].setState({ waveform, level, semitone });
        const o = engine.oscillators[index];
        const applied = `${o.waveform}, level ${o.level.toFixed(2)}, tune ${o.semitone >= 0 ? '+' : ''}${o.semitone} st, detune ${o.detune}¢`;
        withReason(`oscillator-${index}`, reason, applied);
        logCall('set_oscillator', { oscillator, waveform, level, detune, semitone, reason }, applied);
        return `Oscillator ${oscillator} is now: ${applied}.`;
      },
    },
    {
      name: 'set_filter',
      description:
        'Adjust the lowpass filter that shapes brightness/warmth, applied after the oscillator ' +
        'mix. cutoff (20-20000 Hz): lower = warmer/darker/muddier/duller, higher = brighter/' +
        'thinner/harsher/more present. For "warmer", "muddy", "lo-fi", "underwater" requests, ' +
        'lower the cutoff (roughly 300-1200 Hz for very warm/muffled, 1500-4000 Hz for gentle ' +
        'warmth). For "brighter", "crisper", "cutting through the mix", raise it (5000 Hz+). ' +
        'resonance (0-20) emphasizes frequencies right at the cutoff: a little (1-4) adds ' +
        'character or a "wah"/nasal quality, a lot (8+) gets squelchy/acid-like or can ' +
        'self-oscillate into a whistle. Either field can be omitted to leave it unchanged.',
      inputSchema: {
        type: 'object',
        properties: {
          cutoff: { type: 'number', minimum: 20, maximum: 20000 },
          resonance: { type: 'number', minimum: 0, maximum: 20 },
          reason: REASON_FIELD,
        },
      },
      execute: async ({ cutoff, resonance, reason }) => {
        engine.setFilter({ cutoff, resonance });
        filterUI.setState({ cutoff, resonance });
        const applied = `cutoff ${Math.round(engine.filterFreq)} Hz, resonance ${engine.filterQ.toFixed(1)}`;
        withReason('filter', reason, applied);
        logCall('set_filter', { cutoff, resonance, reason }, applied);
        return `Filter is now: ${applied}.`;
      },
    },
    {
      name: 'set_envelope',
      description:
        'Adjust the ADSR amplitude envelope, shared by the full oscillator mix. attack ' +
        '(seconds) is fade-in time — near 0 is punchy/plucky/percussive, 0.3s+ is a slow swell ' +
        'or pad-like fade-in. decay (seconds) is fall time from the attack peak to the sustain ' +
        'level. sustain (0-1) is the held volume while a key is down, not a duration. release ' +
        '(seconds) is fade-out time after the key is released — near 0 is abrupt/staccato, 1s+ ' +
        'lingers/feels ambient. For "punchier"/"snappier" requests: fast attack, shorter decay, ' +
        'lower sustain. For "softer"/"pad-like"/"ambient" requests: slower attack, longer release. ' +
        'Any field can be omitted to leave it unchanged.',
      inputSchema: {
        type: 'object',
        properties: {
          attack: { type: 'number', minimum: 0, maximum: 5 },
          decay: { type: 'number', minimum: 0, maximum: 5 },
          sustain: { type: 'number', minimum: 0, maximum: 1 },
          release: { type: 'number', minimum: 0, maximum: 5 },
          reason: REASON_FIELD,
        },
      },
      execute: async ({ attack, decay, sustain, release, reason }) => {
        engine.setEnvelope({ attack, decay, sustain, release });
        envelopeUI.setState({ attack, decay, sustain, release });
        const e = engine.envelope;
        const applied = `attack ${e.attack.toFixed(2)}s, decay ${e.decay.toFixed(2)}s, sustain ${e.sustain.toFixed(2)}, release ${e.release.toFixed(2)}s`;
        withReason('envelope', reason, applied);
        logCall('set_envelope', { attack, decay, sustain, release, reason }, applied);
        return `Envelope is now: ${applied}.`;
      },
    },
    {
      name: 'set_effect',
      description:
        'Toggle and blend the synth\'s single built-in effect: a delay (echo). enabled turns it ' +
        'on/off. mix (0-1): low (0.1-0.25) is a subtle thickening/slapback, high (0.4+) is ' +
        'spacious, washed-out, dubby, "lo-fi" or ambient. Use for "add some space", "dreamy", ' +
        '"lo-fi beat" (moderate mix plus a darker filter cutoff usually reads as "lo-fi"), or ' +
        '"more atmospheric". Turn it off for "tight", "dry", or "direct".',
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          mix: { type: 'number', minimum: 0, maximum: 1 },
          reason: REASON_FIELD,
        },
        required: ['enabled'],
      },
      execute: async ({ enabled, mix, reason }) => {
        engine.setEffect({ enabled, mix });
        effectUI.setState({ enabled, mix });
        const applied = `${engine.effect.enabled ? 'on' : 'off'}, mix ${engine.effect.mix.toFixed(2)}`;
        withReason('effect', reason, applied);
        logCall('set_effect', { enabled, mix, reason }, applied);
        return `Delay is now: ${applied}.`;
      },
    },
    {
      name: 'load_preset',
      description:
        'Instantly load a complete, curated starting sound (all 3 oscillators, filter, ' +
        'envelope, and effect at once), then optionally fine-tune individual parameters with ' +
        'the other tools afterward. Use this as a fast, reliable first move for a vague request ' +
        'before nudging individual knobs — e.g. "lo-fi beat" -> load_preset("lofi_beat") then ' +
        'optionally tweak cutoff further. Available presets: ' +
        PRESETS.map((p) => `"${p.id}" (${p.name})`).join(', ') + '.',
      inputSchema: {
        type: 'object',
        properties: {
          preset: { type: 'string', enum: PRESETS.map((p) => p.id) },
          reason: REASON_FIELD,
        },
        required: ['preset'],
      },
      execute: async ({ preset: presetId, reason }) => {
        const preset = PRESETS.find((p) => p.id === presetId);
        if (!preset) return `Unknown preset: ${presetId}`;
        engine.loadPreset(preset);
        applyPresetToUI(preset, { oscUIs, filterUI, envelopeUI, effectUI });
        const applied = `"${preset.name}" — cutoff ${Math.round(engine.filterFreq)} Hz, resonance ${engine.filterQ.toFixed(1)}, delay ${engine.effect.enabled ? 'on' : 'off'}`;
        withReason('preset', reason || `Loaded the "${preset.name}" preset as a starting point.`, applied);
        logCall('load_preset', { preset: presetId, reason }, applied);
        return `Loaded preset ${applied}.`;
      },
    },
    {
      name: 'explain_parameter',
      description:
        'Return a plain-language, beginner-friendly explanation of what a synth parameter ' +
        'category does and why it matters, using terminology a beginner could later recognize ' +
        'in other DAWs (FL Studio, Ableton, Vital, etc). Call this when the user directly asks ' +
        '"what does X do?" and there is no parameter change to make.',
      inputSchema: {
        type: 'object',
        properties: {
          parameter: { type: 'string', enum: ['oscillator', 'filter', 'envelope', 'effect'] },
        },
        required: ['parameter'],
      },
      execute: async ({ parameter }) => PARAM_EXPLANATIONS[parameter] || 'Unknown parameter.',
    },
  ];
}

// Registers every tool def with the browser's real WebMCP API, if present
// (ChatGPT's in-app browser, or Chrome with #enable-webmcp-testing).
function registerWebMcpTools(toolDefs) {
  if (!document.modelContext || typeof document.modelContext.registerTool !== 'function') {
    return false;
  }
  toolDefs.forEach((def) => {
    document.modelContext.registerTool({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      execute: def.execute,
    });
  });
  return true;
}
