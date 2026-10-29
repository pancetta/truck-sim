// Money counter, orders button and panel, goal banner, load/unload and service progress bar, a service spot's service
// buttons, the Stars banner, payment, fine, tow, surprise, thank-you and Story chain notices. Reads Sim state each frame; changes it only through the
// Sim's order and service commands.
export function createOrders(root, sim, map, tables, strings) {
  root.innerHTML = `
    <div class="money" aria-label="${strings.money}"></div>
    <button type="button" class="orders-toggle">${strings.orders}</button>
    <div class="orders-panel" hidden></div>
    <div class="goal" hidden><i>↑</i><span></span><small></small><p hidden><b></b><meter max="1" low="0.25" high="0.5" optimum="0"></meter></p></div>
    <div class="progress" hidden><span></span><i></i></div>
    <div class="notices"><div class="services"></div><div class="paid stars-banner" hidden><b></b><span></span></div><div class="paid" hidden></div><div class="paid fined" hidden></div><div class="paid towed" hidden></div><div class="paid surprised" hidden></div><div class="paid thanked" hidden></div><div class="paid storied" hidden></div></div>`;
  const money = root.querySelector('.money');
  const panel = root.querySelector('.orders-panel');
  const progress = root.querySelector('.progress');
  const starsBanner = root.querySelector('.stars-banner');
  const [starsLine, missedLines] = starsBanner.children;
  const paid = root.querySelector('.paid:not(.stars-banner)');
  const fined = root.querySelector('.fined');
  const towed = root.querySelector('.towed');
  const surprised = root.querySelector('.surprised');
  const thanked = root.querySelector('.thanked');
  const storied = root.querySelector('.storied');
  const services = root.querySelector('.services');
  const goal = root.querySelector('.goal');
  const [arrow, goalText, hint, damage] = goal.children;
  const [damageText, meter] = damage.children;
  const eur = (n) => `${n.toLocaleString('de-DE')} €`;
  const km = (m) => `${(m / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  const clock = (s) => `${Math.floor(Math.ceil(s) / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;
  // A spot as the player knows it: business and street.
  const place = (id) => {
    const s = map.spots.find((s) => s.id === id);
    return `${s.name}, ${s.street}`;
  };
  // A round's drop-offs are listed in the order they are driven. A cargo kind's twist ends the tag line, in place of a
  // normal offer's tag, which says nothing more.
  const tagOf = (o, twist = strings.cargoKinds[o.cargo.kind]?.twist) =>
    [strings.offerTypes[o.type], twist && o.type === 'normal' ? null : strings.offerTags[o.type], twist].filter(Boolean).join(' · ');
  // A Client's Reputation: its level in hearts, then the level's name.
  const top = tables.reputation.levels.length - 1;
  const standing = (level) => `${strings.reputation} ${'♥'.repeat(level)}${'♡'.repeat(top - level)} ${strings.reputationLevels[level]}`;
  const kindOf = (id) => strings.spotKinds[map.spots.find((s) => s.id === id).kind];
  // A Story chain's title and how far it is: the step under way (or just done) of how many.
  const chainOf = (id) => tables.stories.find((c) => c.id === id);
  const part = (id, step) => `${strings.stories[id].title} · ${strings.story.part} ${step}/${chainOf(id).steps.length}`;
  // A chain under way, with its next step: its cargo and the Kind of place it goes to; and that step's line on its offer.
  const chainHtml = (id, step) => {
    const next = chainOf(id).steps[step];
    return `<p class="story">${strings.story.label}: <b>${part(id, step + 1)}</b><br><small>${strings.story.next}: ${next.cargo.name} → ${strings.spotKinds[next.to]}</small></p>`;
  };
  const offerHtml = (o) =>
    (o.story ? `<small class="story">„${strings.stories[o.story.chain].steps[o.story.step].offer}“</small><br>` : '') +
    `<b>${o.cargo.name}</b> · ${o.cargo.weight} t<br><small class="places">${[o.pickup, ...o.drops.map((d) => d.spot)].map(place).join(' → ')}</small><br>` +
    `<small class="client">${[kindOf(o.pickup), standing(o.reputation)].filter(Boolean).join(' · ')}</small><br>` +
    `<small>${km(o.distance)} · ${strings.expectedTime} ${clock(o.expectedTime)}</small><br>` +
    `<small class="tag">${tagOf(o)}</small><strong>${eur(o.pay)}</strong>`;
  const stop = (order) => (order.drops.length > 1 && order.phase === 'dropoff' ? ` ${order.drop + 1}/${order.drops.length}` : '');
  let shown = null; // what the open panel shows, so it only redraws on a change
  let lastMoney = sim.state.profile.money;
  money.textContent = eur(lastMoney);
  let lastPayment = sim.state.lastPayment;
  let lastFine = sim.state.lastFine;
  let lastTow = sim.state.lastTow;
  let lastSurprise = sim.state.lastSurprise;
  let lastReputation = sim.state.lastReputation;
  let lastStory = sim.state.lastStory;
  let shownServices = null;
  const timers = new Map();
  // Writes to the DOM only when a shown value changes, not every frame. It compares with what it last wrote,
  // since style properties read back normalised (a colour as rgb()).
  const written = new Map();
  const set = (target, key, value) => {
    const last = written.get(target) ?? written.set(target, {}).get(target);
    if (last[key] !== value) target[key] = last[key] = value;
  };

  // Shows a notice for a few seconds (`seconds`); a new one restarts its time.
  function notify(el, text, seconds) {
    el.textContent = text;
    show(el, seconds);
  }
  function show(el, seconds = tables.orders.paidNoticeTime) {
    el.hidden = false;
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(() => (el.hidden = true), seconds * 1000));
  }

  // Hides the notices at once: the Werkstatt panel opening over them would cover them (#orders is a stacking
  // context of its own, under the Werkstatt).
  function dismissNotices() {
    for (const el of [starsBanner, paid, fined, towed, surprised, thanked, storied]) {
      if (el.hidden) continue;
      clearTimeout(timers.get(el));
      el.hidden = true;
    }
  }

  root.querySelector('.orders-toggle').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    shown = null;
  });
  services.addEventListener('click', (e) => {
    const id = e.target.closest('[data-service]')?.dataset.service;
    const result = id && sim.buyService(id);
    if (result && !result.ok) notify(towed, strings.refusals[result.reason]);
  });
  panel.addEventListener('click', (e) => {
    const id = e.target.closest('[data-offer]')?.dataset.offer;
    if (!id) return;
    sim.acceptOrder(Number(id));
    panel.hidden = true;
  });

  // Offset from the truck to the route point just past the route's first turn (or its last point), so the arrow
  // leans into a turn while the truck is still approaching it. Off the road it aims at the route's first point
  // instead, where the truck joins the road.
  function pastNextTurn(route, truck) {
    // Whether the way turns at b, coming from a and going on to c (by more than about 0.3 rad).
    const turns = (a, b, c) => Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) > 0.3 * Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z);
    let i = 0;
    while (i < route.length - 1 && !turns(i ? route[i - 1] : truck, route[i], route[i + 1])) i++;
    const t = map.graph.onRoad(truck.x, truck.z) ? route[Math.min(i + 1, route.length - 1)] : route[0];
    return [t.x - truck.x, t.z - truck.z];
  }

  function update({ profile, lastPayment: payment, lastFine: fine, lastTow: tow, lastSurprise: surprise, lastReputation: thanks, lastStory: story, serviceOffer, service, order, offers, progress: p, truck, route }) {
    if (profile.money !== lastMoney) {
      lastMoney = profile.money;
      money.textContent = eur(lastMoney);
    }
    // Only payments show the payment notice and only fines the fine notice; purchases change the money too.
    if (payment !== lastPayment) {
      lastPayment = payment;
      const lines = payment.lines.map((l) => `${strings.payLines[l.label]} +${eur(l.amount)}`);
      notify(paid, [`${strings.paid}: +${eur(payment.amount)}`, ...lines].join('\n'));
      // Earned Stars filled, missed ones hollow, then each missed one with why.
      const missed = payment.stars.filter((s) => s.reasons.length);
      const why = (reason) => strings.starReasons[reason] ?? strings[reason];
      starsLine.textContent = payment.stars.map((s) => (s.reasons.length ? '☆' : '★')).join(' ');
      missedLines.textContent = missed.map((s) => `☆ ${strings.stars[s.star]}: ${s.reasons.map(why).join(', ')}`).join('\n');
      if (payment.stars.length) show(starsBanner); // a round's drops before the last pay without Stars
    }

    if (fine !== lastFine) {
      lastFine = fine;
      notify(fined, `${strings.fine}: ${strings[fine.reason]} −${eur(fine.amount)}`);
    }

    if (tow !== lastTow) {
      lastTow = tow;
      notify(towed, `${strings.towed} ${tow.station ? place(tow.station) : ''} −${eur(tow.fee)}`);
    }

    if (surprise !== lastSurprise) {
      lastSurprise = surprise;
      const s = strings.surprises;
      notify(surprised, surprise.kind === 'closed' ? `${[s.closed, surprise.street].filter(Boolean).join(': ')} · ${s.newRoute}` : `${s.dropoff} ${place(surprise.spot)} · ${strings.payLines.umweg} +${eur(surprise.umweg)}`);
    }

    if (thanks !== lastReputation) {
      lastReputation = thanks;
      const { name, kind } = map.spots.find((s) => s.id === thanks.client);
      notify(thanked, `${name}: „${strings.thanks[kind] ?? ''}“\n${standing(thanks.level)}`);
    }

    // A Story chain's notice: its Client's opening line as it starts, then each step's thank-you, the last with the
    // reward (its money is the payment's Belohnung line). Longer lines than the others, so it stays longer.
    if (story !== lastStory) {
      lastStory = story;
      const text = strings.stories[story.chain];
      const { steps, reward } = chainOf(story.chain);
      const done = `${strings.story.done}: ${text.title} · +${reward.stars}\u00a0★${reward.visual ? ` · ${strings.visuals[reward.visual]}` : ''}`;
      const said = story.step ? text.steps[story.step - 1].thanks : text.intro;
      const how = story.step === 0 ? `${strings.story.started}: ${text.title}` : story.step === steps.length ? done : `${part(story.chain, story.step)} ✓`;
      notify(storied, `„${said}“\n${how}`, tables.orders.storyNoticeTime);
    }

    if (serviceOffer !== shownServices) {
      shownServices = serviceOffer;
      services.innerHTML = serviceOffer
        .map((s) => `<button type="button" data-service="${s.id}">${strings.services[s.id]}${s.price ? ` · ${eur(s.price)}` : ''}</button>`)
        .join('');
    }

    const share = service ? service.progress : p;
    set(progress, 'hidden', share === 0);
    if (share > 0) {
      set(progress.firstChild, 'textContent', service ? strings.serving[service.id] : order.phase === 'pickup' ? strings.loading : strings.unloading);
      set(progress.lastChild.style, 'transform', `scaleX(${share})`);
    }

    // Where to go: an arrow along the route to its next corner (or the active zone), turned by the truck's
    // heading, and the straight-line distance to the zone; on a round, which drop-off of how many. The bonus time
    // runs to the next drop's expected time, which its time bonus uses.
    set(goal, 'hidden', !order);
    if (order) {
      const pickup = order.phase === 'pickup';
      const target = pickup ? order.pickup : order.dropoff;
      const { zone, dock } = map.spots.find((s) => s.id === target);
      const dx = (zone.minX + zone.maxX) / 2 - truck.x;
      const dz = (zone.minZ + zone.maxZ) / 2 - truck.z;
      const [ax, az] = route.length > 1 ? pastNextTurn(route, truck) : [dx, dz];
      const ahead = ax * Math.sin(truck.heading) + az * Math.cos(truck.heading);
      const right = -ax * Math.cos(truck.heading) + az * Math.sin(truck.heading);
      set(arrow.style, 'transform', `rotate(${Math.atan2(right, ahead).toFixed(2)}rad)`);
      set(arrow.style, 'color', `#${tables.palette[pickup ? 'pickup' : 'dropoff'].toString(16).padStart(6, '0')}`); // the zone marker's colour
      set(
        goalText,
        'textContent',
        `${pickup ? strings.toPickup : strings.toDropoff}${stop(order)} ${place(target)} · ${Math.round(Math.hypot(dx, dz) / 10) * 10} m · ` +
        `${strings.bonusTime} ${clock(Math.max(0, order.drops[order.drop].expectedTime - order.elapsed))}`,
      );
      set(hint, 'textContent', pickup ? strings.stopToLoad : dock ? strings.stopToDock : strings.stopToUnload);
      // The damage meter, while cargo of a kind is loaded.
      const kind = strings.cargoKinds[order.cargo.kind];
      set(damage, 'hidden', pickup || !kind);
      if (!damage.hidden) {
        set(damageText, 'textContent', `${kind.name} · ${kind.meter} ${Math.round(order.damage * 100)} %`);
        set(meter, 'value', order.damage);
      }
    }

    if (panel.hidden) return;
    // Fresh offers whenever the open panel has neither an order nor offers, e.g. right after a delivery.
    if (!order && offers.length === 0) offers = sim.requestOffers();
    const now = order ? `${order.id} ${order.phase} ${order.drop} ${order.dropoff}` : offers.map((o) => o.id).join();
    if (now === shown) return;
    shown = now;
    // The Story chains under way on this map atop the offers; an active step's own chain atop the order.
    const chains = Object.entries(profile.stories[map.id] ?? {})
      .filter(([id, { step }]) => chainOf(id)?.steps[step])
      .map(([id, { step }]) => chainHtml(id, step));
    panel.innerHTML = order
      ? `<h2>${strings.activeOrder}</h2>${order.story ? chainHtml(order.story.chain, order.story.step) : ''}<p>${offerHtml(order)}</p>` +
        `<p>${order.phase === 'pickup' ? strings.toPickup : `${strings.toDropoff}${stop(order)}`}</p>`
      : `<h2>${strings.orders}</h2>${chains.join('')}<ul>${offers
          .map((o) => `<li><p>${offerHtml(o)}</p><button type="button" data-offer="${o.id}">${strings.accept}</button></li>`)
          .join('')}</ul>`;
  }

  return { update, dismissNotices };
}
