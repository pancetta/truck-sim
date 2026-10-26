import { expect, test } from 'vitest';
import { getHeapStatistics } from 'node:v8';
import * as base from '../tables.js';
import { createSim } from './sim.js';
import { createTraffic } from './traffic.js';
import { parseMap } from './map.js';
import city from '../city.txt?raw';
import { createAutopilot, seeded } from '../autopilot.js';

// Bench (#31): the traffic step at 100 cars, on the ?perf&auto drive. The spawn ring is widened to 400 m, as
// in docs/perf/2026-10-baseline.md, so the city holds that many.
// shortcut: the thresholds are generous so slow CI runners pass; they catch a return to the O(n²), allocating
// step (1.6 ms and 5.4 MB per step here before #31), not small regressions.
// shortcut: total_allocated_bytes is Node 26+; under older Node (CI runs 24) only the time is checked. Drop the
// guard once CI's Node has it.
const allocated = () => getHeapStatistics().total_allocated_bytes;
const tables = { ...base, traffic: { ...base.traffic, spawnDistance: [45, 400], despawnDistance: 450 } };
const map = parseMap(city, tables);
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

test('the traffic step at 100 cars is fast and allocates next to nothing', () => {
  const { frames, lights } = drive(1400);
  const traffic = createTraffic(tables, map, seeded(1));
  const truck = { ...frames[0].truck };
  const held = new Set();
  const play = (i) => {
    Object.assign(truck, frames[i].truck);
    for (let k = 0; k < lights.length; k++) lights[k].phase = frames[i].phases[k];
    traffic.step(step, truck, lights, 100, held);
  };
  for (let i = 0; i < 600; i++) play(i); // fills the city and warms up the JIT
  expect(traffic.cars.length).toBeGreaterThan(90);

  const before = allocated();
  const t0 = performance.now();
  for (let i = 600; i < 1400; i++) play(i);
  const ms = (performance.now() - t0) / 800;
  const bytes = (allocated() - before) / 800;
  console.info(`traffic step, ${traffic.cars.length} cars: ${(ms * 1000).toFixed(1)} µs, ${Math.round(bytes)} B allocated`);
  expect(ms).toBeLessThan(0.26); // the whole Sim step at 100 cars in the baseline
  if (before !== undefined) expect(bytes).toBeLessThan(32 * 1024); // 5.4 MB per step before #31
});
