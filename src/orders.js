// Money counter, orders button and panel, load/unload progress bar and payment notice.
// Reads Sim state each frame; changes it only through the Sim's order commands.
export function createOrders(root, sim, tables, strings) {
  root.innerHTML = `
    <div class="money" aria-label="${strings.money}"></div>
    <button type="button" class="orders-toggle">${strings.orders}</button>
    <div class="orders-panel" hidden></div>
    <div class="progress" hidden><span></span><i></i></div>
    <div class="paid" hidden></div>`;
  const money = root.querySelector('.money');
  const panel = root.querySelector('.orders-panel');
  const progress = root.querySelector('.progress');
  const paid = root.querySelector('.paid');
  const eur = (n) => `${n.toLocaleString('de-DE')} €`;
  const km = (m) => `${(m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  const offerHtml = (o) =>
    `<b>${o.cargo.name}</b> · ${o.cargo.weight} t<br><small>${o.pickup} → ${o.dropoff} · ${km(o.distance)}</small>` +
    `<strong>${eur(o.pay)}</strong>`;
  let shown = ''; // what the open panel shows, so it only redraws on a change
  let lastMoney = sim.state.money;
  money.textContent = eur(lastMoney);
  let paidTimer;

  root.querySelector('.orders-toggle').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    shown = '';
    if (!panel.hidden && !sim.state.order && sim.state.offers.length === 0) sim.requestOffers();
  });
  panel.addEventListener('click', (e) => {
    const id = e.target.closest('[data-offer]')?.dataset.offer;
    if (!id) return;
    sim.acceptOrder(Number(id));
    panel.hidden = true;
  });

  function update({ money: m, order, offers, progress: p }) {
    if (m !== lastMoney) {
      money.textContent = eur(m);
      if (m > lastMoney) {
        paid.textContent = `${strings.paid}: +${eur(m - lastMoney)}`;
        paid.hidden = false;
        clearTimeout(paidTimer);
        paidTimer = setTimeout(() => (paid.hidden = true), tables.orders.paidNoticeTime * 1000);
      }
      lastMoney = m;
    }

    progress.hidden = p === 0;
    if (p > 0) {
      progress.firstChild.textContent = order.phase === 'pickup' ? strings.loading : strings.unloading;
      progress.lastChild.style.transform = `scaleX(${p})`;
    }

    const now = order ? `${order.id} ${order.phase}` : offers.map((o) => o.id).join();
    if (panel.hidden || now === shown) return;
    shown = now;
    panel.innerHTML = order
      ? `<h2>${strings.activeOrder}</h2><p>${offerHtml(order)}</p>` +
        `<p>${order.phase === 'pickup' ? strings.toPickup : strings.toDropoff}</p>`
      : `<h2>${strings.orders}</h2><ul>${offers
          .map((o) => `<li><p>${offerHtml(o)}</p><button type="button" data-offer="${o.id}">${strings.accept}</button></li>`)
          .join('')}</ul>`;
  }

  return { update };
}
