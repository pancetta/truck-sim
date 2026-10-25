// Werkstatt button and panel: each upgrade's level, next price, needed rank and effect, plus the save reset.
// Reads Sim state; buys only through sim.buyUpgrade(). main.js pauses the Sim while the panel is `open`.
export function createWerkstatt(root, sim, tables, strings, onReset) {
  root.innerHTML = `
    <button type="button" class="werkstatt-toggle">${strings.werkstatt}</button>
    <div class="werkstatt" hidden>
      <div class="werkstatt-panel">
        <h2>${strings.werkstatt} <small></small></h2>
        <ul></ul>
        <p class="werkstatt-refusal"></p>
        <div class="werkstatt-actions">
          <button type="button" data-action="reset">${strings.resetSave}</button>
          <button type="button" data-action="close">${strings.close}</button>
        </div>
      </div>
    </div>`;
  const toggle = root.querySelector('.werkstatt-toggle');
  const overlay = root.querySelector('.werkstatt');
  const summary = root.querySelector('h2 small');
  const list = root.querySelector('ul');
  const refusal = root.querySelector('.werkstatt-refusal');
  const eur = (n) => `${n.toLocaleString('de-DE')} €`;
  const percent = (factor) => `${factor > 1 ? '+' : '−'}${Math.round(Math.abs(factor - 1) * 100)} %`;
  const effect = (id, level) => `${strings.effects[id]} ${level.maxCargo ? `${level.maxCargo} t` : percent(level.factor)}`;

  function draw() {
    const { profile, rank } = sim.state;
    summary.textContent = `${eur(profile.money)} · ${rank.title}`;
    list.innerHTML = Object.entries(tables.upgrades)
      .map(([id, { levels }]) => {
        const level = profile.upgrades[id] ?? 0;
        const next = levels[level];
        const needs = next?.rank > 0 ? ` · ${strings.from} ${tables.rank.tiers[next.rank].title}` : '';
        const detail = next ? `${effect(id, next)} · ${eur(next.price)}${needs}` : strings.maxLevel;
        return (
          `<li><p><b>${strings.upgrades[id]}</b> ${strings.level} ${level}/${levels.length}<br><small>${detail}</small></p>` +
          (next ? `<button type="button" data-buy="${id}">${strings.buy}</button>` : '') +
          '</li>'
        );
      })
      .join('');
  }

  toggle.addEventListener('click', () => {
    if (!sim.state.garageAvailable) return;
    refusal.textContent = '';
    draw();
    overlay.hidden = false;
  });
  overlay.addEventListener('click', (e) => {
    const id = e.target.closest('[data-buy]')?.dataset.buy;
    if (id) {
      const { ok, reason } = sim.buyUpgrade(id);
      refusal.textContent = ok ? '' : strings.refusals[reason];
      draw();
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') overlay.hidden = true;
    if (action === 'reset' && confirm(strings.resetConfirm)) onReset();
  });

  function update({ garageAvailable }) {
    toggle.disabled = !garageAvailable;
  }

  return {
    update,
    get open() {
      return !overlay.hidden;
    },
  };
}
