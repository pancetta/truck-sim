import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { freshProfile } from './sim.js';
import { createTerrain } from './terrain.js';
import { BRAKE, DT, GAS, IDLE, acceptFrom, createSim, drive, lane, parkAt, seeded, timeUntil } from './fixtures.js';

// Vehicles on slopes (#105): gravity along the heading, a hill start for the heaviest loads, a hill hold after the
// brake, more fuel uphill, and the body pitched and rolled by the ground under it.
const top = tables.rank.tiers.at(-1).stars;
const all = Object.fromEntries(Object.keys(tables.fleet).map((id) => [id, {}]));
const STEEP = 0.12; // the steepest street on Monti

// Vicolo (fixtures.lane), 180 m north–south, on a plane rising `grade` per m towards +z (and `across` per m towards
// +x); the truck starts in the middle facing +z. `profile` picks the Vehicle and trailer, `cargo` t is loaded; `base`
// are the tables.
function on(grade, { profile = {}, cargo = 0, across = 0, base = tables } = {}) {
  const { t, map } = lane(base, [], 90);
  const h = (x, z) => grade * z + across * x;
  const grid = { minX: -1000, minZ: -1000, cell: 2000, nx: 2, nz: 2, h: [h(-1000, -1000), h(1000, -1000), h(-1000, 1000), h(1000, 1000)] };
  const sim = createSim(t, { ...map, ...createTerrain(grid) }, seeded(1), { ...freshProfile(), money: 100000, stars: top, vehicles: all, ...profile });
  sim.state.truck.mass += cargo * 1000;
  return sim;
}
const climbed = (sim, seconds, input = GAS) => {
  const z = sim.state.truck.z;
  drive(sim, seconds, input);
  return sim.state.truck.z - z;
};
// Steps with `input` for `seconds`, returning the truck's lowest z on the way.
function lowest(sim, seconds, input) {
  let least = sim.state.truck.z;
  for (let t = 0; t < seconds; t += DT) {
    sim.step(DT, input);
    least = Math.min(least, sim.state.truck.z);
  }
  return least;
}

// The heaviest loads each starts with: the truck at its own cargo limit, with the top trailer at the heaviest cargo the
// truck takes (under a Schwertransport's), and the Schwerlaster with the heaviest Schwertransport.
const heaviest = [
  ['the full truck', {}, tables.fleet.truck.maxCargo],
  ['the truck with the top trailer', { trailer: { level: tables.trailer.levels.length, hitched: true } }, tables.orders.schwertransport - 1],
  ['the Schwerlaster with a Schwertransport', { vehicle: 'lorry' }, 30],
];

describe('Sim: Vehicles on slopes', () => {
  test.each(heaviest)('%s starts uphill on the steepest street without rolling back', (_, profile, cargo) => {
    const sim = on(STEEP, { profile, cargo });
    const start = sim.state.truck.z;
    expect(lowest(sim, 20, GAS)).toBe(start);
    expect(sim.state.truck.z - start).toBeGreaterThan(3);
  });

  test('every Vehicle, full, starts uphill on the steepest street', () => {
    for (const vehicle of Object.keys(tables.fleet)) {
      expect(climbed(on(STEEP, { profile: { vehicle }, cargo: tables.fleet[vehicle].maxCargo }), 10), vehicle).toBeGreaterThan(3);
    }
  });

  test('an empty truck climbs faster than a loaded one', () => {
    expect(climbed(on(STEEP), 8)).toBeGreaterThan(climbed(on(STEEP, { cargo: 10 }), 8) * 1.5);
  });

  test('gravity slows the truck uphill and speeds it up downhill, the pedals off', () => {
    const speedAfter = (grade) => {
      const sim = on(grade);
      sim.state.truck.speed = 8;
      drive(sim, 3, IDLE);
      return sim.state.truck.speed;
    };
    expect(speedAfter(STEEP)).toBeLessThan(speedAfter(0) - 3);
    expect(speedAfter(-0.05)).toBeGreaterThan(8);
  });

  test('the brake stops a full truck rolling back and holds it, until reverse engages after its usual pause', () => {
    const rolling = on(STEEP, { cargo: 10 });
    rolling.state.truck.speed = -2;
    drive(rolling, 0.8, BRAKE); // stopped, and not yet in reverse
    expect(rolling.state.truck.speed).toBe(0);

    const sim = on(STEEP, { cargo: 10 });
    const z = sim.state.truck.z;
    drive(sim, tables.fleet.truck.reverseDelay - 0.05, BRAKE);
    expect(sim.state.truck).toMatchObject({ z, speed: 0, gear: 'N' });
    drive(sim, 0.1, BRAKE);
    expect(sim.state.truck.gear).toBe('R');
  });

  test('released at a standstill, the hill hold keeps it there a moment, then it rolls back; gas from the hold climbs', () => {
    const { hillHold } = tables.fleet.truck;
    const sim = on(STEEP, { cargo: 10 });
    drive(sim, 0.2, BRAKE);
    const z = sim.state.truck.z;
    drive(sim, hillHold - 0.1, IDLE);
    expect(sim.state.truck.z).toBe(z);
    drive(sim, 2, IDLE);
    expect(sim.state.truck.z).toBeLessThan(z - 0.5);

    const climber = on(STEEP, { cargo: 10 });
    drive(climber, 0.2, BRAKE);
    drive(climber, 0.5, IDLE);
    const from = climber.state.truck.z;
    expect(lowest(climber, 5, GAS)).toBe(from);
    expect(climber.state.truck.z).toBeGreaterThan(from + 1);
  });

  test('loading on a slope, the parking brake holds it past the hill hold', () => {
    const loadTime = 3 * tables.fleet.truck.hillHold;
    const sim = on(STEEP, { base: { ...tables, orders: { ...tables.orders, loadTime } } });
    parkAt(sim, 'B'); // up against the wall at the top of Vicolo
    acceptFrom(sim, 'B');
    const z = sim.state.truck.z;
    drive(sim, loadTime + 0.1, IDLE);
    expect(sim.state.order.phase).toBe('dropoff');
    expect(sim.state.truck.z).toBeCloseTo(z, 2); // it may creep in the step before the loading starts
  });

  test('a new game and a reset to the road stand on the slope until the truck first moves', () => {
    const sim = on(STEEP, { cargo: 10 });
    const z = sim.state.truck.z;
    drive(sim, 10, IDLE);
    expect(sim.state.truck.z).toBe(z);
    sim.state.truck.speed = -3;
    drive(sim, 1, IDLE);
    sim.resetToRoad();
    const placed = sim.state.truck.z;
    drive(sim, 10, IDLE);
    expect(sim.state.truck.z).toBe(placed);
  });

  test('stopped from reverse by letting go of the pedal, the hill hold keeps it there', () => {
    for (const grade of [0.08, -0.08]) {
      const sim = on(grade, { cargo: 10 });
      drive(sim, 2, BRAKE); // reverse engages, then drives backwards
      expect(sim.state.truck.speed).toBeLessThan(0);
      timeUntil(sim, IDLE, () => sim.state.truck.speed === 0, 3); // letting go brakes it to a stop and ends reverse
      const z = sim.state.truck.z;
      drive(sim, tables.fleet.truck.hillHold - 0.2, IDLE);
      expect(sim.state.truck.z, `grade ${grade}`).toBe(z);
    }
  });

  test('downhill the brakes stop the heaviest load as on the flat, in the rain too', () => {
    const [, profile, cargo] = heaviest[1];
    const stopping = (grade, rain) => {
      const sim = on(grade, { profile, cargo });
      if (rain) sim.state.weather = { kind: 'rain', intensity: 1 };
      sim.state.truck.speed = 50 / 3.6;
      const z = sim.state.truck.z;
      timeUntil(sim, BRAKE, () => sim.state.truck.speed <= 0, 60);
      return sim.state.truck.z - z;
    };
    for (const rain of [false, true]) expect(stopping(-STEEP, rain)).toBeLessThan(stopping(0, rain) * 1.1);
  });

  test('downhill it rolls away from a standstill with the pedals off, once the hold lets go', () => {
    const sim = on(-0.08);
    drive(sim, 0.2, BRAKE);
    drive(sim, 4, IDLE);
    expect(sim.state.truck.speed).toBeGreaterThan(1);
  });

  test('a hitched trailer climbs with the truck, pitched to the slope, and its weight slows the climb', () => {
    const profile = { trailer: { level: 1, hitched: true } };
    const sim = on(0.08, { profile });
    const trailerZ = sim.state.trailer.z;
    const up = climbed(sim, 8);
    expect(sim.state.trailer.z - trailerZ).toBeGreaterThan(up - 0.5);
    expect(sim.state.trailer.pitch).toBeCloseTo(Math.atan(0.08), 3);
    expect(up).toBeLessThan(climbed(on(0.08), 8));
  });

  test('the body is pitched and rolled by the ground under it', () => {
    const sim = on(STEEP);
    sim.step(DT, IDLE);
    const { truck } = sim.state;
    expect(truck.pitch).toBeCloseTo(Math.atan(STEEP), 3);
    expect(truck.roll).toBeCloseTo(0, 6);
    // Facing +z, +x is on the truck's left: the ground rising to the left leans the body right, at most maxBank.
    const across = on(0, { across: 0.02 });
    across.step(DT, IDLE);
    expect(across.state.truck.pitch).toBeCloseTo(0, 6);
    expect(across.state.truck.roll).toBeCloseTo(Math.atan(0.02), 3);
    const hillside = on(0, { across: 0.4 });
    hillside.step(DT, IDLE);
    expect(hillside.state.truck.roll).toBeCloseTo(tables.fleet.truck.maxBank, 6);
  });

  test('uphill it burns more fuel per metre than on the flat, downhill no more', () => {
    const perMetre = (grade, input = GAS) => {
      const sim = on(grade, { cargo: 5 });
      sim.state.truck.speed = 6;
      const [fuel, z] = [sim.state.profile.fuel, sim.state.truck.z];
      drive(sim, 2, input);
      return (fuel - sim.state.profile.fuel) / (sim.state.truck.z - z);
    };
    expect(perMetre(0.05)).toBeGreaterThan(perMetre(0) * 1.3);
    expect(perMetre(-0.05)).toBeCloseTo(perMetre(0), 6);
    // Coasting up a slope on its momentum costs no more than coasting on the flat.
    expect(perMetre(STEEP, IDLE)).toBeCloseTo(perMetre(0, IDLE), 6);
  });
});
