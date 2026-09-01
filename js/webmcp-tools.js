// Registers the 5 WebMCP tools per https://webmachinelearning.github.io/webmcp/
// Each execute() drives the same engine + UI update functions the sliders use,
// so agent-driven changes and manual changes behave identically.

const PARAM_EXPLANATIONS = {
  waveform:
    'The waveform is the oscillator\'s raw shape, before any filtering — it decides the ' +
    'harmonic content of the tone. Sine: pure, smooth, no extra harmonics — think a soft ' +
    'flute or a sub-bass with no edge. Triangle: close to sine but with a little more bite, ' +
    'still mellow. Sawtooth: bright, buzzy, contains every harmonic — the classic analog ' +
    'synth-bass/lead sound, great starting point for "brighter" or "fuller" requests. ' +
    'Square: hollow, reedy, only odd harmonics — think retro video-game or clarinet tones.',
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

function registerWebMcpTools({ engine, filterUI, envelopeUI, effectUI }) {
  if (!document.modelContext || typeof document.modelContext.registerTool !== 'function') {
    return false;
  }

  const withReason = (parameter, reason) => {
    if (reason) addReasoningLogEntry(parameter, reason);
  };

  document.modelContext.registerTool({
    name: 'set_waveform',
    description:
      'Set the oscillator waveform — the fundamental tone color of the synth, before any ' +
      'filtering. Use this to translate vague creative requests into a concrete shape: ' +
      '"warmer", "softer", "purer", "flute-like" -> sine or triangle. "brighter", "fuller", ' +
      '"analog", "buzzy", "classic synth bass/lead" -> sawtooth (richest in harmonics). ' +
      '"hollow", "retro", "video-game", "clarinet-like", "reedy" -> square (odd harmonics only). ' +
      'Triangle sits between sine and square: softer than square, slightly more character than sine.',
    inputSchema: {
      type: 'object',
      properties: {
        waveform: {
          type: 'string',
          enum: ['sine', 'square', 'sawtooth', 'triangle'],
          description: 'Oscillator shape to switch to.',
        },
        reason: {
          type: 'string',
          description:
            'A short (1-2 sentence) plain-language explanation of why you are making this ' +
            'change, written for a beginner. Always include this — it is shown directly in ' +
            'the UI next to the control you just moved.',
        },
      },
      required: ['waveform'],
    },
    execute: async ({ waveform, reason }) => {
      engine.setWaveform(waveform);
      setActiveWaveformButton(waveform);
      withReason('waveform', reason);
      return `Waveform set to ${waveform}.`;
    },
  });

  document.modelContext.registerTool({
    name: 'set_filter',
    description:
      'Adjust the lowpass filter that shapes brightness/warmth. cutoff (20-20000 Hz) is the ' +
      'frequency above which content is removed: lower cutoff = warmer/darker/muddier/duller, ' +
      'higher cutoff = brighter/thinner/harsher/more present. For "warmer", "softer", "muddy", ' +
      '"lo-fi", "underwater" requests, lower the cutoff (roughly 300-1200 Hz for very warm/muffled, ' +
      '1500-4000 Hz for a gentle warmth). For "brighter", "crisper", "more present", "cutting ' +
      'through the mix", raise it (5000 Hz+). resonance (0-20) emphasizes frequencies right at ' +
      'the cutoff: a little (1-4) adds character or a "wah"/nasal quality, a lot (8+) gets ' +
      'squelchy, acid-like, or can self-oscillate into a whistle — use sparingly unless the ' +
      'user explicitly wants an aggressive, resonant, "acid" sound. Either field can be omitted ' +
      'to leave it unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        cutoff: { type: 'number', minimum: 20, maximum: 20000, description: 'Filter cutoff in Hz.' },
        resonance: { type: 'number', minimum: 0, maximum: 20, description: 'Filter resonance (Q).' },
        reason: {
          type: 'string',
          description:
            'A short (1-2 sentence) plain-language explanation of why you are making this ' +
            'change, written for a beginner. Always include this — it is shown directly in ' +
            'the UI next to the control you just moved.',
        },
      },
    },
    execute: async ({ cutoff, resonance, reason }) => {
      engine.setFilter({ cutoff, resonance });
      if (cutoff != null) filterUI.setCutoff(cutoff);
      if (resonance != null) filterUI.setResonance(resonance);
      withReason('filter', reason);
      const parts = [];
      if (cutoff != null) parts.push(`cutoff to ${Math.round(cutoff)} Hz`);
      if (resonance != null) parts.push(`resonance to ${resonance.toFixed(1)}`);
      return `Set ${parts.join(' and ')}.`;
    },
  });

  document.modelContext.registerTool({
    name: 'set_envelope',
    description:
      'Adjust the ADSR amplitude envelope, which shapes how a note starts and ends. attack ' +
      '(seconds) is fade-in time — near 0 is punchy/plucky/percussive, 0.3s+ is a slow swell ' +
      'or pad-like fade-in. decay (seconds) is how long it takes to fall from the attack peak ' +
      'to the sustain level. sustain (0-1) is the held volume level while a key is down, not a ' +
      'duration. release (seconds) is fade-out time after the key is released — near 0 is ' +
      'abrupt/staccato, 1s+ lingers/feels ambient or reverberant. For "punchier"/"snappier"/' +
      '"percussive" requests: fast attack, shorter decay, lower sustain. For "softer"/"pad-like"/' +
      '"ambient"/"swelling" requests: slower attack, longer release. Any field can be omitted ' +
      'to leave it unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        attack: { type: 'number', minimum: 0, maximum: 5, description: 'Attack time in seconds.' },
        decay: { type: 'number', minimum: 0, maximum: 5, description: 'Decay time in seconds.' },
        sustain: { type: 'number', minimum: 0, maximum: 1, description: 'Sustain level, 0-1.' },
        release: { type: 'number', minimum: 0, maximum: 5, description: 'Release time in seconds.' },
        reason: {
          type: 'string',
          description:
            'A short (1-2 sentence) plain-language explanation of why you are making this ' +
            'change, written for a beginner. Always include this — it is shown directly in ' +
            'the UI next to the control you just moved.',
        },
      },
    },
    execute: async ({ attack, decay, sustain, release, reason }) => {
      engine.setEnvelope({ attack, decay, sustain, release });
      envelopeUI.set(
        Object.fromEntries(
          Object.entries({ attack, decay, sustain, release }).filter(([, v]) => v != null)
        )
      );
      withReason('envelope', reason);
      return 'Envelope updated.';
    },
  });

  document.modelContext.registerTool({
    name: 'set_effect',
    description:
      'Toggle and blend the synth\'s single built-in effect: a delay (echo). enabled turns it ' +
      'on/off. mix (0-1) controls how much delayed signal is blended in — low mix (0.1-0.25) ' +
      'is a subtle thickening/slapback, high mix (0.4+) is a spacious, washed-out, dubby, ' +
      '"lo-fi" or ambient sound. Use this for requests like "add some space", "make it dreamy", ' +
      '"lo-fi beat" (moderate mix plus a darker filter cutoff usually reads as "lo-fi"), or ' +
      '"more atmospheric". Turn it off for a "tight", "dry", or "direct" sound.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Whether the delay effect is active.' },
        mix: { type: 'number', minimum: 0, maximum: 1, description: 'Dry/wet blend, 0-1.' },
        reason: {
          type: 'string',
          description:
            'A short (1-2 sentence) plain-language explanation of why you are making this ' +
            'change, written for a beginner. Always include this — it is shown directly in ' +
            'the UI next to the control you just moved.',
        },
      },
      required: ['enabled'],
    },
    execute: async ({ enabled, mix, reason }) => {
      engine.setEffect({ enabled, mix });
      effectUI.set({ enabled, mix });
      withReason('effect', reason);
      return `Delay ${enabled ? 'enabled' : 'disabled'}${mix != null ? ` at mix ${mix.toFixed(2)}` : ''}.`;
    },
  });

  document.modelContext.registerTool({
    name: 'explain_parameter',
    description:
      'Return a plain-language, beginner-friendly explanation of what a synth parameter ' +
      'category does and why it matters, using terminology a beginner could later recognize ' +
      'in other DAWs (FL Studio, Ableton, Vital, etc). Call this when the user directly asks ' +
      '"what does X do?" / "what is resonance?" / "explain the envelope" and there is no ' +
      'parameter change to make.',
    inputSchema: {
      type: 'object',
      properties: {
        parameter: {
          type: 'string',
          enum: ['waveform', 'filter', 'envelope', 'effect'],
          description: 'Which parameter category to explain.',
        },
      },
      required: ['parameter'],
    },
    execute: async ({ parameter }) => {
      return PARAM_EXPLANATIONS[parameter] || 'Unknown parameter.';
    },
  });

  return true;
}
