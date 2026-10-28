import { describe, expect, test } from 'vitest';
import * as base from '../tables.js';
import { freshProfile } from './sim.js';
import { build, way, monti, createSim, seeded, vehiclesOverlap, DT, GAS, IDLE } from './fixtures.js';

// Zebra crossings (#79): placed by the map builder's rule, crossed by pedestrians, stopped at by AI cars and the truck.

const { classes } = base.osm;
const { back, depth } = base.zebras;
const CAR = base.city.obstacles.car;
const PERSON = { length: 2 * base.pedestrians.radius, width: 2 * base.pedestrians.radius };
const withTraffic = (n) => ({ ...base, police: { ...base.police, count: 0, radius: 1000 }, rank: { ...base.rank, tiers: base.rank.tiers.map((t) => ({ ...t, traffic: n })) } });
// `t` with `count` pedestrians that appear anywhere out of the truck's view and cross at every zebra they pass.
const crowd = (t, count = 40) => ({ ...t, pedestrians: { ...t.pedestrians, count, spawnDistance: [0, 400], despawnDistance: 450 }, zebras: { ...t.zebras, use: 1 } });
const onStrip = (q) => q.zebra >= 0 && !q.waiting;

// A T: Via A (tertiary) east–west, Vicolo (residential, lower) south from it and a service lane north.
const T = (vicolo = 90) => [way('tertiary', [[-90, 0], [0, 0], [90, 0]], { name: 'Via A' }), way('residential', [[0, 0], [0, vicolo]], { name: 'Vicolo' }), way('service', [[0, -90], [0, 0]])];

describe('zebra crossings: where the map builder puts them', () => {
  test('across a lower road class where it meets a higher one, back from the mouth; none on the higher road or a service lane', () => {
    const map = build(T());
    expect(map.zebras).toHaveLength(1);
    const [zebra] = map.zebras;
    expect(map.graph.edges[zebra.edge].name).toBe('Vicolo');
    expect(zebra.x).toBeCloseTo(0, 6);
    expect(zebra.z).toBeCloseTo(classes.tertiary.width / 2 + back, 6); // the mouth is the cross road's kerb
    const out = classes.residential.width / 2 + base.osm.pavement / 2;
    expect(zebra.kerbs.map(({ x, z }) => [x, z])).toEqual([[expect.closeTo(-out, 6), expect.closeTo(zebra.z, 6)], [expect.closeTo(out, 6), expect.closeTo(zebra.z, 6)]]);
  });

  test('across every arm of a light junction, between its stop line and the junction', () => {
    const map = build([way('tertiary', [[0, -90], [0, 0], [0, 90]], { name: 'Via B' }), way('tertiary', [[-90, 0], [0, 0], [90, 0]], { name: 'Via A' })]);
    expect(map.zebras).toHaveLength(4);
    for (const l of map.lights) {
      const zebra = map.zebras.find((q) => Math.abs((q.x - l.x) * l.dz - (q.z - l.z) * l.dx) < 1e-6); // on the light's road
      expect(Math.hypot(zebra.x, zebra.z) + depth / 2).toBeLessThan(Math.hypot(l.x, l.z)); // the stop line is farther out
    }
  });

  test('none where the roads are of one class, or on an arm too short for the strip', () => {
    expect(build([way('residential', [[-90, 0], [0, 0], [90, 0]]), way('residential', [[0, -90], [0, 0], [0, 90]])]).zebras).toEqual([]);
    expect(build(T(classes.tertiary.width / 2 + back + depth / 2 - 0.5)).zebras).toEqual([]);
  });

  test('on Monti they lie across the road, their kerbs on the pavement', () => {
    const map = monti();
    expect(map.zebras.length).toBeGreaterThan(10);
    for (const zebra of map.zebras) {
      const { width } = map.graph.edges[zebra.edge];
      for (const c of [zebra, ...zebra.strip]) expect(map.graph.project(map.graph.edges[zebra.edge], c.x, c.z).d).toBeLessThan(width / 2 + 0.3);
      for (const k of zebra.kerbs) expect(map.graph.nearest(k.x, k.z).d).toBeGreaterThan(width / 2);
    }
  });
});

describe('zebra crossings: pedestrians and AI cars', () => {
  test('cars stop for a pedestrian waiting or crossing, and pedestrians step out only in front of cars that have stopped', () => {
    // A crossroads of Via A (tertiary) and two lower residential arms, each with a zebra; busy with cars and people.
    const t = crowd({ ...withTraffic(8), traffic: { ...base.traffic, spawnDistance: [20, 500] } });
    const map = build([way('tertiary', [[-90, 0], [0, 0], [90, 0]], { name: 'Via A' }), way('residential', [[0, -90], [0, 0], [0, 90]])], t);
    expect(map.zebras).toHaveLength(2);
    const sim = createSim(t, map, seeded(3));
    Object.assign(sim.state.truck, { x: -80, z: -80, heading: 0 }); // off the road, out of the way
    const { zebras, traffic, pedestrians } = sim.state;
    // m from a car's centre along its zebra's road to the strip (negative on it), if the car is on that road heading in
    const toStrip = (c, zebra) => {
      const along = (c.x - zebra.x) * zebra.dx + (c.z - zebra.z) * zebra.dz;
      const across = (c.x - zebra.x) * -zebra.dz + (c.z - zebra.z) * zebra.dx;
      const heading = Math.sin(c.heading) * -Math.sign(along) * zebra.dx + Math.cos(c.heading) * -Math.sign(along) * zebra.dz;
      return Math.abs(across) < zebra.half && heading > 0.9 ? Math.abs(along) - depth / 2 - CAR.length / 2 : Infinity;
    };
    let [overlaps, setOuts, onCar, inFront] = [0, 0, 0, 0];
    const waiting = new Set();
    for (let s = 0; s < 240; s += DT) {
      sim.step(DT, IDLE);
      for (const q of pedestrians) {
        if (onStrip(q)) overlaps += traffic.filter((c) => vehiclesOverlap(c, CAR, { ...q, heading: 0 }, PERSON)).length;
        if (onStrip(q) && waiting.has(q.id)) {
          setOuts++;
          const zebra = zebras[q.zebra];
          onCar += traffic.filter((c) => toStrip(c, zebra) <= 0 && toStrip(c, zebra) > -depth - CAR.length).length;
        }
        if (onStrip(q)) inFront += traffic.some((c) => c.speed === 0 && toStrip(c, zebras[q.zebra]) > 0 && toStrip(c, zebras[q.zebra]) < 3) ? 1 : 0;
        if (q.zebra >= 0 && q.waiting) waiting.add(q.id);
        else waiting.delete(q.id);
      }
    }
    expect(overlaps).toBe(0);
    expect(onCar).toBe(0); // none sets out over a car on the strip
    expect(setOuts).toBeGreaterThan(10);
    expect(inFront).toBeGreaterThan(0); // steps someone crossed in front of a car standing at the strip
  }, 60_000);
});

describe('zebra crossings: the truck', () => {
  const map = build(T());
  const [zebra] = map.zebras;
  // The truck standing in Vicolo's northbound lane, its front bumper `gap` m short of the strip.
  const before = (gap) => ({ x: classes.residential.lane, z: zebra.z + depth / 2 + gap + base.vehicle.length / 2, heading: Math.PI, speed: 0 });

  // Waits with the truck standing 4 m short of the strip until a pedestrian is a metre out on it (if `crossing`), then
  // drives through, with a police car coming along Via A (if `witness`), which sees it. Returns the fines taken, the
  // steps a pedestrian overlapped the truck, the ones on the strip as the truck entered it and the ones of those that
  // reached a kerb while it was on the strip.
  function pass(t, { crossing = true, witness = true } = {}) {
    const sim = createSim(t, map, seeded(1), { ...freshProfile(), money: 1000 });
    Object.assign(sim.state.truck, before(4));
    const { pedestrians, truck } = sim.state;
    for (let s = 0; s < 120 && crossing && !pedestrians.some((q) => onStrip(q) && q.t > 1); s += DT) sim.step(DT, IDLE);
    if (crossing) expect(pedestrians.some(onStrip)).toBe(true);
    const run = map.graph.paths.find((p) => p.kind === 'run' && p.startDir.x > 0 && p.prims[0].x < -50);
    if (witness) sim.state.traffic.push({ id: 99, x: 0, z: 0, heading: 0, speed: 0, lane: run, route: [run], s: 0, police: true });
    let [fines, overlaps, entered] = [[], 0, null];
    const kerbed = new Set();
    for (let s = 0; s < 20 && truck.z > zebra.z - depth / 2 - base.vehicle.length / 2; s += DT) {
      const last = sim.state.lastFine;
      sim.step(DT, GAS);
      if (sim.state.lastFine !== last) fines.push(sim.state.lastFine.reason);
      overlaps += pedestrians.filter((q) => vehiclesOverlap(q, PERSON, truck, base.vehicle)).length;
      if (!entered && truck.z - base.vehicle.length / 2 < zebra.z + depth / 2) entered = pedestrians.filter(onStrip);
      for (const q of entered ?? []) if (!onStrip(q)) kerbed.add(q);
    }
    return { fines, overlaps, entered, kerbed, through: truck.z < zebra.z - depth / 2 - base.vehicle.length / 2 };
  }

  test('entering a zebra a pedestrian is on, with a Witness, is one fine per pass; the pedestrian steps back off the strip', () => {
    const { fines, overlaps, entered, kerbed, through } = pass(crowd(withTraffic(0)));
    expect(through).toBe(true);
    expect(fines).toEqual(['zebra']);
    expect(overlaps).toBe(0);
    expect(entered.length).toBeGreaterThan(0);
    expect(entered.every((q) => kerbed.has(q))).toBe(true); // each back at a kerb (or over, away from the truck) before it was through
  }, 30_000);

  test('no fine without a Witness, and none driving over an empty zebra', () => {
    const unseen = pass(crowd(withTraffic(0)), { witness: false });
    expect(unseen.fines).toEqual([]);
    expect(unseen.overlaps).toBe(0);
    const empty = pass({ ...withTraffic(0), pedestrians: { ...base.pedestrians, count: 0 } }, { crossing: false });
    expect(empty.through).toBe(true);
    expect(empty.fines).toEqual([]);
  }, 30_000);

  test('the HUD hint: a zebra ahead within the hint distance', () => {
    const t = { ...withTraffic(0), pedestrians: { ...base.pedestrians, count: 0 } };
    const ahead = (pose) => {
      const sim = createSim(t, map, seeded(1));
      Object.assign(sim.state.truck, pose);
      sim.step(DT, IDLE);
      return sim.state.zebraAhead;
    };
    expect(ahead(before(10))).toBe(true);
    expect(ahead({ ...before(10), heading: 0 })).toBe(false); // driving away from it
    expect(ahead(before(base.signs.hint + 5))).toBe(false);
  });
});
