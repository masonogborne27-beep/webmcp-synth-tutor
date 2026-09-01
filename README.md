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

The **Ask the agent** box at the top is the fastest way in: paste a free API key (Gemini or
Claude — pick either from the dropdown, stored only in your browser), then type something
vague and creative:

- "make it sound warmer"
- "more like a lo-fi beat"
- "give me a punchier bass"
- "what does resonance do?"

The agent decides which real tool functions to call, executes them, and replies in plain
language. Keep going — follow-ups like "no, even warmer" refine from where it left off, since
conversation history persists for the session. No key handy? Click a preset instead to get a
real sound going immediately (no blank-slate problem), then turn the knobs yourself.

Watch the reasoning appear as an annotation on the module that changed, and build up in the
reasoning log below the diagram — this happens whether the agent was driven by the built-in
chat, or by an external WebMCP-capable agent (see below).

## Signal chain

```
3x Oscillator (sine / triangle / sawtooth / square, each with level + semitone/detune tune)
  -> mixed together
    -> Lowpass filter (cutoff + resonance)
      -> Amp envelope (ADSR)
        -> Delay effect (feedback + dry/wet mix)
          -> Limiter -> Master output
```

Monophonic — one note at a time, played from a 4-octave on-screen keyboard (C2-C6; mouse-
clickable across the whole range, or `A S D F G H J K` / `W E T Y U` for the current octave,
with `Z`/`X` shifting which octave those keys play). The whole chain is drawn as a live
schematic: a filter-response curve, an ADSR shape, and a real oscilloscope on the output
stage, so you can *see* the sound design, not just hear it.

## Presets

Six starting points (Warm Pad, Punchy Bass, Lo-Fi Beat, Bright Pluck, Ambient Drone, Retro
Lead) plus a "Surprise me" randomizer — pick one, then turn any knob to hear what it does
from a real sound instead of silence.

## The agent, two ways

1. **Built-in chat (primary path)** — `js/agent.js` calls an LLM directly from the browser
   with the tool definitions below as function declarations, executes whatever the model
   decides to call, and shows its reply in a chat log. By default this needs **zero setup**:
   it routes through a shared backend (see below) using one Claude key that isn't visible to
   the visitor. "Bring your own key" Gemini/Claude options remain in the provider dropdown as
   a fallback.
2. **WebMCP (`document.modelContext.registerTool()`)** — the same tool definitions are also
   registered with the browser's native WebMCP API when present, so an agentic browser
   (ChatGPT's in-app browser, or Chrome with `#enable-webmcp-testing`) can drive the page
   directly, no chat UI or API key involved. This is what the Devpost challenge is actually
   about — the built-in chat is what makes the same experience available to everyone else.

Both paths share one source of truth: `buildToolDefs()` in `js/webmcp-tools.js` returns the
tool list once, and both the WebMCP registration and the Agent class consume it, so the two
paths can never drift apart.

### Shared agent backend

A static site can't hide a secret — anything the browser can read, a visitor can read. So the
zero-setup default routes through a tiny Cloudflare Worker (`worker/index.js`) that holds one
Anthropic API key as a server-side secret and proxies Messages API requests for it. It's the
only server-side code in the whole project.

To deploy your own copy:

```bash
cd worker
npx wrangler login                          # one-time Cloudflare auth
npx wrangler secret put ANTHROPIC_API_KEY   # paste your key when prompted — never in a script
npx wrangler deploy
```

Then update `SHARED_WORKER_URL` in `js/agent.js` to the printed `*.workers.dev` URL, and add
that same URL (plus whatever origin you serve the frontend from) to `ALLOWED_ORIGINS` in
`worker/index.js`. The Worker also caps request size and restricts CORS to those origins as
basic abuse protection, since one key now covers every visitor's usage.

## WebMCP tools

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
