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
    onChange: (v) => { engine.setOscillator(index, { semitone: v }); onLogged(`oscillator-${index}`); },
  });

  module.append(el('div', 'knob-row', [levelKnob.el, tuneKnob.el]));
  module.append(annotationSlot(`oscillator-${index}`));
  updatePower();
  redrawWave();

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
    },
  };
}

function drawFilterCurve(canvas, cutoff, resonance) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
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
  module.append(canvas);

  const redraw = () => drawFilterCurve(canvas, engine.filterFreq, engine.filterQ);

  const cutoffKnob = createKnob({
    label: 'Cutoff',
    posMin: 0, posMax: 100,
    initialPos: hzToSlider(engine.filterFreq),
    toReal: sliderToHz, toPos: hzToSlider,
    format: (v) => `${Math.round(v)} Hz`,
    onChange: (hz) => { engine.setFilter({ cutoff: hz }); redraw(); onLogged('filter'); },
  });
  const resonanceKnob = createKnob({
    label: 'Resonance',
    posMin: 0, posMax: 20, step: 0.1,
    initialPos: engine.filterQ,
    format: (v) => v.toFixed(1),
    onChange: (q) => { engine.setFilter({ resonance: q }); redraw(); onLogged('filter'); },
  });

  module.append(el('div', 'knob-row', [cutoffKnob.el, resonanceKnob.el]));
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

function drawEnvelopeViz(svg, env) {
  const w = 120, h = 90, floor = h - 2;
  const totalTime = Math.max(env.attack + env.decay + env.release, 0.3) * 1.4;
  const holdFrac = 0.35;
  const x1 = (env.attack / totalTime) * w;
  const x2 = x1 + (env.decay / totalTime) * w;
  const sustainEnd = x2 + holdFrac * w;
  const x3 = Math.min(sustainEnd + (env.release / totalTime) * w, w);
  const sustainY = floor - env.sustain * (floor - 2);
  const linePoints = [
    [0, floor], [x1, 2], [x2, sustainY], [Math.min(sustainEnd, w - 1), sustainY], [x3, floor],
  ];
  const fillPoints = [...linePoints, [x3, floor + 2], [0, floor + 2]];
  svg.querySelector('polyline.line').setAttribute('points', linePoints.map((p) => p.join(',')).join(' '));
  svg.querySelector('polyline.fill').setAttribute('points', fillPoints.map((p) => p.join(',')).join(' '));
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

  const state = { ...engine.envelope };
  const redraw = () => drawEnvelopeViz(svg, state);

  const specs = [
    ['attack', 'Attack', 0, 3, (v) => `${v.toFixed(2)}s`],
    ['decay', 'Decay', 0, 3, (v) => `${v.toFixed(2)}s`],
    ['sustain', 'Sustain', 0, 1, (v) => v.toFixed(2)],
    ['release', 'Release', 0, 4, (v) => `${v.toFixed(2)}s`],
  ];
  const knobs = {};
  const knobEls = specs.map(([key, label, min, max, format]) => {
    const knob = createKnob({
      label, posMin: min, posMax: max, step: 0.01,
      initialPos: engine.envelope[key], format,
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
  // Graph on the left half, the 4 knobs as a 2x2 grid on the right half.
  const knobGrid = el('div', 'knob-grid', knobEls);
  module.append(el('div', 'envelope-body', [svg, knobGrid]));
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
    onLogged('effect');
  });
  module.append(toggleWrap);

  const mixKnob = createKnob({
    label: 'Mix', posMin: 0, posMax: 1, step: 0.01,
    initialPos: engine.effect.mix,
    format: (v) => v.toFixed(2),
    onChange: (v) => { engine.setEffect({ mix: v }); onLogged('effect'); },
  });
  module.append(el('div', 'knob-row', [mixKnob.el]));
  module.append(annotationSlot('effect'));

  return {
    module,
    setState({ enabled, mix }) {
      if (enabled != null) checkbox.checked = enabled;
      if (mix != null) mixKnob.setReal(mix);
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
function annotatePresetLoad(reason) {
  MODULE_PARAMS.forEach((param) => addReasoningLogEntry(param, reason));
}

function initPresets(engine, uiHandles) {
  const container = document.getElementById('presets');
  PRESETS.forEach((preset, i) => {
    const card = el('button', 'preset-card', [el('span', 'badge', [String(i + 1)]), preset.name]);
    card.addEventListener('click', () => {
      engine.loadPreset(preset);
      applyPresetToUI(preset, uiHandles);
      annotatePresetLoad(`Loaded "${preset.name}" as a starting point — tweak any knob from here.`);
    });
    container.append(card);
  });

  document.getElementById('surprise-btn').addEventListener('click', () => {
    const preset = randomPreset();
    engine.loadPreset(preset);
    applyPresetToUI(preset, uiHandles);
    annotatePresetLoad('Randomized every parameter — see what stuck and refine from here.');
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

function renderAnnotation(param) {
  const inline = document.getElementById(`reason-${param}`);
  if (!inline || !annotationEngine) return;
  const reason = annotationReasons.get(param);
  inline.textContent = '';
  if (!reason) return;
  inline.append(document.createTextNode(reason));
  const applied = describeModule(annotationEngine, param);
  if (applied) inline.append(el('span', 'applied', [` (now: ${applied})`]));
}

// reason set -> the agent explained this module. reason omitted/empty -> the
// user just moved this knob themselves, which retires the agent's explanation
// for it rather than leaving stale prose over a value the user has overridden.
function addReasoningLogEntry(parameter, reason) {
  const grounded = reason ? groundText(reason, annotationEngine) : '';
  if (grounded) annotationReasons.set(parameter, grounded);
  else annotationReasons.delete(parameter);
  renderAnnotation(parameter);
  if (!grounded) return;
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
