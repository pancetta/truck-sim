// On-screen steering wheel and pedals. Mouse and touch both arrive as pointer
// events; each widget captures its own pointer, so wheel and pedal work together.

const RELEASE_EVENTS = ['pointerup', 'pointercancel', 'lostpointercapture'];

export function createControls(root, tables, strings) {
  const { wheelLock, wheelCentreTime } = tables.controls;
  const input = { steer: 0, gas: 0, brake: 0 };

  const wheel = touchTarget('wheel');
  wheel.setAttribute('aria-label', strings.wheel);
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
  // Pointers on the wheel queue up; the first one steers, and when it lifts the next takes over.
  let angle = 0; // degrees
  const wheelPointers = [];
  let lastPointerAngle = null; // null: the next move only sets a fresh starting angle

  wheel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    wheel.setPointerCapture(e.pointerId);
    wheelPointers.push(e.pointerId);
    if (wheelPointers.length === 1) lastPointerAngle = null;
  });
  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== wheelPointers[0]) return;
    const { angle: a, nearHub } = polar(wheel, e);
    // Near the hub the direction is meaningless, so the wheel neither follows it nor
    // measures the next move from it.
    if (nearHub) {
      lastPointerAngle = null;
      return;
    }
    if (lastPointerAngle !== null) {
      const delta = ((a - lastPointerAngle + 540) % 360) - 180; // shortest way round
      angle = Math.max(-wheelLock, Math.min(wheelLock, angle + delta));
    }
    lastPointerAngle = a;
  });
  for (const type of RELEASE_EVENTS) {
    wheel.addEventListener(type, (e) => {
      const i = wheelPointers.indexOf(e.pointerId);
      if (i === -1) return;
      wheelPointers.splice(i, 1);
      if (i === 0) lastPointerAngle = null;
    });
  }

  holdPedal(gas, (down) => (input.gas = down ? 1 : 0));
  holdPedal(brake, (down) => (input.brake = down ? 1 : 0));

  function update(dt) {
    if (wheelPointers.length === 0) {
      const back = (wheelLock / wheelCentreTime) * dt;
      angle = Math.sign(angle) * Math.max(0, Math.abs(angle) - back);
    }
    wheel.style.transform = `rotate(${angle}deg)`;
    input.steer = angle / wheelLock;
    return input;
  }

  return { update };
}

function touchTarget(className) {
  const node = document.createElement('div');
  node.className = className;
  node.setAttribute('role', 'button');
  return node;
}

// Pointer position relative to the element's centre: angle in degrees, and
// whether it is within the inner quarter of the radius.
function polar(node, e) {
  const r = node.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  return { angle: (Math.atan2(dy, dx) * 180) / Math.PI, nearHub: Math.hypot(dx, dy) < r.width / 8 };
}

// A pedal stays down while any pointer holds it.
function holdPedal(node, set) {
  const holding = new Set();
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    node.setPointerCapture(e.pointerId);
    holding.add(e.pointerId);
    node.classList.add('down');
    set(true);
  });
  for (const type of RELEASE_EVENTS) {
    node.addEventListener(type, (e) => {
      holding.delete(e.pointerId);
      if (holding.size > 0) return;
      node.classList.remove('down');
      set(false);
    });
  }
}
