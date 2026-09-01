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

  const track = document.createElementNS(svgNS, 'path');
  track.setAttribute('class', 'knob-track');
  track.setAttribute('d', describeArc(cx, cy, r, KNOB_MIN_ANGLE, KNOB_MAX_ANGLE));

  const fill = document.createElementNS(svgNS, 'path');
  fill.setAttribute('class', 'knob-fill');

  const pointer = document.createElementNS(svgNS, 'line');
  pointer.setAttribute('class', 'knob-pointer');
  pointer.setAttribute('x1', cx);
  pointer.setAttribute('y1', cy);

  svg.append(track, fill, pointer);

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
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
  };

  svg.addEventListener('mousedown', (e) => {
    dragStartY = e.clientY;
    dragStartPos = pos;
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
