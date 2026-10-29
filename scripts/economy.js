// The economy run (#58): the Sim on the real Monti map, driven by the autopilot as a simple player, over many simulated
// hours and several seeds. It reports money per hour, deliveries, stops, tows, fines and the pay lines, for tuning the
// economy in src/tables.js. Run it with `node scripts/economy.js [hours] [seeds] [careless]`, e.g.
// `node scripts/economy.js 4 1,2,3,4`; `careless` never refuels, so the tow is its only fuel.
//
// The player takes the first offer (offers are random, so its deliveries are the average one), refuels below `refuel` of
// the tank (default 0.3) and can pay for a full one (with a snack below 70 % energy, if it keeps `reserve` €), and when tired drives to the nearer of home (sleep, free) and the
// restaurant (meal). Whenever it may and can afford an upgrade level, keeping `reserve` €, it drives home and buys the
// cheapest ones (sleeping there too if it's below `nap` energy). It drives like the autopilot: at the
// street's limit, waiting only for cars ahead, so it ignores red lights, give-way and stop signs (the rule fines are a
// careless driver's).
// shortcut: the autopilot turns round by jumping on along its route when stuck (see autopilot.js), and a leg it can't
// finish in `legLimit` s jumps into the target's zone (counted as `rescues`); give it a real turn-round if those grow.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as realTables from '../src/tables.js';
import { buildOsmMap } from '../src/sim/osm.js';
import { createSim, freshProfile, seeded } from '../src/sim/sim.js';
import { createAutopilot } from '../src/autopilot.js';

const DT = realTables.loop.step;
const IDLE = { steer: 0, gas: 0, brake: 0 };
const reserve = 300; // € the player keeps when buying upgrades
const nap = 0.7; // energy below which the player sleeps when home anyway
const approach = 25; // m from the target zone's centre within which the player crawls at `crawl` m/s
const crawl = 3;
const legLimit = 600; // s

const read = (file) => JSON.parse(readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8'));
export const montiMap = (t = realTables) => buildOsmMap(read(t.osm.file), t, read(t.osm.furniture), read(t.osm.terrain));

// Plays `hours` of driving time (profile.timePlayed) from `profile` with the Sim seeded with `seed`; returns the totals.
export function runEconomy({ tables = realTables, map = montiMap(tables), seed = 1, hours = 1, profile = freshProfile(), refuel = 0.3 } = {}) {
  const sim = createSim(tables, map, seeded(seed), profile);
  const s = sim.state;
  const p = () => s.profile;
  const spot = (id) => map.spots.find((x) => x.id === id);
  const inZone = ({ zone }) => s.truck.x > zone.minX && s.truck.x < zone.maxX && s.truck.z > zone.minZ && s.truck.z < zone.maxZ;
  const length = (a, b) => (a === b ? 0 : (map.graph.route(spot(a).pose, spot(b).pose)?.length ?? Infinity));
  const nearest = (from, ids) => ids.reduce((best, id) => (length(from, id) < length(from, best) ? id : best));
  const end = hours * 3600;
  const r = {
    seed, hours, startMoney: p().money, deliveries: 0, pay: {}, fines: {}, finesCount: {}, tows: 0, towFees: 0, fuel: { stops: 0, cost: 0 },
    snacks: 0, meals: 0, sleeps: 0, food: 0, upgrades: [], upgradeCost: 0, burnt: 0, driving: 0, rescues: 0, ranks: [], lowest: p().money, hourly: [],
  };
  let here = tables.osm.start;
  Object.assign(s.truck, spot(here).lane, { speed: 0 });
  let lastFine = s.lastFine;
  let lastPayment = s.lastPayment;
  let lastTow = s.lastTow;
  let tier = s.rank.tier;
  const done = () => p().timePlayed >= end;

  // One Sim step, with the totals it changed.
  function step(input) {
    const fuel = p().fuel;
    sim.step(DT, input);
    if (p().fuel < fuel) r.burnt += fuel - p().fuel;
    if (Math.abs(s.truck.speed) > 0.1) r.driving += DT;
    if (s.lastFine !== lastFine) {
      ({ lastFine } = s);
      r.fines[lastFine.reason] = (r.fines[lastFine.reason] ?? 0) + lastFine.amount;
      r.finesCount[lastFine.reason] = (r.finesCount[lastFine.reason] ?? 0) + 1;
    }
    if (s.lastPayment !== lastPayment) {
      ({ lastPayment } = s);
      if (lastPayment.stars.length) r.deliveries++; // a round pays each drop, and is one delivery
      for (const l of lastPayment.lines) r.pay[l.label] = (r.pay[l.label] ?? 0) + l.amount;
    }
    if (p().timePlayed >= (r.hourly.length + 1) * 3600) r.hourly.push(p().money);
    if (s.rank.tier !== tier) r.ranks.push({ tier: (tier = s.rank.tier), hours: p().timePlayed / 3600 });
    r.lowest = Math.min(r.lowest, p().money);
  }

  // Stands until `until()` holds (or `limit` s pass).
  function wait(until, limit = 30) {
    for (let t = 0; t < limit && !until() && !done(); t += DT) step(IDLE);
  }

  // Drives from `here` into spot `to`'s zone and stops there; false if a tow took the truck elsewhere.
  function driveTo(to) {
    if (here === to && inZone(spot(to))) return true;
    const pilot = createAutopilot(sim, map, tables, [here, to], false);
    const { zone } = spot(to);
    const [cx, cz] = [(zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2];
    for (let t = 0; !done(); t += DT) {
      if (s.lastTow !== lastTow) break;
      const input = pilot.update(DT);
      const v = s.truck.speed;
      if (inZone(spot(to))) {
        if (v === 0) break;
        step({ steer: input.steer, gas: 0, brake: 1 });
        continue;
      }
      if (Math.hypot(s.truck.x - cx, s.truck.z - cz) < approach) {
        input.gas = v < crawl ? input.gas : 0;
        input.brake = v > crawl + 1 ? 0.6 : input.brake;
      }
      if (t > legLimit) {
        r.rescues++;
        Object.assign(s.truck, { x: cx, z: cz, heading: spot(to).bay?.heading ?? spot(to).lane.heading, speed: 0 }); // a dock's zone is in its bay
        step(IDLE);
        break;
      }
      step(input);
    }
    if (s.lastTow !== lastTow) {
      ({ lastTow } = s);
      r.tows++;
      r.towFees += lastTow.fee;
      here = lastTow.station;
      return false;
    }
    here = to;
    return true;
  }

  // Buys service `id` where the truck stands, if offered and affordable; true if it was bought.
  function buy(id) {
    wait(() => s.serviceOffer.length > 0, 2);
    const offer = s.serviceOffer.find((x) => x.id === id);
    if (!offer || !sim.buyService(id).ok) return false;
    if (id === 'fuel') Object.assign(r.fuel, { stops: r.fuel.stops + 1, cost: r.fuel.cost + offer.price });
    wait(() => !s.service);
    return true;
  }

  function refill() {
    if (!driveTo(nearest(here, tables.osm.stations))) return;
    buy('fuel');
    if (p().energy < 1 - tables.energy.snack.restore && p().money >= tables.energy.snack.price + reserve && buy('snack')) {
      r.snacks++;
      r.food += tables.energy.snack.price;
    }
  }

  function rest() {
    const meal = p().money >= tables.energy.meal.price;
    const to = meal ? nearest(here, [tables.osm.home, tables.osm.restaurant]) : tables.osm.home;
    if (!driveTo(to)) return;
    if (to === tables.osm.restaurant && buy('meal')) {
      r.meals++;
      r.food += tables.energy.meal.price;
      return;
    }
    if (sim.sleep().ok) r.sleeps++;
    shop();
  }

  // The cheapest upgrade level the rank allows and the money (less the reserve) pays for, if any.
  const affordable = () =>
    Object.entries(tables.upgrades)
      .map(([id, u]) => ({ id, level: u.levels[p().vehicles.truck[id] ?? 0] }))
      .filter(({ level }) => level && level.rank <= s.rank.tier && level.price <= p().money - reserve)
      .sort((a, b) => a.level.price - b.level.price)[0];

  // At home: sleeps if below `nap`, then buys every affordable() level.
  function shop() {
    if (p().energy < nap && sim.sleep().ok) r.sleeps++;
    for (let next; (next = affordable()); ) {
      if (!sim.buyUpgrade(next.id).ok) return;
      r.upgrades.push({ id: next.id, level: p().vehicles.truck[next.id], hours: p().timePlayed / 3600 });
      r.upgradeCost += next.level.price;
    }
  }

  function deliver() {
    const offers = sim.requestOffers();
    if (!offers.length) return wait(() => false, 1);
    const [best] = offers;
    sim.acceptOrder(best.id);
    while (s.order && !done()) {
      const target = s.order.phase === 'pickup' ? best.pickup : s.order.dropoff;
      const { phase } = s.order;
      const payment = s.lastPayment; // a round's drop pays and keeps the phase
      if (!driveTo(target)) continue;
      wait(() => !s.order || s.order.phase !== phase || s.lastPayment !== payment, tables.orders.loadTime + 1);
    }
  }

  while (!done()) {
    if (p().fuel < refuel * s.tank && p().money >= Math.ceil((s.tank - p().fuel) * tables.fuel.price)) refill();
    else if (s.tired) rest();
    else if (affordable()) driveTo(tables.osm.home) && shop();
    else deliver();
  }
  return { ...r, money: p().money, stars: p().stars, baseTank: tables.fleet.truck.tank };
}

// The run's totals as a few lines of text.
export function report(r) {
  const h = r.hours;
  const pay = Object.values(r.pay).reduce((a, b) => a + b, 0);
  const fines = Object.values(r.fines).reduce((a, b) => a + b, 0);
  const costs = r.fuel.cost + r.food + r.towFees + fines;
  const perH = (x) => Math.round(x / h);
  const list = (o) => Object.entries(o).map(([k, v]) => `${k} ${perH(v)}`).join(', ') || 'none';
  const counts = (o) => Object.entries(o).map(([k, v]) => `${k} ${(v / h).toFixed(1)}`).join(', ') || 'none';
  return [
    `seed ${r.seed}, ${h} h: money ${r.startMoney} → ${r.money} (lowest ${r.lowest}), net ${perH(r.money - r.startMoney)} €/h, ${(r.deliveries / h).toFixed(1)} deliveries/h, Stars ${r.stars}`,
    `  pay ${perH(pay)} €/h (${list(r.pay)}); running costs ${perH(costs)} €/h (${Math.round((100 * costs) / pay)} % of pay), leaving ${perH(pay - costs)} €/h`,
    `  fuel ${perH(r.fuel.cost)} €/h in ${(r.fuel.stops / h).toFixed(1)} stops/h; ${(r.burnt / Math.max(1, r.deliveries)).toFixed(0)} L/delivery, a ${r.baseTank} L tank lasts ${((r.baseTank / r.burnt) * r.deliveries).toFixed(1)} deliveries`,
    `  food ${perH(r.food)} €/h (snacks ${(r.snacks / h).toFixed(1)}/h, meals ${(r.meals / h).toFixed(1)}/h), sleeps ${(r.sleeps / h).toFixed(1)}/h; driving ${Math.round((100 * r.driving) / (h * 3600))} % of the time`,
    `  tows ${(r.tows / h).toFixed(1)}/h for ${perH(r.towFees)} €/h; fines ${perH(fines)} €/h (${list(r.fines)}; per h: ${counts(r.finesCount)}); rescues ${r.rescues}`,
    `  money by hour: ${r.hourly.join(', ')}`,
    `  ranks: ${r.ranks.map((x) => `${x.tier} at ${x.hours.toFixed(2)} h`).join(', ') || 'none'}`,
    `  upgrades (${r.upgradeCost} €): ${r.upgrades.map((u) => `${u.id}${u.level} ${u.hours.toFixed(2)} h`).join(', ') || 'none'}`,
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [hoursArg = '1', seedsArg = '1,2,3', mode] = process.argv.slice(2);
  const hours = Number(hoursArg);
  const seeds = seedsArg.split(',').map(Number);
  if (!(hours > 0) || !seeds.every(Number.isInteger) || ![undefined, 'careless'].includes(mode)) {
    console.error('usage: node scripts/economy.js [hours > 0] [seeds, e.g. 1,2,3] [careless]');
    process.exit(1);
  }
  const refuel = mode === 'careless' ? 0 : undefined;
  const map = montiMap();
  for (const seed of seeds) console.log(report(runEconomy({ map, seed, hours, refuel })));
}
