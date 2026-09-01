// DOM wiring: keyboard, sliders/buttons, envelope viz, reasoning log, status pill.
// Pure UI logic — talks to a SynthEngine instance passed in, never creates one.

const WHITE_KEYS = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const BLACK_KEYS = [
  { note: 'C#4', afterWhiteIndex: 0 },
  { note: 'D#4', afterWhiteIndex: 1 },
  { note: 'F#4', afterWhiteIndex: 3 },
  { note: 'G#4', afterWhiteIndex: 4 },
  { note: 'A#4', afterWhiteIndex: 5 },
];

const KEY_TO_NOTE = {
  a: 'C4', w: 'C#4', s: 'D4', e: 'D#4', d: 'E4', f: 'F4',
  t: 'F#4', g: 'G4', y: 'G#4', h: 'A4', u: 'A#4', j: 'B4', k: 'C5',
};

const WHITE_KEY_WIDTH = 60;
const BLACK_KEY_WIDTH = 38;

function initKeyboard(engine) {
  const container = document.getElementById('keyboard');
  const keyEls = {};

  WHITE_KEYS.forEach((note) => {
    const el = document.createElement('div');
    el.className = 'key white';
    el.dataset.note = note;
    el.textContent = note;
    container.appendChild(el);
    keyEls[note] = el;
  });

  BLACK_KEYS.forEach(({ note, afterWhiteIndex }) => {
    const el = document.createElement('div');
    el.className = 'key black';
    el.dataset.note = note;
    el.style.position = 'absolute';
    el.style.left = `${(afterWhiteIndex + 1) * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2}px`;
    container.appendChild(el);
    keyEls[note] = el;
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

  const heldKeys = new Set();
  document.addEventListener('keydown', (e) => {
    const note = KEY_TO_NOTE[e.key.toLowerCase()];
    if (!note || heldKeys.has(e.key)) return;
    heldKeys.add(e.key);
    press(note);
  });
  document.addEventListener('keyup', (e) => {
    const note = KEY_TO_NOTE[e.key.toLowerCase()];
    heldKeys.delete(e.key);
    if (note) release(note);
  });
}

function initWaveformButtons(engine, onChange) {
  const buttons = document.querySelectorAll('.wave-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const waveform = btn.dataset.waveform;
      engine.setWaveform(waveform);
      onChange?.(waveform);
    });
  });
}

function setActiveWaveformButton(waveform) {
  document.querySelectorAll('.wave-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.waveform === waveform);
  });
}

// Cutoff slider (0-100) maps logarithmically onto 20-20000 Hz.
function sliderToHz(v) {
  const minLog = Math.log(20);
  const maxLog = Math.log(20000);
  return Math.exp(minLog + ((maxLog - minLog) * v) / 100);
}
function hzToSlider(hz) {
  const minLog = Math.log(20);
  const maxLog = Math.log(20000);
  return ((Math.log(hz) - minLog) / (maxLog - minLog)) * 100;
}

function initFilterControls(engine, onChange) {
  const cutoff = document.getElementById('cutoff');
  const resonance = document.getElementById('resonance');
  const cutoffValue = document.getElementById('cutoff-value');
  const resonanceValue = document.getElementById('resonance-value');

  const renderCutoff = (hz) => (cutoffValue.textContent = `${Math.round(hz)} Hz`);
  const renderRes = (q) => (resonanceValue.textContent = q.toFixed(1));

  cutoff.addEventListener('input', () => {
    const hz = sliderToHz(Number(cutoff.value));
    engine.setFilter({ cutoff: hz });
    renderCutoff(hz);
    onChange?.({ cutoff: hz });
  });
  resonance.addEventListener('input', () => {
    const q = Number(resonance.value);
    engine.setFilter({ resonance: q });
    renderRes(q);
    onChange?.({ resonance: q });
  });

  renderCutoff(sliderToHz(Number(cutoff.value)));
  renderRes(Number(resonance.value));

  return {
    setCutoff(hz) {
      cutoff.value = hzToSlider(hz);
      renderCutoff(hz);
    },
    setResonance(q) {
      resonance.value = q;
      renderRes(q);
    },
  };
}

function drawEnvelopeViz(env) {
  const svg = document.getElementById('envelope-viz');
  const w = 200, h = 60, floor = h - 2;
  const totalTime = Math.max(env.attack + env.decay + env.release, 0.3) * 1.4;
  const releaseHold = 0.4; // fraction of width reserved to visualize sustain hold before release

  const x1 = (env.attack / totalTime) * w;
  const x2 = x1 + (env.decay / totalTime) * w;
  const sustainEnd = x2 + releaseHold * w;
  const x3 = Math.min(sustainEnd + (env.release / totalTime) * w, w);
  const sustainY = floor - env.sustain * (floor - 2);

  const points = [
    [0, floor],
    [x1, 2],
    [x2, sustainY],
    [Math.min(sustainEnd, w - 1), sustainY],
    [x3, floor],
  ].map((p) => p.join(',')).join(' ');

  svg.querySelector('polyline').setAttribute('points', points);
}

function initEnvelopeControls(engine, onChange) {
  const ids = ['attack', 'decay', 'sustain', 'release'];
  const state = { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.3 };
  const sliders = {};

  ids.forEach((id) => {
    const slider = document.getElementById(id);
    const valueEl = document.getElementById(`${id}-value`);
    sliders[id] = slider;
    const render = () => {
      valueEl.textContent = id === 'sustain'
        ? Number(slider.value).toFixed(2)
        : `${Number(slider.value).toFixed(2)}s`;
    };
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      state[id] = v;
      engine.setEnvelope({ [id]: v });
      render();
      drawEnvelopeViz(state);
      onChange?.({ [id]: v });
    });
    render();
  });

  drawEnvelopeViz(state);

  return {
    set(partial) {
      Object.entries(partial).forEach(([k, v]) => {
        if (sliders[k] == null) return;
        sliders[k].value = v;
        state[k] = v;
        document.getElementById(`${k}-value`).textContent =
          k === 'sustain' ? v.toFixed(2) : `${v.toFixed(2)}s`;
      });
      drawEnvelopeViz(state);
    },
  };
}

function initEffectControls(engine, onChange) {
  const enabled = document.getElementById('effect-enabled');
  const mix = document.getElementById('effect-mix');
  const mixValue = document.getElementById('effect-mix-value');

  const render = () => (mixValue.textContent = Number(mix.value).toFixed(2));

  enabled.addEventListener('change', () => {
    engine.setEffect({ enabled: enabled.checked });
    onChange?.({ enabled: enabled.checked });
  });
  mix.addEventListener('input', () => {
    const v = Number(mix.value);
    engine.setEffect({ mix: v });
    render();
    onChange?.({ mix: v });
  });

  render();

  return {
    set({ enabled: en, mix: m }) {
      if (en != null) enabled.checked = en;
      if (m != null) { mix.value = m; render(); }
    },
  };
}

const MAX_LOG_ENTRIES = 4;

function addReasoningLogEntry(parameter, reason) {
  if (!reason) return;
  const list = document.getElementById('reasoning-log-list');
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<span class="param">${parameter}</span>${reason}<span class="time">${time}</span>`;
  list.prepend(li);
  while (list.children.length > MAX_LOG_ENTRIES) {
    list.removeChild(list.lastChild);
  }

  const inline = document.getElementById(`reason-${parameter}`);
  if (inline) inline.textContent = reason;
}

function setMcpStatus(ready) {
  const el = document.getElementById('mcp-status');
  el.classList.toggle('mcp-status--on', ready);
  el.classList.toggle('mcp-status--off', !ready);
  el.querySelector('.label').textContent = ready
    ? 'WebMCP: 5 tools ready'
    : 'WebMCP: unavailable in this browser';
}
