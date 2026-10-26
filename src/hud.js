// Dashboard overlay: speed (red above the limit), gear, RPM, rank and total distance. Reads Sim state; never writes to it.
export function createHud(root, tables, strings) {
  const { idleRpm, upshiftRpm, torqueCurve } = tables.vehicle;
  const maxRpm = torqueCurve.at(-1)[0];
  root.className = 'dash';
  root.innerHTML = `
    <div class="dash-speed"><b></b><small>${strings.kmh}</small></div>
    <div class="dash-gear" aria-label="${strings.gear}"></div>
    <div class="dash-rpm" aria-label="${strings.rpm}"><i></i><small></small></div>
    <div class="dash-rank" aria-label="${strings.rank}"><span></span><small aria-label="${strings.distance}"></small><div><i></i></div></div>`;
  const speed = root.querySelector('.dash-speed b');
  const gear = root.querySelector('.dash-gear');
  const bar = root.querySelector('.dash-rpm i');
  const rpm = root.querySelector('.dash-rpm small');
  const rankTitle = root.querySelector('.dash-rank span');
  const rankBar = root.querySelector('.dash-rank i');
  const distance = root.querySelector('.dash-rank small');

  // Writes to the DOM only when a shown value changes, not every frame.
  const set = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  let shownBar;
  let shownRank;
  let shownKm;

  function update({ truck, rank, profile }) {
    const kmh = Math.round(Math.abs(truck.speed) * 3.6);
    set(speed, String(kmh));
    speed.classList.toggle('over', kmh > tables.speedLimit);
    set(gear, String(truck.gear));
    const fill = ((truck.rpm - idleRpm) / (maxRpm - idleRpm)).toFixed(2);
    if (fill !== shownBar) bar.style.transform = `scaleX(${(shownBar = fill)})`;
    bar.classList.toggle('high', truck.rpm > upshiftRpm);
    set(rpm, `${Math.round(truck.rpm / 50) * 50} ${strings.rpm}`);
    set(rankTitle, rank.title);
    const km = Math.floor(profile.distance / 1000); // formatted only on a change: toLocaleString is slow
    if (km !== shownKm) distance.textContent = `${(shownKm = km).toLocaleString('de-DE')} ${strings.km}`;
    if (rank.progress !== shownRank) rankBar.style.transform = `scaleX(${(shownRank = rank.progress)})`;
  }

  return { update };
}
