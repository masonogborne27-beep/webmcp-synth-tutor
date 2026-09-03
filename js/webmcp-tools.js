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
    'The filter shapes which frequencies get through, applied after the oscillator mix. Type ' +
    'sets the basic shape: lowpass (default) keeps lows and cuts highs — lowering its cutoff ' +
    'makes a sound warmer/darker/muffled, raising it makes it brighter/thinner/more present. ' +
    'Highpass is the mirror image — cuts lows, keeps highs — for thin/telephone/no-bass/airy ' +
    'sounds. Bandpass only lets a narrow band through, for nasal/muffled-radio/narrow tones. ' +
    'Resonance boosts the frequencies right at the cutoff — a little adds a characterful "wah" ' +
    'or nasal edge, a lot gets squelchy or can self-oscillate into a whistle; on a bandpass it ' +
    'narrows the band instead. Env amount sweeps the cutoff open or closed over the life of ' +
    'each note (using the same attack/decay/sustain timing as the amplitude envelope) instead ' +
    'of sitting still — this is what makes a "pluck" or "wow" sound, versus a static tone.',
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

// Tool annotation hints (MCP/WebMCP convention — advisory, not enforced):
// every set_*/load_preset tool changes in-memory synth state that's always
// trivially overwritten by the next call, never destroys anything external,
// produces the same end state for the same args (idempotent), and never
// touches anything outside this page (not open-world). explain_parameter
// changes nothing at all.
const SYNTH_MUTATING_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const SYNTH_READONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Returns the tool definitions as plain data + execute functions, independent
// of WebMCP. Both registerWebMcpTools() and the Agent panel consume this.
function buildToolDefs({ engine, oscUIs, filterUI, envelopeUI, effectUI }) {
  // Every number a tool reports — to the bubble, and back to the model as the
  // function result that shapes its reply — comes from describeModule() reading
  // live engine state after the change. The tool never formats a value from its
  // own arguments, so there is no second number that could disagree.
  const report = (parameter, reason) => {
    if (reason) addReasoningLogEntry(parameter, reason);
    return describeModule(engine, parameter);
  };

  // Stage 1 of the pipeline trace: the raw arguments the LLM actually sent,
  // beside the state that actually resulted. Any divergence between what the
  // model says and what it sent is visible here rather than taken on faith.
  const logCall = (name, args, applied) => {
    if (window.SIGNAL_PATH_DEBUG) console.log(`[1/4 tool args] ${name}`, { rawArgs: args, appliedState: applied });
  };

  return [
    {
      name: 'synth_set_oscillator',
      annotations: SYNTH_MUTATING_ANNOTATIONS,
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
        // The inputSchema enum already keeps a schema-respecting caller from
        // sending an out-of-range oscillator, but a defensive check turns a
        // silent no-op (the old behavior — engine.setOscillator just returns
        // if the index doesn't exist) into an actionable error the model can
        // recover from instead of reporting success on a change that never
        // happened.
        if (!Number.isInteger(oscillator) || oscillator < 1 || oscillator > 3) {
          return `Error: oscillator must be 1, 2, or 3 (got ${JSON.stringify(oscillator)}). No change was made.`;
        }
        const index = oscillator - 1;
        engine.setOscillator(index, { waveform, level, detune, semitone });
        oscUIs[index].setState({ waveform, level, semitone });
        const applied = report(`oscillator-${index}`, reason);
        logCall('synth_set_oscillator', { oscillator, waveform, level, detune, semitone, reason }, applied);
        return `Oscillator ${oscillator} is now: ${applied}.`;
      },
    },
    {
      name: 'synth_set_filter',
      annotations: SYNTH_MUTATING_ANNOTATIONS,
      description:
        'Adjust the filter that shapes brightness/warmth, applied after the oscillator mix. ' +
        'type ("lowpass"/"highpass"/"bandpass"): lowpass (default) keeps lows and cuts highs; ' +
        'highpass is the mirror image (cuts lows, keeps highs) for "thin"/"telephone"/' +
        '"no bass"/"airy" requests; bandpass only lets a narrow band through, for "nasal"/' +
        '"muffled radio"/"narrow" requests. cutoff (20-20000 Hz, the center/corner frequency ' +
        'depending on type): for a lowpass, lower = warmer/darker/muddier, higher = brighter/' +
        'thinner/more present (roughly 300-1200 Hz for very warm/muffled, 5000 Hz+ for bright/' +
        'crisp); for a highpass, HIGHER cutoff removes MORE bass (thinner), lower removes ' +
        'almost nothing. resonance (0-20) emphasizes frequencies at the cutoff: a little (1-4) ' +
        'adds character or a "wah", a lot (8+) gets squelchy/acid-like or can self-oscillate ' +
        'into a whistle; on a bandpass, higher resonance narrows the band instead. envAmount ' +
        '(-4 to 4 octaves, default 0) sweeps the cutoff over each note\'s attack/decay/sustain ' +
        '(reusing the envelope\'s own timing) instead of holding still: +2 to +4 is the classic ' +
        '"pluck"/"wow" sweep (opens bright on the attack, settles down through decay); negative ' +
        'values invert it (opens dark, brightens on release). Leave a field out to leave it ' +
        'unchanged — only cutoff and resonance have UI knobs shown at rest, so envAmount and ' +
        'type are this synth\'s hidden depth, worth reaching for on "pluck", "wow", "talking", ' +
        'or "movement" requests rather than only ever setting a static cutoff.',
      inputSchema: {
        type: 'object',
        properties: {
          cutoff: { type: 'number', minimum: 20, maximum: 20000 },
          resonance: { type: 'number', minimum: 0, maximum: 20 },
          type: { type: 'string', enum: FILTER_TYPES, description: 'Filter shape. Omit to leave unchanged.' },
          envAmount: {
            type: 'number', minimum: -4, maximum: 4,
            description: 'Filter envelope depth in octaves, swept over each note using the envelope\'s attack/decay/sustain timing. 0 = static filter (default).',
          },
          reason: REASON_FIELD,
        },
      },
      execute: async ({ cutoff, resonance, type, envAmount, reason }) => {
        if (type != null && !FILTER_TYPES.includes(type)) {
          return `Error: type must be one of ${FILTER_TYPES.join(', ')} (got ${JSON.stringify(type)}). No change was made.`;
        }
        engine.setFilter({ cutoff, resonance, type, envAmount });
        filterUI.setState({ cutoff, resonance, type, envAmount });
        const applied = report('filter', reason);
        logCall('synth_set_filter', { cutoff, resonance, type, envAmount, reason }, applied);
        return `Filter is now: ${applied}.`;
      },
    },
    {
      name: 'synth_set_envelope',
      annotations: SYNTH_MUTATING_ANNOTATIONS,
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
        // Demonstrate the new shape rather than just redrawing it: the
        // playhead walks the curve while the note sounds.
        engine.auditionNote();
        const applied = report('envelope', reason);
        logCall('synth_set_envelope', { attack, decay, sustain, release, reason }, applied);
        return `Envelope is now: ${applied}.`;
      },
    },
    {
      name: 'synth_set_effect',
      annotations: SYNTH_MUTATING_ANNOTATIONS,
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
        const applied = report('effect', reason);
        logCall('synth_set_effect', { enabled, mix, reason }, applied);
        return `Delay is now: ${applied}.`;
      },
    },
    {
      name: 'synth_load_preset',
      annotations: SYNTH_MUTATING_ANNOTATIONS,
      description:
        'Instantly load a complete, curated starting sound (all 3 oscillators, filter, ' +
        'envelope, and effect at once), then optionally fine-tune individual parameters with ' +
        'the other tools afterward. Use this as a fast, reliable first move for a vague request ' +
        'before nudging individual knobs — e.g. "lo-fi beat" -> synth_load_preset("lofi_beat") ' +
        'then optionally tweak cutoff further. Available presets: ' +
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
        if (!preset) {
          return `Error: unknown preset "${presetId}". Valid ids are: ${PRESETS.map((p) => p.id).join(', ')}.`;
        }
        engine.loadPreset(preset);
        applyPresetToUI(preset, { oscUIs, filterUI, envelopeUI, effectUI });
        // Demonstrate the resulting envelope shape, same as a manually
        // triggered synth_set_envelope — a preset changes it just as much.
        engine.auditionNote();
        // A preset replaces every module, so it annotates every module — and
        // the result handed back to the model spells out all of them. Reporting
        // only a cutoff here is what let the model keep talking about a preset's
        // headline number while the rest of the patch had moved on.
        const presetReason = reason || `Loaded the "${preset.name}" preset as a starting point.`;
        annotatePresetLoad(engine, presetReason);
        const applied = MODULE_PARAMS
          .map((p) => `${MODULE_LABELS[p]} — ${describeModule(engine, p)}`)
          .join('; ');
        logCall('synth_load_preset', { preset: presetId, reason }, applied);
        return `Loaded preset "${preset.name}". Full resulting patch: ${applied}.`;
      },
    },
    {
      name: 'synth_explain_parameter',
      annotations: SYNTH_READONLY_ANNOTATIONS,
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
      execute: async ({ parameter }) => {
        // Asking "what does the envelope do" is exactly when watching the
        // current shape play out is most useful — demonstrate it live
        // rather than only describing it in prose.
        if (parameter === 'envelope') engine.auditionNote();
        return PARAM_EXPLANATIONS[parameter] ||
          `Error: unknown parameter "${parameter}". Valid values are: ${Object.keys(PARAM_EXPLANATIONS).join(', ')}.`;
      },
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
      // Advisory hints (readOnlyHint/destructiveHint/idempotentHint/
      // openWorldHint) — passed through even though WebMCP's current spec
      // doesn't formally define this field yet, since it mirrors MCP's own
      // tool annotations and a spec-unaware host will just ignore it.
      annotations: def.annotations,
      execute: def.execute,
    });
  });
  return true;
}
