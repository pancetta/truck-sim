// Werkstatt button and panel: each upgrade's level, next price, needed rank and effect; the visual items to
// try on and buy; and the save reset. Reads Sim state; buys only through the Sim's commands. main.js pauses
// the Sim while the panel is `open` and hands `look` and `showroom` to the renderer. A tried-on item lives
// only in `previews` here, never in the profile, and closing the panel drops it.
export function createWerkstatt(root, sim, tables, strings, onReset) {
  root.innerHTML = `
    <button type="button" class="werkstatt-toggle">${strings.werkstatt}</button>
    <div class="werkstatt" hidden>
      <div class="werkstatt-panel">
        <h2>${strings.werkstatt} <small></small></h2>
        <div class="werkstatt-tabs">
          <button type="button" data-tab="technik">${strings.technik}</button>
          <button type="button" data-tab="looks">${strings.looks}</button>
        </div>
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
  const tabs = [...root.querySelectorAll('[data-tab]')];

  // Visual item ids by slot, in table order; the free one is the slot's stock item.
  const slots = {};
  for (const [id, { slot }] of Object.entries(tables.visuals)) (slots[slot] ??= []).push(id);
  let tab = 'technik';
  let previews = {}; // slot → tried-on item not bought yet
  let focus = null; // slot of the last item tapped
  const owned = (id) => tables.visuals[id].price === 0 || sim.state.profile.owned.includes(id);
  const shownIn = (slot) => previews[slot] ?? sim.state.profile.equipped[slot] ?? slots[slot].find((id) => tables.visuals[id].price === 0);

  function draw() {
    const { profile, rank } = sim.state;
    summary.textContent = `${eur(profile.money)} · ${rank.title}`;
    for (const b of tabs) b.setAttribute('aria-pressed', b.dataset.tab === tab);
    list.innerHTML = tab === 'technik' ? upgradeRows() : visualRows();
  }

  function visualRows() {
    return Object.entries(slots)
      .map(([slot, ids]) => {
        const shown = shownIn(slot);
        const price = owned(shown) ? '' : ` · ${eur(tables.visuals[shown].price)}`;
        const items = ids.map((id) => {
          const tag = owned(id) ? '' : ` <small>${eur(tables.visuals[id].price)}</small>`;
          return `<button type="button" data-try="${id}" aria-pressed="${id === shown}">${strings.visuals[id]}${tag}</button>`;
        });
        return (
          `<li class="werkstatt-slot"><p><b>${strings.visualSlots[slot]}</b><br><small>${strings.visuals[shown]}${price}</small></p>` +
          (price ? `<button type="button" data-buy-visual="${shown}">${strings.buy}</button>` : '') +
          `<div class="werkstatt-items">${items.join('')}</div></li>`
        );
      })
      .join('');
  }

  function upgradeRows() {
    const { profile } = sim.state;
    return Object.entries(tables.upgrades)
      .map(([id, { levels }]) => {
        const level = profile.upgrades[id] ?? 0;
        const next = levels[level];
        const needs = next?.rank > 0 ? ` · ${strings.from} ${tables.rank.tiers[next.rank].title}` : '';
        // The effect is the next level's total over the base truck, so it's labelled with that level.
        const detail = next ? `→ ${strings.level} ${level + 1}: ${effect(id, next)} · ${eur(next.price)}${needs}` : strings.maxLevel;
        return (
          `<li><p><b>${strings.upgrades[id]}</b> ${strings.level} ${level}/${levels.length}<br><small>${detail}</small></p>` +
          (next ? `<button type="button" data-buy="${id}">${strings.buy}</button>` : '') +
          '</li>'
        );
      })
      .join('');
  }

  // Shows a command's refusal, if any, and draws the panel again.
  function answer({ ok, reason }) {
    refusal.textContent = ok ? '' : strings.refusals[reason];
    draw();
  }

  toggle.addEventListener('click', () => {
    if (!sim.state.garageAvailable) return;
    refusal.textContent = '';
    draw();
    overlay.hidden = false;
  });
  overlay.addEventListener('click', (e) => {
    const target = (name) => e.target.closest(`[data-${name}]`)?.dataset;
    const id = target('buy')?.buy;
    if (id) answer(sim.buyUpgrade(id));
    if (target('tab')) {
      tab = target('tab').tab;
      focus = null; // back to the orbit
      answer({ ok: true });
    }
    // An owned item is worn at once; any other is only tried on until it's bought.
    const tried = target('try')?.try;
    if (tried) {
      const { slot } = tables.visuals[tried];
      focus = slot;
      const result = sim.equipVisual(tried);
      const preview = result.reason === 'notOwned';
      if (preview) previews[slot] = tried;
      else delete previews[slot];
      answer(preview ? { ok: true } : result);
    }
    const bought = target('buy-visual')?.buyVisual;
    if (bought) {
      const result = sim.buyVisual(bought);
      if (result.ok) delete previews[tables.visuals[bought].slot];
      answer(result);
    }
    const action = target('action')?.action;
    if (action === 'close') {
      overlay.hidden = true;
      previews = {};
      focus = null;
    }
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
    // slot → item id for every slot: what the truck wears, with the tried-on items over it.
    get look() {
      return Object.fromEntries(Object.keys(slots).map((slot) => [slot, shownIn(slot)]));
    },
    // How the renderer shows the truck: null while driving, else the orbit, or the cab for the gimmick.
    get showroom() {
      if (overlay.hidden) return null;
      return focus === 'gimmick' ? 'cab' : 'orbit';
    },
  };
}
