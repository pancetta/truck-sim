import { describe, expect, test } from 'vitest';
import * as base from '../tables.js';
import { freshProfile } from './sim.js';
import { DT, GAS, IDLE, createSim, lane, seeded } from './fixtures.js';

// Pedestrians and the truck on the pavement (#100): they jump out of its way, one with nowhere to go stops it, and
// driving onto the pavement at them costs the clean Star, and a fine with a Witness.

const { width } = base.osm.classes.residential;
const kerb = width / 2; // Vicolo's west kerb is at x = -kerb, its wall at -(kerb + pavement)
const truck = base.fleet.truck;
// Whether pedestrian `q` (base.pedestrians.radius round) overlaps the footprint of `size` at `pose`.
const overlap = (q, { x, z, heading }, size) => {
  const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
  const along = Math.max(0, Math.abs((q.x - x) * fx + (q.z - z) * fz) - size.length / 2);
  const right = Math.max(0, Math.abs(-(q.x - x) * fz + (q.z - z) * fx) - size.width / 2);
  return Math.hypot(along, right) < base.pedestrians.radius - 1e-6;
};
// `t` with `count` pedestrians that appear anywhere out of the truck's view and stay, a police car that sees from
// anywhere, and no AI traffic.
const crowd = (t, count = 40) => ({
  ...t,
  pedestrians: { ...t.pedestrians, count, spawnDistance: [0, 400], despawnDistance: 450 },
  police: { ...t.police, count: 0, radius: 1000 },
  rank: { ...t.rank, tiers: t.rank.tiers.map((tier) => ({ ...tier, traffic: 0 })) },
});
const CRUISE = 3; // m/s

// A Sim on the lane with a crowd that has spread along both pavements, its truck then put at the north end facing
// south (+z), `onto` m of its right side (west) over the kerb, with an order on, standing a second.
function onPavement(onto, { t = base, profile = freshProfile(), witness = false } = {}) {
  const { t: spots, map } = lane(crowd(t));
  const sim = createSim(spots, map, seeded(1), { ...profile, money: 1000 });
  sim.acceptOrder(sim.requestOffers()[0].id);
  for (let s = 0; s < 40; s += DT) sim.step(DT, IDLE);
  Object.assign(sim.state.truck, { x: -kerb - onto + truck.width / 2, z: -20, heading: 0, speed: 0 });
  const { hitch, drawbar, length } = base.trailer;
  if (sim.state.trailer) Object.assign(sim.state.trailer, { x: sim.state.truck.x, z: -20 - hitch - drawbar - length / 2, heading: 0 }); // straight behind
  if (witness) {
    const run = map.graph.paths.find((p) => p.kind === 'run' && p.startDir.z < 0); // northbound, the east lane
    sim.state.traffic.push({ id: 99, x: run.prims[0].x, z: run.prims[0].z, heading: Math.PI, speed: 0, lane: run, route: [run], s: 0, police: true });
  }
  for (let s = 0; s < 1; s += DT) sim.step(DT, IDLE); // the ones it was put on get out from under it
  return sim;
}

// Drives the truck south at CRUISE for `seconds` with `steer`, and counts the steps a pedestrian overlapped it or its
// trailer, the pedestrians that stepped aside, the fines taken and whether it was stopped.
function cruise(sim, seconds, steer = 0) {
  const { pedestrians, truck: pose } = sim.state;
  const trailerSize = { length: base.trailer.length, width: base.trailer.width };
  let [overlaps, fines, stopped] = [0, [], false];
  const aside = new Set();
  for (let s = 0; s < seconds; s += DT) {
    const last = sim.state.lastFine;
    sim.step(DT, { ...(pose.speed < CRUISE ? GAS : IDLE), steer });
    if (sim.state.lastFine !== last) fines.push(sim.state.lastFine.reason);
    stopped ||= sim.state.collision;
    for (const q of pedestrians) {
      if (overlap(q, pose, truck)) overlaps++;
      if (sim.state.trailer && overlap(q, sim.state.trailer, trailerSize)) overlaps++;
      if (Math.hypot(q.asideX, q.asideZ) > 0.2) aside.add(q.id);
    }
  }
  return { overlaps, aside: aside.size, fines, stopped, faults: sim.state.order.faults };
}

describe('pedestrians and the truck on the pavement (#100)', () => {
  test('they jump out of its way and never overlap it', () => {
    const sim = onPavement(1);
    const { overlaps, aside, stopped } = cruise(sim, 14);
    expect(aside).toBeGreaterThan(2);
    expect(overlaps).toBe(0);
    expect(stopped).toBe(false);
    expect(sim.state.truck.z).toBeGreaterThan(15); // it got through
  }, 30_000);

  test('nor its trailer', () => {
    const sim = onPavement(1, { profile: { ...freshProfile(), stars: base.rank.tiers.at(-1).stars, trailer: { level: 1, hitched: true } } });
    expect(sim.state.trailer).not.toBeNull();
    const { overlaps, aside } = cruise(sim, 14);
    expect(aside).toBeGreaterThan(2);
    expect(overlaps).toBe(0);
    expect(sim.state.truck.z).toBeGreaterThan(15);
  }, 30_000);

  test('one with nowhere to go, pinned between it and the wall, stops it, as something solid, without a Contact', () => {
    const sim = onPavement(1); // half a metre between its side and the wall
    const { truck: pose, pedestrians } = sim.state;
    const wall = -(kerb + base.osm.pavement);
    const beside = (q) => Math.abs(q.z - pose.z) < truck.length / 2 - 1 && q.x < pose.x - truck.width / 2;
    for (let s = 0; s < 60 && !pedestrians.some(beside); s += DT) sim.step(DT, IDLE);
    expect(pedestrians.some(beside)).toBe(true);
    const { overlaps, stopped } = cruise(sim, 3, 1); // turning towards the wall
    expect(stopped).toBe(true);
    expect(overlaps).toBe(0);
    expect(pedestrians.some((q) => q.stuck)).toBe(true);
    const [fx, fz] = [Math.sin(pose.heading), Math.cos(pose.heading)];
    const westmost = Math.min(...[1, -1].map((f) => pose.x + (fx * f * truck.length - fz * truck.width) / 2));
    expect(westmost).toBeGreaterThan(wall + 0.05); // they stopped it, not the wall
    expect(sim.state.profile.money).toBe(1000);
  }, 30_000);

  test('driving at them on the pavement costs the clean Star; with a Witness it is a fine too', () => {
    const seen = cruise(onPavement(1, { witness: true }), 14);
    expect(seen.faults).toEqual(['pedestrian']);
    expect(seen.fines.length).toBeGreaterThan(0);
    expect(new Set(seen.fines)).toEqual(new Set(['pedestrian']));

    const unseen = cruise(onPavement(1), 14);
    expect(unseen.faults).toEqual(['pedestrian']);
    expect(unseen.fines).toEqual([]);
  }, 30_000);

  test('driving past them in the lane costs nothing, and nobody jumps', () => {
    const sim = onPavement(-(kerb - base.osm.classes.residential.lane - truck.width / 2), { witness: true }); // in its lane
    expect(sim.state.truck.x).toBeCloseTo(-base.osm.classes.residential.lane, 6);
    const { faults, fines, aside } = cruise(sim, 14);
    expect(faults).toEqual([]);
    expect(fines).toEqual([]);
    expect(aside).toBe(0);
  }, 30_000);
});
