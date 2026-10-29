// Werkstatt button and panel: the Vehicles to buy and choose; the current Vehicle's upgrades, each with its level, next
// price, needed rank and effect, and for the truck its trailer, to buy, upgrade, hitch and unhitch (#96); the visual items to try on and buy (on a Vehicle they fit); and the save reset. Reads
// Sim state; buys only through the Sim's commands. main.js pauses the Sim while the panel is `open` and hands `look` and
// `showroom` to the renderer. A tried-on item lives only in `previews` here, never in the profile, and closing the panel
// drops it.
export function createWerkstatt(root, sim, tables, strings, onReset) {
  root.innerHTML = `
    <button type="button" class="werkstatt-toggle" hidden>${strings.werkstatt}</button>
    <div class="werkstatt" hidden>
      <div class="werkstatt-panel">
        <h2>${strings.werkstatt} <small></small></h2>
        <div class="werkstatt-tabs">
          <button type="button" data-tab="fahrzeuge">${strings.fahrzeuge}</button>
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
  const current = () => tables.fleet[sim.state.profile.vehicle];
  const tonnes = (factor) => `${Math.round(current().maxCargo * factor)} t`;
  const effect = (id, level) => `${strings.effects[id]} ${id === 'cargoBed' ? tonnes(level.factor) : percent(level.factor)}`;
  const tabs = [...root.querySelectorAll('[data-tab]')];

  // Visual item ids by slot, in table order; the free one is the slot's stock item.
  const slots = {};
  for (const [id, { slot }] of Object.entries(tables.visuals)) (slots[slot] ??= []).push(id);
  let tab = 'technik';
  let previews = {}; // slot → tried-on item not bought yet
  let focus = null; // slot of the last item tapped
  const shownIn = (slot) => previews[slot] ?? sim.state.profile.equipped[slot] ?? slots[slot].find((id) => tables.visuals[id].price === 0);

  function draw() {
    const { profile, rank } = sim.state;
    summary.textContent = `${eur(profile.money)} · ${rank.title} · ${strings.fleet[profile.vehicle]}`;
    for (const b of tabs) b.setAttribute('aria-pressed', b.dataset.tab === tab);
    const rows = { fahrzeuge: vehicleRows, technik: upgradeRows, looks: visualRows }[tab];
    list.innerHTML = rows();
  }

  // Each Vehicle with its load and tank: the current one, an owned one to drive, or its price and the Tier it needs.
  function vehicleRows() {
    const { profile } = sim.state;
    return Object.entries(tables.fleet)
      .map(([id, v]) => {
        const stats = `${strings.effects.cargoBed} ${v.maxCargo} t · ${strings.effects.tank} ${v.tank} ${strings.litres}`;
        const owned = Object.hasOwn(profile.vehicles, id);
        const needs = v.rank > 0 ? ` · ${strings.from} ${tables.rank.tiers[v.rank].title}` : '';
        const status = id === profile.vehicle ? ` · ${strings.current}` : owned ? '' : ` · ${eur(v.price)}${needs}`;
        const button = id === profile.vehicle ? '' : owned ? `<button type="button" data-choose="${id}">${strings.choose}</button>` : `<button type="button" data-buy-vehicle="${id}">${strings.buy}</button>`;
        return `<li><p><b>${strings.fleet[id]}</b><br><small>${stats}${status}</small></p>${button}</li>`;
      })
      .join('');
  }

  function visualRows() {
    if (!current().looks) return `<li><p><small>${strings.looksTruckOnly}</small></p></li>`;
    return Object.entries(slots)
      .map(([slot, ids]) => {
        const shown = shownIn(slot);
        const price = sim.owns(shown) ? '' : ` · ${eur(tables.visuals[shown].price)}`;
        const items = ids.map((id) => {
          const tag = sim.owns(id) ? '' : ` <small>${eur(tables.visuals[id].price)}</small>`;
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
        const level = profile.vehicles[profile.vehicle][id] ?? 0;
        const next = levels[level];
        const needs = next?.rank > 0 ? ` · ${strings.from} ${tables.rank.tiers[next.rank].title}` : '';
        // The effect is the next level's total over the base Vehicle, so it's labelled with that level.
        const detail = next ? `→ ${strings.level} ${level + 1}: ${effect(id, next)} · ${eur(next.price)}${needs}` : strings.maxLevel;
        return (
          `<li><p><b>${strings.upgrades[id]}</b> ${strings.level} ${level}/${levels.length}<br><small>${detail}</small></p>` +
          (next ? `<button type="button" data-buy="${id}">${strings.buy}</button>` : '') +
          '</li>'
        );
      })
      .join('') + trailerRow();
  }

  // The truck's trailer: its level, hitched or not, and the next level's load, price and Tier; nothing in another Vehicle.
  function trailerRow() {
    const { vehicle, trailer } = sim.state.profile;
    if (vehicle !== 'truck') return '';
    const { levels } = tables.trailer;
    const next = levels[trailer.level];
    const needs = next?.rank > 0 ? ` · ${strings.from} ${tables.rank.tiers[next.rank].title}` : '';
    const detail = next ? `→ ${strings.level} ${trailer.level + 1}: ${strings.trailerLoad} +${next.capacity} t · ${eur(next.price)}${needs}` : strings.maxLevel;
    const hitched = trailer.level ? ` · ${trailer.hitched ? strings.hitched : strings.unhitched}` : '';
    return (
      `<li><p><b>${strings.trailer}</b> ${strings.level} ${trailer.level}/${levels.length}${hitched}<br><small>${detail}</small></p>` +
      (next ? `<button type="button" data-buy-trailer>${strings.buy}</button>` : '') +
      (trailer.level ? `<button type="button" data-hitch="${!trailer.hitched}">${trailer.hitched ? strings.unhitch : strings.hitch}</button>` : '') +
      '</li>'
    );
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
    const vehicle = target('buy-vehicle')?.buyVehicle;
    if (vehicle) answer(sim.buyVehicle(vehicle));
    const chosen = target('choose')?.choose;
    if (chosen) answer(sim.chooseVehicle(chosen));
    if (target('buy-trailer')) answer(sim.buyTrailer());
    const hitch = target('hitch')?.hitch;
    if (hitch) answer(sim.hitchTrailer(hitch === 'true'));
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

  // The button shows only where the Werkstatt sells: at home, standing, with no active order.
  function update({ garageAvailable }) {
    if (toggle.hidden === garageAvailable) toggle.hidden = !garageAvailable; // writes only on a change
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
