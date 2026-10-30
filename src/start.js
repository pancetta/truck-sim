// Start screen (#112): after loading and from the in-game Menü button, over the paused game's orbiting view (main.js
// pauses the Sim while it's `open` and orbits the camera). The main page: Weiterspielen with the Save's Rank, Stars,
// money and time played; Neues Spiel; the map cards (tables.maps); and the Anleitung (#113: a page per topic, each with
// our own drawing), Einstellungen and Credits pages. Acts only through the handlers main.js passes.
import { RULE_ICONS, ZEBRA_ICON, playedText, starsText } from './hud.js';

// The how-to-play pages' drawings, our own, by the page's key (strings.start.howToPages), on a 240 × 80 grid; the pedals
// are drawn as the game's, with their labels.
const TRUCK = '<rect x="1" y="3" width="9" height="8" rx="1" fill="#e8c547"/><path d="M10 5.5h2.6l2.4 3V11h-5z" fill="#d1495b"/><circle cx="4" cy="12" r="1.8" fill="#fff"/><circle cx="12" cy="12" r="1.8" fill="#fff"/>';
const icon = (x, svg) => `<g transform="translate(${x} 22) scale(1.6)">${svg}</g>`;
export const howToArt = (strings) => ({
  controls:
    '<circle cx="44" cy="40" r="30" fill="none" stroke="#8a8e98" stroke-width="8"/><rect x="41" y="6" width="6" height="10" rx="1" fill="#e8c547"/>' +
    '<path d="M16 40h18M54 40h18M44 50v20" stroke="#8a8e98" stroke-width="6"/><circle cx="44" cy="40" r="10" fill="#8a8e98"/>' +
    '<rect x="140" y="26" width="44" height="44" rx="7" fill="#33353c" stroke="#8a8e98" stroke-width="3"/><rect x="194" y="14" width="34" height="56" rx="7" fill="#33353c" stroke="#8a8e98" stroke-width="3"/>' +
    `<text x="162" y="62" font-size="11" font-weight="700" text-anchor="middle" fill="#fff">${strings.brake}</text><text x="211" y="62" font-size="11" font-weight="700" text-anchor="middle" fill="#fff">${strings.gas}</text>`,
  orders:
    `<g transform="translate(6 18) scale(3)">${TRUCK}</g><path d="M62 54h68" stroke="#e8c547" stroke-width="3" stroke-dasharray="7 5"/><path d="M130 47l10 7-10 7z" fill="#e8c547"/>` +
    '<rect x="148" y="38" width="40" height="32" rx="3" fill="#6cc551" fill-opacity="0.25" stroke="#6cc551" stroke-width="2" stroke-dasharray="5 3"/>' +
    '<text x="214" y="34" font-size="20" text-anchor="middle" fill="#e8c547">★★★</text>',
  traffic:
    icon(8, RULE_ICONS.light) + icon(56, RULE_ICONS.giveWay) + icon(104, RULE_ICONS.stop) + icon(152, ZEBRA_ICON) +
    '<circle cx="219" cy="41" r="18" fill="#fff" stroke="#d1495b" stroke-width="4"/><text x="219" y="47" font-size="16" font-weight="700" text-anchor="middle" fill="#2b2d33">30</text>',
  fuel:
    '<rect x="20" y="20" width="28" height="48" rx="3" fill="#d1495b"/><rect x="25" y="26" width="18" height="12" rx="1" fill="#fff"/><path d="M48 28h6v30" stroke="#8a8e98" stroke-width="3" fill="none"/>' +
    '<rect x="84" y="38" width="76" height="12" rx="6" fill="#fff" fill-opacity="0.15"/><rect x="84" y="38" width="50" height="12" rx="6" fill="#6fa8dc"/>' +
    '<path d="M182 44 206 22 230 44z" fill="#d1495b"/><rect x="188" y="44" width="36" height="26" fill="#e8c547"/><rect x="201" y="52" width="10" height="18" fill="#2b2d33"/>',
  werkstatt:
    '<path d="M50 56h12" stroke="#8a8e98" stroke-width="3"/><rect x="6" y="30" width="44" height="28" rx="2" fill="#e8c547"/><circle cx="20" cy="60" r="5" fill="#fff"/><circle cx="34" cy="60" r="5" fill="#fff"/>' +
    `<g transform="translate(60 18) scale(3)">${TRUCK}</g>` +
    '<g transform="translate(176 52) rotate(-40)"><rect x="0" y="-5" width="48" height="10" rx="4" fill="#8a8e98"/><circle cx="0" cy="0" r="13" fill="#8a8e98"/><rect x="-14" y="-4" width="14" height="8" fill="#282830"/></g>',
  clients:
    '<rect x="16" y="32" width="56" height="38" fill="#f2e6d0"/><path d="M10 32h68l-6-12H16z" fill="#d1495b"/><rect x="24" y="44" width="16" height="26" fill="#2b2d33"/><rect x="46" y="44" width="18" height="14" fill="#6fa8dc"/>' +
    '<text x="132" y="50" font-size="22" text-anchor="middle" fill="#d1495b">♥♥♥♡</text>' +
    '<path d="M186 28q12-6 22 0v38q-10-6-22 0zM230 28q-12-6-22 0v38q10-6 22 0z" fill="#fff"/><path d="M192 38h10M192 46h10M214 38h10M214 46h10" stroke="#8a8e98" stroke-width="2"/>',
});

// Every row of CREDITS.md's tables (Asset | Files | Source | Licence) but their headers (the line over a |---| rule),
// without the files: the credits page's one source.
export const creditsFrom = (markdown) =>
  markdown
    .split('\n')
    .filter((line, i, lines) => line.startsWith('| ') && !lines[i + 1]?.startsWith('|-'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map(([, asset, , source, licence]) => ({ asset, source, licence }));

export function createStart(root, tables, strings, credits, { onNewGame, onReset, onChooseMap, onReplay }) {
  const s = strings.start;
  const back = `<button type="button" class="start-back" data-to="main">${s.back}</button>`;
  const topics = Object.keys(s.howToPages);
  const art = howToArt(strings);
  // Each topic's page: back to the list, its drawing and text, and on to the next topic (the last one back to the list).
  const topicPage = (key, i) => `
        <section class="start-page" data-page="${key}" hidden>
          <button type="button" class="start-back" data-to="howTo">${s.back}</button>
          <h2>${s.howToPages[key].title}</h2>
          <svg class="start-art" viewBox="0 0 240 80" aria-hidden="true">${art[key]}</svg>
          ${s.howToPages[key].text.map((p) => `<p>${p}</p>`).join('')}
          <button type="button" data-to="${topics[i + 1] ?? 'howTo'}">${topics[i + 1] ? `${s.next}: ${s.howToPages[topics[i + 1]].title}` : s.back}</button>
        </section>`;
  root.innerHTML = `
    <div class="start" hidden>
      <h1 class="start-title">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1" y="3" width="9" height="8" rx="1" fill="#e8c547" />
          <path d="M10 5.5h2.6l2.4 3V11h-5z" fill="#d1495b" />
          <circle cx="4" cy="12" r="1.8" fill="#fff" />
          <circle cx="12" cy="12" r="1.8" fill="#fff" />
        </svg>
        Truck Sim
      </h1>
      <div class="start-panel">
        <section class="start-page" data-page="main">
          <button type="button" class="start-continue" data-action="continue">${s.continue}<small></small></button>
          <button type="button" data-action="new">${s.newGame}</button>
          <h2>${s.map}</h2>
          <div class="start-maps">${Object.entries(tables.maps)
            .map(([id, { open }]) => {
              const line = open ? strings.maps[id].line : s.mapLocked;
              return `<button type="button" data-map="${id}"${open ? '' : ' disabled'}><b>${strings.maps[id].name}</b><small>${line}</small></button>`;
            })
            .join('')}</div>
          <div class="start-links">
            <button type="button" data-to="howTo">${s.howTo}</button>
            <button type="button" data-to="settings">${s.settings}</button>
            <button type="button" data-to="credits">${s.credits}</button>
          </div>
        </section>
        <section class="start-page" data-page="howTo" hidden>
          ${back}
          <h2>${s.howTo}</h2>
          ${topics.map((key) => `<button type="button" data-to="${key}">${s.howToPages[key].title}</button>`).join('')}
        </section>
        ${topics.map(topicPage).join('')}
        <section class="start-page" data-page="settings" hidden>
          ${back}
          <h2>${s.settings}</h2>
          <button type="button" data-action="replay">${s.replayTutorial}</button>
          <button type="button" data-action="reset">${strings.resetSave}</button>
        </section>
        <section class="start-page" data-page="credits" hidden>
          ${back}
          <h2>${s.credits}</h2>
          <p>${s.creditsIntro}</p>
          <ul>${credits.map((c) => `<li><a href="${c.source}" target="_blank" rel="noopener">${c.asset}</a> · ${c.licence}</li>`).join('')}</ul>
          <p>${s.creditsOwn}</p>
          ${back}
        </section>
      </div>
    </div>`;
  const overlay = root.querySelector('.start');
  const resume = root.querySelector('.start-continue');
  const pages = [...root.querySelectorAll('[data-page]')];
  const cards = [...root.querySelectorAll('[data-map]')];
  const eur = (n) => `${n.toLocaleString('de-DE')} €`;

  const page = (name) => {
    for (const p of pages) p.hidden = p.dataset.page !== name;
  };
  const choose = (id) => {
    for (const c of cards) c.setAttribute('aria-pressed', c.dataset.map === id);
  };

  overlay.addEventListener('click', (e) => {
    const target = (name) => e.target.closest(`[data-${name}]`)?.dataset;
    if (target('to')) page(target('to').to);
    if (target('map')) {
      choose(target('map').map);
      onChooseMap(target('map').map);
    }
    const action = target('action')?.action;
    if (action === 'continue') overlay.hidden = true;
    if (action === 'new') onNewGame();
    if (action === 'reset' && confirm(strings.resetConfirm)) onReset();
    if (action === 'replay') onReplay();
  });

  return {
    // `canContinue`: Weiterspielen shows, with the Profile in `state`; `map`: the chosen map's id.
    show(state, canContinue, map) {
      const { profile, rank } = state;
      resume.hidden = !canContinue;
      resume.querySelector('small').textContent = `${rank.title} · ${starsText(rank)} · ${eur(profile.money)} · ${playedText(profile.timePlayed, strings)}`;
      choose(map);
      page('main');
      overlay.hidden = false;
    },
    hide() {
      overlay.hidden = true;
    },
    get open() {
      return !overlay.hidden;
    },
  };
}
