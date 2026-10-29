import { describe, expect, test } from 'vitest';
import * as base from '../tables.js';
import { way, build, withSpots, createSim, drive, timeUntil, seeded, IDLE } from './fixtures.js';
import { freshProfile } from './sim.js';

// Surprises on the way (#85): a street closing on the route ahead, the Client changing the drop-off, their chances.

// No police, zebra crossings in use, AI cars or scheduled street events; surprises as given.
const quiet = (surprises) => ({
  ...base,
  police: { ...base.police, count: 0 },
  zebras: { ...base.zebras, use: 0 },
  rank: { ...base.rank, tiers: base.rank.tiers.map((tier) => ({ ...tier, traffic: 0 })) },
  events: { ...base.events, count: 0 },
  surprises: { ...base.surprises, after: [1, 1], ahead: 5, ...surprises },
});

// A ladder: two residential streets 80 m apart (north at z -40, south at z 40) from x -80 to 80, joined at the ends and
// by a middle rung M along x 0. A is on the north street 10 m west of the rung, B and C on the south one, 10 and 50 m
// west of it: A to B is 100 m by M, A to C 140 m. With `stub`, D is on a residential dead end south of the street, 30 m west of the rung, that
// only a service lane (4 m) leads to: no oversized load reaches it. `kinds` gives spots their kind, by id.
function ladder(t, stub = false, kinds = {}) {
  const north = way('residential', [[-80, -40], [0, -40], [80, -40]], { name: 'Nord' });
  const south = way('residential', [[-80, 40], [-30, 40], [0, 40], [80, 40]], { name: 'Süd' }); // -30: where the stub joins
  const rung = way('residential', [[0, -40], [0, 40]], { name: 'Mitte' });
  const ways = [north, south, way('residential', [[-80, -40], [-80, 40]]), way('residential', [[80, -40], [80, 40]]), rung];
  const end = way('residential', [[-30, 60], [-30, 95]], { name: 'Sackgasse' });
  if (stub) ways.push(way('service', [[-30, 40], [-30, 60]]), end);
  const spots = [
    ...(stub ? [{ id: 'D', name: 'Sackgasse', street: 'Sackgasse', way: end.id, at: 20, side: 'right' }] : []),
    { id: 'A', name: 'Nord', street: 'Nord', way: north.id, at: 70, side: 'right' },
    { id: 'B', name: 'Süd', street: 'Süd', way: south.id, at: 70, side: 'right' },
    { id: 'C', name: 'Süd West', street: 'Süd', way: south.id, at: 30, side: 'right' },
  ];
  const tables = withSpots(spots.map((s) => ({ ...s, kind: kinds[s.id] })), [], null, t);
  const map = build(ways, tables);
  const M = map.graph.edges.find((e) => e.points.every((p) => p.x === 0)).id;
  return { tables, map, M };
}

// Whether the route (a polyline) passes within 5 m of (x, z).
const passes = (route, x, z) =>
  route.slice(1).some((b, i) => {
    const a = route[i];
    const l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / l2)) : 0;
    return Math.hypot(a.x + t * (b.x - a.x) - x, a.z + t * (b.z - a.z) - z) < 5;
  });

// Accepts an order from A to B and loads it, the truck standing in A's zone facing east, towards the rung.
function loadAtoB(sim, map) {
  let offer;
  for (let i = 0; i < 50 && !offer; i++) offer = sim.requestOffers().find((o) => o.pickup === 'A' && o.dropoff === 'B');
  expect(offer, 'an offer from A to B').toBeTruthy();
  sim.acceptOrder(offer.id);
  standIn(sim, map, 'A');
  drive(sim, base.orders.loadTime + 0.1, IDLE);
  expect(sim.state.order.phase).toBe('dropoff');
  return offer;
}
function standIn(sim, map, id) {
  const { zone } = map.spots.find((s) => s.id === id);
  Object.assign(sim.state.truck, { x: (zone.minX + zone.maxX) / 2, z: (zone.minZ + zone.maxZ) / 2, heading: Math.PI / 2, speed: 0 });
}

describe('Sim: surprises on the way (#85)', () => {
  test('a street closes on the route ahead, and the route goes round it', () => {
    const { tables, map, M } = ladder(quiet({ closed: 1, dropoff: 0 }));
    const sim = createSim(tables, map, seeded(1));
    loadAtoB(sim, map);
    expect(sim.state.closed.size).toBe(0);
    expect(passes(sim.state.route, 0, 0)).toBe(true); // by M

    timeUntil(sim, IDLE, () => sim.state.lastSurprise, 5);
    expect(sim.state.lastSurprise).toEqual({ kind: 'closed', street: 'Mitte' });
    expect([...sim.state.closed]).toEqual([M]);
    expect(sim.state.events).toMatchObject([{ edge: M }]);
    expect(['market', 'roadworks']).toContain(sim.state.events[0].kind);
    expect(passes(sim.state.route, 0, 0)).toBe(false);
    expect(passes(sim.state.route, 80, 0)).toBe(true); // on round the east end, not back round the west (#99)
    expect(sim.state.order.surprise).toBe(null);
  });

  test('the Client changes the drop-off: the order goes to the new place, with the Umweg paid and the time extended', () => {
    const { tables, map } = ladder(quiet({ closed: 0, dropoff: 1 }));
    const sim = createSim(tables, map, seeded(1));
    const offer = loadAtoB(sim, map);
    const { expectedTime } = offer;

    timeUntil(sim, IDLE, () => sim.state.lastSurprise, 5);
    const order = sim.state.order;
    const extra = 40; // A to C less A to B
    const umweg = Math.round((tables.orders.payPerKm * extra) / 1000);
    expect(sim.state.lastSurprise).toEqual({ kind: 'dropoff', spot: 'C', umweg });
    expect(order.dropoff).toBe('C');
    expect(order.drops).toMatchObject([{ spot: 'C', umweg }]);
    expect(order.expectedTime).toBeCloseTo(expectedTime + extra / tables.orders.referenceSpeed, 0);
    expect(order.drops[0].expectedTime).toBe(order.expectedTime);
    expect(passes(sim.state.route, -50, 40)).toBe(true); // to C

    // Delivered at C, within the extended time: the Umweg line and the on-time Star.
    standIn(sim, map, 'C');
    timeUntil(sim, IDLE, () => !sim.state.order, 5);
    expect(sim.state.lastPayment.lines).toContainEqual({ label: 'umweg', amount: umweg });
    expect(sim.state.lastPayment.stars).toContainEqual({ star: 'onTime', reasons: [] });
  });

  test("an oversized load's drop-off moves only to a place a wide route leads to", () => {
    const t = quiet({ closed: 0, dropoff: 1 });
    const { tables, map } = ladder({ ...t, orders: { ...t.orders, shares: { oversized: 1 } } }, true);
    const moved = (profile) => {
      const sim = createSim(tables, map, seeded(1), profile);
      loadAtoB(sim, map);
      timeUntil(sim, IDLE, () => sim.state.lastSurprise, 5);
      return [sim.state.order.type, sim.state.order.dropoff];
    };
    const tiers = tables.rank.tiers;
    // Below the oversized tier a normal order may go to D; from it, an oversized one only ever to C.
    const seen = new Set();
    for (let played = 0; played < 20; played++) seen.add(moved({ ...freshProfile(), timePlayed: played }).join());
    expect(seen).toContain('normal,D');
    const oversized = new Set();
    for (let played = 0; played < 20; played++) oversized.add(moved({ ...freshProfile(), timePlayed: played, stars: tiers[tables.orders.types.oversized].stars }).join());
    expect([...oversized]).toEqual(['oversized,C']);
  });

  test("so does a Schwertransport's, in the Schwerlaster (#90)", () => {
    const t = quiet({ closed: 0, dropoff: 1 });
    const { tables, map } = ladder({ ...t, orders: { ...t.orders, shares: { schwertransport: 1 } } }, true);
    const moved = new Set();
    for (let played = 0; played < 20; played++) {
      const lorry = { ...freshProfile(), timePlayed: played, stars: tables.rank.tiers.at(-1).stars, vehicle: 'lorry', vehicles: { truck: {}, lorry: {} } };
      const sim = createSim(tables, map, seeded(1), lorry);
      loadAtoB(sim, map);
      timeUntil(sim, IDLE, () => sim.state.lastSurprise, 5);
      moved.add([sim.state.order.type, sim.state.order.dropoff].join());
    }
    expect([...moved]).toEqual(['schwertransport,C']);
  });

  test('the drop-off moves to a place of its kind where there is one (#86)', () => {
    const { tables, map } = ladder(quiet({ closed: 0, dropoff: 1 }), true, { A: 'depot', B: 'bakery', C: 'shop', D: 'bakery' });
    const seen = new Set();
    for (let played = 0; played < 20; played++) {
      const sim = createSim(tables, map, seeded(1), { ...freshProfile(), timePlayed: played });
      loadAtoB(sim, map);
      timeUntil(sim, IDLE, () => sim.state.lastSurprise, 5);
      seen.add(sim.state.order.dropoff);
    }
    expect([...seen]).toEqual(['D']); // C is nearer, but a shop
  });

  test('surprises come at the table chances, at most one per order', () => {
    const { tables, map } = ladder(quiet({ closed: 0.3, dropoff: 0.2 }));
    const sim = createSim(tables, map, seeded(2));
    const kinds = { closed: 0, dropoff: 0, none: 0 };
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const [offer] = sim.requestOffers();
      sim.acceptOrder(offer.id);
      kinds[sim.state.order.surprise?.kind ?? 'none']++;
      sim.state.order = null;
    }
    expect(kinds.closed / n).toBeCloseTo(0.3, 1);
    expect(kinds.dropoff / n).toBeCloseTo(0.2, 1);

    // Sprung once, it doesn't come again: the order keeps going to C and nothing more closes.
    const once = createSim({ ...tables, surprises: { ...tables.surprises, closed: 0, dropoff: 1 } }, map, seeded(1));
    loadAtoB(once, map);
    timeUntil(once, IDLE, () => once.state.lastSurprise, 5);
    const first = once.state.lastSurprise;
    drive(once, 10, IDLE);
    expect(once.state.lastSurprise).toBe(first);
    expect(once.state.order.dropoff).toBe('C');
  });
});
