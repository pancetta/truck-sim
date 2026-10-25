// Dashboard overlay: speed, gear, RPM and rank. Reads Sim state; never writes to it.
export function createHud(root, tables, strings) {
  const { idleRpm, upshiftRpm, torqueCurve } = tables.vehicle;
  const maxRpm = torqueCurve.at(-1)[0];
  root.className = 'dash';
  root.innerHTML = `
    <div class="dash-speed"><b></b><small>${strings.kmh}</small></div>
    <div class="dash-gear" aria-label="${strings.gear}"></div>
    <div class="dash-rpm" aria-label="${strings.rpm}"><i></i><small></small></div>
    <div class="dash-rank" aria-label="${strings.rank}"><span></span><div><i></i></div></div>`;
  const speed = root.querySelector('.dash-speed b');
  const gear = root.querySelector('.dash-gear');
  const bar = root.querySelector('.dash-rpm i');
  const rpm = root.querySelector('.dash-rpm small');
  const rankTitle = root.querySelector('.dash-rank span');
  const rankBar = root.querySelector('.dash-rank i');

  // Writes to the DOM only when a shown value changes, not every frame.
  const set = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  let shownBar;
  let shownRank;

  function update({ truck, rank }) {
    set(speed, String(Math.round(Math.abs(truck.speed) * 3.6)));
    set(gear, String(truck.gear));
    const fill = ((truck.rpm - idleRpm) / (maxRpm - idleRpm)).toFixed(2);
    if (fill !== shownBar) bar.style.transform = `scaleX(${(shownBar = fill)})`;
    bar.classList.toggle('high', truck.rpm > upshiftRpm);
    set(rpm, `${Math.round(truck.rpm / 50) * 50} ${strings.rpm}`);
    set(rankTitle, rank.title);
    if (rank.progress !== shownRank) rankBar.style.transform = `scaleX(${(shownRank = rank.progress)})`;
  }

  return { update };
}
