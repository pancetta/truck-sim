import { expect, test } from 'vitest';
import { getHeapStatistics } from 'node:v8';
import * as base from '../tables.js';
import { createSim } from './sim.js';
import { createTraffic } from './traffic.js';
import { createAutopilot, seeded } from '../autopilot.js';
import { monti, undrained } from './fixtures.js';

// Bench (#31): the traffic step at 100 cars, on the ?perf&auto drive round Monti. The spawn ring is widened to 400 m, as
// in docs/perf/2026-10-baseline.md, so the city holds that many.
// shortcut: the thresholds catch a return to the O(n²), allocating step (1.6 ms and 5.4 MB per step on an idle
// M2 before #31, 0.08 ms and 14 KB after), not small regressions. The time is the fastest of five batches, so a
// loaded machine or CI runner doesn't fail it.
// shortcut: total_allocated_bytes is Node 26+; under older Node (CI runs 24) only the time is checked. Drop the
// guard once CI's Node has it.
const allocated = () => getHeapStatistics().total_allocated_bytes;
const tables = { ...undrained(base), traffic: { ...base.traffic, spawnDistance: [45, 400], despawnDistance: 450 } };
const map = monti(tables);
const { step } = tables.loop;

// The truck and lights of the autopilot's loop, step by step, replayed below against 100 cars of their own.
function drive(steps) {
  const sim = createSim(tables, map, seeded(tables.perf.seed));
  const autopilot = createAutopilot(sim, map, tables);
  sim.requestOffers();
  sim.acceptOrder(sim.state.offers[0].id);
  autopilot.place();
  const frames = [];
  for (let i = 0; i < steps; i++) {
    sim.step(step, autopilot.update(step));
    frames.push({ truck: { ...sim.state.truck }, phases: sim.state.lights.map((l) => l.phase) });
  }
  return { frames, lights: sim.state.lights.map((l) => ({ ...l })) };
}

// The traffic step at 100 cars, replaying `frames` (truck and light phases per step) against `lights`.
function bench(frames, lights) {
  const traffic = createTraffic(tables, map, seeded(1));
  const truck = { ...frames[0].truck };
  const held = new Set();
  const play = (i) => {
    Object.assign(truck, frames[i].truck);
    for (let k = 0; k < lights.length; k++) lights[k].phase = frames[i].phases[k];
    traffic.step(step, truck, lights, 100, held);
  };
  // Fills the city and warms up the JIT; new cars need `lookAhead` of room, so filling takes a while.
  for (let i = 0; i < 1000; i++) play(i);
  expect(traffic.cars.length).toBeGreaterThan(90);

  const before = allocated();
  let ms = Infinity;
  for (let i = 1000; i < 1800; i += 160) {
    const t0 = performance.now();
    for (let k = i; k < i + 160; k++) play(k);
    ms = Math.min(ms, (performance.now() - t0) / 160);
  }
  const bytes = (allocated() - before) / 800;
  console.info(`traffic step, ${traffic.cars.length} cars: ${(ms * 1000).toFixed(1)} µs (fastest batch), ${Math.round(bytes)} B allocated`);
  expect(ms).toBeLessThan(1);
  if (before !== undefined) expect(bytes).toBeLessThan(32 * 1024); // 5.4 MB per step before #31
}

test('the traffic step at 100 cars is fast and allocates next to nothing', () => {
  const { frames, lights } = drive(1800);
  bench(frames, lights);
});
