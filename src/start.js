// Start screen (#112): after loading and from the in-game Menü button, over the paused game's orbiting view (main.js
// pauses the Sim while it's `open` and orbits the camera). The main page: Weiterspielen with the Save's Rank, Stars,
// money and time played; Neues Spiel; the map cards (tables.maps); and the Anleitung, Einstellungen and Credits pages.
// Acts only through the handlers main.js passes.
import { playedText, starsText } from './hud.js';

// Every row of CREDITS.md's tables (Asset | Files | Source | Licence), without the files: the credits page's one source.
export const creditsFrom = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Asset |'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map(([, asset, , source, licence]) => ({ asset, source, licence }));

export function createStart(root, tables, strings, credits, { onNewGame, onReset, onChooseMap }) {
  const s = strings.start;
  const back = `<button type="button" class="start-back" data-to="main">${s.back}</button>`;
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
          ${s.howToText.map((p) => `<p>${p}</p>`).join('')}
        </section>
        <section class="start-page" data-page="settings" hidden>
          ${back}
          <h2>${s.settings}</h2>
          <button type="button" disabled>${s.replayTutorial}</button>
          <button type="button" data-action="reset">${strings.resetSave}</button>
        </section>
        <section class="start-page" data-page="credits" hidden>
          ${back}
          <h2>${s.credits}</h2>
          <p>${s.creditsIntro}</p>
          <ul>${credits.map((c) => `<li>${c.asset} · <a href="${c.source}" target="_blank" rel="noopener">${c.licence}</a></li>`).join('')}</ul>
          <p>${s.creditsOwn}</p>
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
