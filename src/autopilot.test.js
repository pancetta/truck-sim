import { describe, expect, test } from 'vitest';
import * as tables from './tables.js';
import { createSim } from './sim/sim.js';
import { monti } from './sim/fixtures.js';
import { createAutopilot, seeded } from './autopilot.js';

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

describe('the autopilot into the docks', () => {
  // No AI cars or police, so nothing but the streets is under test.
  const empty = { ...tables, police: { ...tables.police, count: 0 }, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 0 })) } };
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

  test.each(tables.osm.docks)('drives from the start spot into dock %s, and backs into its bay from the street for the dock bonus', (id) => {
    const dock = spot(id);
    // Forwards along the legal route, service lanes included, into the bay.
    const sim = createSim(empty, map, seeded(1));
    const there = createAutopilot(sim, map, empty, [tables.osm.start, id], false);
    there.place();
    expect(run(sim, there.update, () => inZone(sim.state.truck, dock), 200)).toEqual({ done: true, contacts: 0 });

    // Out of the bay forwards and on along the street, as the truck backs in later: kinematics run both ways.
    // shortcut: the back-in replays the truck's own way out with a test-only reverse controller, so it proves a way in
    // from that side of the street exists, not that the autopilot could find one; give the autopilot a reverse mode if
    // docking itself comes under test.
    const { x, z, heading } = dock.bay;
    const docked = { x: x + (Math.sin(heading) * tables.vehicle.length) / 2, z: z + (Math.cos(heading) * tables.vehicle.length) / 2, heading };
    const out = createAutopilot(sim, map, empty, [id, tables.osm.start], false);
    Object.assign(sim.state.truck, docked, { speed: 0 });
    const trail = [];
    const mouth = dock.pose.edge.length + 15; // m past the bay's street end
    const left = run(sim, () => (trail.push({ ...sim.state.truck }), out.update(step)), () => Math.hypot(sim.state.truck.x - docked.x, sim.state.truck.z - docked.z) > mouth, 120);
    expect(left).toEqual({ done: true, contacts: 0 });
    run(sim, () => ({ steer: 0, gas: 0, brake: 0.6 }), () => sim.state.truck.speed === 0, 10);

    // shortcut: the drop-off is set up directly, as offers are random and only the docking is under test.
    sim.state.order = { id: 1, type: 'dock', cargo: tables.orders.cargo[0], pickup: tables.osm.start, dropoff: id, distance: 0, pay: 100, expectedTime: 1, phase: 'dropoff', elapsed: 0, damage: 0 };
    expect(reverseAlong(sim, trail)).toEqual({ done: true, contacts: 0 });
    run(sim, () => ({ steer: 0, gas: 0, brake: 0 }), () => !sim.state.order, tables.orders.loadTime + 1);
    expect(sim.state.lastPayment?.lines.map((l) => l.label)).toContain('dock');
  });
});

test('the autopilot drives the loop (tables.perf.spots) among its traffic, hardly ever into an AI car', () => {
  const sim = createSim(tables, map, seeded(tables.perf.seed));
  const autopilot = createAutopilot(sim, map, tables);
  autopilot.place();
  const zones = tables.perf.spots.map((id) => map.spots.find((s) => s.id === id).zone);
  const passed = new Set();
  let crashes = 0;
  for (let i = 0; i < 520 / step; i++) {
    const fine = sim.state.lastFine;
    sim.step(step, autopilot.update(step));
    if (sim.state.lastFine !== fine && sim.state.lastFine.reason === 'collision') crashes++;
    const { x, z } = sim.state.truck;
    zones.forEach((zone, k) => x > zone.minX && x < zone.maxX && z > zone.minZ && z < zone.maxZ && passed.add(k));
  }
  expect([...passed].sort()).toEqual(tables.perf.spots.map((_, k) => k)); // a lap takes about 470 s
  expect(crashes).toBeLessThanOrEqual(3); // shortcut: it ignores right of way and only waits for cars ahead
});
