import { describe, expect, test } from 'vitest';
import { createSim } from './sim.js';
import * as tables from '../tables.js';

const DT = 1 / 60;

function drive(sim, seconds, input) {
  for (let t = 0; t < seconds; t += DT) sim.step(DT, input);
}

function snapshot(sim) {
  const { x, z, heading } = sim.state.truck;
  return { x, z, heading };
}

describe('Sim: driving', () => {
  test('full gas with no steering moves the truck forward along its heading', () => {
    const sim = createSim(tables);
    const start = snapshot(sim);

    drive(sim, 3, { steer: 0, gas: 1, brake: 0 });

    const dx = sim.state.truck.x - start.x;
    const dz = sim.state.truck.z - start.z;
    const forward = dx * Math.sin(start.heading) + dz * Math.cos(start.heading);
    const sideways = dx * Math.cos(start.heading) - dz * Math.sin(start.heading);
    expect(forward).toBeGreaterThan(1);
    expect(Math.abs(sideways)).toBeLessThan(1e-6);
  });

  test('steering right with gas turns the truck to its right', () => {
    const sim = createSim(tables);
    const start = snapshot(sim);

    drive(sim, 3, { steer: 1, gas: 1, brake: 0 });

    const dx = sim.state.truck.x - start.x;
    const dz = sim.state.truck.z - start.z;
    // Right of a truck facing (sin h, cos h) is (-cos h, sin h).
    const toRight = -dx * Math.cos(start.heading) + dz * Math.sin(start.heading);
    expect(toRight).toBeGreaterThan(0.5);
    expect(sim.state.truck.heading).not.toBeCloseTo(start.heading, 1);
  });

  test('full brake brings a moving truck to a stop', () => {
    const sim = createSim(tables);
    drive(sim, 3, { steer: 0, gas: 1, brake: 0 });

    for (let t = 0; t < 10 && sim.state.truck.speed > 0; t += DT) {
      sim.step(DT, { steer: 0, gas: 0, brake: 1 });
    }

    expect(sim.state.truck.speed).toBe(0);
  });

  test('holding full gas never takes the truck past 90 km/h', () => {
    const sim = createSim(tables);
    drive(sim, 120, { steer: 0, gas: 1, brake: 0 });

    expect(sim.state.truck.speed).toBeGreaterThan(10);
    expect(sim.state.truck.speed).toBeLessThanOrEqual(25);
  });

  test('with no pedals pressed a moving truck rolls to a stop', () => {
    const sim = createSim(tables);
    drive(sim, 3, { steer: 0, gas: 1, brake: 0 });

    drive(sim, 60, { steer: 0, gas: 0, brake: 0 });

    expect(sim.state.truck.speed).toBe(0);
  });
});
