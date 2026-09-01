# Sound Design Tutor Synth

A minimal browser synth built for **The WebMCP Challenge**. An AI agent connects to the
page via [WebMCP](https://webmachinelearning.github.io/webmcp/) and can change the sound —
but the point isn't that it *can* make sounds, it's that every change comes with a short,
plain-language explanation of *why*, shown right next to the control that just moved.

**This is a sound-design teaching tool, not a composition or sequencing tool.** There's no
sequencer, no multi-track composition, no beat-making workflow — just one voice, one
signal chain, and an agent that explains what it's doing in FL Studio / Vital-adjacent
language a beginner could carry into any other DAW.

## Try it

Type something vague and creative into the connected agent, e.g.:

- "make it sound warmer"
- "more like a lo-fi beat"
- "give me a punchier bass"
- "what does resonance do?"

Watch the reasoning appear next to the knob that moved, and build up in the reasoning
log at the bottom of the controls.

## Signal chain

```
Oscillator (sine / triangle / sawtooth / square)
  -> Lowpass filter (cutoff + resonance)
    -> Amp envelope (ADSR)
      -> Delay effect (feedback + dry/wet mix)
        -> Master output
```

Monophonic — one note at a time, played from the on-screen keyboard (mouse or
`A S D F G H J K` for white keys, `W E T Y U` for black keys, one octave from C4).

## WebMCP tools

Registered via `document.modelContext.registerTool()`:

| Tool | Purpose |
| --- | --- |
| `set_waveform` | Switch the oscillator shape |
| `set_filter` | Adjust cutoff and/or resonance |
| `set_envelope` | Adjust attack / decay / sustain / release |
| `set_effect` | Toggle the delay and set its dry/wet mix |
| `explain_parameter` | Plain-language explanation of a parameter category, for standalone questions |

The four mutating tools accept an optional `reason` string in their input schema — the
agent is prompted (via the tool description) to always include a short, beginner-friendly
explanation, which the page renders inline next to the control and appends to the
reasoning log.

## Running locally

No build step, no dependencies. Serve the directory statically and open it:

```bash
python3 -m http.server 8420
```

Then visit `http://localhost:8420`. To test the agent integration, open the page in
ChatGPT's in-app browser, or in Chrome with `chrome://flags/#enable-webmcp-testing`
enabled.

## Explicitly out of scope

Multiple/mixed oscillators, wavetable synthesis, a full effects chain, MIDI I/O, preset
cloud sync, a step sequencer, polyphony, and accounts of any kind — see the project brief
for the reasoning. This is a deliberately small, deep instrument, not a DAW.

## License

MIT — see [LICENSE](LICENSE).
