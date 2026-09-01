// Reusable rotary knob widget — draggable SVG dial, replaces <input type="range">
// for a real-instrument feel. Value math is delegated to the caller via
// toReal/toPos so a knob can either be linear (most params) or log-mapped
// (filter cutoff) while sharing the exact same drag/draw code.

const KNOB_MIN_ANGLE = -135;
const KNOB_MAX_ANGLE = 135;

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// One shared <defs> block, injected once, so every knob's cap can reference
// the same gradient by id instead of duplicating an SVG def per knob. The
// off-center highlight (cx/cy at 35%/30%) is what makes it read as a curved
// physical cap catching light, rather than a flat painted circle.
let knobDefsReady = false;
function ensureKnobDefs() {
  if (knobDefsReady) return;
  knobDefsReady = true;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const defs = document.createElementNS(svgNS, 'defs');
  const grad = document.createElementNS(svgNS, 'radialGradient');
  grad.setAttribute('id', 'knobCapGradient');
  grad.setAttribute('cx', '35%');
  grad.setAttribute('cy', '30%');
  grad.setAttribute('r', '75%');
  [
    ['0%', '#6a6a74'],
    ['35%', '#3d3d44'],
    ['80%', '#222226'],
    ['100%', '#151517'],
  ].forEach(([offset, color]) => {
    const stop = document.createElementNS(svgNS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    grad.append(stop);
  });
  defs.append(grad);
  svg.append(defs);
  document.body.append(svg);
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {number} opts.posMin / posMax - the drag range, in whatever unit toReal expects
 * @param {number} opts.initialPos
 * @param {number} [opts.step]
 * @param {(pos:number)=>number} [opts.toReal] - maps drag position -> real engine value
 * @param {(real:number)=>number} [opts.toPos] - inverse of toReal, used by setReal()
 * @param {(real:number)=>string} opts.format - real value -> display string
 * @param {(real:number)=>void} opts.onChange
 */
function createKnob(opts) {
  ensureKnobDefs();
  const {
    label, posMin, posMax, initialPos, step = 0,
    toReal = (p) => p, toPos = (r) => r, format = (v) => String(v), onChange,
  } = opts;

  let pos = initialPos;
  const size = 56;
  const cx = size / 2, cy = size / 2, r = 20;

  const wrap = document.createElement('div');
  wrap.className = 'knob';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'knob-dial');

  const ticks = [KNOB_MIN_ANGLE, 0, KNOB_MAX_ANGLE].map((angle) => {
    const inner = polarToCartesian(cx, cy, r + 4, angle);
    const outer = polarToCartesian(cx, cy, r + 7, angle);
    const tick = document.createElementNS(svgNS, 'line');
    tick.setAttribute('class', 'knob-tick');
    tick.setAttribute('x1', inner.x); tick.setAttribute('y1', inner.y);
    tick.setAttribute('x2', outer.x); tick.setAttribute('y2', outer.y);
    return tick;
  });

  const track = document.createElementNS(svgNS, 'path');
  track.setAttribute('class', 'knob-track');
  track.setAttribute('d', describeArc(cx, cy, r, KNOB_MIN_ANGLE, KNOB_MAX_ANGLE));

  const fill = document.createElementNS(svgNS, 'path');
  fill.setAttribute('class', 'knob-fill');

  // The physical cap — a gradient disc the pointer is drawn on top of, so
  // the knob reads as a rounded object with a turned indicator, not a flat
  // ring with a line through the middle.
  const cap = document.createElementNS(svgNS, 'circle');
  cap.setAttribute('class', 'knob-cap');
  cap.setAttribute('cx', cx);
  cap.setAttribute('cy', cy);
  cap.setAttribute('r', r - 5);
  cap.setAttribute('fill', 'url(#knobCapGradient)');

  const pointer = document.createElementNS(svgNS, 'line');
  pointer.setAttribute('class', 'knob-pointer');
  pointer.setAttribute('x1', cx);
  pointer.setAttribute('y1', cy);

  svg.append(...ticks, track, fill, cap, pointer);

  const labelEl = document.createElement('div');
  labelEl.className = 'knob-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  valueEl.className = 'knob-value';

  wrap.append(svg, labelEl, valueEl);

  function render() {
    const norm = clamp((pos - posMin) / (posMax - posMin), 0, 1);
    const angle = KNOB_MIN_ANGLE + norm * (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE);
    fill.setAttribute('d', describeArc(cx, cy, r, KNOB_MIN_ANGLE, angle));
    const tip = polarToCartesian(cx, cy, r - 3, angle);
    pointer.setAttribute('x2', tip.x);
    pointer.setAttribute('y2', tip.y);
    valueEl.textContent = format(toReal(pos));
  }

  function setPos(next, { silent = false } = {}) {
    pos = clamp(step ? Math.round(next / step) * step : next, posMin, posMax);
    render();
    if (!silent) onChange?.(toReal(pos));
  }

  let dragStartY = null;
  let dragStartPos = null;
  const DRAG_PX_FOR_FULL_RANGE = 180;

  const onPointerMove = (e) => {
    if (dragStartY == null) return;
    const deltaY = dragStartY - e.clientY;
    const deltaPos = (deltaY / DRAG_PX_FOR_FULL_RANGE) * (posMax - posMin);
    setPos(dragStartPos + deltaPos);
  };
  const onPointerUp = () => {
    dragStartY = null;
    svg.classList.remove('dragging');
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
  };

  svg.addEventListener('mousedown', (e) => {
    dragStartY = e.clientY;
    dragStartPos = pos;
    svg.classList.add('dragging');
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
    e.preventDefault();
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const deltaPos = (-e.deltaY / 500) * (posMax - posMin);
    setPos(pos + deltaPos);
  }, { passive: false });

  render();

  return {
    el: wrap,
    setReal(real) { setPos(toPos(real), { silent: true }); },
    getReal() { return toReal(pos); },
  };
}
