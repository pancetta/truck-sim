// Dashboard overlay, the truck's own: speed (red above the limit), the speed limit, gear, RPM, the fuel gauge, total
// distance and the game clock, and above it the name of the street the truck is on, the next junction's rule while one
// is near and a zebra crossing sign while one is, a police sign while a police car sees the truck, the low-fuel warning
// and the tired or exhausted warning.
// A status strip at the top shows the player's and driver's: rank, Stars and progress to the next tier, the driver's
// energy and the time played. Reads Sim state; never writes to it.
// The rules' icons, our own drawings: a traffic light, the right before left warning sign, the priority road's diamond,
// the give-way triangle and the stop octagon; and the zebra crossing's, a pedestrian on stripes in a blue square.
const ZEBRA_ICON =
  '<rect x="1" y="1" width="22" height="22" rx="2" fill="#1d63c4" stroke="#fff" stroke-width="1"/><path d="M12 3.5 21 19H3z" fill="#fff"/>' +
  '<path d="M6 17.5h2.4M10.8 17.5h2.4M15.6 17.5h2.4" stroke="#2b2d33" stroke-width="1.2"/><circle cx="12.6" cy="9" r="1.1" fill="#2b2d33"/>' +
  '<path d="M12.4 10.5 11.6 13.4 10 15.6M11.6 13.4 13.4 15.6M10.6 11.8 13.8 12.2" stroke="#2b2d33" stroke-width="1" fill="none" stroke-linecap="round"/>';
const RULE_ICONS = {
  priority: '<path d="M12 1 23 12 12 23 1 12z" fill="#fff" stroke="#2b2d33" stroke-width="1"/><path d="M12 5.5 18.5 12 12 18.5 5.5 12z" fill="#e8c547"/>',
  giveWay: '<path d="M1.5 3h21L12 22z" fill="#fff" stroke="#d1495b" stroke-width="2.5" stroke-linejoin="round"/>',
  stop: '<path d="M7.4 1h9.2L23 7.4v9.2L16.6 23H7.4L1 16.6V7.4z" fill="#d1495b" stroke="#fff" stroke-width="1.2"/><text x="12" y="14.6" font-size="7" font-weight="700" font-family="sans-serif" text-anchor="middle" fill="#fff">STOP</text>',
  light: '<rect x="7" y="1" width="10" height="22" rx="3" fill="#2b2d33"/><circle cx="12" cy="6" r="2.4" fill="#ff4a3d"/><circle cx="12" cy="12" r="2.4" fill="#e8c547"/><circle cx="12" cy="18" r="2.4" fill="#6cc551"/>',
  rightBeforeLeft: '<path d="M12 2 23 21H1z" fill="#fff" stroke="#d1495b" stroke-width="2.5" stroke-linejoin="round"/><path d="M11 8h2v10h-2zM8 12.5h8v1.5H8z" fill="#2b2d33"/>',
};

// The texts the HUD and the cab's cluster share: total distance (m), game clock (minutes since midnight) and time
// played (s).
export const kmText = (m, strings) => `${Math.floor(m / 1000).toLocaleString('de-DE')} ${strings.km}`;
const twoDigits = (n) => String(n).padStart(2, '0');
export const clockText = (minutes) => `${twoDigits(Math.floor(minutes / 60))}:${twoDigits(Math.floor(minutes % 60))}`;
export const playedText = (s, strings) => `${strings.timePlayed} ${Math.floor(s / 3600)}:${twoDigits(Math.floor((s % 3600) / 60))} h`;
// The Stars (state.rank) and the next tier's, if any.
export const starsText = ({ stars, next }) => `★ ${stars}${next === null ? '' : `/${next}`}`;

export function createHud(root, tables, strings) {
  root.className = 'dash';
  root.innerHTML = `
    <div class="dash-speed"><b></b><small>${strings.kmh}</small></div>
    <div class="dash-limit" aria-label="${strings.speedLimit}"></div>
    <div class="dash-gear" aria-label="${strings.gear}"></div>
    <div class="dash-rpm" aria-label="${strings.rpm}"><i></i><small></small></div>
    <div class="dash-fuel" aria-label="${strings.fuel}"><small>${strings.fuel}</small><div><i></i></div></div>
    <div class="dash-trip"><small aria-label="${strings.distance}"></small><small aria-label="${strings.clock}"></small></div>
    <div class="dash-signs">
      <div class="dash-street" aria-label="${strings.street}" hidden></div>
      <div class="dash-rules">
        <div class="dash-rule" role="status" hidden><svg viewBox="0 0 24 24" aria-hidden="true"></svg><span></span></div>
        <div class="dash-rule dash-zebra" role="status" hidden><svg viewBox="0 0 24 24" aria-hidden="true">${ZEBRA_ICON}</svg>${strings.zebraAhead}</div>
      </div>
      <div class="dash-police" role="status" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3.5"/></svg>${strings.policeSees}</div>
      <div class="dash-fuel-low" role="status" hidden>${strings.fuelLow}</div>
      <div class="dash-tired" role="status" hidden></div>
    </div>`;
  const speed = root.querySelector('.dash-speed b');
  const gear = root.querySelector('.dash-gear');
  const bar = root.querySelector('.dash-rpm i');
  const rpm = root.querySelector('.dash-rpm small');
  const [distance, clock] = root.querySelectorAll('.dash-trip small');
  const status = document.createElement('div');
  status.className = 'status';
  status.innerHTML = `
    <div class="status-rank" aria-label="${strings.rank}"><span></span><b></b><div><i></i></div></div>
    <div class="status-energy" aria-label="${strings.energy}"><small>${strings.energy}</small><div><i></i></div></div>
    <small></small>`;
  root.after(status);
  const rankTitle = status.querySelector('.status-rank span');
  const rankStars = status.querySelector('.status-rank b');
  const rankBar = status.querySelector('.status-rank i');
  const energyBar = status.querySelector('.status-energy i');
  const played = status.querySelector(':scope > small');
  const police = root.querySelector('.dash-police');
  const limit = root.querySelector('.dash-limit');
  const rule = root.querySelector('.dash-rule');
  const zebra = root.querySelector('.dash-zebra');
  const street = root.querySelector('.dash-street');
  const fuelBar = root.querySelector('.dash-fuel i');
  const fuelLow = root.querySelector('.dash-fuel-low');
  const tired = root.querySelector('.dash-tired');

  // Writes to the DOM only when a shown value changes, not every frame.
  const set = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  let shownBar;
  let shownRank; // state.rank, replaced only when the Stars change
  let shownKm;
  let shownMinute;
  let shownPlayed;
  let shownRule = null;
  let shownFuel;
  let shownEnergy;
  let shownTired = 0; // 0 rested, 1 tired, 2 exhausted

  // In the cab view the 3D instruments show speed, gear, RPM, fuel, distance and clock, so the overlay hides but for the
  // limit and the signs (style.css).
  function update({ truck, rank, profile, tank, policeSees, junctionRule, zebraAhead, speedLimit, street: name, tired: isTired, exhausted }, inCab) {
    root.classList.toggle('cab', inCab);
    const kmh = Math.round(Math.abs(truck.speed) * 3.6);
    set(speed, String(kmh));
    speed.classList.toggle('over', kmh > speedLimit);
    set(limit, String(speedLimit));
    set(gear, String(truck.gear));
    const { idleRpm, upshiftRpm, torqueCurve } = tables.fleet[profile.vehicle];
    const maxRpm = torqueCurve.at(-1)[0];
    const fill = ((truck.rpm - idleRpm) / (maxRpm - idleRpm)).toFixed(2);
    if (fill !== shownBar) bar.style.transform = `scaleX(${(shownBar = fill)})`;
    bar.classList.toggle('high', truck.rpm > upshiftRpm);
    set(rpm, `${Math.round(truck.rpm / 50) * 50} ${strings.rpm}`);
    // Each formatted only on a change: toLocaleString is slow, and the others would make a string every frame.
    const km = Math.floor(profile.distance / 1000);
    if (km !== shownKm) distance.textContent = kmText((shownKm = km) * 1000, strings);
    const minute = Math.floor(profile.timeOfDay);
    if (minute !== shownMinute) clock.textContent = clockText((shownMinute = minute));
    const playedMinute = Math.floor(profile.timePlayed / 60);
    if (playedMinute !== shownPlayed) played.textContent = playedText((shownPlayed = playedMinute) * 60, strings);
    if (rank !== shownRank) {
      shownRank = rank;
      set(rankTitle, rank.title);
      set(rankStars, starsText(rank));
      rankBar.style.transform = `scaleX(${rank.progress})`;
    }
    if (police.hidden === policeSees) police.hidden = !policeSees;
    if (zebra.hidden === zebraAhead) zebra.hidden = !zebraAhead;
    const fuel = (profile.fuel / tank).toFixed(2);
    if (fuel !== shownFuel) {
      fuelBar.style.transform = `scaleX(${(shownFuel = fuel)})`;
      const low = profile.fuel < tables.fuel.low * tank;
      fuelBar.classList.toggle('low', low);
      fuelLow.hidden = !low;
    }
    const energy = profile.energy.toFixed(2);
    if (energy !== shownEnergy) energyBar.style.transform = `scaleX(${(shownEnergy = energy)})`;
    const level = exhausted ? 2 : isTired ? 1 : 0;
    if (level !== shownTired) {
      shownTired = level;
      energyBar.classList.toggle('tired', level === 1);
      energyBar.classList.toggle('low', level === 2);
      tired.hidden = level === 0;
      tired.classList.toggle('exhausted', level === 2);
      tired.textContent = level === 2 ? strings.exhausted : strings.tired;
    }
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
