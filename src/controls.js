// On-screen steering wheel and pedals. Mouse and touch both arrive as pointer
// events; each widget captures its own pointer, so wheel and pedal work together.

export function createControls(root, tables, strings) {
  const { wheelLock, wheelCentreTime, hubRadius } = tables.controls;
  const input = { steer: 0, gas: 0, brake: 0 };

  const wheel = touchTarget('wheel');
  wheel.setAttribute('aria-label', strings.wheel);
  wheel.innerHTML = WHEEL_SVG;
  const gas = touchTarget('pedal gas');
  gas.textContent = strings.gas;
  const brake = touchTarget('pedal brake');
  brake.textContent = strings.brake;
  const pedals = document.createElement('div');
  pedals.className = 'pedals';
  pedals.append(brake, gas);
  root.append(wheel, pedals);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // Wheel: rotate by dragging around its centre; clockwise steers right.
  // Every pointer on the wheel keeps its last position (relative to the centre); the
  // first one in the map steers, and when it lifts the next takes over where it is.
  let angle = 0; // degrees
  const wheelPointers = trackPointers(wheel, (e) => fromCentre(wheel, e));

  wheel.addEventListener('pointermove', (e) => {
    const prev = wheelPointers.get(e.pointerId);
    if (!prev) return;
    const next = fromCentre(wheel, e);
    wheelPointers.set(e.pointerId, next);
    if (e.pointerId !== wheelPointers.keys().next().value) return;
    // A move that passes near the hub has no meaningful direction, so it doesn't turn the wheel.
    if (distanceToSegment(prev, next) < (wheel.offsetWidth / 2) * hubRadius) return;
    const delta = (Math.atan2(prev.x * next.y - prev.y * next.x, prev.x * next.x + prev.y * next.y) * 180) / Math.PI;
    angle = Math.max(-wheelLock, Math.min(wheelLock, angle + delta));
  });

  // A pedal is down while any pointer holds it.
  const gasPointers = trackPointers(gas);
  const brakePointers = trackPointers(brake);

  function update(dt) {
    input.gas = gasPointers.size > 0 ? 1 : 0;
    input.brake = brakePointers.size > 0 ? 1 : 0;
    gas.classList.toggle('down', input.gas > 0);
    brake.classList.toggle('down', input.brake > 0);

    if (wheelPointers.size === 0) {
      const back = (wheelLock / wheelCentreTime) * dt;
      angle = Math.sign(angle) * Math.max(0, Math.abs(angle) - back);
    }
    wheel.style.transform = `rotate(${angle}deg)`;
    input.steer = angle / wheelLock;
    return input;
  }

  return { update };
}

// Our own design: a padded rim with finger grips and a light top marker, three spokes and a round hub.
// Units are the wheel's CSS pixels (180 px, centre at 0,0); the rim spans radius 72–90 like the old ring.
const WHEEL_SVG = `<svg viewBox="-90 -90 180 180" aria-hidden="true">
  <defs>
    <linearGradient id="wheel-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a4d56" /><stop offset="1" stop-color="#1c1d22" />
    </linearGradient>
  </defs>
  <path d="M-72 -9 L-26 -12 L-26 12 L-72 9 Z M72 -9 L26 -12 L26 12 L72 9 Z M-12 24 L-17 72 L17 72 L12 24 Z"
    fill="#33353c" stroke="#5c606b" stroke-width="1.5" />
  <circle r="81" fill="none" stroke="url(#wheel-rim)" stroke-width="18" />
  <circle r="81" fill="none" stroke="#15161a" stroke-width="18" stroke-dasharray="1.5 6" opacity="0.5" />
  <circle r="89" fill="none" stroke="#8a8e98" stroke-width="1.5" />
  <circle r="73" fill="none" stroke="#0e0f12" stroke-width="1.5" />
  <rect x="-4" y="-90" width="8" height="18" rx="2" fill="#e8b23a" />
  <circle r="27" fill="#26272d" stroke="#5c606b" stroke-width="2" />
  <circle r="15" fill="#33353c" stroke="#1a1b20" stroke-width="3" />
</svg>`;

function touchTarget(className) {
  const node = document.createElement('div');
  node.className = className;
  node.setAttribute('role', 'button');
  return node;
}

// Pointer position relative to the element's centre (screen pixels, y down).
// The bounding box grows as the wheel rotates, but its centre stays put.
function fromCentre(node, e) {
  const r = node.getBoundingClientRect();
  return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
}

// Distance from the centre (origin) to the straight segment a→b.
function distanceToSegment(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

// The pointers holding a control, in the order they pressed it, each with a value
// from `onPress`. Primary button only; captured, so a finger sliding off still holds.
// Reuse this for any new on-screen control.
function trackPointers(node, onPress = () => true) {
  const held = new Map();
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    node.setPointerCapture(e.pointerId);
    held.set(e.pointerId, onPress(e));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    node.addEventListener(type, (e) => held.delete(e.pointerId));
  }
  return held;
}
