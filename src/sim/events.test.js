import { describe, expect, test } from 'vitest';
import * as base from '../tables.js';
import { way, build, withSpots, createSim, monti, undrained, drive, timeUntil, seeded, DT, GAS, IDLE } from './fixtures.js';

// Street events (#80): their schedule, routes and AI cars round a closed edge, its barriers, and garbage trucks.

// Without police cars, zebra crossings in use or AI cars, unless a test asks for them.
const quiet = { ...base, police: { ...base.police, count: 0 }, zebras: { ...base.zebras, use: 0 } };
const cars = (n, t = quiet) => ({ ...t, rank: { ...t.rank, tiers: t.rank.tiers.map((tier) => ({ ...tier, traffic: n })) } });
// One event at a time, the first after `first` s, of the `kinds` given ({ kind: [least, most] s}); anywhere but on the
// truck's own lines of view (traffic.spawnView, which the AI cars' spawning uses too).
const events = (t, kinds, first = 5) => ({
  ...t,
  traffic: { ...t.traffic, spawnView: 0.01 },
  events: { ...t.events, count: 1, every: [first, first], hidden: 0, kinds: Object.fromEntries(Object.entries(kinds).map(([k, d]) => [k, { weight: 1, duration: d }])) },
});

// A ladder: two residential streets 80 m apart (north at z -40, south at z 40) from x -80 to 80, joined at the ends and
// by a middle rung along x 0 (edge M), whose two junctions are the map's only ones, so M is the one edge a market or
// roadworks may close. A is on the north street and B on the south one, 10 m west of the rung: A to B is 100 m by M
// and 220 m round the west end.
function ladder(t) {
  const north = way('residential', [[-80, -40], [0, -40], [80, -40]], { name: 'Nord' });
  const south = way('residential', [[-80, 40], [0, 40], [80, 40]], { name: 'Süd' });
  const ways = [north, south, way('residential', [[-80, -40], [-80, 40]]), way('residential', [[80, -40], [80, 40]]), way('residential', [[0, -40], [0, 40]])];
  const spots = [
    { id: 'A', name: 'Nord', street: 'Nord', way: north.id, at: 70, side: 'right' },
    { id: 'B', name: 'Süd', street: 'Süd', way: south.id, at: 70, side: 'right' },
  ];
  const tables = withSpots(spots, [], null, t);
  const map = build(ways, tables);
  const M = map.graph.edges.find((e) => e.points.every((p) => p.x === 0)).id;
  return { tables, map, M };
}
// The truck on the west end's street, facing south a little off its line (off the rung's), far from the rung.
const westEnd = { x: -80, z: -20, heading: 0.05, speed: 0 };
// The edge ids a car is on, turning into, or plans to drive.
const edgesOf = (car) => car.route.map((p) => (p.kind === 'run' ? p.edge : p.out.edge).id);
// Whether the route (a polyline) passes within 5 m of (x, z).
const passes = (route, x, z) =>
  route.slice(1).some((b, i) => {
    const a = route[i];
    const l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / l2)) : 0;
    return Math.hypot(a.x + t * (b.x - a.x) - x, a.z + t * (b.z - a.z) - z) < 5;
  });

describe('Sim: street events (#80)', () => {
  test('events open and close on a seeded schedule: no more at once than the tables allow, each as long as they say', () => {
    const t = {
      ...cars(8, undrained(quiet)),
      events: { ...base.events, every: [5, 15], kinds: { market: { weight: 1, duration: [20, 40] }, roadworks: { weight: 1, duration: [20, 40] }, garbage: { weight: 2, duration: [10, 20] } } },
    };
    const map = monti(t);
    const run = () => {
      const sim = createSim(t, map, seeded(1));
      const log = new Map(); // event id → { kind, edge, from, to }
      let most = 0;
      for (let i = 1; i <= 400 / DT; i++) {
        sim.step(DT, IDLE);
        most = Math.max(most, sim.state.events.length);
        for (const x of sim.state.events) if (!log.has(x.id)) log.set(x.id, { kind: x.kind, edge: x.edge, from: i * DT });
        for (const [id, x] of log) if (x.to === undefined && !sim.state.events.some((e) => e.id === id)) x.to = i * DT;
      }
      return { log: [...log.values()], most };
    };
    const { log, most } = run();

    expect(most).toBeLessThanOrEqual(2);
    expect(new Set(log.map((x) => x.kind))).toEqual(new Set(['market', 'roadworks', 'garbage']));
    for (const x of log.filter((x) => x.to !== undefined)) {
      const [least, longest] = t.events.kinds[x.kind].duration;
      expect(x.to - x.from).toBeGreaterThanOrEqual(least - 2 * DT);
      expect(x.to - x.from).toBeLessThanOrEqual(longest + 2 * DT);
    }
    expect(run().log).toEqual(log); // the same seed, the same schedule
  }, 60_000);

  test('the route and offers go round a closed edge, and the route is found again when it closes', () => {
    const { tables, map, M } = ladder(events(cars(0), { market: [600, 600] }, 10));
    const sim = createSim(tables, map, seeded(1));
    // Facing north on the west end's street, the truck comes to A heading east, towards the rung (#99).
    Object.assign(sim.state.truck, { ...westEnd, heading: Math.PI + 0.05 });
    const spot = (id) => map.spots.find((s) => s.id === id);
    let before;
    for (let i = 0; i < 20 && !before?.length; i++) before = sim.requestOffers().filter((o) => o.pickup === 'A');
    expect(before.every((o) => o.distance < 110)).toBe(true); // by M
    // Loaded at A, a little off the rung's line, before the market comes.
    const [offer] = before;
    sim.acceptOrder(offer.id);
    const zone = spot(offer.pickup).zone;
    Object.assign(sim.state.truck, { x: (zone.minX + zone.maxX) / 2, z: (zone.minZ + zone.maxZ) / 2, heading: Math.PI / 2 + 0.05, speed: 0 });
    drive(sim, tables.orders.loadTime + 0.5, IDLE);
    expect(sim.state.order.phase).toBe('dropoff');
    expect(sim.state.closed.size).toBe(0);
    expect(passes(sim.state.route, 0, 0)).toBe(true);

    timeUntil(sim, IDLE, () => sim.state.closed.size > 0, 20);
    expect([...sim.state.closed]).toEqual([M]);
    expect(passes(sim.state.route, 0, 0)).toBe(false);
    expect(passes(sim.state.route, 80, 0)).toBe(true); // on round the east end, not back round the west (#99)

    sim.state.order = null; // no order, so offers come again
    expect(sim.requestOffers().every((o) => o.distance > 200)).toBe(true);
  });

  test("a closed edge's barriers go up once the truck is off it, and stop it there", () => {
    const { tables, map, M } = ladder(events(cars(0), { roadworks: [600, 600] }));
    const sim = createSim(tables, map, seeded(1));
    Object.assign(sim.state.truck, westEnd);
    timeUntil(sim, IDLE, () => sim.state.events[0]?.on, 20);
    const [x] = sim.state.events;
    expect(x).toMatchObject({ kind: 'roadworks', edge: M, on: true });

    // From the north junction's box, straight down the rung: the barrier stands where the box ends, plus `back`.
    const node = map.graph.nodes[map.graph.edges[M].from];
    Object.assign(sim.state.truck, { x: 0, z: -40 - 4, heading: 0, speed: 0 });
    drive(sim, 4, GAS);
    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.z + tables.fleet.truck.length / 2).toBeLessThan(-40 + node.radius + tables.events.back);
  });

  // Two-wheelers among them (#102), at more than the tables' share.
  const mixed = { ...quiet, traffic: { ...quiet.traffic, twoWheelers: { scooter: { ...quiet.traffic.twoWheelers.scooter, share: 0.3 }, bicycle: { ...quiet.traffic.twoWheelers.bicycle, share: 0.3 } } } };
  test('AI cars never turn into a closed edge nor appear on it, and the ones on it as it closes drive out; two-wheelers too', () => {
    const { tables, map, M } = ladder(events(cars(8, mixed), { market: [600, 600] }));
    const sim = createSim(tables, map, seeded(3));
    Object.assign(sim.state.truck, westEnd);
    timeUntil(sim, IDLE, () => sim.state.closed.size > 0, 20);
    // The cars on M, turning into it or too close to stop before it as it closes.
    const committed = new Set(sim.state.traffic.filter((c) => edgesOf(c).includes(M)).map((c) => c.id));
    expect(committed.size).toBeGreaterThan(0);
    const strays = new Set();
    let turns = 0;
    for (let i = 0; i < 60 / DT; i++) {
      const lanes = new Map(sim.state.traffic.map((c) => [c.id, c.lane]));
      sim.step(DT, IDLE);
      for (const c of sim.state.traffic) {
        if (!committed.has(c.id) && edgesOf(c).includes(M)) strays.add(c.id);
        if (lanes.has(c.id) && lanes.get(c.id) !== c.lane && c.lane.kind === 'turn') turns++;
      }
    }

    expect([...strays]).toEqual([]);
    expect(sim.state.traffic.filter((c) => edgesOf(c).includes(M))).toEqual([]);
    expect(sim.state.events[0].on).toBe(true);
    expect(turns).toBeGreaterThan(10); // the others kept driving round
    expect(new Set(sim.state.traffic.map((c) => c.kind)).size).toBeGreaterThan(1);
  });

  test('a garbage truck holds the car behind it while it stands, both drive on after, and the truck passes it', () => {
    const { tables, map } = ladder(events(cars(0), { garbage: [15, 15] }, 1));
    const sim = createSim(tables, map, seeded(1));
    Object.assign(sim.state.truck, westEnd);
    timeUntil(sim, IDLE, () => sim.state.traffic.length > 0, 5);
    const [garbage] = sim.state.traffic;
    expect(garbage.kind).toBe('garbage');
    // A car coming up behind it in its lane.
    const car = { id: 999, kind: 'car', x: 0, z: 0, heading: 0, speed: 0, lane: garbage.lane, route: [garbage.lane], s: garbage.s - 20, police: false };
    sim.state.traffic.push(car);
    // The truck behind it in the other lane, passing.
    const h = garbage.heading;
    const [fx, fz] = [Math.sin(h), Math.cos(h)];
    const side = 2 * map.graph.edges[garbage.lane.edge.id].laneOffset; // left of the way is (cos h, -sin h)
    Object.assign(sim.state.truck, { x: garbage.x - fx * 15 + Math.cos(h) * side, z: garbage.z - fz * 15 - Math.sin(h) * side, heading: h, speed: 0 });
    let hit = false;
    for (let t = 0; t < 6; t += DT) {
      sim.step(DT, GAS);
      hit ||= sim.state.collision;
    }
    expect(hit).toBe(false);
    expect((sim.state.truck.x - garbage.x) * fx + (sim.state.truck.z - garbage.z) * fz).toBeGreaterThan(10);

    drive(sim, 6, IDLE);
    expect(garbage.speed).toBe(0);
    expect(car.speed).toBe(0);
    const gap = garbage.s - car.s - tables.city.obstacles.car.length;
    expect(gap).toBeGreaterThan(tables.traffic.followGap - 0.5);
    expect(gap).toBeLessThan(tables.traffic.followGap + 2);

    const [g0, c0] = [garbage.s, car.s];
    drive(sim, 10, IDLE);
    expect(garbage.s - g0).toBeGreaterThan(5);
    expect(car.s - c0).toBeGreaterThan(5);
  });
});
