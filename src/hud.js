// Dashboard overlay: speed, gear and RPM. Reads Sim state; never writes to it.
export function createHud(root, tables, strings) {
  const { idleRpm, maxRpm, upshiftRpm } = tables.vehicle;
  root.className = 'dash';
  root.innerHTML = `
    <div class="dash-speed"><b></b><small>${strings.kmh}</small></div>
    <div class="dash-gear" aria-label="${strings.gear}"></div>
    <div class="dash-rpm" aria-label="${strings.rpm}"><i></i><small></small></div>`;
  const speed = root.querySelector('.dash-speed b');
  const gear = root.querySelector('.dash-gear');
  const bar = root.querySelector('.dash-rpm i');
  const rpm = root.querySelector('.dash-rpm small');

  function update({ truck }) {
    speed.textContent = Math.round(Math.abs(truck.speed) * 3.6);
    gear.textContent = truck.gear;
    bar.style.transform = `scaleX(${(truck.rpm - idleRpm) / (maxRpm - idleRpm)})`;
    bar.classList.toggle('high', truck.rpm > upshiftRpm);
    rpm.textContent = `${Math.round(truck.rpm / 50) * 50} ${strings.rpm}`;
  }

  return { update };
}
