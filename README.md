# Signal Path — Sound Design Tutor Synth

A browser synth built for **The WebMCP Challenge**. An AI agent connects to the page via
[WebMCP](https://webmachinelearning.github.io/webmcp/) and can change the sound — but the
point isn't that it *can* make sounds, it's that every change comes with a short,
plain-language explanation of *why*, pinned as an annotation directly onto the module that
just changed and logged to a running reasoning log.

**This is a sound-design teaching tool, not a composition or sequencing tool.** There's no
sequencer, no multi-track composition, no beat-making workflow — just one instrument, a
signal-path diagram you can actually watch, and an agent that explains what it's doing in
FL Studio / Vital-adjacent language a beginner could carry into any other DAW.

## Try it

Click a preset to get a real sound going immediately (no blank-slate problem), then either
turn the knobs yourself or type something vague and creative into a connected agent, e.g.:

- "make it sound warmer"
- "more like a lo-fi beat"
- "give me a punchier bass"
- "what does resonance do?"

Watch the reasoning appear as an annotation on the module that changed, and build up in the
reasoning log below the diagram.

## Signal chain

```
3x Oscillator (sine / triangle / sawtooth / square, each with level + semitone/detune tune)
  -> mixed together
    -> Lowpass filter (cutoff + resonance)
      -> Amp envelope (ADSR)
        -> Delay effect (feedback + dry/wet mix)
          -> Limiter -> Master output
```

Monophonic — one note at a time, played from the on-screen keyboard (mouse or
`A S D F G H J K` for white keys, `W E T Y U` for black keys, one octave from C4). The
whole chain is drawn as a live schematic: a filter-response curve, an ADSR shape, and a
real oscilloscope on the output stage, so you can *see* the sound design, not just hear it.

## Presets

Six starting points (Warm Pad, Punchy Bass, Lo-Fi Beat, Bright Pluck, Ambient Drone, Retro
Lead) plus a "Surprise me" randomizer — pick one, then turn any knob to hear what it does
from a real sound instead of silence.

## WebMCP tools

Registered via `document.modelContext.registerTool()`:

| Tool | Purpose |
| --- | --- |
| `set_oscillator` | Set waveform / level / detune / semitone for oscillator 1, 2, or 3 |
| `set_filter` | Adjust cutoff and/or resonance |
| `set_envelope` | Adjust attack / decay / sustain / release |
| `set_effect` | Toggle the delay and set its dry/wet mix |
| `load_preset` | Instantly load one of the 6 curated starting sounds |
| `explain_parameter` | Plain-language explanation of a parameter category, for standalone questions |

The five mutating tools accept an optional `reason` string in their input schema — the
agent is prompted (via the tool description) to always include a short, beginner-friendly
explanation, which the page pins onto the relevant module and appends to the reasoning log.

## Running locally

No build step, no dependencies. Serve the directory statically and open it:

```bash
python3 -m http.server 8420
```

Then visit `http://localhost:8420`. To test the agent integration, open the page in
ChatGPT's in-app browser, or in Chrome with `chrome://flags/#enable-webmcp-testing`
enabled (Google's [Model Context Tool Inspector](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd)
extension is the easiest way to manually invoke tools or route natural language through
Gemini for local testing).

## Explicitly out of scope

Wavetable synthesis, a full effects chain (more than one effect), MIDI I/O, preset cloud
sync, a step sequencer, and polyphony beyond one note at a time — this stays a deliberately
deep single instrument, not a DAW.

## License

MIT — see [LICENSE](LICENSE).
