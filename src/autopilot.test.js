import { expect, test } from 'vitest';
import * as tables from './tables.js';
import { createSim } from './sim/sim.js';
import { parseMap } from './sim/map.js';
import city from './city.txt?raw';
import { createAutopilot, seeded } from './autopilot.js';

const map = parseMap(city, tables);
const { step } = tables.loop;

// Drives the ?perf&auto setup headless: seeded Sim, order accepted, one autopilot input per step.
function drive(seconds) {
  const sim = createSim(tables, map, seeded(tables.perf.seed));
  const autopilot = createAutopilot(sim, map, tables);
  sim.requestOffers();
  sim.acceptOrder(sim.state.offers[0].id);
  autopilot.place();
  const reached = new Set();
  let crashes = 0;
  for (let i = 0; i < seconds / step; i++) {
    const fine = sim.state.lastFine;
    sim.step(step, autopilot.update(step));
    if (sim.state.lastFine !== fine && sim.state.lastFine.reason === 'collision') crashes++;
    const { x, z } = sim.state.truck;
    tables.perf.route.forEach((corner, k) => {
      if (Math.hypot(x - corner.x, z - corner.z) < tables.perf.spacing) reached.add(k);
    });
  }
  return { truck: sim.state.truck, reached, crashes };
}

test('the autopilot drives the whole loop, hardly ever into an AI car', () => {
  const { reached, crashes } = drive(240);
  expect([...reached].sort()).toEqual([0, 1, 2, 3]); // the last corner comes at about 230 s
  // shortcut: it ignores right of way and only waits for cars ahead, so a car crossing its path can still be hit.
  expect(crashes).toBeLessThanOrEqual(3);
});

test('the autopilot drives the same way every run', () => {
  const run = drive(20);
  const again = drive(20);
  expect([again.truck.x, again.truck.z]).toEqual([run.truck.x, run.truck.z]);
});
