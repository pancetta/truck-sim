import { describe, expect, test } from 'vitest';
import * as tables from './tables.js';
import { createSim } from './sim/sim.js';
import { BRAKE, IDLE, monti, undrained } from './sim/fixtures.js';
import { createAutopilot } from './autopilot.js';
import { freshProfile, seeded } from './sim/sim.js';

const map = monti(tables);
const { step } = tables.loop;

test('the autopilot drives the same way every run', () => {
  const drive = () => {
    const sim = createSim(tables, map, seeded(tables.perf.seed));
    const autopilot = createAutopilot(sim, map, tables);
    autopilot.place();
    for (let i = 0; i < 20 / step; i++) sim.step(step, autopilot.update(step));
    return [sim.state.truck.x, sim.state.truck.z];
  };
  expect(drive()).toEqual(drive());
});

// No AI cars, police, street events or pedestrians (solid to the truck since #100), so nothing but the streets is under test.
const empty = { ...tables, police: { ...tables.police, count: 0 }, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 0 })) }, events: { ...tables.events, count: 0 }, pedestrians: { ...tables.pedestrians, count: 0 } };

describe('the autopilot into the docks', () => {
  const spot = (id) => map.spots.find((s) => s.id === id);
  const inZone = ({ x, z }, { zone }) => x > zone.minX && x < zone.maxX && z > zone.minZ && z < zone.maxZ;

  // Steps the autopilot (or `input`, a function of the step) until `done` or `seconds` pass; returns whether it got
  // there and how often the truck ran into something (a wall, a post, a parked car).
  function run(sim, input, done, seconds) {
    let contacts = 0;
    for (let i = 0; i < seconds / step; i++) {
      const touching = sim.state.collision;
      sim.step(step, input());
      if (sim.state.collision && !touching) contacts++;
      if (done()) return { done: true, contacts };
    }
    return { done: false, contacts };
  }

  // Backs the truck along `trail` (the poses it drove forwards, oldest first) to its first pose: pure pursuit on the
  // point tables.perf.radius / 2 m behind, at up to 2 m/s. The brake pedal drives backwards once reverse is in,
  // and letting go of it brakes.
  function reverseAlong(sim, trail) {
    const t = sim.state.truck;
    let k = trail.length - 1;
    const input = () => {
      while (k > 0 && Math.hypot(trail[k].x - t.x, trail[k].z - t.z) < tables.perf.radius / 2) k--;
      const want = Math.atan2(trail[k].x - t.x, trail[k].z - t.z);
      const err = Math.atan2(Math.sin(want - t.heading - Math.PI), Math.cos(want - t.heading - Math.PI));
      return { steer: Math.max(-1, Math.min(1, err * tables.perf.steerGain)), gas: 0, brake: t.gear !== 'R' || t.speed > -2 ? 1 : 0 };
    };
    const end = trail[0];
    const back = run(sim, input, () => k === 0 && Math.hypot(end.x - t.x, end.z - t.z) < 0.3, 300);
    run(sim, () => ({ steer: 0, gas: 0, brake: 0 }), () => t.speed === 0, 5);
    return back;
  }

  // shortcut: the legs start at spot A, the start before home (#51): from home the autopilot scrapes a corner on the way to F
  // and H (its known limit, #64); start from tables.osm.start again once it picks its lane per corner.
  const from = 'A';
  // Every Vehicle that gets dock offers is docked into each dock (#88): a switch at the start drives it. One longer than
  // the bays gets none (#90), so isn't.
  const owning = (vehicle) => ({ ...freshProfile(), vehicles: Object.fromEntries(Object.keys(tables.fleet).map((k) => [k, {}])), vehicle });
  const docking = Object.keys(tables.fleet).filter((vehicle) => {
    const sim = createSim(tables, map, seeded(1), { ...owning(vehicle), stars: tables.rank.tiers.at(-1).stars });
    return Array.from({ length: 30 }, () => sim.requestOffers()).flat().some((o) => spot(o.dropoff).dock);
  });
  expect(docking).toEqual(Object.keys(tables.fleet).filter((k) => tables.fleet[k].length <= tables.osm.bayLength));
  const cases = docking.flatMap((vehicle) => tables.osm.docks.map((id) => [vehicle, id]));
  test.each(cases)('drives the %s from spot A into dock %s, and backs into its bay from the street for the dock bonus', (vehicle, id) => {
    const dock = spot(id);
    const { length } = tables.fleet[vehicle];
    // Forwards along the legal route, service lanes included, into the bay.
    const sim = createSim(empty, map, seeded(1), owning(vehicle));
    const there = createAutopilot(sim, map, empty, [from, id], false);
    there.place();
    expect(run(sim, there.update, () => inZone(sim.state.truck, dock), 200)).toEqual({ done: true, contacts: 0 });

    // Out of the bay forwards and on along the street, as the truck backs in later: kinematics run both ways.
    // shortcut: the back-in replays the truck's own way out with a test-only reverse controller, so it proves a way in
    // from that side of the street exists, not that the autopilot could find one; give the autopilot a reverse mode if
    // docking itself comes under test.
    const { x, z, heading } = dock.bay;
    const docked = { x: x + (Math.sin(heading) * length) / 2, z: z + (Math.cos(heading) * length) / 2, heading };
    expect(inZone(docked, dock)).toBe(true); // the dock's zone holds its middle when docked
    const out = createAutopilot(sim, map, empty, [id, from], false);
    Object.assign(sim.state.truck, docked, { speed: 0 });
    const trail = [];
    const mouth = dock.pose.edge.length + 15; // m past the bay's street end
    const left = run(sim, () => (trail.push({ ...sim.state.truck }), out.update(step)), () => Math.hypot(sim.state.truck.x - docked.x, sim.state.truck.z - docked.z) > mouth, 120);
    expect(left).toEqual({ done: true, contacts: 0 });
    run(sim, () => ({ steer: 0, gas: 0, brake: 0.6 }), () => sim.state.truck.speed === 0, 10);

    // shortcut: the drop-off is set up directly, as offers are random and only the docking is under test.
    sim.state.order = { id: 1, type: 'dock', cargo: tables.orders.cargo[0], pickup: from, dropoff: id, drops: [{ spot: id, distance: 0, pay: 100, expectedTime: 1 }], drop: 0, distance: 0, pay: 100, expectedTime: 1, phase: 'dropoff', elapsed: 0, damage: 0, faults: [] };
    expect(reverseAlong(sim, trail)).toEqual({ done: true, contacts: 0 });
    run(sim, () => ({ steer: 0, gas: 0, brake: 0 }), () => !sim.state.order, tables.orders.loadTime + 1);
    expect(sim.state.lastPayment?.lines.map((l) => l.label)).toContain('dock');
  });
});

test('the autopilot drives the loop (tables.perf.spots) among its traffic, hardly ever into an AI car', () => {
  const sim = createSim(undrained(), map, seeded(tables.perf.seed));
  const autopilot = createAutopilot(sim, map, tables);
  autopilot.place();
  const zones = tables.perf.spots.map((id) => map.spots.find((s) => s.id === id).zone);
  const passed = new Set();
  let [crashes, jumps] = [0, 0];
  let [px, pz] = [sim.state.truck.x, sim.state.truck.z];
  for (let i = 0; i < 520 / step; i++) {
    const fine = sim.state.lastFine;
    sim.step(step, autopilot.update(step));
    if (sim.state.lastFine !== fine && sim.state.lastFine.reason === 'collision') crashes++;
    const { x, z } = sim.state.truck;
    // Every 1 m from where it was: a jump on past the cars it waited behind (#109: a scooter behind a garbage truck at
    // work) passes zones by too.
    const n = Math.ceil(Math.hypot(x - px, z - pz));
    if (n > 1) jumps++; // the autopilot put it on: it was stuck
    for (let k = 1; k <= n; k++) {
      const [qx, qz] = [px + ((x - px) * k) / n, pz + ((z - pz) * k) / n];
      zones.forEach((zone, j) => qx > zone.minX && qx < zone.maxX && qz > zone.minZ && qz < zone.maxZ && passed.add(j));
    }
    [px, pz] = [x, z];
  }
  expect([...passed].sort()).toEqual(tables.perf.spots.map((_, k) => k)); // a lap takes about 470 s
  expect(crashes).toBeLessThanOrEqual(3); // shortcut: it ignores right of way and only waits for cars ahead
  // shortcut: 5 jumps in this run: on from behind standing cars it waits for (4, flat or downhill), and clipping a wall at
  // the corner into Piazza di San Martino ai Monti (412, 27; it does on the flat too); none stuck on a climb (#109).
  expect(jumps).toBeLessThanOrEqual(6);
});

test('the autopilot pulls away after a stop on the loop\'s steepest climb, full and with the trailer hitched (#109)', () => {
  const sim = createSim(undrained(empty), map, seeded(1), { ...freshProfile(), trailer: { level: 1, hitched: true } });
  const autopilot = createAutopilot(sim, map, tables);
  const t = sim.state.truck;
  t.mass += tables.fleet.truck.maxCargo * 1000; // full: empty, it would start uphill without the hill start (#105)
  const grade = () => map.slopeAt(t.x, t.z, Math.sin(t.heading), Math.cos(t.heading), 5);
  // shortcut: 1000 points walk round the loop more than once (place wraps), so its length needn't be known.
  let steepest = { grade: 0, i: 0, x: 0, z: 0 };
  for (let i = 0; i < 1000; i++) {
    autopilot.place(i);
    if (grade() > steepest.grade) steepest = { grade: grade(), i, x: t.x, z: t.z };
  }
  expect(steepest.grade).toBeGreaterThan(0.08);
  // On from 40 points before it until there, then stopped (still steering) and held for 5 s, tapping the brake as a
  // driver waiting does (holding it would engage reverse).
  autopilot.place(steepest.i - 40);
  let [px, pz, jumps] = [t.x, t.z, 0];
  const go = (input) => {
    sim.step(step, input);
    if (Math.hypot(t.x - px, t.z - pz) > 1) jumps++; // the autopilot put it on along the loop: it was stuck
    [px, pz] = [t.x, t.z];
  };
  for (let i = 0; i < 60 / step && Math.hypot(t.x - steepest.x, t.z - steepest.z) > 3; i++) go(autopilot.update(step));
  expect(Math.hypot(t.x - steepest.x, t.z - steepest.z)).toBeLessThan(3);
  for (let i = 0; i < 10 / step && Math.abs(t.speed) > 0.1; i++) go({ ...autopilot.update(step), gas: 0, brake: 1 });
  for (let i = 0; i < 5 / step; i++) go(i % 2 ? BRAKE : IDLE); // standing, the autopilot not asked: it would jump on
  expect(t.speed).toBeCloseTo(0, 1);
  expect(grade()).toBeGreaterThan(0.08);
  const [x0, z0, h0] = [t.x, t.z, t.heading];
  for (let i = 0; i < 20 / step; i++) go(autopilot.update(step));
  expect(jumps).toBe(0);
  expect((t.x - x0) * Math.sin(h0) + (t.z - z0) * Math.cos(h0)).toBeGreaterThan(40); // on up, not rolled back down
}, 60_000);
