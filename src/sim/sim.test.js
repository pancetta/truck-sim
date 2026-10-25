import { describe, expect, test } from 'vitest';
import { createSim } from './sim.js';
import * as tables from '../tables.js';

const DT = 1 / 60;
const GAS = { steer: 0, gas: 1, brake: 0 };
const BRAKE = { steer: 0, gas: 0, brake: 1 };
const IDLE = { steer: 0, gas: 0, brake: 0 };

function drive(sim, seconds, input) {
  for (let t = 0; t < seconds; t += DT) sim.step(DT, input);
}

// Steps until `done()` holds or `limit` seconds pass; returns the time taken.
function timeUntil(sim, input, done, limit = 120) {
  let t = 0;
  while (!done() && t < limit) {
    sim.step(DT, input);
    t += DT;
  }
  return t;
}

function withMass(emptyMass) {
  return { ...tables, vehicle: { ...tables.vehicle, emptyMass } };
}

function snapshot(sim) {
  const { x, z, heading } = sim.state.truck;
  return { x, z, heading };
}

// Distance moved since `start`, split into the start heading's forward and right axes.
// Forward is (sin h, cos h); right is (-cos h, sin h).
function moved(sim, start) {
  const dx = sim.state.truck.x - start.x;
  const dz = sim.state.truck.z - start.z;
  return {
    forward: dx * Math.sin(start.heading) + dz * Math.cos(start.heading),
    right: -dx * Math.cos(start.heading) + dz * Math.sin(start.heading),
  };
}

describe('Sim: driving', () => {
  test('full gas with no steering moves the truck forward along its heading', () => {
    const sim = createSim(tables);
    const start = snapshot(sim);

    drive(sim, 3, GAS);

    const { forward, right } = moved(sim, start);
    expect(forward).toBeGreaterThan(1);
    expect(Math.abs(right)).toBeLessThan(1e-6);
  });

  test('steering right with gas turns the truck to its right', () => {
    const sim = createSim(tables);
    const start = snapshot(sim);

    drive(sim, 3, { steer: 1, gas: 1, brake: 0 });

    expect(moved(sim, start).right).toBeGreaterThan(0.5);
    expect(sim.state.truck.heading).not.toBeCloseTo(start.heading, 1);
  });

  test('full brake brings a moving truck to a stop', () => {
    const sim = createSim(tables);
    drive(sim, 10, GAS);

    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0, 20);

    expect(sim.state.truck.speed).toBe(0);
  });

  test('holding full gas never takes the truck past 90 km/h', () => {
    const sim = createSim(tables);
    drive(sim, 120, GAS);

    expect(sim.state.truck.speed).toBeGreaterThan(15);
    expect(sim.state.truck.speed).toBeLessThanOrEqual(25);
  });

  test('with no pedals pressed a moving truck rolls to a stop', () => {
    const sim = createSim(tables);
    drive(sim, 5, GAS);

    drive(sim, 60, IDLE);

    expect(sim.state.truck.speed).toBe(0);
  });

  test('with no pedals at a standstill the truck stays still', () => {
    const sim = createSim(tables);
    const start = snapshot(sim);

    drive(sim, 5, IDLE);

    expect(sim.state.truck.speed).toBe(0);
    expect(snapshot(sim)).toEqual(start);
    expect(sim.state.truck.gear).toBe('N');
  });

  test('the same steering turns the truck less sharply at higher speed', () => {
    // Heading change per metre travelled, at a crawl and at speed.
    function turnPerMetre(cruise) {
      const sim = createSim(tables);
      timeUntil(sim, GAS, () => sim.state.truck.speed >= cruise);
      const start = snapshot(sim);
      drive(sim, 0.5, { steer: 1, gas: 0, brake: 0 });
      const { x, z, heading } = sim.state.truck;
      return Math.abs(heading - start.heading) / Math.hypot(x - start.x, z - start.z);
    }

    expect(turnPerMetre(20)).toBeLessThan(turnPerMetre(3) / 2);
  });
});

describe('Sim: gearbox', () => {
  test('under steady full gas the gear rises as speed rises, with RPM in the engine range', () => {
    const sim = createSim(tables);
    const gears = [];
    for (let t = 0; t < 60; t += DT) {
      sim.step(DT, GAS);
      gears.push(sim.state.truck.gear);
      expect(sim.state.truck.rpm).toBeGreaterThanOrEqual(tables.vehicle.idleRpm);
      expect(sim.state.truck.rpm).toBeLessThanOrEqual(tables.vehicle.maxRpm);
    }

    expect(gears[0]).toBe(1);
    expect(gears.every((g, i) => i === 0 || g >= gears[i - 1])).toBe(true);
    expect(gears.at(-1)).toBeGreaterThanOrEqual(4);
  });

  test('under braking the gear comes back down', () => {
    const sim = createSim(tables);
    drive(sim, 60, GAS);
    const top = sim.state.truck.gear;

    const gears = [];
    timeUntil(sim, BRAKE, () => {
      gears.push(sim.state.truck.gear);
      return sim.state.truck.speed === 0;
    });

    const forward = gears.filter((g) => typeof g === 'number');
    expect(forward.every((g, i) => i === 0 || g <= forward[i - 1])).toBe(true);
    expect(forward[0]).toBe(top);
    expect(forward.at(-1)).toBe(1);
  });
});

describe('Sim: reverse', () => {
  const { reverseDelay, reverseSpeed } = tables.vehicle;

  test('holding the brake at a standstill waits for the reverse delay, then reverses up to the cap', () => {
    const sim = createSim(tables);

    drive(sim, reverseDelay - 0.05, BRAKE);
    expect(sim.state.truck.speed).toBe(0);

    let fastest = 0;
    for (let t = 0; t < 10; t += DT) {
      sim.step(DT, BRAKE);
      fastest = Math.min(fastest, sim.state.truck.speed);
    }
    expect(sim.state.truck.speed).toBeLessThan(0);
    expect(sim.state.truck.gear).toBe('R');
    expect(fastest).toBeGreaterThanOrEqual(-reverseSpeed);
    expect(fastest).toBeLessThan(-reverseSpeed * 0.9);
  });

  test('releasing the brake while reversing brings the truck back to a stop, and it stays there', () => {
    const sim = createSim(tables);
    drive(sim, reverseDelay + 3, BRAKE);
    expect(sim.state.truck.speed).toBeLessThan(0);

    drive(sim, 3, IDLE);
    expect(sim.state.truck.speed).toBe(0);
    const stopped = snapshot(sim);

    drive(sim, 3, IDLE);
    expect(snapshot(sim)).toEqual(stopped);
    expect(sim.state.truck.gear).toBe('N');
  });

  test('a brake tap shorter than the reverse delay never reverses', () => {
    const sim = createSim(tables);
    for (let i = 0; i < 5; i++) {
      drive(sim, reverseDelay / 2, BRAKE);
      drive(sim, 0.2, IDLE);
    }

    expect(sim.state.truck.speed).toBe(0);
  });

  test('braking a forward-moving truck to a stop does not roll it backwards', () => {
    const sim = createSim(tables);
    drive(sim, 5, GAS);
    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);

    drive(sim, reverseDelay - 0.05, BRAKE);

    expect(sim.state.truck.speed).toBe(0);
  });
});

describe('Sim: mass', () => {
  test('a heavier truck reaches a given speed later and stops later under full brake', () => {
    function run(mass) {
      const sim = createSim(withMass(mass));
      const toSpeed = timeUntil(sim, GAS, () => sim.state.truck.speed >= 15);
      const toStop = timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
      return { toSpeed, toStop };
    }
    const light = run(tables.vehicle.emptyMass);
    const heavy = run(tables.vehicle.emptyMass * 2);

    expect(heavy.toSpeed).toBeGreaterThan(light.toSpeed);
    expect(heavy.toStop).toBeGreaterThan(light.toStop);
  });

  test('the body leans out of a turn, and more so on a heavier truck', () => {
    function lean(mass) {
      const sim = createSim(withMass(mass));
      timeUntil(sim, GAS, () => sim.state.truck.speed >= 8);
      drive(sim, 0.3, { steer: 0.5, gas: 0, brake: 0 });
      return sim.state.truck.roll;
    }

    // Positive roll leans the body to the truck's right; a right turn leans it left.
    expect(lean(tables.vehicle.emptyMass)).toBeLessThan(0);
    expect(lean(tables.vehicle.emptyMass * 1.5)).toBeLessThan(lean(tables.vehicle.emptyMass));
  });
});
