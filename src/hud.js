// Dashboard overlay: speed (red above the limit), the speed limit, gear, RPM, rank and total distance, and above it
// the name of the street the truck is on, the next junction's rule while one is near and a police sign while a police
// car sees the truck. Reads Sim state; never writes to it.
// The rules' icons, our own drawings: a traffic light, and the right before left warning sign.
const RULE_ICONS = {
  light: '<rect x="7" y="1" width="10" height="22" rx="3" fill="#2b2d33"/><circle cx="12" cy="6" r="2.4" fill="#ff4a3d"/><circle cx="12" cy="12" r="2.4" fill="#e8c547"/><circle cx="12" cy="18" r="2.4" fill="#6cc551"/>',
  rightBeforeLeft: '<path d="M12 2 23 21H1z" fill="#fff" stroke="#d1495b" stroke-width="2.5" stroke-linejoin="round"/><path d="M11 8h2v10h-2zM8 12.5h8v1.5H8z" fill="#2b2d33"/>',
};

export function createHud(root, tables, strings) {
  const { idleRpm, upshiftRpm, torqueCurve } = tables.vehicle;
  const maxRpm = torqueCurve.at(-1)[0];
  root.className = 'dash';
  root.innerHTML = `
    <div class="dash-speed"><b></b><small>${strings.kmh}</small></div>
    <div class="dash-limit" aria-label="${strings.speedLimit}"></div>
    <div class="dash-gear" aria-label="${strings.gear}"></div>
    <div class="dash-rpm" aria-label="${strings.rpm}"><i></i><small></small></div>
    <div class="dash-rank" aria-label="${strings.rank}"><span></span><small aria-label="${strings.distance}"></small><div><i></i></div></div>
    <div class="dash-signs">
      <div class="dash-street" aria-label="${strings.street}" hidden></div>
      <div class="dash-rule" role="status" hidden><svg viewBox="0 0 24 24" aria-hidden="true"></svg><span></span></div>
      <div class="dash-police" role="status" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3.5"/></svg>${strings.policeSees}</div>
    </div>`;
  const speed = root.querySelector('.dash-speed b');
  const gear = root.querySelector('.dash-gear');
  const bar = root.querySelector('.dash-rpm i');
  const rpm = root.querySelector('.dash-rpm small');
  const rankTitle = root.querySelector('.dash-rank span');
  const rankBar = root.querySelector('.dash-rank i');
  const distance = root.querySelector('.dash-rank small');
  const police = root.querySelector('.dash-police');
  const limit = root.querySelector('.dash-limit');
  const rule = root.querySelector('.dash-rule');
  const street = root.querySelector('.dash-street');

  // Writes to the DOM only when a shown value changes, not every frame.
  const set = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  let shownBar;
  let shownRank;
  let shownKm;
  let shownRule = null;

  // In the cab view the 3D instruments show speed, gear and RPM, so the overlay hides (style.css).
  function update({ truck, rank, profile, policeSees, junctionRule, speedLimit, street: name }, inCab) {
    root.classList.toggle('cab', inCab);
    const kmh = Math.round(Math.abs(truck.speed) * 3.6);
    set(speed, String(kmh));
    speed.classList.toggle('over', kmh > speedLimit);
    set(limit, String(speedLimit));
    set(gear, String(truck.gear));
    const fill = ((truck.rpm - idleRpm) / (maxRpm - idleRpm)).toFixed(2);
    if (fill !== shownBar) bar.style.transform = `scaleX(${(shownBar = fill)})`;
    bar.classList.toggle('high', truck.rpm > upshiftRpm);
    set(rpm, `${Math.round(truck.rpm / 50) * 50} ${strings.rpm}`);
    set(rankTitle, rank.title);
    const km = Math.floor(profile.distance / 1000); // formatted only on a change: toLocaleString is slow
    if (km !== shownKm) distance.textContent = `${(shownKm = km).toLocaleString('de-DE')} ${strings.km}`;
    if (rank.progress !== shownRank) rankBar.style.transform = `scaleX(${(shownRank = rank.progress)})`;
    if (police.hidden === policeSees) police.hidden = !policeSees;
    if (street.hidden !== !name) street.hidden = !name;
    set(street, name);
    if (junctionRule !== shownRule) {
      shownRule = junctionRule;
      rule.hidden = !junctionRule;
      if (junctionRule) {
        rule.firstChild.innerHTML = RULE_ICONS[junctionRule];
        rule.lastChild.textContent = strings.rules[junctionRule];
      }
    }
  }

  return { update };
}
