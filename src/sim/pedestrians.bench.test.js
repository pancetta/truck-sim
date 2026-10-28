import { expect, test } from 'vitest';
import { getHeapStatistics } from 'node:v8';
import * as base from '../tables.js';
import { createSim, seeded } from './sim.js';
import { createPedestrians } from './pedestrians.js';
import { createAutopilot } from '../autopilot.js';
import { monti, undrained } from './fixtures.js';

// Bench (#78), beside the traffic bench: the pedestrian step at 300 people (five times tables.pedestrians.count), on the
// ?perf&auto drive round Monti, with the spawn ring widened to 400 m so the city holds that many.
// shortcut: the thresholds catch an allocating or O(n²) step, not small regressions; time and bytes are the least of
// five batches, so a loaded machine doesn't fail it. Only a new pedestrian allocates (about 100 B, under one a step),
// but V8 counts a few hundred B a step of its own here; an object per pedestrian per step would be 15 KB and more.
// total_allocated_bytes is Node 26+, as in the traffic bench.
const allocated = () => getHeapStatistics().total_allocated_bytes;
const tables = { ...undrained(base), pedestrians: { ...base.pedestrians, spawnDistance: [30, 400], despawnDistance: 450 } };
const map = monti(tables);
const { step } = tables.loop;

test('the pedestrian step at 300 people is fast and allocates next to nothing', () => {
  // The truck of the autopilot's loop, step by step.
  const sim = createSim(tables, map, seeded(tables.perf.seed));
  const autopilot = createAutopilot(sim, map, tables);
  sim.requestOffers();
  sim.acceptOrder(sim.state.offers[0].id);
  autopilot.place();
  const trucks = [];
  for (let i = 0; i < 1800; i++) {
    sim.step(step, autopilot.update(step));
    trucks.push({ ...sim.state.truck });
  }

  const pedestrians = createPedestrians(tables, map, seeded(1));
  for (let i = 0; i < 1000; i++) pedestrians.step(step, trucks[i], 300); // fills the city, one a step, and warms up the JIT
  expect(pedestrians.people).toHaveLength(300);
  let [ms, bytes] = [Infinity, Infinity];
  for (let i = 1000; i < 1800; i += 160) {
    const [t0, b0] = [performance.now(), allocated()];
    for (let k = i; k < i + 160; k++) pedestrians.step(step, trucks[k], 300);
    [ms, bytes] = [Math.min(ms, (performance.now() - t0) / 160), Math.min(bytes, (allocated() - b0) / 160)];
  }
  console.info(`pedestrian step, ${pedestrians.people.length} people: ${(ms * 1000).toFixed(1)} µs, ${Math.round(bytes)} B allocated (least batch)`);
  expect(ms).toBeLessThan(0.1);
  if (!Number.isNaN(bytes)) expect(bytes).toBeLessThan(4096);
});
