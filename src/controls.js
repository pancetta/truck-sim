// On-screen steering wheel and pedals. Mouse and touch both arrive as pointer
// events; each widget captures its own pointer, so wheel and pedal work together.

export function createControls(root, tables, strings) {
  const { wheelLock, wheelCentreTime } = tables.controls;
  const input = { steer: 0, gas: 0, brake: 0 };

  const wheel = el('div', 'wheel', strings.wheel);
  const gas = el('div', 'pedal gas', strings.gas);
  const brake = el('div', 'pedal brake', strings.brake);
  gas.textContent = strings.gas;
  brake.textContent = strings.brake;
  const pedals = document.createElement('div');
  pedals.className = 'pedals';
  pedals.append(brake, gas);
  root.append(wheel, pedals);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // Wheel: rotate by dragging around its centre; clockwise steers right.
  let angle = 0; // degrees
  let dragPointer = null;
  let lastPointerAngle = 0;

  function pointerAngle(e) {
    const r = wheel.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  }

  wheel.addEventListener('pointerdown', (e) => {
    wheel.setPointerCapture(e.pointerId);
    dragPointer = e.pointerId;
    lastPointerAngle = pointerAngle(e);
  });
  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragPointer) return;
    const a = pointerAngle(e);
    const delta = ((a - lastPointerAngle + 540) % 360) - 180; // shortest way round
    lastPointerAngle = a;
    angle = Math.max(-wheelLock, Math.min(wheelLock, angle + delta));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    wheel.addEventListener(type, (e) => {
      if (e.pointerId === dragPointer) dragPointer = null;
    });
  }

  holdPedal(gas, (down) => (input.gas = down ? 1 : 0));
  holdPedal(brake, (down) => (input.brake = down ? 1 : 0));

  function update(dt) {
    if (dragPointer === null) {
      const back = (wheelLock / wheelCentreTime) * dt;
      angle = Math.sign(angle) * Math.max(0, Math.abs(angle) - back);
    }
    wheel.style.transform = `rotate(${angle}deg)`;
    input.steer = angle / wheelLock;
    return input;
  }

  return { update };
}

function el(tag, className, label) {
  const node = document.createElement(tag);
  node.className = className;
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', label);
  return node;
}

function holdPedal(node, set) {
  node.addEventListener('pointerdown', (e) => {
    node.setPointerCapture(e.pointerId);
    node.classList.add('down');
    set(true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    node.addEventListener(type, () => {
      node.classList.remove('down');
      set(false);
    });
  }
}
