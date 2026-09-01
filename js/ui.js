// DOM wiring: signal-path diagram (oscillators/filter/envelope/effect/output),
// keyboard, presets, reasoning log/annotations, status pill. Pure UI logic —
// talks to a SynthEngine instance passed in, never creates one.

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

const WHITE_KEY_WIDTH = 34;
const BLACK_KEY_WIDTH = 22;

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

function cable() {
  const c = el('div', 'cable');
  c.append(el('span', 'cable-dot'));
  return c;
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

function buildOscillatorModule(index, engine, onLogged) {
  const module = el('section', 'module module--osc');
  module.append(el('h3', 'module-title', [`OSC ${index + 1}`]));

  const waveMini = buildWaveformMini(index, engine, () => onLogged(`oscillator-${index}`));
  module.append(waveMini);

  const levelKnob = createKnob({
    label: 'Level',
    posMin: 0, posMax: 1, step: 0.01,
    initialPos: engine.oscillators[index].level,
    format: (v) => v.toFixed(2),
    onChange: (v) => { engine.setOscillator(index, { level: v }); onLogged(`oscillator-${index}`); },
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

  return {
    module,
    setState({ waveform, level, semitone }) {
      if (waveform != null) waveMini._setActive(waveform);
      if (level != null) levelKnob.setReal(level);
      if (semitone != null) tuneKnob.setReal(semitone);
    },
  };
}

function drawFilterCurve(canvas, cutoff, resonance) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  const points = 64;
  for (let i = 0; i <= points; i++) {
    const freq = 20 * Math.pow(1000, i / points); // 20Hz..20kHz log sweep
    const ratio = freq / cutoff;
    // simple one-pole-ish lowpass magnitude approximation with resonance bump
    const resonanceBump = 1 + (resonance / 20) * Math.exp(-Math.pow(Math.log(ratio), 2) * 4);
    const mag = (1 / Math.sqrt(1 + Math.pow(ratio, 4))) * resonanceBump;
    const x = (i / points) * w;
    const y = h - Math.min(mag, 1.4) * (h * 0.72) - 2;
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
  module.append(el('h3', 'module-title', ['Filter']));

  const canvas = document.createElement('canvas');
  canvas.width = 120; canvas.height = 56;
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
  const w = 120, h = 48, floor = h - 2;
  const totalTime = Math.max(env.attack + env.decay + env.release, 0.3) * 1.4;
  const holdFrac = 0.35;
  const x1 = (env.attack / totalTime) * w;
  const x2 = x1 + (env.decay / totalTime) * w;
  const sustainEnd = x2 + holdFrac * w;
  const x3 = Math.min(sustainEnd + (env.release / totalTime) * w, w);
  const sustainY = floor - env.sustain * (floor - 2);
  const points = [
    [0, floor], [x1, 2], [x2, sustainY], [Math.min(sustainEnd, w - 1), sustainY], [x3, floor],
  ].map((p) => p.join(',')).join(' ');
  svg.querySelector('polyline').setAttribute('points', points);
}

function buildEnvelopeModule(engine, onLogged) {
  const module = el('section', 'module module--envelope');
  module.append(el('h3', 'module-title', ['Envelope']));

  const svg = svgEl('svg', { viewBox: '0 0 120 48', class: 'envelope-viz' });
  svg.append(svgEl('polyline', { points: '0,46 0,46' }));
  module.append(svg);

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
  module.append(el('div', 'knob-row', knobEls));
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
  module.append(el('h3', 'module-title', ['Delay']));

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

function buildOutputModule(engine) {
  const module = el('section', 'module module--output');
  module.append(el('h3', 'module-title', ['Output']));
  const canvas = document.createElement('canvas');
  canvas.width = 130; canvas.height = 64;
  canvas.className = 'scope';
  module.append(canvas);

  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  function draw() {
    requestAnimationFrame(draw);
    const samples = engine.getScopeSamples();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!samples) return;
    ctx.beginPath();
    const step = Math.floor(samples.length / canvas.width) || 1;
    for (let x = 0, i = 0; x < canvas.width; x++, i += step) {
      const y = canvas.height / 2 - samples[i] * (canvas.height / 2 - 2);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = style.getPropertyValue('--accent').trim() || '#7effc0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  draw();

  return { module };
}

function buildSignalPath(engine, onLogged) {
  const root = document.getElementById('signal-path');
  const oscUIs = [0, 1, 2].map((i) => buildOscillatorModule(i, engine, onLogged));
  const filterUI = buildFilterModule(engine, onLogged);
  const envelopeUI = buildEnvelopeModule(engine, onLogged);
  const effectUI = buildEffectModule(engine, onLogged);
  const outputUI = buildOutputModule(engine);

  oscUIs.forEach((o) => root.append(o.module));
  root.append(cable());
  root.append(filterUI.module);
  root.append(cable());
  root.append(envelopeUI.module);
  root.append(cable());
  root.append(effectUI.module);
  root.append(cable());
  root.append(outputUI.module);

  return { oscUIs, filterUI, envelopeUI, effectUI, outputUI };
}

// ---- keyboard ----
function initKeyboard(engine) {
  const container = document.getElementById('keyboard');
  const keyEls = {};

  WHITE_KEYS.forEach((note) => {
    const keyEl = el('div', 'key white', [note]);
    keyEl.dataset.note = note;
    container.appendChild(keyEl);
    keyEls[note] = keyEl;
  });
  BLACK_KEYS.forEach(({ note, afterWhiteIndex }) => {
    const keyEl = el('div', 'key black');
    keyEl.dataset.note = note;
    keyEl.style.position = 'absolute';
    keyEl.style.left = `${(afterWhiteIndex + 1) * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2}px`;
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
  const renderOctave = () => { octaveIndicator.textContent = `Octave ${currentOctave} (Z/X to shift)`; };
  renderOctave();

  const heldKeys = new Map(); // physical key -> note name, so keyup releases the right note even after a shift
  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'z') { currentOctave = Math.max(MIN_OCTAVE, currentOctave - 1); renderOctave(); return; }
    if (key === 'x') { currentOctave = Math.min(MAX_OCTAVE, currentOctave + 1); renderOctave(); return; }
    if (!(key in KEY_TO_SEMITONE) || heldKeys.has(key)) return;
    const note = qwertyNoteName(KEY_TO_SEMITONE[key], currentOctave);
    heldKeys.set(key, note);
    press(note);
  });
  document.addEventListener('keyup', (e) => {
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

function initPresets(engine, uiHandles) {
  const container = document.getElementById('presets');
  PRESETS.forEach((preset) => {
    const card = el('button', 'preset-card', [preset.name]);
    card.addEventListener('click', () => {
      engine.loadPreset(preset);
      applyPresetToUI(preset, uiHandles);
      addReasoningLogEntry('preset', `Loaded "${preset.name}" as a starting point — tweak any knob from here.`);
    });
    container.append(card);
  });

  document.getElementById('surprise-btn').addEventListener('click', () => {
    const preset = randomPreset();
    engine.loadPreset(preset);
    applyPresetToUI(preset, uiHandles);
    addReasoningLogEntry('preset', 'Randomized every parameter — see what stuck and refine from here.');
  });
}

// ---- reasoning log + inline annotations ----
const MAX_LOG_ENTRIES = 4;
const PARAM_LABELS = {
  'oscillator-0': 'osc 1', 'oscillator-1': 'osc 2', 'oscillator-2': 'osc 3',
  filter: 'filter', envelope: 'envelope', effect: 'delay', preset: 'preset',
};

function addReasoningLogEntry(parameter, reason) {
  if (!reason) return;
  const list = document.getElementById('reasoning-log-list');
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const label = PARAM_LABELS[parameter] || parameter;
  li.innerHTML = `<span class="param">${label}</span>${reason}<span class="time">${time}</span>`;
  list.prepend(li);
  while (list.children.length > MAX_LOG_ENTRIES) list.removeChild(list.lastChild);

  const inline = document.getElementById(`reason-${parameter}`);
  if (inline) {
    inline.textContent = reason;
    inline.classList.remove('annotation--flash');
    void inline.offsetWidth;
    inline.classList.add('annotation--flash');
  }
}

function setMcpStatus(ready) {
  const statusEl = document.getElementById('mcp-status');
  statusEl.classList.toggle('mcp-status--on', ready);
  statusEl.classList.toggle('mcp-status--off', !ready);
  statusEl.querySelector('.label').textContent = ready
    ? 'WebMCP: 6 tools ready'
    : 'WebMCP: unavailable in this browser';
}
