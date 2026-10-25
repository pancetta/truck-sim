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
  for (let i = 0; i < seconds / step; i++) {
    sim.step(step, autopilot.update(step));
    const { x, z } = sim.state.truck;
    tables.perf.route.forEach(({ col, row }, k) => {
      if (Math.hypot(x - (col + 0.5) * map.tileSize, z - (row + 0.5) * map.tileSize) < map.tileSize) reached.add(k);
    });
  }
  return { truck: sim.state.truck, reached };
}

test('the autopilot drives the whole loop, the same way every run', () => {
  const run = drive(400);
  expect([...run.reached].sort()).toEqual([0, 1, 2, 3]);
  const again = drive(400);
  expect([again.truck.x, again.truck.z]).toEqual([run.truck.x, run.truck.z]);
});
