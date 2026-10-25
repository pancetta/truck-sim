// Money counter, orders button and panel, goal banner, load/unload progress bar, payment and fine notices.
// Reads Sim state each frame; changes it only through the Sim's order commands.
export function createOrders(root, sim, map, tables, strings) {
  root.innerHTML = `
    <div class="money" aria-label="${strings.money}"></div>
    <button type="button" class="orders-toggle">${strings.orders}</button>
    <div class="orders-panel" hidden></div>
    <div class="goal" hidden><i>↑</i><span></span><small></small><p hidden><b></b><meter max="1" low="0.25" high="0.5" optimum="0"></meter></p></div>
    <div class="progress" hidden><span></span><i></i></div>
    <div class="notices"><div class="paid" hidden></div><div class="paid fined" hidden></div></div>`;
  const money = root.querySelector('.money');
  const panel = root.querySelector('.orders-panel');
  const progress = root.querySelector('.progress');
  const paid = root.querySelector('.paid');
  const fined = root.querySelector('.fined');
  const goal = root.querySelector('.goal');
  const [arrow, goalText, hint, damage] = goal.children;
  const [damageText, meter] = damage.children;
  const eur = (n) => `${n.toLocaleString('de-DE')} €`;
  const km = (m) => `${(m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  const clock = (s) => `${Math.floor(Math.ceil(s) / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;
  const offerHtml = (o) =>
    `<b>${o.cargo.name}</b> · ${o.cargo.weight} t<br><small>${o.pickup} → ${o.dropoff} · ${km(o.distance)} · ` +
    `${strings.expectedTime} ${clock(o.expectedTime)}</small><br>` +
    `<small>${strings.offerTypes[o.type]}</small><strong>${eur(o.pay)}</strong>`;
  let shown = null; // what the open panel shows, so it only redraws on a change
  let lastMoney = sim.state.profile.money;
  money.textContent = eur(lastMoney);
  let lastPayment = sim.state.lastPayment;
  let lastFine = sim.state.lastFine;
  const timers = new Map();

  // Shows a notice for a few seconds; a new one restarts its time.
  function notify(el, text) {
    el.textContent = text;
    el.hidden = false;
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => (el.hidden = true), tables.orders.paidNoticeTime * 1000));
  }

  root.querySelector('.orders-toggle').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    shown = null;
  });
  panel.addEventListener('click', (e) => {
    const id = e.target.closest('[data-offer]')?.dataset.offer;
    if (!id) return;
    sim.acceptOrder(Number(id));
    panel.hidden = true;
  });

  // Offset from the truck to the centre of the route tile just past the route's first turn (or its last
  // tile), so the arrow leans into a turn while the truck is still approaching the junction. Off the road
  // it aims at the route's first tile instead, where the truck joins the road.
  function pastNextTurn(route, { x, z }) {
    const step = (i) => `${route[i + 1].col - route[i].col},${route[i + 1].row - route[i].row}`;
    let i = 1;
    while (i < route.length - 1 && step(i) === step(0)) i++;
    const onRoute = Math.floor(x / map.tileSize) === route[0].col && Math.floor(z / map.tileSize) === route[0].row;
    const t = onRoute ? route[Math.min(i + 1, route.length - 1)] : route[0];
    return [(t.col + 0.5) * map.tileSize - x, (t.row + 0.5) * map.tileSize - z];
  }

  function update({ profile, lastPayment: payment, lastFine: fine, order, offers, progress: p, truck, route }) {
    if (profile.money !== lastMoney) {
      lastMoney = profile.money;
      money.textContent = eur(lastMoney);
    }
    // Only payments show the payment notice and only fines the fine notice; purchases change the money too.
    if (payment !== lastPayment) {
      lastPayment = payment;
      const lines = payment.lines.map((l) => `${strings.payLines[l.label]} +${eur(l.amount)}`);
      notify(paid, [`${strings.paid}: +${eur(payment.amount)}`, ...lines].join('\n'));
    }

    if (fine !== lastFine) {
      lastFine = fine;
      notify(fined, `${strings.fine}: ${strings[fine.reason]} −${eur(fine.amount)}`);
    }

    progress.hidden = p === 0;
    if (p > 0) {
      progress.firstChild.textContent = order.phase === 'pickup' ? strings.loading : strings.unloading;
      progress.lastChild.style.transform = `scaleX(${p})`;
    }

    // Where to go: an arrow along the route to its next corner (or the active zone), turned by the truck's
    // heading, and the straight-line distance to the zone.
    goal.hidden = !order;
    if (order) {
      const pickup = order.phase === 'pickup';
      const target = pickup ? order.pickup : order.dropoff;
      const { zone, dock } = map.spots.find((s) => s.id === target);
      const dx = (zone.minX + zone.maxX) / 2 - truck.x;
      const dz = (zone.minZ + zone.maxZ) / 2 - truck.z;
      const [ax, az] = route.length > 1 ? pastNextTurn(route, truck) : [dx, dz];
      const ahead = ax * Math.sin(truck.heading) + az * Math.cos(truck.heading);
      const right = -ax * Math.cos(truck.heading) + az * Math.sin(truck.heading);
      arrow.style.transform = `rotate(${Math.atan2(right, ahead)}rad)`;
      arrow.style.color = `#${tables.palette[pickup ? 'pickup' : 'dropoff'].toString(16).padStart(6, '0')}`; // the zone marker's colour
      goalText.textContent =
        `${pickup ? strings.toPickup : strings.toDropoff} ${target} · ${Math.round(Math.hypot(dx, dz) / 10) * 10} m · ` +
        `${strings.bonusTime} ${clock(Math.max(0, order.expectedTime - order.elapsed))}`;
      hint.textContent = pickup ? strings.stopToLoad : dock ? strings.stopToDock : strings.stopToUnload;
      // The damage meter, while fragile cargo is loaded.
      damage.hidden = pickup || !order.cargo.fragile;
      if (!damage.hidden) {
        damageText.textContent = `${strings.offerTypes.fragile} · ${strings.damage} ${Math.round(order.damage * 100)} %`;
        meter.value = order.damage;
      }
    }

    if (panel.hidden) return;
    // Fresh offers whenever the open panel has neither an order nor offers, e.g. right after a delivery.
    if (!order && offers.length === 0) offers = sim.requestOffers();
    const now = order ? `${order.id} ${order.phase}` : offers.map((o) => o.id).join();
    if (now === shown) return;
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
