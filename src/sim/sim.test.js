import { describe, expect, test } from 'vitest';
import { createSim } from './sim.js';
import * as tables from '../tables.js';
import { parseMap } from './map.js';
import city from '../city.txt?raw';

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
      expect(sim.state.truck.rpm).toBeLessThanOrEqual(tables.vehicle.torqueCurve.at(-1)[0]);
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
    const gears = new Set();
    for (let i = 0; i < 5; i++) {
      for (let t = 0; t < reverseDelay / 2; t += DT) {
        sim.step(DT, BRAKE);
        gears.add(sim.state.truck.gear);
      }
      drive(sim, 0.2, IDLE);
    }

    expect(gears.has('R')).toBe(false);
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

// Test grids use the real tile size; the tile under the truck is read straight from the ASCII.
const TILE = tables.city.tileSize;

function simOn(grid) {
  return createSim(tables, parseMap(grid, tables));
}

function tileUnder(grid, sim) {
  const rows = grid.trim().split('\n').map((line) => line.trim());
  return rows[Math.floor(sim.state.truck.z / TILE)][Math.floor(sim.state.truck.x / TILE)];
}

describe('Sim: city', () => {
  test('on load the truck stands still on a road tile of the city map', () => {
    const sim = simOn(city);

    expect(tileUnder(city, sim)).toBe('.');
    expect(sim.state.truck.speed).toBe(0);
  });

  test('driving into a building stops the truck outside it and flags the collision', () => {
    // A north–south lane closed off by buildings; the truck starts facing south (+z).
    const grid = `
      ###
      #.#
      #.#
      #.#
      ###`;
    const sim = simOn(grid);
    expect(sim.state.truck.heading).toBeCloseTo(0);

    drive(sim, 1, { steer: 0, gas: 1, brake: 0 });
    expect(sim.state.collision).toBe(false);
    drive(sim, 10, { steer: 0, gas: 1, brake: 0 });

    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.truck.z + tables.vehicle.length / 2).toBeLessThanOrEqual(4 * TILE);
  });

  test('driving into the map edge stops the truck inside the map', () => {
    const grid = `
      ...
      ...
      ...`;
    const sim = simOn(grid);

    drive(sim, 10, { steer: 0, gas: 1, brake: 0 });

    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.truck.z + tables.vehicle.length / 2).toBeLessThanOrEqual(3 * TILE);
  });

  test('driving into a parked car stops the truck at the car', () => {
    // The car stands at the north kerb of its tile, across the lane the truck drives down.
    const grid = `
      ###
      ###
      #.#
      #,#
      #c#
      ###`;
    const sim = simOn(grid);
    expect(sim.state.truck.z).toBeCloseTo(2.5 * TILE);
    expect(sim.state.truck.heading).toBeCloseTo(0);

    drive(sim, 10, { steer: 0, gas: 1, brake: 0 });

    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.truck.z + tables.vehicle.length / 2).toBeLessThanOrEqual(4 * TILE + tables.city.kerbGap);
  });

  test('driving at an angle past a building corner without touching it does not stop the truck', () => {
    // The truck veers left (+x) towards the lone building, then passes its south-west corner diagonally.
    const grid = `
      .,,,,,
      ,#,,,,
      ,,,,,,
      ,,,,,,
      ,,,,,,
      ,,,,,,`;
    const sim = simOn(grid);
    let hit = false;
    for (let t = 0; t < 7; t += DT) {
      sim.step(DT, { steer: t < 2.25 ? -0.5 : 0, gas: 1, brake: 0 });
      hit ||= sim.state.collision;
    }

    expect(hit).toBe(false);
    expect(sim.state.truck.z).toBeGreaterThan(2 * TILE);
  });

  test('resetToRoad() from off-road puts the truck on the nearest road, along it, stopped in first gear', () => {
    // A north–south road with open ground to the east.
    const grid = `
      .,,,,
      .,,,,
      .,,,,
      .,,,,`;
    const sim = simOn(grid);
    for (let t = 0; t < 10 && tileUnder(grid, sim) !== ','; t += DT) {
      sim.step(DT, { steer: -1, gas: 1, brake: 0 }); // steer left, towards +x
    }
    expect(tileUnder(grid, sim)).toBe(',');

    sim.resetToRoad();

    expect(tileUnder(grid, sim)).toBe('.');
    expect(sim.state.truck.x).toBeCloseTo(TILE / 2);
    expect(Math.sin(sim.state.truck.heading)).toBeCloseTo(0); // facing north or south
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.truck.gear).toBe(1);
  });
});
