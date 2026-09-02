// DOM wiring: the signal chain (oscillators -> filter -> envelope -> delay,
// connected by arrows so the layout itself shows the audio path) plus a
// separate, deliberately dramatic Output scope, the keyboard, presets, and
// inline speech-bubble annotations. Pure UI logic — talks to a SynthEngine
// instance passed in, never creates one.

// Full playable range, not just one octave — a real MIDI controller's worth
// (C2-C6, 4 octaves) so an average user can actually play a bassline and a
// lead without feeling boxed in.
const KEYBOARD_OCTAVES = [2, 3, 4, 5];
const WHITE_NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_AFTER_NAMES = ['C', 'D', 'F', 'G', 'A'];

const WHITE_KEYS = KEYBOARD_OCTAVES.flatMap((oct) => WHITE_NOTE_NAMES.map((n) => `${n}${oct}`));
WHITE_KEYS.push(`C${KEYBOARD_OCTAVES[KEYBOARD_OCTAVES.length - 1] + 1}`);
const BLACK_KEYS = KEYBOARD_OCTAVES.flatMap((oct) =>
  BLACK_AFTER_NAMES.map((n) => ({
    note: `${n}#${oct}`,
    afterWhiteIndex: WHITE_KEYS.indexOf(`${n}${oct}`),
  }))
);

// QWERTY plays one octave at a time, relative to a shiftable "current octave"
// (Z/X shift it) — semitone offsets from that octave's C.
const KEY_TO_SEMITONE = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};
const DEFAULT_OCTAVE = 4;
const MIN_OCTAVE = 1;
const MAX_OCTAVE = 6;

function qwertyNoteName(semitoneOffset, octave) {
  const midi = (octave + 1) * 12 + semitoneOffset;
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const noteOctave = Math.floor(midi / 12) - 1;
  return `${name}${noteOctave}`;
}

// Percentage-based, not fixed pixels, so the keyboard stretches to fill the
// full width of its row instead of leaving a gap when the container is wider
// than a fixed-size piano would be. Must track WHITE_KEYS.length — see below.
const WHITE_KEY_WIDTH_PCT = 100 / WHITE_KEYS.length;
const BLACK_KEY_WIDTH_PCT = WHITE_KEY_WIDTH_PCT * 0.62;

const WAVE_PATHS = {
  sine: 'M2 12 C 5 3, 8 3, 12 12 S 19 21, 22 12',
  triangle: 'M2 12 L 7 3 L 12 12 L 17 21 L 22 12',
  sawtooth: 'M2 20 L 12 4 L 12 20 L 22 4',
  square: 'M2 4 L 2 20 L 12 20 L 12 4 L 22 4 L 22 20',
};
const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];

function el(tag, className, children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  (children || []).forEach((c) => c != null && node.append(c));
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function moduleTitle(text) {
  return el('h3', 'module-title', [text]);
}

// Silkscreened spec text at the foot of a faceplate — the kind of thing a
// real panel prints under a control. Flavor, but accurate flavor: the filter
// really is a 12 dB/oct lowpass (BiquadFilterNode), the envelope really does
// ramp linearly, the delay line really is fixed at 280 ms.
function moduleSpec(text) {
  return el('div', 'module-spec', [text]);
}

// ---- log-scale helpers for the filter cutoff knob ----
function sliderToHz(v) {
  const minLog = Math.log(20), maxLog = Math.log(20000);
  return Math.exp(minLog + ((maxLog - minLog) * v) / 100);
}
function hzToSlider(hz) {
  const minLog = Math.log(20), maxLog = Math.log(20000);
  return ((Math.log(hz) - minLog) / (maxLog - minLog)) * 100;
}

function buildWaveformMini(index, engine, onChange) {
  const wrap = el('div', 'wave-mini');
  const buttons = WAVEFORMS.map((wf) => {
    const btn = el('button', 'wave-mini-btn' + (wf === engine.oscillators[index].waveform ? ' active' : ''));
    btn.dataset.waveform = wf;
    btn.title = wf;
    const svg = svgEl('svg', { viewBox: '0 0 24 24' });
    svg.append(svgEl('path', { d: WAVE_PATHS[wf] }));
    btn.append(svg);
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      engine.setOscillator(index, { waveform: wf });
      onChange?.(wf);
    });
    wrap.append(btn);
    return btn;
  });
  wrap._setActive = (wf) => buttons.forEach((b) => b.classList.toggle('active', b.dataset.waveform === wf));
  return wrap;
}

function annotationSlot(param) {
  const box = el('div', 'annotation');
  box.id = `reason-${param}`;
  return box;
}

// Draws ~2.5 cycles of the given waveform shape, amplitude scaled by level —
// a muted oscillator (level 0) reads as a flat line, a loud one as a tall wave.
function drawOscWaveform(canvas, waveform, level) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cycles = 2.5;
  const amp = (h / 2 - 5) * Math.max(0, Math.min(1, level));
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const t = (x / w) * cycles * Math.PI * 2;
    let v;
    if (waveform === 'sine') v = Math.sin(t);
    else if (waveform === 'triangle') v = (2 / Math.PI) * Math.asin(Math.sin(t));
    else if (waveform === 'sawtooth') v = 2 * (((t / (2 * Math.PI)) % 1) - 0.5);
    else v = Math.sin(t) >= 0 ? 1 : -1; // square
    const y = h / 2 - v * amp;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  const style = getComputedStyle(document.documentElement);
  ctx.strokeStyle = style.getPropertyValue('--accent').trim() || '#5eead4';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function buildOscillatorModule(index, engine, onLogged) {
  const module = el('section', 'module module--osc');

  const oscState = { waveform: engine.oscillators[index].waveform, level: engine.oscillators[index].level };
  // Remembers where the level knob was before the power dot muted it, so
  // clicking back on restores the same depth instead of jumping to full.
  let lastLevel = oscState.level > 0.001 ? oscState.level : 1;

  const powerBtn = el('button', 'osc-power');
  powerBtn.type = 'button';
  const updatePower = () => {
    const on = oscState.level > 0.001;
    powerBtn.classList.toggle('on', on);
    powerBtn.setAttribute('aria-pressed', String(on));
    powerBtn.title = `Oscillator ${index + 1}: ${on ? 'on' : 'off'} — click to ${on ? 'mute' : 'unmute'}`;
  };
  powerBtn.addEventListener('click', () => {
    const turningOn = oscState.level <= 0.001;
    if (!turningOn) lastLevel = oscState.level;
    const newLevel = turningOn ? lastLevel : 0;
    engine.setOscillator(index, { level: newLevel });
    oscState.level = newLevel;
    levelKnob.setReal(newLevel);
    updatePower();
    redrawWave();
    onLogged(`oscillator-${index}`);
  });
  module.append(el('h3', 'module-title', [powerBtn, `OSC ${index + 1}`]));

  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 90;
  canvas.className = 'osc-viz';
  const redrawWave = () => drawOscWaveform(canvas, oscState.waveform, oscState.level);
  module.append(canvas);

  const waveMini = buildWaveformMini(index, engine, () => onLogged(`oscillator-${index}`));
  waveMini.querySelectorAll('.wave-mini-btn').forEach((btn) => {
    btn.addEventListener('click', () => { oscState.waveform = btn.dataset.waveform; redrawWave(); });
  });
  module.append(waveMini);

  const levelKnob = createKnob({
    label: 'Level',
    posMin: 0, posMax: 1, step: 0.01,
    initialPos: engine.oscillators[index].level,
    format: (v) => v.toFixed(2),
    scaleMin: '0', scaleMax: '1',
    onChange: (v) => {
      engine.setOscillator(index, { level: v });
      oscState.level = v;
      if (v > 0.001) lastLevel = v;
      updatePower();
      redrawWave();
      onLogged(`oscillator-${index}`);
    },
  });
  const tuneKnob = createKnob({
    label: 'Tune',
    posMin: -24, posMax: 24, step: 1,
    initialPos: engine.oscillators[index].semitone,
    format: (v) => (v === 0 ? '0 st' : `${v > 0 ? '+' : ''}${v} st`),
    scaleMin: '−24', scaleMax: '+24',
    onChange: (v) => { engine.setOscillator(index, { semitone: v }); onLogged(`oscillator-${index}`); },
  });

  module.append(el('div', 'knob-row', [levelKnob.el, tuneKnob.el]));

  // One-word character tag, re-derived live from this oscillator's actual
  // waveform/tune/level — same pattern as the topbar's overall patch
  // character readout, scoped to just this oscillator.
  const characterEl = el('span', 'osc-character-word', ['']);
  module.append(el('div', 'osc-character', [characterEl]));
  const updateCharacter = () => { characterEl.textContent = describeOscCharacter(engine.oscillators[index]); };
  engine.onChange((param) => { if (param === `oscillator-${index}`) updateCharacter(); });

  module.append(moduleSpec(`VCO ${index + 1} · ±24 ST`));
  module.append(annotationSlot(`oscillator-${index}`));
  updatePower();
  redrawWave();
  updateCharacter();

  return {
    module,
    setState({ waveform, level, semitone }) {
      if (waveform != null) { waveMini._setActive(waveform); oscState.waveform = waveform; }
      if (level != null) {
        levelKnob.setReal(level);
        oscState.level = level;
        if (level > 0.001) lastLevel = level;
      }
      if (semitone != null) tuneKnob.setReal(semitone);
      updatePower();
      redrawWave();
      updateCharacter();
    },
  };
}

// The curve sweeps 20Hz-20kHz log-mapped linearly across the canvas — this
// is the inverse of that same mapping, so a reference tick at a given
// frequency lands exactly under the curve's own x for that frequency,
// rather than a separately-eyeballed position that could drift from it.
const FILTER_FREQ_MIN = 20, FILTER_FREQ_MAX = 20000;
function filterFreqToFrac(freq) {
  return Math.log(freq / FILTER_FREQ_MIN) / Math.log(FILTER_FREQ_MAX / FILTER_FREQ_MIN);
}
const FILTER_FREQ_TICKS = [
  { freq: 100, label: '100' },
  { freq: 1000, label: '1k' },
  { freq: 10000, label: '10k' },
];

function drawFilterCurve(canvas, cutoff, resonance) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  // Faint reference gridlines at 100Hz/1kHz/10kHz, drawn first so the curve
  // stroke sits on top of them.
  const gridStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#a1a1aa';
  ctx.save();
  ctx.strokeStyle = gridStyle;
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 1;
  FILTER_FREQ_TICKS.forEach(({ freq }) => {
    const x = filterFreqToFrac(freq) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  });
  ctx.restore();
  ctx.beginPath();
  const points = 64;
  // A canvas always clips its own drawing to its element bounds — it cannot
  // literally escape the box. What was actually happening: at max resonance
  // the peak's y (and, with a stroke width of 2, any point sitting exactly
  // on x=0/x=w or y=0/y=h) bled right up to — and its stroke half-width past
  // — the edge, reading as "poking out of the frame". Insetting every edge
  // by a margin at least as big as the stroke's half-width fixes this for
  // every corner, not just the one that was reported.
  const margin = 3;
  for (let i = 0; i <= points; i++) {
    const freq = 20 * Math.pow(1000, i / points); // 20Hz..20kHz log sweep
    const ratio = freq / cutoff;
    // simple one-pole-ish lowpass magnitude approximation with resonance bump
    const resonanceBump = 1 + (resonance / 20) * Math.exp(-Math.pow(Math.log(ratio), 2) * 4);
    const mag = (1 / Math.sqrt(1 + Math.pow(ratio, 4))) * resonanceBump;
    const x = clamp((i / points) * w, margin, w - margin);
    const y = clamp(h - Math.min(mag, 1.4) * (h * 0.72), margin, h - margin);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'var(--accent, #7effc0)';
  const style = getComputedStyle(document.documentElement);
  ctx.strokeStyle = style.getPropertyValue('--accent').trim() || '#7effc0';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function buildFilterModule(engine, onLogged) {
  const module = el('section', 'module module--filter');
  module.append(moduleTitle('Filter'));

  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 90;
  canvas.className = 'filter-curve';

  // Freq labels as an HTML overlay, not canvas text: the canvas's internal
  // 320x90 resolution gets stretched to whatever width the module renders
  // at, which would stretch drawn text horizontally right along with it.
  // Percentage-based left offsets stay correct at any width for the same
  // reason the gridlines do — both come from the identical log-frequency
  // fraction, just applied in CSS space instead of canvas space.
  const freqTicks = FILTER_FREQ_TICKS.map(({ freq, label }) =>
    el('span', 'filter-freq-tick', [label]));
  freqTicks.forEach((tickEl, i) => {
    tickEl.style.left = `${filterFreqToFrac(FILTER_FREQ_TICKS[i].freq) * 100}%`;
  });
  module.append(el('div', 'filter-curve-wrap', [canvas, ...freqTicks]));

  const redraw = () => drawFilterCurve(canvas, engine.filterFreq, engine.filterQ);

  const cutoffKnob = createKnob({
    label: 'Cutoff',
    posMin: 0, posMax: 100,
    initialPos: hzToSlider(engine.filterFreq),
    toReal: sliderToHz, toPos: hzToSlider,
    format: (v) => `${Math.round(v)} Hz`,
    scaleMin: '20', scaleMax: '20k',
    onChange: (hz) => { engine.setFilter({ cutoff: hz }); redraw(); onLogged('filter'); },
  });
  const resonanceKnob = createKnob({
    label: 'Resonance',
    posMin: 0, posMax: 20, step: 0.1,
    initialPos: engine.filterQ,
    format: (v) => v.toFixed(1),
    scaleMin: '0', scaleMax: '20',
    onChange: (q) => { engine.setFilter({ resonance: q }); redraw(); onLogged('filter'); },
  });

  module.append(el('div', 'knob-row', [cutoffKnob.el, resonanceKnob.el]));
  module.append(moduleSpec('LOWPASS · 12 dB/OCT'));
  module.append(annotationSlot('filter'));
  redraw();

  return {
    module,
    setState({ cutoff, resonance }) {
      if (cutoff != null) cutoffKnob.setReal(cutoff);
      if (resonance != null) resonanceKnob.setReal(resonance);
      redraw();
    },
  };
}

const ENV_VIEW = { w: 120, h: 90 };

// The curve's geometry, computed once and shared by everything drawn on the
// graph: the line itself, the stage labels beneath it, and the playhead that
// travels it while a note sounds. One source of shape, so a label or the
// playhead can never sit somewhere the curve isn't.
function envelopeGeometry(env) {
  const { w, h } = ENV_VIEW;
  const floor = h - 2;
  const totalTime = Math.max(env.attack + env.decay + env.release, 0.3) * 1.4;
  const holdFrac = 0.35;
  const x1 = (env.attack / totalTime) * w;
  const x2 = x1 + (env.decay / totalTime) * w;
  const sustainEnd = x2 + holdFrac * w;
  const x3 = Math.min(sustainEnd + (env.release / totalTime) * w, w);
  const sustainY = floor - env.sustain * (floor - 2);
  return { w, h, floor, peakY: 2, x1, x2, sustainEnd: Math.min(sustainEnd, w - 1), x3, sustainY };
}

function drawEnvelopeViz(svg, env) {
  const g = envelopeGeometry(env);
  const linePoints = [
    [0, g.floor], [g.x1, g.peakY], [g.x2, g.sustainY], [g.sustainEnd, g.sustainY], [g.x3, g.floor],
  ];
  const fillPoints = [...linePoints, [g.x3, g.floor + 2], [0, g.floor + 2]];
  svg.querySelector('polyline.line').setAttribute('points', linePoints.map((p) => p.join(',')).join(' '));
  svg.querySelector('polyline.fill').setAttribute('points', fillPoints.map((p) => p.join(',')).join(' '));
  return g;
}

function buildEnvelopeModule(engine, onLogged) {
  const module = el('section', 'module module--envelope');
  module.append(moduleTitle('Envelope'));

  // preserveAspectRatio="none": without it, the SVG letterboxes to keep the
  // viewBox's 120:90 ratio, leaving visible empty bars once this box is
  // stretched to match the knob grid's height/width — none lets the drawn
  // curve fill the actual box exactly, edge to edge.
  const svg = svgEl('svg', { viewBox: '0 0 120 90', preserveAspectRatio: 'none', class: 'envelope-viz' });
  svg.append(svgEl('polyline', { class: 'fill', points: '0,88 0,88' }));
  svg.append(svgEl('polyline', { class: 'line', points: '0,88 0,88' }));

  // Playhead: a vertical marker plus a dot riding the curve. The line uses
  // non-scaling-stroke and the dot is counter-scaled per frame, because the
  // graph's non-uniform stretch would otherwise render them as a wedge and
  // an ellipse.
  const playLine = svgEl('line', {
    class: 'env-playhead-line', x1: 0, y1: 0, x2: 0, y2: ENV_VIEW.h,
    'vector-effect': 'non-scaling-stroke',
  });
  const playDot = svgEl('circle', { class: 'env-playhead-dot', cx: 0, cy: 0, r: 4 });
  svg.append(playLine, playDot);

  const state = { ...engine.envelope };
  let geometry = envelopeGeometry(state);
  const redraw = () => { geometry = drawEnvelopeViz(svg, state); };

  const specs = [
    ['attack', 'Attack', 0, 3, (v) => `${v.toFixed(2)}s`, '0', '3s'],
    ['decay', 'Decay', 0, 3, (v) => `${v.toFixed(2)}s`, '0', '3s'],
    ['sustain', 'Sustain', 0, 1, (v) => v.toFixed(2), '0', '1'],
    ['release', 'Release', 0, 4, (v) => `${v.toFixed(2)}s`, '0', '4s'],
  ];
  const knobs = {};
  const knobEls = specs.map(([key, label, min, max, format, scaleMin, scaleMax]) => {
    const knob = createKnob({
      label, posMin: min, posMax: max, step: 0.01,
      initialPos: engine.envelope[key], format, scaleMin, scaleMax,
      onChange: (v) => {
        state[key] = v;
        engine.setEnvelope({ [key]: v });
        redraw();
        onLogged('envelope');
      },
    });
    knobs[key] = knob;
    return knob.el;
  });
  // ---- live playhead ----
  // The envelope stops being an abstract diagram the moment you can watch a
  // note travel it: attack ramp, decay fall, sustain plateau, release tail,
  // in step with what you're hearing. Driven by the same note trigger that
  // starts the audio, so the two cannot fall out of sync.
  //
  // walkPosition() is the ONE function that places a point on the curve
  // before release, and it is built from exactly the same breakpoints
  // drawEnvelopeViz() draws (g.x1/x2/sustainEnd, g.peakY/sustainY/floor) — not
  // a second, independent formula that happens to produce similar numbers.
  // The release phase below reuses its output as the start of the release
  // lerp rather than computing its own "current" position, which is what
  // previously let a note released mid-attack or mid-decay draw a straight
  // diagonal from wherever it was to the bottom-right corner: audio-accurate,
  // but nowhere the drawn curve actually goes.
  //
  // The plateau is the one part real time can't be mapped onto directly —
  // the graph draws a fixed-width hold, but a key can be held indefinitely.
  // The playhead crosses it over HOLD_TRAVERSE_S and then parks at its end.
  // An early release doesn't skip this: the pointer keeps tracing the
  // already-drawn attack/decay/hold shape at its normal pace and only starts
  // the release segment once it naturally reaches the hold's end — so the
  // dot is always sitting somewhere on the visible line, never off it.
  const HOLD_TRAVERSE_S = 0.9;
  let noteStart = 0;
  let released = false;
  let keyUpAt = 0;
  let rafId = null;

  const lerp = (a, b, t) => a + (b - a) * t;

  const setPlayhead = (x, y, visible) => {
    svg.classList.toggle('env-playing', visible);
    if (!visible) return;
    playLine.setAttribute('x1', x);
    playLine.setAttribute('x2', x);
    playDot.setAttribute('cx', 0);
    playDot.setAttribute('cy', 0);
    // Counter-scale so the dot stays round however the graph is stretched.
    const rect = svg.getBoundingClientRect();
    const sx = rect.width ? 4.5 / (4 * (rect.width / geometry.w)) : 1;
    const sy = rect.height ? 4.5 / (4 * (rect.height / geometry.h)) : 1;
    playDot.setAttribute('transform', `translate(${x} ${y}) scale(${sx} ${sy})`);
  };

  // Where the drawn attack/decay/hold shape sits at real elapsed time `t`
  // since note-on. Every value returned is a point that lies exactly on the
  // polyline drawEnvelopeViz() draws — this is the single source both the
  // "still held" case and the release lerp's start point read from.
  const walkPosition = (t, g) => {
    const { attack, decay } = state;
    if (t < attack) return [lerp(0, g.x1, attack ? t / attack : 1), lerp(g.floor, g.peakY, attack ? t / attack : 1)];
    const td = t - attack;
    if (td < decay) return [lerp(g.x1, g.x2, decay ? td / decay : 1), lerp(g.peakY, g.sustainY, decay ? td / decay : 1)];
    const th = td - decay;
    return [Math.min(g.x2 + (th / HOLD_TRAVERSE_S) * (g.sustainEnd - g.x2), g.sustainEnd), g.sustainY];
  };

  const holdEndsAt = () => state.attack + state.decay + HOLD_TRAVERSE_S;

  const frame = () => {
    const now = performance.now() / 1000;
    const g = geometry;
    const heldT = now - noteStart;

    if (!released) {
      const [x, y] = walkPosition(heldT, g);
      setPlayhead(x, y, true);
      rafId = requestAnimationFrame(frame);
      return;
    }

    // Release doesn't begin until the shape has actually finished drawing
    // out to the hold's end — a key released mid-attack still gets to watch
    // attack and decay land before the release segment starts, which is what
    // keeps the dot on the curve instead of cutting across to it.
    const releaseAnchorT = Math.max(keyUpAt - noteStart, holdEndsAt());
    if (heldT < releaseAnchorT) {
      const [x, y] = walkPosition(heldT, g);
      setPlayhead(x, y, true);
      rafId = requestAnimationFrame(frame);
      return;
    }
    const relT = state.release ? (heldT - releaseAnchorT) / state.release : 1;
    if (relT >= 1) { stopPlayhead(); return; }
    const [fx, fy] = walkPosition(releaseAnchorT, g);
    setPlayhead(lerp(fx, g.x3, relT), lerp(fy, g.floor, relT), true);
    rafId = requestAnimationFrame(frame);
  };

  function stopPlayhead() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    released = false;
    setPlayhead(0, 0, false);
  }

  engine.onNote((type) => {
    const now = performance.now() / 1000;
    if (type === 'on') {
      noteStart = now;
      released = false;
      if (!rafId) rafId = requestAnimationFrame(frame);
    } else {
      released = true;
      keyUpAt = now;
      if (!rafId) rafId = requestAnimationFrame(frame);
    }
  });

  // Graph on the left half, the 4 knobs as a 2x2 grid on the right half.
  const knobGrid = el('div', 'knob-grid', knobEls);
  module.append(el('div', 'envelope-body', [svg, knobGrid]));
  module.append(moduleSpec('ADSR · LINEAR'));
  module.append(annotationSlot('envelope'));
  redraw();

  return {
    module,
    setState(partial) {
      Object.entries(partial).forEach(([k, v]) => {
        if (v == null || !knobs[k]) return;
        state[k] = v;
        knobs[k].setReal(v);
      });
      redraw();
    },
  };
}

// Each bar is one echo repeat. Bar i's amplitude is mix * feedback^i — the
// exact factor the feedback loop actually applies i times over, not a
// decorative approximation — so a real feedback change would visibly alter
// how many bars survive above the "near-zero" floor before this fades out.
// feedback is presently fixed (DELAY_FEEDBACK), but mix and enabled are the
// two values that do change live, and both drive this directly.
const DELAY_ECHO_BARS = 6;
const DELAY_ECHO_FLOOR = 0.03; // repeats quieter than this aren't worth drawing

function drawDelayEcho(canvas, engine) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const { enabled, mix } = engine.effect;
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--accent').trim() || '#5eead4';
  const dim = style.getPropertyValue('--text-dim').trim() || '#8b8a90';

  const gap = 5;
  const barW = (w - gap * (DELAY_ECHO_BARS - 1)) / DELAY_ECHO_BARS;
  for (let i = 0; i < DELAY_ECHO_BARS; i++) {
    const amp = enabled ? mix * Math.pow(DELAY_FEEDBACK, i) : 0;
    const x = i * (barW + gap);
    if (!enabled || amp < DELAY_ECHO_FLOOR) {
      // Inactive/decayed-away: a flat, dim baseline tick rather than an
      // empty gap, so "off" reads as a deliberate state, not a rendering gap.
      ctx.fillStyle = dim;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(x, h - 2, barW, 2);
      continue;
    }
    const barH = Math.max(2, amp * (h - 4));
    ctx.fillStyle = accent;
    ctx.globalAlpha = Math.max(0.18, amp);
    ctx.fillRect(x, h - barH, barW, barH);
  }
  ctx.globalAlpha = 1;
}

function buildEffectModule(engine, onLogged) {
  const module = el('section', 'module module--effect');
  module.append(moduleTitle('Delay'));

  const toggleWrap = el('label', 'toggle');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = engine.effect.enabled;
  toggleWrap.append(checkbox, el('span', 'toggle-track'), el('span', 'toggle-label', ['On']));
  checkbox.addEventListener('change', () => {
    engine.setEffect({ enabled: checkbox.checked });
    redrawEcho();
    onLogged('effect');
  });
  module.append(toggleWrap);

  const mixKnob = createKnob({
    label: 'Mix', posMin: 0, posMax: 1, step: 0.01,
    initialPos: engine.effect.mix,
    format: (v) => v.toFixed(2),
    scaleMin: 'dry', scaleMax: 'wet',
    onChange: (v) => { engine.setEffect({ mix: v }); redrawEcho(); onLogged('effect'); },
  });
  module.append(el('div', 'knob-row', [mixKnob.el]));

  const echoCanvas = document.createElement('canvas');
  echoCanvas.width = 140; echoCanvas.height = 54;
  echoCanvas.className = 'delay-echo';
  const redrawEcho = () => drawDelayEcho(echoCanvas, engine);
  module.append(echoCanvas);

  // The real fixed values behind the echo above: this delay line always
  // repeats every 280ms (DELAY_TIME_S) with each repeat at 35% of the last
  // (DELAY_FEEDBACK) — not a decorative caption, the exact numbers the bars
  // are computed from.
  module.append(moduleSpec(`${Math.round(DELAY_TIME_S * 1000)} MS · FB ${DELAY_FEEDBACK.toFixed(2)}`));
  module.append(annotationSlot('effect'));
  redrawEcho();

  return {
    module,
    setState({ enabled, mix }) {
      if (enabled != null) checkbox.checked = enabled;
      if (mix != null) mixKnob.setReal(mix);
      redrawEcho();
    },
  };
}

// The one deliberately dramatic element on the page (a CRT-style glowing
// trace) — everything else on the instrument stays quiet and disciplined
// around it, by design.
function buildSignalPath(engine, onLogged) {
  const rowTop = document.getElementById('row-top');
  const rowOsc = document.getElementById('row-osc');

  const oscUIs = [0, 1, 2].map((i) => buildOscillatorModule(i, engine, onLogged));
  const filterUI = buildFilterModule(engine, onLogged);
  const envelopeUI = buildEnvelopeModule(engine, onLogged);
  const effectUI = buildEffectModule(engine, onLogged);

  rowTop.append(envelopeUI.module, filterUI.module, effectUI.module);
  oscUIs.forEach((o) => rowOsc.append(o.module));

  return { oscUIs, filterUI, envelopeUI, effectUI };
}

// ---- keyboard unit: Output scope + physical keybed, built together as the
// one hardware strip they're now fused into visually. ----
function buildKeyboardUnit(engine) {
  const outputHero = document.getElementById('output-hero');
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 100;
  canvas.className = 'scope';
  outputHero.append(canvas, el('div', 'output-scope-label', ['Output']));

  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  function draw() {
    requestAnimationFrame(draw);
    const samples = engine.getScopeSamples();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    if (!samples) {
      // Idle placeholder before the first note is ever played (no analyser yet).
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
    } else {
      const step = Math.floor(samples.length / canvas.width) || 1;
      for (let x = 0, i = 0; x < canvas.width; x++, i += step) {
        const y = canvas.height / 2 - samples[i] * (canvas.height / 2 - 6);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    const accent = style.getPropertyValue('--accent').trim() || '#7effc0';
    ctx.strokeStyle = accent;
    ctx.lineWidth = samples ? 2.5 : 1.5;
    ctx.globalAlpha = samples ? 1 : 0.2;
    ctx.shadowColor = accent;
    ctx.shadowBlur = samples ? 14 : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  draw();

  const container = document.getElementById('keyboard');
  const keyEls = {};

  const makeKey = (className, note) => {
    const qwertyEl = el('span', 'key-qwerty', ['']);
    const keyEl = el('div', className, [note, qwertyEl]);
    keyEl.dataset.note = note;
    keyEl._qwertyEl = qwertyEl;
    return keyEl;
  };

  WHITE_KEYS.forEach((note) => {
    const keyEl = makeKey('key white', note);
    container.appendChild(keyEl);
    keyEls[note] = keyEl;
  });
  BLACK_KEYS.forEach(({ note, afterWhiteIndex }) => {
    const keyEl = makeKey('key black', '');
    keyEl.dataset.note = note;
    keyEl.style.position = 'absolute';
    keyEl.style.left = `${(afterWhiteIndex + 1) * WHITE_KEY_WIDTH_PCT - BLACK_KEY_WIDTH_PCT / 2}%`;
    container.appendChild(keyEl);
    keyEls[note] = keyEl;
  });

  const press = (note) => {
    if (!note || !NOTE_FREQS[note]) return;
    engine.noteOn(NOTE_FREQS[note]);
    keyEls[note]?.classList.add('active');
  };
  const release = (note) => {
    if (!note) return;
    engine.noteOff();
    keyEls[note]?.classList.remove('active');
  };

  let mouseIsDown = false;
  document.addEventListener('mousedown', () => (mouseIsDown = true));
  document.addEventListener('mouseup', () => (mouseIsDown = false));
  container.addEventListener('mousedown', (e) => {
    const note = e.target.closest('.key')?.dataset.note;
    if (note) press(note);
  });
  container.addEventListener('mouseup', (e) => {
    const note = e.target.closest('.key')?.dataset.note;
    if (note) release(note);
  });
  container.addEventListener('mouseleave', (e) => {
    const note = e.target.closest('.key')?.dataset.note;
    if (note && mouseIsDown) release(note);
  });

  let currentOctave = DEFAULT_OCTAVE;
  const octaveIndicator = document.getElementById('octave-indicator');
  const updateQwertyLabels = () => {
    Object.values(keyEls).forEach((k) => { k._qwertyEl.textContent = ''; });
    Object.entries(KEY_TO_SEMITONE).forEach(([letter, semitone]) => {
      const note = qwertyNoteName(semitone, currentOctave);
      const keyEl = keyEls[note];
      if (keyEl) keyEl._qwertyEl.textContent = letter.toUpperCase();
    });
  };
  const renderOctave = () => {
    octaveIndicator.textContent = `Octave ${currentOctave} (Z/X to shift)`;
    updateQwertyLabels();
  };
  renderOctave();

  // Never hijack keystrokes meant for a text field (agent chat, API key input, etc).
  const isTypingTarget = (e) =>
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;

  const heldKeys = new Map(); // physical key -> note name, so keyup releases the right note even after a shift
  document.addEventListener('keydown', (e) => {
    if (isTypingTarget(e)) return;
    const key = e.key.toLowerCase();
    if (key === 'z') { currentOctave = Math.max(MIN_OCTAVE, currentOctave - 1); renderOctave(); return; }
    if (key === 'x') { currentOctave = Math.min(MAX_OCTAVE, currentOctave + 1); renderOctave(); return; }
    if (!(key in KEY_TO_SEMITONE) || heldKeys.has(key)) return;
    const note = qwertyNoteName(KEY_TO_SEMITONE[key], currentOctave);
    heldKeys.set(key, note);
    press(note);
  });
  document.addEventListener('keyup', (e) => {
    // Always release a key we're tracking, even if focus moved to a text
    // field mid-hold — otherwise the note gets stuck on.
    const key = e.key.toLowerCase();
    const note = heldKeys.get(key);
    heldKeys.delete(key);
    if (note) release(note);
  });
}

// ---- presets ----
function applyPresetToUI(preset, uiHandles) {
  preset.oscillators.forEach((o, i) => uiHandles.oscUIs[i].setState(o));
  uiHandles.filterUI.setState(preset.filter);
  uiHandles.envelopeUI.setState(preset.envelope);
  uiHandles.effectUI.setState(preset.effect);
}

function randomPreset() {
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return {
    oscillators: [0, 1, 2].map((i) => ({
      waveform: pick(WAVEFORMS),
      level: i === 0 ? rand(0.6, 1) : rand(0, 0.7),
      detune: Math.round(rand(-15, 15)),
      semitone: pick([-12, -12, 0, 0, 0, 7, 12]),
    })),
    filter: { cutoff: Math.round(rand(300, 8000)), resonance: rand(0, 8) },
    envelope: {
      attack: rand(0.001, 0.8),
      decay: rand(0.05, 0.6),
      sustain: rand(0.1, 0.9),
      release: rand(0.1, 1.8),
    },
    effect: { enabled: Math.random() > 0.4, mix: rand(0.1, 0.6) },
  };
}

// A preset rewrites every module at once, so it must annotate every module at
// once. The old code wrote a single entry keyed "preset" — a slot that does
// not exist — so a preset load left no bubble of its own while silently
// invalidating the numbers in all the bubbles that were already showing.
//
// Only ONE bubble carries the framing sentence ("Loaded X as a starting
// point...") — Envelope, the first/most prominent panel — since it's the
// same sentence regardless of which module it sits on. Filter/Effect get
// reason:'' (just "(now: ...)", no repeated prose) since a preset gives no
// per-parameter reasoning for them to show.
//
// Oscillators are the exception: a preset choosing "sawtooth, -12 st" IS a
// real, explainable sound-design choice (a sub-bass layer, a bright lead...)
// even though no model is in the loop narrating it for this particular
// change. describeOscReason derives that explanation straight from the
// values themselves, so oscillator bubbles say why that waveform/tune
// combination was worth picking, not just "(now: sawtooth, level 0.90...)"
// with nothing behind it.
const PRIMARY_ANNOTATION_PARAM = 'envelope';
function annotatePresetLoad(engine, reason) {
  MODULE_PARAMS.forEach((param) => {
    if (param === PRIMARY_ANNOTATION_PARAM) {
      addReasoningLogEntry(param, reason);
    } else if (param.startsWith('oscillator-')) {
      const index = Number(param.slice('oscillator-'.length));
      addReasoningLogEntry(param, describeOscReason(engine.oscillators[index]));
    } else {
      addReasoningLogEntry(param, '');
    }
  });
}

function initPresets(engine, uiHandles) {
  const container = document.getElementById('presets');
  PRESETS.forEach((preset, i) => {
    const card = el('button', 'preset-card', [el('span', 'badge', [String(i + 1)]), preset.name]);
    card.addEventListener('click', () => {
      engine.loadPreset(preset);
      applyPresetToUI(preset, uiHandles);
      annotatePresetLoad(engine, `Loaded "${preset.name}" as a starting point — tweak any knob from here.`);
    });
    container.append(card);
  });

  document.getElementById('surprise-btn').addEventListener('click', () => {
    const preset = randomPreset();
    engine.loadPreset(preset);
    applyPresetToUI(preset, uiHandles);
    // No bubbles here on purpose: a named preset has a real story worth
    // telling ("Loaded Warm Pad..."), but a random patch's values are
    // arbitrary — six bubbles of "(now: cutoff 6529 Hz...)" don't teach
    // anything, they're just noise. Clear whatever bubbles were already up
    // so nothing stale lingers over the new random values.
    clearAllAnnotations();
  });
}

// ---- grounding: no model-written number ever reaches the screen ----
// The model is told to describe changes qualitatively and let the UI supply
// the numbers. These strip any it writes anyway, so a hallucinated "6500 Hz"
// can never end up sitting next to the real 1400 Hz. Both the annotation
// prose and the chat reply go through here; the true values are appended
// separately, straight from describeModule(engine, ...).

// A bare number carrying a unit ("to 3500 Hz", "0.25s", "8 semitones").
const NUMERIC_CLAIM_RE =
  /\s*\b(?:to|at|around|about|near|of|roughly)?\s*~?\d+(?:[.,]\d+)?\s*(?:hz|khz|db|%|ms|sec(?:onds?)?|semitones?|cents?|s\b|st\b)/gi;
// A parameter named with a number but no unit ("resonance to 8", "mix 0.4").
const PARAM_NUMBER_RE =
  /\b(cutoff|resonance|attack|decay|sustain|release|level|mix|detune|tune)\b\s*(?:to|at|of|=)?\s*~?\d+(?:[.,]\d+)?/gi;

function groundText(text, engine) {
  if (!text) return text;
  let out = text;
  // A preset the model names must be the one actually loaded, or not named.
  PRESETS.forEach((p) => {
    if (p.name === engine?.lastPresetName) return;
    out = out.split(p.name).join(engine?.lastPresetName || 'a preset');
  });
  out = out.replace(NUMERIC_CLAIM_RE, '');
  out = out.replace(PARAM_NUMBER_RE, '$1');
  // Tidy the punctuation left behind by a removed clause.
  return out.replace(/\s+([,.;!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

// ---- signal-flow connector ----
// A static SVG overlay drawn through the existing gaps between panels —
// never resizes or repositions a module — tracing the real audio graph:
// the 3 oscillators mix down and feed the envelope's amplitude gain, which
// feeds the filter, which feeds the delay, which feeds the output. That
// order (envelope, then filter) matches audio-engine.js's actual node
// wiring (mixNode -> envGain -> filterNode), not the more common "filter
// then envelope" synth convention — it happens to also match the current
// left-to-right panel order (Envelope, Filter, Delay), so no panel needed
// to move to keep the line straight and accurate.
function initSignalFlow() {
  const instrument = document.querySelector('.instrument');
  const rowTop = document.getElementById('row-top');
  const rowOsc = document.getElementById('row-osc');
  const envelopeEl = document.querySelector('.module--envelope');
  const filterEl = document.querySelector('.module--filter');
  const delayEl = document.querySelector('.module--effect');
  const oscEls = [...rowOsc.children];
  if (!envelopeEl || !filterEl || !delayEl || oscEls.length === 0) return;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'signal-flow');
  svg.setAttribute('aria-hidden', 'true');

  const group = document.createElementNS(svgNS, 'g');
  svg.append(group);
  instrument.prepend(svg);

  const rel = (elem, ir) => {
    const r = elem.getBoundingClientRect();
    return {
      top: r.top - ir.top, bottom: r.bottom - ir.top,
      left: r.left - ir.left, right: r.right - ir.left,
      centerX: (r.left + r.right) / 2 - ir.left,
    };
  };

  // A chevron drawn as its own small path at a segment's midpoint, rather
  // than a marker glued to the line's end — reads as "direction of flow
  // partway along," not as an arrow poking into the next panel's border.
  const chevronAt = (x, y, angleDeg) => svgEl('path', {
    class: 'signal-flow-chevron',
    d: 'M -3,-4 L 3,0 L -3,4',
    transform: `translate(${x} ${y}) rotate(${angleDeg})`,
  });

  const segment = (x1, y1, x2, y2, angleDeg) => {
    const frag = document.createDocumentFragment();
    frag.append(svgEl('line', { x1, y1, x2, y2, class: 'signal-flow-line' }));
    if (angleDeg != null) frag.append(chevronAt((x1 + x2) / 2, (y1 + y2) / 2, angleDeg));
    return frag;
  };

  function redraw() {
    const ir = instrument.getBoundingClientRect();
    if (!ir.width || !ir.height) return;
    svg.setAttribute('width', ir.width);
    svg.setAttribute('height', ir.height);
    svg.setAttribute('viewBox', `0 0 ${ir.width} ${ir.height}`);
    group.textContent = '';

    const oscR = oscEls.map((e) => rel(e, ir));
    const envR = rel(envelopeEl, ir);
    const filterR = rel(filterEl, ir);
    const delayR = rel(delayEl, ir);
    const rowTopR = rel(rowTop, ir);
    const rowOscR = rel(rowOsc, ir);

    // Three oscillators converge to one point in the gap before continuing
    // up as a single mixed signal — never three parallel lines all the way.
    const mergeX = oscR.reduce((sum, r) => sum + r.centerX, 0) / oscR.length;
    const mergeY = (rowTopR.bottom + rowOscR.top) / 2;
    oscR.forEach((r) => group.append(segment(r.centerX, rowOscR.top - 1, mergeX, mergeY)));

    // Keep the merge-to-envelope entry point inside Envelope's own span even
    // at extreme aspect ratios, where the plain average of 3 OSC centers
    // could otherwise land past Envelope's edge.
    const entryX = Math.min(Math.max(mergeX, envR.left + 14), envR.right - 14);
    group.append(segment(mergeX, mergeY, entryX, rowTopR.bottom + 1, -90));

    const midY = (rowTopR.top + rowTopR.bottom) / 2;
    group.append(segment(envR.right + 1, midY, filterR.left - 1, midY, 0));
    group.append(segment(filterR.right + 1, midY, delayR.left - 1, midY, 0));
    // A short stub past Delay implies "-> Output" without reaching all the
    // way down into the separate keyboard/output section below.
    group.append(segment(delayR.right + 1, midY, delayR.right + 20, midY, 0));
  }

  redraw();
  new ResizeObserver(redraw).observe(instrument);
}

// ---- inline speech-bubble annotations ----
// A bubble stores only the model's prose. Its numbers are re-derived from live
// engine state every time that module changes — from any source: a later tool
// call in the same turn, a preset load that overwrites everything, or the user
// turning the knob by hand. Nothing is cached, so a bubble cannot drift away
// from the knob beneath it. (It used to bake the value in at execute time,
// which is exactly how a bubble reading 3500 Hz ended up over a 1400 Hz knob.)
const annotationReasons = new Map();
let annotationEngine = null;

function initAnnotations(engine) {
  annotationEngine = engine;
  engine.onChange((param) => renderAnnotation(param));
  MODULE_PARAMS.forEach((p) => renderAnnotation(p));
}

// The word-level readout of the patch, re-derived on every change from the
// same live state the knobs show — so a viewer can watch "WARM" become
// "BRIGHT" as the cutoff opens, which is the whole teaching point.
function initPatchCharacter(engine) {
  const target = document.getElementById('patch-character-words');
  if (!target) return;
  const render = () => {
    const words = describePatchCharacter(engine);
    target.textContent = '';
    words.forEach((word, i) => {
      if (i) target.append(el('span', 'patch-character-sep', ['·']));
      target.append(el('span', 'patch-character-word', [word]));
    });
  };
  engine.onChange(render);
  render();
}

function renderAnnotation(param) {
  const inline = document.getElementById(`reason-${param}`);
  if (!inline || !annotationEngine) return;
  inline.textContent = '';
  // Distinguish "no entry at all" (bubble retired, e.g. the user just turned
  // this knob themselves) from "entry with an empty reason" (part of a
  // multi-module change whose framing sentence lives on a different panel —
  // still show the applied value, just no repeated prose).
  if (!annotationReasons.has(param)) return;
  const reason = annotationReasons.get(param);
  const applied = describeModule(annotationEngine, param);
  if (reason) inline.append(document.createTextNode(reason));
  if (applied) inline.append(el('span', 'applied', [reason ? ` (now: ${applied})` : `now: ${applied}`]));
}

// One suggestion is on screen at a time: a new request clears the bubbles the
// last one left behind, so the annotations always describe the change the user
// just asked for rather than accumulating across requests.
function clearAllAnnotations() {
  annotationReasons.clear();
  MODULE_PARAMS.forEach((p) => renderAnnotation(p));
}

// reason === a string -> show it (possibly '' for "applied value only, no
// prose" — see annotatePresetLoad). reason === null/undefined -> retire this
// module's bubble entirely, e.g. the user just turned this knob themselves,
// which clears whatever explanation used to be there rather than leaving
// stale prose over a value the user has since overridden.
function addReasoningLogEntry(parameter, reason) {
  if (reason == null) {
    annotationReasons.delete(parameter);
    renderAnnotation(parameter);
    return;
  }
  const grounded = reason ? groundText(reason, annotationEngine) : '';
  annotationReasons.set(parameter, grounded);
  renderAnnotation(parameter);
  const inline = document.getElementById(`reason-${parameter}`);
  if (!inline) return;
  inline.classList.remove('annotation--flash');
  void inline.offsetWidth;
  inline.classList.add('annotation--flash');
}

function setMcpStatus(ready) {
  const statusEl = document.getElementById('mcp-status');
  statusEl.classList.toggle('mcp-status--on', ready);
  statusEl.classList.toggle('mcp-status--off', !ready);
  statusEl.querySelector('.label').textContent = ready
    ? 'WebMCP: 6 tools ready'
    : 'WebMCP: unavailable in this browser';
}
