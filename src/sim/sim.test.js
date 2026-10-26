import { describe, expect, test } from 'vitest';
import { createSim, freshProfile } from './sim.js';
import * as tables from '../tables.js';
import { DIRS, parseMap } from './map.js';
import city from '../city.txt?raw';
import { createAutopilot } from '../autopilot.js';

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
    expect(sim.state.truck.z + tables.vehicle.length / 2).toBeLessThanOrEqual(4 * TILE + tables.city.obstacles.car.kerbGap);
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

  test('resetToRoad() from off-road puts the truck in the right-hand lane of the nearest road, along it, stopped in first gear', () => {
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
    const { x, heading } = sim.state.truck;
    expect(Math.sin(heading)).toBeCloseTo(0); // facing north or south
    // #43: where the AI cars drive, right of the centre line (right is -cos heading in x), leaving the other lane free.
    expect(x - TILE / 2).toBeCloseTo(-Math.cos(heading) * tables.traffic.laneOffset);
    expect(Math.abs(x - TILE / 2)).toBeGreaterThan(tables.vehicle.width / 2);
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.truck.gear).toBe(1);
  });
});

// Whether two vehicles' footprints ({ x, z, heading } and { length, width }) overlap, by separating axes; touching
// within a µm doesn't count, as in the Sim.
function vehiclesOverlap(a, aSize, b, bSize) {
  const box = ({ x, z, heading }, { length, width }) =>
    [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([f, r]) => [
      x + (Math.sin(heading) * f * length - Math.cos(heading) * r * width) / 2,
      z + (Math.cos(heading) * f * length + Math.sin(heading) * r * width) / 2,
    ]);
  const [p, q] = [box(a, aSize), box(b, bSize)];
  const separated = (axisOf) =>
    [0, 1].some((i) => {
      const [nx, nz] = [axisOf[i + 1][1] - axisOf[i][1], axisOf[i][0] - axisOf[i + 1][0]];
      const len = Math.hypot(nx, nz);
      const [ps, qs] = [p, q].map((corners) => corners.map(([x, z]) => (x * nx + z * nz) / len));
      return Math.max(...ps) <= Math.min(...qs) + 1e-6 || Math.max(...qs) <= Math.min(...ps) + 1e-6;
    });
  return !separated(p) && !separated(q);
}

// shortcut: tiny seeded PRNG (mulberry32) for repeatable offers; fine for tests, not for anything statistical.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A north–south dead-end lane: A's zone is the tile below A, B's the tile above B.
// The truck starts between them, facing south towards B.
const LANE = `
  #A#
  #.#
  #.#
  #.#
  #B#`;

function laneSim(seed = 1, profile) {
  return createSim(tables, parseMap(LANE, tables), seeded(seed), profile);
}

// Asks for offers until one picks up at `pickup` (AI cars draw from the same seeded random), and accepts it.
function acceptFrom(sim, pickup) {
  let offer;
  for (let i = 0; i < 20 && !offer; i++) offer = sim.requestOffers().find((o) => o.pickup === pickup);
  expect(offer, `an offer from ${pickup}`).toBeTruthy();
  sim.acceptOrder(offer.id);
  return offer;
}

// Drives into B's dead end, or reverses into A's; either way the truck stops in that spot's zone.
function parkAt(sim, id) {
  timeUntil(sim, id === 'B' ? GAS : BRAKE, () => sim.state.collision, 30);
}

// Takes an order from A to B on the lane and delivers it; returns the offer. A late delivery idles out the
// expected time first, so it earns no time bonus.
function deliver(sim, late = false) {
  const offer = acceptFrom(sim, 'A');
  if (late) drive(sim, offer.expectedTime, IDLE);
  parkAt(sim, 'A');
  drive(sim, tables.orders.loadTime + 0.1, IDLE);
  parkAt(sim, 'B');
  drive(sim, tables.orders.loadTime + 0.1, IDLE);
  return offer;
}

describe('Sim: profile', () => {
  const profile = { version: 2, money: 500, rankPoints: 7, distance: 1000, upgrades: { motor: 2 }, owned: ['red'], equipped: { paint: 'red' } };

  test('a fresh Sim starts with no money and no payment', () => {
    const sim = laneSim();
    expect(sim.state.profile).toMatchObject({ version: 2, money: 0, rankPoints: 0, distance: 0 });
    expect(sim.state.lastPayment).toBe(null);
  });

  test('a given profile comes back unchanged, and a delivery adds its pay to its money', () => {
    const sim = laneSim(1, profile);
    expect(sim.state.profile).toEqual(profile);

    const offer = deliver(sim, true);

    expect(sim.state.profile).toEqual({
      ...profile,
      money: 500 + offer.pay,
      rankPoints: 7 + tables.rank.pointsPerDelivery,
      distance: sim.state.profile.distance, // see 'Sim: distance'
    });
    expect(profile.money).toBe(500); // the caller's object is left alone
  });

  test('the profile round-trips into a new Sim', () => {
    const sim = laneSim(1, laneSim(1, profile).state.profile);
    expect(sim.state.profile).toEqual(profile);
  });
});

describe('Sim: distance', () => {
  test('driving forwards, then in reverse, adds both distances to the profile', () => {
    const sim = createSim(tables);
    const start = snapshot(sim);
    drive(sim, 5, GAS);
    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
    const forwards = moved(sim, start).forward; // straight, so the path length
    expect(forwards).toBeGreaterThan(20);
    expect(sim.state.profile.distance).toBeCloseTo(forwards, 6);

    const stop = snapshot(sim);
    drive(sim, tables.vehicle.reverseDelay + 3, BRAKE);
    drive(sim, 3, IDLE);
    const backwards = -moved(sim, stop).forward;
    expect(backwards).toBeGreaterThan(2);
    expect(sim.state.profile.distance).toBeCloseTo(forwards + backwards, 6);
  });

  test('pushing against a wall adds next to nothing, and resetToRoad() adds nothing', () => {
    const sim = laneSim(1, { ...freshProfile(), distance: 1000 });
    parkAt(sim, 'B'); // up against the dead end
    const blocked = sim.state.profile.distance;
    expect(blocked).toBeGreaterThan(1000);

    drive(sim, 2, GAS);
    expect(sim.state.collision).toBe(true);
    expect(sim.state.profile.distance - blocked).toBeLessThan(0.1); // only the creep up to the wall

    const before = sim.state.profile.distance;
    sim.resetToRoad();
    sim.resetToRoad();
    expect(sim.state.profile.distance).toBe(before);
  });
});

describe('Sim: Werkstatt', () => {
  const MONEY = 100000;
  const rich = (upgrades = {}, rankPoints = 0) => ({ ...freshProfile(), money: MONEY, rankPoints, upgrades });
  const plane = (profile = rich()) => createSim(tables, undefined, Math.random, profile);

  test('the Werkstatt is available only at a standstill with no active order', () => {
    const sim = laneSim(1, rich());
    expect(sim.state.garageAvailable).toBe(true);

    drive(sim, 0.5, GAS);
    expect(sim.state.garageAvailable).toBe(false);

    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
    expect(sim.state.garageAvailable).toBe(true);

    acceptFrom(sim, 'A');
    expect(sim.state.garageAvailable).toBe(false);
  });

  test('Motor level 1 costs its price, and the truck reaches 50 km/h sooner', () => {
    const tuned = plane();

    expect(tuned.buyUpgrade('motor')).toEqual({ ok: true, reason: null });

    expect(tuned.state.profile.money).toBe(MONEY - tables.upgrades.motor.levels[0].price);
    expect(tuned.state.profile.upgrades.motor).toBe(1);
    const to50 = (sim) => timeUntil(sim, GAS, () => sim.state.truck.speed >= 50 / 3.6);
    expect(to50(tuned)).toBeLessThan(to50(plane()) * 0.95);
  });

  test('Bremsen level 1 stops the truck from 60 km/h in a shorter distance', () => {
    function stopDistance(sim) {
      timeUntil(sim, GAS, () => sim.state.truck.speed >= 60 / 3.6);
      const start = snapshot(sim);
      timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
      return moved(sim, start).forward;
    }
    const tuned = plane();
    tuned.buyUpgrade('brakes');

    expect(stopDistance(tuned)).toBeLessThan(stopDistance(plane()) * 0.9);
  });

  test('Reifen turn sharper at speed, and Fahrwerk leans the body less', () => {
    function corner(id) {
      const sim = plane();
      if (id) sim.buyUpgrade(id);
      timeUntil(sim, GAS, () => sim.state.truck.speed >= 40 / 3.6);
      const { heading } = sim.state.truck;
      drive(sim, 1, { steer: 0.5, gas: 0, brake: 0 });
      return { turn: Math.abs(sim.state.truck.heading - heading), roll: Math.abs(sim.state.truck.roll) };
    }
    const base = corner();

    expect(corner('tyres').turn).toBeGreaterThan(base.turn * 1.1);
    expect(corner('suspension').roll).toBeLessThan(base.roll * 0.9);
  });

  test('Ladefläche raises the heaviest cargo offered', () => {
    function heaviest(sim) {
      let max = 0;
      for (let i = 0; i < 100; i++) for (const o of sim.requestOffers()) max = Math.max(max, o.cargo.weight);
      return max;
    }
    const sim = laneSim(3, rich());
    expect(heaviest(sim)).toBe(tables.orders.maxCargo);

    sim.buyUpgrade('cargoBed');

    expect(heaviest(sim)).toBe(tables.upgrades.cargoBed.levels[0].maxCargo);
  });

  test('each refused purchase gives its reason and changes nothing', () => {
    const moving = plane();
    drive(moving, 1, GAS);
    const onOrder = laneSim(1, rich());
    acceptFrom(onOrder, 'A');
    const cases = [
      [plane(), 'turbo', 'unknown'],
      [plane(), 'toString', 'unknown'],
      [moving, 'motor', 'notIdle'],
      [onOrder, 'motor', 'notIdle'],
      [plane(freshProfile()), 'motor', 'noMoney'],
      [plane(rich({ motor: 1 })), 'motor', 'rankTooLow'], // level 2 needs tables.upgrades.motor.levels[1].rank
      [plane(rich({ motor: 3 }, 1000)), 'motor', 'maxLevel'],
    ];

    for (const [sim, id, reason] of cases) {
      const before = structuredClone(sim.state.profile);
      expect(sim.buyUpgrade(id), reason).toEqual({ ok: false, reason });
      expect(sim.state.profile, reason).toEqual(before);
    }
  });

  test('with enough rank the next level sells', () => {
    const { rank } = tables.upgrades.motor.levels[1];
    const sim = plane(rich({ motor: 1 }, tables.rank.tiers[rank].points));

    expect(sim.buyUpgrade('motor').ok).toBe(true);
    expect(sim.state.profile.upgrades.motor).toBe(2);
  });
});

describe('Sim: visual items', () => {
  const OK = { ok: true, reason: null };
  const items = Object.entries(tables.visuals);
  const [id, item] = items.find(([, v]) => v.price > 0);
  const { slot } = item;
  const [other] = items.find(([k, v]) => k !== id && v.slot === slot && v.price > 0);
  const [stock] = items.find(([, v]) => v.slot === slot && v.price === 0);
  const plane = (profile) => createSim(tables, undefined, Math.random, { ...freshProfile(), ...profile });

  test('every slot has exactly one free stock item', () => {
    const slots = new Set(items.map(([, v]) => v.slot));
    for (const s of slots) expect(items.filter(([, v]) => v.slot === s && v.price === 0), s).toHaveLength(1);
  });

  test('buying takes the price with no rank needed, and wears the item', () => {
    const sim = plane({ money: item.price }); // rank 0

    expect(sim.buyVisual(id)).toEqual(OK);

    expect(sim.state.profile).toMatchObject({ money: 0, owned: [id], equipped: { [slot]: id } });
  });

  test('owned items switch for free, and the stock item empties the slot', () => {
    const sim = plane({ money: 50, owned: [id, other], equipped: { [slot]: id } });

    expect(sim.equipVisual(other)).toEqual(OK);
    expect(sim.state.profile).toMatchObject({ money: 50, equipped: { [slot]: other } });

    expect(sim.equipVisual(stock)).toEqual(OK);
    expect(sim.state.profile).toMatchObject({ money: 50, owned: [id, other], equipped: {} });
  });

  test('each refusal gives its reason and changes nothing', () => {
    const moving = plane({ money: 100000, owned: [id] });
    drive(moving, 1, GAS);
    const cases = [
      [plane({ money: item.price - 1 }), 'buyVisual', id, 'noMoney'],
      [plane({ money: 100000 }), 'buyVisual', 'neonUnderglow', 'unknown'],
      [plane({ money: 100000 }), 'equipVisual', 'toString', 'unknown'],
      [plane({ money: 100000, owned: [id] }), 'buyVisual', id, 'owned'],
      [plane({ money: 100000 }), 'buyVisual', stock, 'owned'],
      [plane({ money: 100000 }), 'equipVisual', id, 'notOwned'],
      [moving, 'buyVisual', other, 'notIdle'],
      [moving, 'equipVisual', id, 'notIdle'],
    ];

    for (const [sim, command, itemId, reason] of cases) {
      const before = structuredClone(sim.state.profile);
      expect(sim[command](itemId), reason).toEqual({ ok: false, reason });
      expect(sim.state.profile, reason).toEqual(before);
    }
  });
});

describe('Sim: rank', () => {
  const { pointsPerDelivery, tiers } = tables.rank;
  const at = (rankPoints) => laneSim(1, { ...freshProfile(), rankPoints });

  test('a fresh Sim starts at the lowest tier', () => {
    expect(laneSim().state.rank).toEqual({ tier: 0, title: tiers[0].title, progress: 0 });
  });

  test('a delivery adds rank points, and crossing a threshold changes the tier and title', () => {
    const sim = at(tiers[1].points - pointsPerDelivery);
    expect(sim.state.rank.tier).toBe(0);

    deliver(sim, true);

    expect(sim.state.profile.rankPoints).toBe(tiers[1].points);
    expect(sim.state.rank).toEqual({ tier: 1, title: tiers[1].title, progress: 0 });
    expect(tiers[1].title).not.toBe(tiers[0].title);
  });

  test('progress runs towards the next tier and stays full at the top', () => {
    expect(at((tiers[1].points + tiers[2].points) / 2).state.rank).toMatchObject({ tier: 1, progress: 0.5 });
    expect(at(tiers.at(-1).points + 1).state.rank).toMatchObject({ tier: tiers.length - 1, progress: 1 });
  });
});

describe('Sim: orders', () => {
  const { loadTime, basePay, payPerKm } = tables.orders;
  const { emptyMass } = tables.vehicle;
  const cityMap = parseMap(city, tables);

  test('requestOffers() gives about three offers between distinct spots, the same for the same seed', () => {
    const offers = createSim(tables, cityMap, seeded(7)).requestOffers();

    expect(offers.length).toBeGreaterThanOrEqual(2);
    expect(offers.length).toBeLessThanOrEqual(4);
    expect(createSim(tables, cityMap, seeded(7)).requestOffers()).toEqual(offers);
    for (let seed = 0; seed < 50; seed++) {
      for (const o of createSim(tables, cityMap, seeded(seed)).requestOffers()) {
        expect(o.pickup).not.toBe(o.dropoff);
        expect(o.distance).toBeGreaterThan(0);
      }
    }
  });

  test('an offer pays base + per-km × the shortest road route between the zones', () => {
    // A's zone is the tile below A, B's the tile right of B. Along the bottom row is 6 tiles; over the top, 12.
    const grid = `
      .......
      .#####.
      .A###B.
      .......`;
    const sim = createSim(tables, parseMap(grid, tables), seeded(1));

    const offers = sim.requestOffers();

    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      expect(o.distance).toBe(6 * TILE);
      expect(o.pay).toBe(Math.round(basePay + (payPerKm * 6 * TILE) / 1000));
    }
  });

  test('accepting an offer makes it the active order; no new offers while it runs', () => {
    const sim = laneSim();
    const [first, second] = sim.requestOffers();

    sim.acceptOrder(first.id);

    expect(sim.state.order).toMatchObject({ ...first, phase: 'pickup' });
    expect(sim.requestOffers()).toEqual([]);
    sim.acceptOrder(second.id);
    expect(sim.state.order.id).toBe(first.id);
  });

  test('standing in the pickup zone for the load time loads the cargo and heads for the drop-off', () => {
    const sim = laneSim();
    const offer = acceptFrom(sim, 'B');
    parkAt(sim, 'B');

    drive(sim, loadTime - 0.1, IDLE);
    expect(sim.state.order.phase).toBe('pickup');
    expect(sim.state.progress).toBeGreaterThan(0.9);
    expect(sim.state.truck.mass).toBe(emptyMass);

    drive(sim, 0.2, IDLE);
    expect(sim.state.order.phase).toBe('dropoff');
    expect(sim.state.progress).toBe(0);
    expect(sim.state.truck.mass).toBe(emptyMass + offer.cargo.weight * 1000);
  });

  test('moving before loading is done resets the progress', () => {
    const sim = laneSim();
    acceptFrom(sim, 'B');
    parkAt(sim, 'B');
    drive(sim, loadTime / 2, IDLE);
    expect(sim.state.progress).toBeGreaterThan(0.4);

    // Held past the reverse delay, the brake rolls the truck back.
    drive(sim, tables.vehicle.reverseDelay + 0.5, BRAKE);

    expect(sim.state.truck.speed).toBeLessThan(0);
    expect(sim.state.progress).toBe(0);
    expect(sim.state.order.phase).toBe('pickup');
  });

  test('short brake taps (under the reverse delay) in the zone still complete loading', () => {
    const sim = laneSim();
    acceptFrom(sim, 'B');
    parkAt(sim, 'B');

    for (let t = 0; t < loadTime + 0.5; t += 0.5) {
      drive(sim, tables.vehicle.reverseDelay * 0.8, BRAKE);
      drive(sim, 0.1, IDLE);
    }

    expect(sim.state.order.phase).toBe('dropoff');
  });

  test('a late unloading pays exactly the offer (base + distance), restores empty mass and clears the order', () => {
    const sim = laneSim();
    const offer = acceptFrom(sim, 'A');
    drive(sim, offer.expectedTime, IDLE);
    parkAt(sim, 'A');
    drive(sim, loadTime + 0.1, IDLE);
    expect(sim.state.order.phase).toBe('dropoff');

    parkAt(sim, 'B');
    drive(sim, loadTime + 0.1, IDLE);

    expect(sim.state.profile.money).toBe(offer.pay);
    expect(sim.state.lastPayment).toEqual({
      amount: offer.pay,
      lines: [
        { label: 'base', amount: offer.pay },
        { label: 'time', amount: 0 },
      ],
    });
    expect(sim.state.profile.rankPoints).toBe(tables.rank.pointsPerDelivery);
    expect(sim.state.truck.mass).toBe(emptyMass);
    expect(sim.state.order).toBe(null);
    expect(sim.state.progress).toBe(0);
    expect(sim.requestOffers().length).toBeGreaterThan(0);
  });

  test('a loaded truck accelerates more slowly than the same truck empty', () => {
    function speedAfterLoadStop(order) {
      const sim = laneSim();
      if (order) acceptFrom(sim, 'A');
      parkAt(sim, 'A');
      drive(sim, loadTime + 0.1, IDLE);
      drive(sim, 1.5, GAS);
      return sim.state.truck.speed;
    }

    expect(speedAfterLoadStop(true)).toBeLessThan(speedAfterLoadStop(false) * 0.8);
  });
});

describe('Sim: time bonus', () => {
  const { loadTime, referenceSpeed, slack } = tables.orders;
  // Spec #12's worked example: base + distance 100 and an expected time of 120 s. One road tile between A and B
  // is both their zones, so the order loads and unloads where the truck starts, with no route; loading and
  // unloading take 30 s each, and the slack makes up the other 60 s.
  const example = { ...tables, orders: { ...tables.orders, basePay: 100, loadTime: 30, slack: 60 } };
  const nookSim = () => createSim(example, parseMap('A.B', example), seeded(1));

  test("an offer expects the routes to the pickup and on to the drop-off at reference speed, plus load, unload and slack", () => {
    // On the lane the truck starts one tile from A's zone, which is two tiles from B's.
    const offer = laneSim().requestOffers().find((o) => o.pickup === 'A');

    expect(offer.expectedTime).toBeCloseTo((3 * TILE) / referenceSpeed + 2 * loadTime + slack);
  });

  test('offers are dropped once the truck leaves the tile they were made on, so their times stay true', () => {
    const sim = laneSim();
    sim.requestOffers();
    drive(sim, 1, IDLE);
    expect(sim.state.offers.length).toBeGreaterThan(0);

    timeUntil(sim, GAS, () => sim.state.offers.length === 0, 10);

    expect(sim.state.offers).toEqual([]);
    expect(Math.abs(sim.state.truck.z - 2.5 * TILE)).toBeGreaterThan(TILE / 2 - 0.5); // it got to the next tile
  });

  test('the active order counts the time since it was accepted', () => {
    const sim = nookSim();
    const offer = sim.requestOffers()[0];
    expect(offer).toMatchObject({ pay: 100, expectedTime: 120 });
    drive(sim, 5, IDLE); // not counted before accepting

    sim.acceptOrder(offer.id);
    drive(sim, 10, IDLE);

    expect(sim.state.order).toMatchObject({ expectedTime: 120 });
    expect(sim.state.order.elapsed).toBeCloseTo(10, 1);
  });

  test('worked example: delivered after 60 of 120 s, the time line is 25 on top of the 100', () => {
    const sim = nookSim();
    sim.acceptOrder(sim.requestOffers()[0].id);

    drive(sim, 61, IDLE); // loaded at 30 s, unloaded at 60 s

    expect(sim.state.order).toBe(null);
    expect(sim.state.lastPayment).toEqual({
      amount: 125,
      lines: [
        { label: 'base', amount: 100 },
        { label: 'time', amount: 25 },
      ],
    });
    expect(sim.state.profile.money).toBe(125);
  });

  test('the time bonus adds rank points in proportion to the bonus earned', () => {
    const { pointsPerDelivery, timeBonusPoints } = tables.rank;
    const sim = nookSim();
    sim.acceptOrder(sim.requestOffers()[0].id);

    drive(sim, 61, IDLE); // half the expected time left: half the full time bonus

    expect(timeBonusPoints).toBeGreaterThan(0);
    expect(sim.state.profile.rankPoints).toBe(pointsPerDelivery + timeBonusPoints / 2);
  });
});

describe('Sim: fragile cargo', () => {
  const { loadTime, fragilePremium, maxCargo, types } = tables.orders;
  const fragileTier = { ...freshProfile(), rankPoints: tables.rank.tiers[types.fragile].points };
  const glass = { name: 'Glas', weight: 4, fragile: true };
  // Every offer is fragile, so runs with the same driving carry the same mass.
  const onlyGlass = { ...tables, orders: { ...tables.orders, cargo: [glass] } };
  // A long north–south lane: A's zone is the tile below A, room to speed up and brake towards B.
  const LONG = `#A#\n${'#.#\n'.repeat(14)}#B#`;
  const longSim = (profile = fragileTier) => createSim(onlyGlass, parseMap(LONG, onlyGlass), seeded(1), profile);
  // Spec #12's worked example on the time-bonus nook (see 'Sim: time bonus'): base + distance 100, 120 s expected.
  const example = { ...onlyGlass, orders: { ...onlyGlass.orders, basePay: 100, loadTime: 30, slack: 60, hitDamage: 0.25 } };
  const nookSim = () => createSim(example, parseMap('A.B', example), seeded(1), fragileTier);

  // Loads a fragile order at A on the long lane; the truck then stands in A's zone facing B.
  function loadAtA(sim) {
    acceptFrom(sim, 'A');
    parkAt(sim, 'A');
    drive(sim, loadTime + 0.1, IDLE);
    expect(sim.state.order).toMatchObject({ type: 'fragile', phase: 'dropoff', damage: 0 });
  }

  function typesOffered(sim) {
    const seen = new Set();
    for (let i = 0; i < 100; i++) for (const o of sim.requestOffers()) seen.add(o.type);
    return seen;
  }

  test('fragile offers come only from their rank tier, and offers are the same for the same seed', () => {
    const below = { ...freshProfile(), rankPoints: tables.rank.tiers[types.fragile - 1].points };
    expect(typesOffered(laneSim(1, below))).toEqual(new Set(['normal']));
    expect(typesOffered(laneSim(1, fragileTier))).toEqual(new Set(['normal', 'fragile']));

    const offers = laneSim(3, fragileTier).requestOffers();
    expect(laneSim(3, fragileTier).requestOffers()).toEqual(offers);
    for (const o of offers) expect(o.type).toBe(o.cargo.fragile ? 'fragile' : 'normal');
  });

  test('cargo heavier than the base Ladefläche carries is a heavy offer', () => {
    const sim = laneSim(1, { ...fragileTier, upgrades: { cargoBed: 1 } });
    for (let i = 0; i < 50; i++) {
      for (const o of sim.requestOffers()) if (!o.cargo.fragile) expect(o.type).toBe(o.cargo.weight > maxCargo ? 'heavy' : 'normal');
    }
    expect(typesOffered(sim)).toEqual(new Set(['normal', 'heavy', 'fragile']));
  });

  test('hard braking with fragile cargo loaded raises the damage; speeding up and coasting do not', () => {
    const sim = longSim();
    loadAtA(sim);

    drive(sim, 4, GAS);
    drive(sim, 2, IDLE);
    expect(sim.state.truck.speed).toBeGreaterThan(5);
    expect(sim.state.order.damage).toBe(0);

    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
    expect(sim.state.collision).toBe(false);
    expect(sim.state.order.damage).toBeGreaterThan(0);
  });

  test('braking before the cargo is loaded does no damage', () => {
    const sim = longSim();
    acceptFrom(sim, 'A');

    drive(sim, 3, GAS);
    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);

    expect(sim.state.order.damage).toBe(0);
  });

  test('touching a wall at a crawl does no damage', () => {
    const sim = longSim();
    loadAtA(sim); // up against A's end wall

    let touched = false;
    for (let t = 0; t < 2; t += DT) {
      sim.step(DT, BRAKE); // reverse engages and backs into the wall
      touched ||= sim.state.collision;
    }

    expect(touched).toBe(true);
    expect(sim.state.order.damage).toBe(0);
  });

  test('a higher Fahrwerk level means less damage for the same braking', () => {
    function brakingDamage(suspension) {
      const sim = longSim({ ...fragileTier, upgrades: suspension ? { suspension } : {} });
      loadAtA(sim);
      drive(sim, 4, GAS);
      timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
      return sim.state.order.damage;
    }
    const [none, one, three] = [brakingDamage(0), brakingDamage(1), brakingDamage(3)];

    expect(one).toBeLessThan(none);
    expect(three).toBeLessThan(one);
    expect(three).toBeGreaterThan(0);
  });

  test('worked example: one hit with fragile cargo loaded is damage 0.25, and the fragile line is 30 on the 100', () => {
    const noTimePoints = { ...example, rank: { ...example.rank, timeBonusPoints: 0 } }; // the bump costs time
    const sim = createSim(noTimePoints, parseMap('A.B', example), seeded(1), fragileTier);
    sim.acceptOrder(sim.requestOffers()[0].id);
    drive(sim, 30.1, IDLE); // loaded at 30 s

    timeUntil(sim, GAS, () => sim.state.collision, 10); // into the map edge, still in the zone
    drive(sim, 1, GAS); // pushing on against it is the same hit
    expect(sim.state.collision).toBe(true);
    drive(sim, 0.1, IDLE);
    expect(sim.state.order.damage).toBe(0.25);
    drive(sim, 31, IDLE);

    expect(sim.state.order).toBe(null);
    expect(sim.state.lastPayment.lines).toContainEqual({ label: 'base', amount: 100 });
    expect(sim.state.lastPayment.lines).toContainEqual({ label: 'fragile', amount: 30 });
    const { pointsPerDelivery, fragilePoints } = tables.rank;
    expect(sim.state.profile.rankPoints).toBe(fragileTier.rankPoints + pointsPerDelivery + Math.round(fragilePoints * 0.75));
  });

  test('an undamaged fragile delivery gets the full premium and the extra rank points', () => {
    const { pointsPerDelivery, timeBonusPoints, fragilePoints } = tables.rank;
    const sim = nookSim();
    sim.acceptOrder(sim.requestOffers()[0].id);

    drive(sim, 61, IDLE); // loaded at 30 s, unloaded at 60 s

    expect(sim.state.lastPayment).toEqual({
      amount: 165,
      lines: [
        { label: 'base', amount: 100 },
        { label: 'time', amount: 25 },
        { label: 'fragile', amount: fragilePremium * 100 },
      ],
    });
    expect(fragilePoints).toBeGreaterThan(0);
    expect(sim.state.profile.rankPoints).toBe(fragileTier.rankPoints + pointsPerDelivery + timeBonusPoints / 2 + fragilePoints);
  });
});

describe('Sim: docking', () => {
  const { loadTime, types, dockHeading } = tables.orders;
  const tierOf = (type) => ({ ...freshProfile(), rankPoints: tables.rank.tiers[types[type]].points });
  // Spec #12's worked example: base + distance 100 (no pay per km), so the dock line is 25.
  const example = (docks, cargo = tables.orders.cargo) => ({
    ...tables,
    orders: { ...tables.orders, basePay: 100, payPerKm: 0, cargo },
    city: { ...tables.city, docks },
  });
  // The lane (see LANE) with `docks` as loading docks; A's bay faces south, out of A into the lane.
  const dockSim = (docks = ['A'], profile = tierOf('dock'), cargo) => {
    const t = example(docks, cargo);
    return createSim(t, parseMap(LANE, t), seeded(1), profile);
  };
  const lineOf = (sim, label) => sim.state.lastPayment.lines.find((l) => l.label === label);

  // How far the middle of the truck's rear is from A's dock edge, the building face at z = TILE, facing south.
  const rearGap = (sim) => sim.state.truck.z - tables.vehicle.length / 2 - TILE;

  // Reverses north until rearGap() is at most `gap`: at full speed while far, then in short bursts at a crawl,
  // braked out of at once (each waits out the reverse delay again), so it never hits the wall, which would harm
  // fragile cargo.
  function backUpToA(sim, gap) {
    timeUntil(sim, BRAKE, () => rearGap(sim) < gap + 4, 30);
    while (rearGap(sim) > gap) {
      timeUntil(sim, IDLE, () => sim.state.truck.speed === 0, 10); // releasing the pedal in reverse brakes
      timeUntil(sim, BRAKE, () => sim.state.truck.speed < -0.5 || rearGap(sim) <= gap, 10);
    }
    timeUntil(sim, IDLE, () => sim.state.truck.speed === 0, 10);
  }

  // Picks up at B, driving into its dead end, moves across onto the bay's centre line (shortcut: set directly,
  // as steering there isn't under test), then reverses north into A's zone to within `gap` of the dock edge and
  // unloads. With `steer`, it swings the rear round on the way, so the truck ends up crooked. Returns the offer.
  function reverseIntoA(sim, steer = 0, gap = 0.5) {
    const offer = acceptFrom(sim, 'B');
    parkAt(sim, 'B');
    drive(sim, loadTime + 0.1, IDLE);
    sim.state.truck.x = 1.5 * TILE;
    if (steer) {
      timeUntil(sim, BRAKE, () => sim.state.truck.z < 2.3 * TILE, 30);
      timeUntil(sim, { ...BRAKE, steer }, () => Math.abs(sim.state.truck.heading) > 1.5 * dockHeading, 10);
    }
    backUpToA(sim, gap);
    expect(sim.state.collision).toBe(false);
    expect(sim.state.order).toMatchObject({ phase: 'dropoff' });
    drive(sim, loadTime + 0.1, IDLE);
    expect(sim.state.order, 'delivered').toBe(null);
    return offer;
  }

  function typesOffered(sim) {
    const seen = new Set();
    for (let i = 0; i < 100; i++) for (const o of sim.requestOffers()) seen.add(o.type);
    return seen;
  }

  test('dock offers go to dock spots, from their rank tier on; fragile + dock from its own', () => {
    const below = { ...freshProfile(), rankPoints: tables.rank.tiers[types.dock - 1].points };
    expect(typesOffered(dockSim(['A'], below))).not.toContain('dock');
    expect(typesOffered(dockSim(['A'], tierOf('dock')))).toContain('dock');
    expect(typesOffered(dockSim(['A'], tierOf('fragileDock')))).toContain('fragileDock');
    expect(types.fragileDock).toBeGreaterThan(types.dock);
    expect(typesOffered(dockSim(['A'], { ...freshProfile(), rankPoints: tables.rank.tiers[types.fragileDock - 1].points }))).not.toContain(
      'fragileDock',
    );

    const sim = dockSim(['A'], tierOf('fragileDock'));
    for (let i = 0; i < 20; i++) {
      for (const o of sim.requestOffers()) expect(['dock', 'fragileDock'].includes(o.type)).toBe(o.dropoff === 'A');
    }
  });

  test('reversing straight into the bay pays the dock line: +25% of base + distance', () => {
    const sim = dockSim();

    const offer = reverseIntoA(sim);

    expect(offer.type).toBe('dock');
    expect(rearGap(sim)).toBeLessThanOrEqual(tables.orders.dockDepth);
    expect(lineOf(sim, 'base').amount).toBe(100);
    expect(lineOf(sim, 'dock').amount).toBe(25);
    expect(sim.state.lastPayment.amount).toBe(125 + lineOf(sim, 'time').amount);
  });

  test('stopping 2–3 m short of the dock edge delivers at normal pay, with no dock line', () => {
    const sim = dockSim();

    reverseIntoA(sim, 0, 3);

    expect(rearGap(sim)).toBeGreaterThan(tables.orders.dockDepth + 1);
    expect(rearGap(sim)).toBeLessThanOrEqual(3);
    expect(lineOf(sim, 'base').amount).toBe(100);
    expect(lineOf(sim, 'dock')).toBeUndefined();
  });

  test('driving into the bay forwards delivers at normal pay, with no dock line', () => {
    const sim = dockSim(['B']);

    const offer = deliver(sim); // A to B, driving into B's dead end

    expect(offer.type).toBe('dock');
    expect(sim.state.order).toBe(null);
    expect(lineOf(sim, 'base').amount).toBe(100);
    expect(lineOf(sim, 'dock')).toBeUndefined();
  });

  test('reversing in crooked delivers at normal pay, with no dock line', () => {
    const sim = dockSim();

    reverseIntoA(sim, 1);

    expect(Math.abs(sim.state.truck.heading)).toBeGreaterThan(dockHeading);
    expect(lineOf(sim, 'base').amount).toBe(100);
    expect(lineOf(sim, 'dock')).toBeUndefined();
  });

  test('reversing in straight but off the centre line delivers at normal pay, with no dock line', () => {
    const sim = dockSim();
    acceptFrom(sim, 'B');
    parkAt(sim, 'B');
    drive(sim, loadTime + 0.1, IDLE);
    sim.state.truck.x = 1.5 * TILE;
    // An S-bend in reverse shifts the truck sideways and leaves it straight again.
    timeUntil(sim, { ...BRAKE, steer: 1 }, () => sim.state.truck.heading > 0.6, 10);
    timeUntil(sim, { ...BRAKE, steer: -1 }, () => sim.state.truck.heading <= 0, 10);
    backUpToA(sim, 0.5);
    expect(Math.abs(sim.state.truck.heading)).toBeLessThan(dockHeading);
    expect(Math.abs(sim.state.truck.x - 1.5 * TILE)).toBeGreaterThan(tables.orders.dockCentre);

    drive(sim, loadTime + 0.1, IDLE);

    expect(sim.state.order).toBe(null);
    expect(lineOf(sim, 'dock')).toBeUndefined();
  });

  test('a fragile + dock order pays both bonus lines', () => {
    const glass = { name: 'Glas', weight: 4, fragile: true };
    const sim = dockSim(['A'], tierOf('fragileDock'), [glass]);

    const offer = reverseIntoA(sim);

    expect(offer.type).toBe('fragileDock');
    expect(lineOf(sim, 'fragile').amount).toBeGreaterThan(30); // a little damage from braking out of reverse
    expect(lineOf(sim, 'dock').amount).toBe(25);
  });

  test('a successful dock adds rank points', () => {
    const { dockPoints } = tables.rank;
    // The same drive with A as a plain spot gives the points without the dock.
    const pallets = [{ name: 'Paletten', weight: 6 }];
    const plain = dockSim([], tierOf('dock'), pallets);
    reverseIntoA(plain);
    const docked = dockSim(['A'], tierOf('dock'), pallets);
    reverseIntoA(docked);

    expect(dockPoints).toBeGreaterThan(0);
    expect(docked.state.profile.rankPoints).toBe(plain.state.profile.rankPoints + dockPoints);
  });
});

describe('Sim: route', () => {
  // A ring road: A's zone is the tile below A, B's the tile right of B. The truck starts on the top row
  // at column 3, facing east. A's zone is 7 tiles away round the left, 11 round the right; B's 5 and 13.
  const RING = `
    .......
    .#####.
    .A###B.
    .......`;
  const tileOf = (sim) => ({ col: Math.floor(sim.state.truck.x / TILE), row: Math.floor(sim.state.truck.z / TILE) });
  const zoneOf = (map, id) => map.spots.find((s) => s.id === id).zoneTile;

  test('the route is empty with no active order', () => {
    const sim = laneSim();
    sim.requestOffers();
    drive(sim, 0.5, GAS);

    expect(sim.state.route).toEqual([]);
  });

  test('before loading the route ends at the pickup, after loading at the drop-off, and empties on delivery', () => {
    const sim = laneSim();
    const map = parseMap(LANE, tables);
    acceptFrom(sim, 'B');

    expect(sim.state.route[0]).toEqual(tileOf(sim));
    expect(sim.state.route.at(-1)).toEqual(zoneOf(map, 'B'));

    parkAt(sim, 'B');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expect(sim.state.route.at(-1)).toEqual(zoneOf(map, 'A'));

    parkAt(sim, 'A');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expect(sim.state.route).toEqual([]);
  });

  test('on a known grid the route is a shortest road path from the truck tile', () => {
    const map = parseMap(RING, tables);
    const sim = createSim(tables, map, seeded(1));
    const [offer] = sim.requestOffers();
    sim.acceptOrder(offer.id);
    const { route } = sim.state;

    expect(route[0]).toEqual({ col: 3, row: 0 });
    expect(route.at(-1)).toEqual(zoneOf(map, offer.pickup));
    expect(route.length).toBe(offer.pickup === 'A' ? 8 : 6);
    route.slice(1).forEach((t, i) => {
      expect(map.isRoad(t.col, t.row)).toBe(true);
      expect(Math.abs(t.col - route[i].col) + Math.abs(t.row - route[i].row)).toBe(1);
    });
  });

  test('off the road the route joins the road where the trip is shortest, not at the nearest road tile', () => {
    // Open ground with roads round it and a row of buildings above it; the left road is a dead end at A.
    // The truck starts on row 4 facing south (placed: row 4 is all crossings, which a reset avoids) and turns
    // left onto the open ground. Row 4 is nearest and A is nearest in a straight line, but the right road is
    // the shortest way to A's zone.
    const grid = `
      A......
      .#####.
      .,,,,,.
      .,,,,,.
      .......
      B......`;
    const map = parseMap(grid, tables);
    const sim = createSim(tables, map, seeded(1));
    Object.assign(sim.state.truck, { x: 3.5 * TILE, z: 4.5 * TILE, heading: 0 });
    acceptFrom(sim, 'A');
    timeUntil(sim, { steer: -1, gas: 0.5, brake: 0 }, () => tileUnder(grid, sim) === ',', 10);
    sim.step(DT, IDLE);

    const { x, z } = sim.state.truck;
    const away = (t) => ((t.col + 0.5) * TILE - x) ** 2 + ((t.row + 0.5) * TILE - z) ** 2;
    const nearest = map.roads.reduce((a, b) => (away(b) < away(a) ? b : a));
    const { route } = sim.state;
    expect(tileUnder(grid, sim)).toBe(',');
    expect(nearest.row).toBe(4);
    expect(route[0].col).toBe(6);
    expect(route.at(-1)).toEqual(zoneOf(map, 'A'));
  });

  test('after the truck moves to another tile, the route starts from the new tile', () => {
    const map = parseMap(RING, tables);
    const sim = createSim(tables, map, seeded(1));
    const [offer] = sim.requestOffers();
    sim.acceptOrder(offer.id);

    timeUntil(sim, GAS, () => tileOf(sim).col === 4, 10);

    expect(sim.state.route[0]).toEqual({ col: 4, row: 0 });
    expect(sim.state.route.at(-1)).toEqual(zoneOf(map, offer.pickup));
    expect(sim.state.route.length).toBe(offer.pickup === 'A' ? 9 : 5); // A: now 8 round the left, 10 round the right
  });
});

describe('Sim: traffic lights', () => {
  // One crossing in the middle; the truck is placed on an approach two tiles out, facing the crossing.
  const CROSSING = `
    ###.###
    ###.###
    ###.###
    ...+...
    ###.###
    ###.###
    ###.###`;
  const EAST = Math.PI / 2;
  const SOUTH = 0;
  const WEST = -Math.PI / 2;
  const money = 500;
  const profile = { ...freshProfile(), money };

  function crossingSim(grid = CROSSING) {
    return createSim(tables, parseMap(grid, tables), seeded(1), profile);
  }

  function placeAt(sim, col, row, heading) {
    Object.assign(sim.state.truck, { x: (col + 0.5) * TILE, z: (row + 0.5) * TILE, heading, speed: 0 });
  }

  // The light the truck meets driving in direction `dir` (a DIRS index).
  const lightFor = (sim, dir) => sim.state.lights.find((l) => l.dir === dir);

  // Drives with full gas until the truck's rear is past the crossing; returns how many fines were taken.
  function driveThrough(sim, done) {
    let fines = 0;
    let last = sim.state.lastFine;
    timeUntil(sim, GAS, () => {
      if (sim.state.lastFine !== last) [fines, last] = [fines + 1, sim.state.lastFine];
      return done();
    }, 20);
    return fines;
  }

  test('a map with light junctions parses into one light per approach, with stop lines at the tile edges', () => {
    const map = parseMap(CROSSING, tables);

    expect(map.isRoad(3, 3)).toBe(true);
    expect(map.lights).toHaveLength(4);
    expect(map.lights.find((l) => l.dir === 1)).toMatchObject({ col: 3, row: 3, x: 3 * TILE, z: 3.5 * TILE });
    expect(map.lights.find((l) => l.dir === 2)).toMatchObject({ col: 3, row: 3, x: 3.5 * TILE, z: 3 * TILE });
    expect(() => parseMap('.+.', tables)).toThrow(/not a crossing/);
  });

  test('speed limit signs stand where streets begin: out of a light junction, and into the city from its edge road', () => {
    // A T on the top edge road, whose street runs south into a light junction.
    const map = parseMap('.......\n###.###\n###.###\n...+...\n###.###', tables);
    const { along, inset } = tables.signs;
    const at = ({ x, z, dir }) => [Math.floor(x / TILE), Math.floor(z / TILE), dir];

    // Not on the edge road itself, one per way out of the light junction.
    expect(map.signs.map(at).sort()).toEqual([[2, 3, 3], [3, 1, 2], [3, 2, 0], [3, 4, 2], [4, 3, 1]].sort());
    // Southbound: `along` m into the street, on the west (right-hand) pavement.
    expect(map.signs.find((s) => at(s)[1] === 1)).toMatchObject({ x: 3 * TILE + inset, z: TILE + along });
    expect(map.colliders.filter((c) => c.kind === 'sign')).toEqual([]); // #43: not solid, so wide turns don't catch on them
  });

  test('each axis cycles green, amber, red with the table timings, never green together, offset per junction', () => {
    const grid = `
      #.##.#
      .+..+.
      #.##.#`;
    const sim = createSim(tables, parseMap(grid, tables), seeded(1));
    const { green, amber, junctionOffset } = tables.lights;
    const ns = (j) => sim.state.lights.find((l) => l.junction === j && l.dir === 2);
    const ew = (j) => sim.state.lights.find((l) => l.junction === j && l.dir === 1);
    const changes = [[], []]; // per junction: [time, phase] of its north–south light
    let t = 0;
    let before = [ns(0).phase, ns(1).phase];
    for (; t < 100; t += DT) {
      sim.step(DT, IDLE);
      for (const j of [0, 1]) {
        expect(ns(j).phase === 'green' && ew(j).phase === 'green').toBe(false);
        if (ns(j).phase !== before[j]) changes[j].push([t, (before[j] = ns(j).phase)]);
      }
    }

    const phases = changes[0].map(([, p]) => p);
    expect(phases.slice(0, 4)).toEqual(['amber', 'red', 'green', 'amber']);
    expect(changes[0][1][0] - changes[0][0][0]).toBeCloseTo(amber, 1);
    expect(changes[0][3][0] - changes[0][2][0]).toBeCloseTo(green, 1);
    // Junction 1 runs ahead by the offset: it turns amber that much earlier.
    expect(changes[0][0][0] - changes[1][0][0]).toBeCloseTo(junctionOffset, 1);
  });

  test('lightsVersion goes up exactly on the steps where some phase changes', () => {
    const sim = crossingSim();
    const phases = () => sim.state.lights.map((l) => l.phase).join();
    let [version, shown, changes] = [sim.state.lightsVersion, phases(), 0];
    for (let t = 0; t < 60; t += DT) {
      sim.step(DT, IDLE);
      expect(sim.state.lightsVersion !== version).toBe(phases() !== shown);
      if (phases() !== shown) changes++;
      [version, shown] = [sim.state.lightsVersion, phases()];
    }
    expect(changes).toBeGreaterThan(2);
  });

  test('crossing the stop line on red fines once', () => {
    const sim = crossingSim();
    placeAt(sim, 1, 3, EAST);
    expect(lightFor(sim, 1).phase).toBe('red');

    const fines = driveThrough(sim, () => sim.state.truck.x > 4.5 * TILE);

    expect(lightFor(sim, 1).phase).toBe('red');
    expect(fines).toBe(1);
    expect(sim.state.lastFine).toEqual({ reason: 'redLight', amount: tables.fines.redLight });
    expect(sim.state.profile.money).toBe(money - tables.fines.redLight);
  });

  test('crossing on green does not fine', () => {
    const sim = crossingSim();
    placeAt(sim, 3, 1, SOUTH);
    expect(lightFor(sim, 2).phase).toBe('green');

    const fines = driveThrough(sim, () => sim.state.truck.z > 4.5 * TILE);

    expect(fines).toBe(0);
    expect(sim.state.lastFine).toBe(null);
    expect(sim.state.profile.money).toBe(money);
  });

  test('crossing on amber does not fine', () => {
    const sim = crossingSim();
    // Front bumper just short of the west stop line, waiting for the east–west light to turn amber.
    Object.assign(sim.state.truck, { x: 3 * TILE - tables.vehicle.length / 2 - 0.5, z: 3.5 * TILE, heading: EAST });
    timeUntil(sim, IDLE, () => lightFor(sim, 1).phase === 'amber', 60);
    expect(lightFor(sim, 1).phase).toBe('amber');

    const fines = driveThrough(sim, () => sim.state.truck.x > 4.5 * TILE);

    expect(fines).toBe(0);
    expect(sim.state.profile.money).toBe(money);
  });

  test('an unsignalled crossing never fines', () => {
    const sim = crossingSim(CROSSING.replace('+', '.'));
    placeAt(sim, 1, 3, EAST);

    const fines = driveThrough(sim, () => sim.state.truck.x > 4.5 * TILE);

    expect(sim.state.lights).toEqual([]);
    expect(fines).toBe(0);
    expect(sim.state.profile.money).toBe(money);
  });

  test('a fine larger than the money leaves 0 and shows the amount taken', () => {
    const sim = createSim(tables, parseMap(CROSSING, tables), seeded(1), { ...profile, money: 30 });
    placeAt(sim, 1, 3, EAST);

    driveThrough(sim, () => sim.state.truck.x > 4.5 * TILE);

    expect(sim.state.lastFine).toEqual({ reason: 'redLight', amount: 30 });
    expect(sim.state.profile.money).toBe(0);
  });

  test('reversing over a stop line on red does not fine; driving forwards back over it does', () => {
    const sim = crossingSim();
    // Facing west on the east arm, then backing west to east through the crossing, front last.
    placeAt(sim, 1, 3, WEST);
    expect(lightFor(sim, 1).phase).toBe('red');
    let fines = 0;
    let last = null;
    const count = () => {
      if (sim.state.lastFine !== last) [fines, last] = [fines + 1, sim.state.lastFine];
    };
    drive(sim, 1, BRAKE); // reverse engages
    timeUntil(sim, BRAKE, () => (count(), sim.state.truck.x > 4.5 * TILE), 30);
    expect(sim.state.truck.x).toBeGreaterThan(4.5 * TILE);
    expect(lightFor(sim, 1).phase).toBe('red');
    expect(fines).toBe(0);

    // Now forwards, westbound into the crossing from the east arm while that approach is red.
    timeUntil(sim, IDLE, () => sim.state.truck.speed === 0, 5);
    timeUntil(sim, IDLE, () => lightFor(sim, 3).phase === 'red', 60);
    timeUntil(sim, GAS, () => (count(), sim.state.truck.x < 2.5 * TILE), 20);
    expect(fines).toBe(1);
    expect(sim.state.lastFine.reason).toBe('redLight');
  });

  test('a signal post is solid: driving onto the pavement corner stops the truck', () => {
    const map = parseMap(CROSSING, tables);
    // The post of the southbound approach stands on the crossing's south-west corner.
    const post = map.lights.find((l) => l.dir === 2).post;
    expect(map.colliders).toContainEqual(expect.objectContaining({ kind: 'signal', minX: post.x - 0.1, maxZ: post.z + 0.1 }));
    const sim = createSim(tables, map, seeded(1), profile);
    // Driving east along the pavement, its right side just over the post's line.
    Object.assign(sim.state.truck, { x: 1.5 * TILE, z: post.z - tables.vehicle.width / 2 + 0.05, heading: EAST, speed: 0 });

    timeUntil(sim, GAS, () => sim.state.collision, 10);

    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.x + tables.vehicle.length / 2).toBeLessThanOrEqual(post.x - 0.1 + 0.5);
  });
});

describe('Sim: traffic', () => {
  const { followGap, stopGap } = tables.traffic;
  const CAR = tables.city.obstacles.car;
  const { tiers } = tables.rank;

  // A ring road. The truck starts on the top row's middle, in the middle of the road, facing east.
  const RING = `
    ################
    ################
    #..............#
    #.############.#
    #.############.#
    #.############.#
    #.############.#
    #.############.#
    #..............#
    ################`;

  // A ring with a bar across, which meets the sides at light junctions. The truck starts on a lone road
  // tile in the middle, out of the cars' way.
  const THETA = `
    ################
    #..............#
    #.############.#
    #+............+#
    #.############.#
    #.#####.######.#
    #.############.#
    #.############.#
    #.############.#
    #..............#
    ################`;

  // Blocks one tile square between roads; big enough for the top tier's cars to fit around the truck.
  const GRID = Array.from({ length: 21 }, (_, row) =>
    Array.from({ length: 21 }, (_, col) => (row % 20 === 0 || col % 20 === 0 || (row % 2 === 0 && col % 2 === 0) ? '#' : '.')).join(''),
  ).join('\n');

  const trafficSim = (grid, seed = 1, profile) => createSim(tables, parseMap(grid, tables), seeded(seed), profile);

  test('the number of AI cars comes from the rank tier, higher tiers bringing more', () => {
    const count = (rankPoints) => {
      const sim = trafficSim(GRID, 1, { ...freshProfile(), rankPoints });
      drive(sim, 1, IDLE);
      return sim.state.traffic.length;
    };

    expect(count(0)).toBe(tiers[0].traffic);
    expect(count(tiers.at(-1).points)).toBe(tiers.at(-1).traffic);
    expect(tiers.at(-1).traffic).toBeGreaterThan(tiers[0].traffic);
  });

  test('AI cars stop behind the standing truck at the following distance and never drive into it', () => {
    const sim = trafficSim(RING, 3);
    const truck = { ...sim.state.truck };
    expect(truck.heading).toBeCloseTo(Math.PI / 2); // east, along the top row
    const overlapsTruck = (c) =>
      Math.abs(c.x - truck.x) < (tables.vehicle.length + CAR.length) / 2 && Math.abs(c.z - truck.z) < (tables.vehicle.width + CAR.width) / 2;

    let hits = 0;
    for (let t = 0; t < 120; t += DT) {
      sim.step(DT, IDLE);
      hits += sim.state.traffic.filter(overlapsTruck).length;
    }

    // Eastbound cars on the truck's row, nearest the truck's rear first.
    const behind = sim.state.traffic
      .filter((c) => Math.abs(c.z - truck.z) < TILE / 2 && Math.abs(c.heading - Math.PI / 2) < 0.01 && c.x < truck.x)
      .sort((a, b) => b.x - a.x);
    expect(hits).toBe(0);
    expect(behind.length).toBeGreaterThan(0);
    expect(behind[0].speed).toBe(0);
    expect(truck.x - tables.vehicle.length / 2 - (behind[0].x + CAR.length / 2)).toBeCloseTo(followGap, 1);
    // The next car keeps its distance to the first.
    if (behind[1]) expect(behind[0].x - behind[1].x - CAR.length).toBeGreaterThanOrEqual(followGap - 0.05);
  });

  test('an AI car stops at the stop line of a red light and drives on at green', () => {
    const sim = trafficSim(THETA, 2);
    // How far the car's front bumper is short of the light's stop line, along the light's direction.
    const short = (car, l) => (l.x - car.x) * DIRS[l.dir][0] + (l.z - car.z) * DIRS[l.dir][1] - CAR.length / 2;
    const approaching = (car, l) =>
      car.lane.col === l.col - DIRS[l.dir][0] && car.lane.row === l.row - DIRS[l.dir][1] && car.lane.to === l.dir;
    let car;
    let light;
    timeUntil(sim, IDLE, () => {
      light = sim.state.lights.find((l) => l.phase === 'red' && (car = sim.state.traffic.find((c) => approaching(c, l) && c.speed === 0 && short(c, l) < 3)));
      return light;
    }, 300);
    expect(light).toBeTruthy();
    expect(short(car, light)).toBeCloseTo(stopGap, 1);

    timeUntil(sim, IDLE, () => light.phase === 'green', 60);
    drive(sim, 5, IDLE);

    expect(sim.state.traffic).toContain(car);
    expect(short(car, light)).toBeLessThan(0);
  });

  test('AI cars cruise at the speed limit and take right turns slower than left ones, both faster than 4.5 m/s', () => {
    const sim = trafficSim(GRID, 5);
    const fastest = { straight: 0, right: 0, left: 0 };
    for (let t = 0; t < 120; t += DT) {
      sim.step(DT, IDLE);
      for (const { lane, speed } of sim.state.traffic) {
        const kind = lane.from === lane.to ? 'straight' : lane.to === (lane.from + 1) % 4 ? 'right' : 'left';
        fastest[kind] = Math.max(fastest[kind], speed);
      }
    }

    expect(fastest.straight).toBeCloseTo(tables.speedLimit / 3.6, 5);
    expect(fastest.right).toBeGreaterThan(4.5);
    expect(fastest.left).toBeGreaterThan(fastest.right);
  });

  test("new cars appear out of the truck's view: on a tile far enough away and off the truck's street", () => {
    const sim = trafficSim(GRID, 4);
    const [near, far] = tables.traffic.spawnDistance;
    const seen = new Set();
    for (let t = 0; t < 90; t += DT) {
      // Move the truck to a corner after a while, so cars left far behind give way to new ones.
      if (t > 30 && t < 30 + DT) Object.assign(sim.state.truck, { x: 1.5 * TILE, z: 1.5 * TILE });
      sim.step(DT, IDLE);
      const { x, z } = sim.state.truck;
      for (const { id, lane } of sim.state.traffic.filter((c) => !seen.has(c.id))) {
        seen.add(id);
        const away = Math.hypot((lane.col + 0.5) * TILE - x, (lane.row + 0.5) * TILE - z);
        expect(away).toBeGreaterThanOrEqual(near);
        expect(away).toBeLessThanOrEqual(far);
        expect(lane.col === Math.floor(x / TILE) || lane.row === Math.floor(z / TILE)).toBe(false);
      }
    }
    expect(seen.size).toBeGreaterThan(tiers[0].traffic); // some cars left and new ones came
  });

  test('traffic is the same for the same seed', () => {
    const run = (seed) => {
      const sim = trafficSim(GRID, seed);
      drive(sim, 20, IDLE);
      return sim.state.traffic.map(({ x, z, heading, speed }) => ({ x, z, heading, speed }));
    };

    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});

describe('Sim: right of way and collisions', () => {
  const { stopGap, laneOffset } = tables.traffic;
  const CAR = tables.city.obstacles.car;
  // No cars of their own: each test adds the ones it needs.
  const quiet = { ...tables, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 0 })) } };
  // An unsignalled crossing at (3, 3); the truck is parked out of the way on the lone tile top left.
  const CROSS = `
    .######
    ###.###
    ###.###
    .......
    ###.###
    ###.###
    ###.###`;
  const [NORTH, EAST, SOUTH, WEST] = [0, 1, 2, 3].map((d) => Math.atan2(DIRS[d][0], DIRS[d][1]));

  function crossSim(profile) {
    const sim = createSim(quiet, parseMap(CROSS, quiet), seeded(1), profile);
    Object.assign(sim.state.truck, { x: 0.5 * TILE, z: 0.5 * TILE, heading: SOUTH });
    return sim;
  }

  // Adds a standing AI car that drives through `tiles` ([col, row] neighbours in order) and on from the
  // start of the first, entering it towards the second. Then places it with a step that takes no time.
  function addCar(sim, id, tiles) {
    const dir = (a, b) => DIRS.findIndex(([dc, dr]) => b[0] - a[0] === dc && b[1] - a[1] === dr);
    const dirs = tiles.slice(1).map((t, i) => dir(tiles[i], t));
    const route = tiles.map(([col, row], i) => ({ col, row, from: dirs[Math.max(0, i - 1)], to: dirs[Math.min(i, dirs.length - 1)] }));
    const car = { id, x: 0, z: 0, heading: 0, speed: 0, lane: route[0], route, s: 0 };
    sim.state.traffic.push(car);
    sim.step(0, IDLE);
    return car;
  }

  // Straight through the crossing from two tiles out, by the direction of travel.
  const through = {
    [NORTH]: [[3, 5], [3, 4], [3, 3], [3, 2], [3, 1]],
    [WEST]: [[5, 3], [4, 3], [3, 3], [2, 3], [1, 3]],
    [SOUTH]: [[3, 1], [3, 2], [3, 3], [3, 4], [3, 5]],
    [EAST]: [[1, 3], [2, 3], [3, 3], [4, 3], [5, 3]],
  };
  const inCrossing = (car) => car.lane.col === 3 && car.lane.row === 3;
  // How far the front bumper of a northbound car is short of the crossing.
  const shortOfCrossing = (car) => car.z - CAR.length / 2 - 4 * TILE;

  // Steps `seconds`, noting when each car first is in the crossing and the most there at once.
  function watch(sim, cars, seconds, input = IDLE) {
    const entered = new Map();
    let most = 0;
    for (let t = 0; t < seconds; t += DT) {
      sim.step(DT, input);
      const inside = cars.filter((c) => sim.state.traffic.includes(c) && inCrossing(c));
      for (const c of inside) if (!entered.has(c)) entered.set(c, t);
      most = Math.max(most, inside.length);
    }
    return { entered, most };
  }

  test('an AI car gives way to a car coming from its right', () => {
    const sim = crossSim();
    const a = addCar(sim, 1, through[NORTH]);
    const b = addCar(sim, 2, through[WEST]); // on a's right, arriving at the same time

    let waited = false;
    for (let t = 0; t < 8 && !waited; t += DT) {
      sim.step(DT, IDLE);
      waited = a.speed === 0 && shortOfCrossing(a) > 0;
    }
    expect(waited).toBe(true);
    expect(shortOfCrossing(a)).toBeCloseTo(stopGap, 1);
    const { entered, most } = watch(sim, [a, b], 15);

    expect(entered.has(b)).toBe(true);
    expect(entered.has(a)).toBe(true);
    expect(entered.get(b)).toBeLessThan(entered.get(a));
    expect(most).toBe(1);
  });

  test('an AI car gives way to the truck driving in from its right, and goes once the truck is through', () => {
    const sim = crossSim();
    // The truck stands on the east arm in its lane, 22 m short of the crossing, and drives in.
    Object.assign(sim.state.truck, { x: 4 * TILE + 22 + tables.vehicle.length / 2, z: 3.5 * TILE - laneOffset, heading: WEST });
    const a = addCar(sim, 1, through[NORTH]);

    let waited = false;
    timeUntil(sim, GAS, () => {
      waited ||= a.speed === 0 && Math.abs(shortOfCrossing(a) - stopGap) < 0.1;
      return sim.state.truck.x + tables.vehicle.length / 2 < 3 * TILE; // its rear is through
    }, 20);
    expect(waited).toBe(true);
    expect(inCrossing(a)).toBe(false);
    const { entered } = watch(sim, [a], 10);

    expect(entered.has(a)).toBe(true);
    expect(sim.state.lastFine).toBe(null);
  });

  test('a truck waiting at the crossing lets the car on its left go', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, { x: 4 * TILE + 5 + tables.vehicle.length / 2, z: 3.5 * TILE - laneOffset, heading: WEST });
    const a = addCar(sim, 1, through[NORTH]);

    const { entered } = watch(sim, [a], 10);

    expect(entered.has(a)).toBe(true);
  });

  test('a truck waiting at the crossing lets the car on its left go, even with a car queued behind it', () => {
    // #43 QA: the car behind can't go first, so it mustn't hold the crossing for its approach.
    const sim = crossSim();
    Object.assign(sim.state.truck, { x: 4 * TILE + 3 + tables.vehicle.length / 2, z: 3.5 * TILE - laneOffset, heading: WEST });
    const behind = addCar(sim, 1, through[WEST]);
    const a = addCar(sim, 2, through[NORTH]);

    const { entered } = watch(sim, [a, behind], 10);

    expect(entered.has(a)).toBe(true);
    expect(entered.has(behind)).toBe(false);
  });

  test('with the truck waiting on one approach, three cars arriving at once all get through', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, { x: 3.5 * TILE + laneOffset, z: 4 * TILE + 5 + tables.vehicle.length / 2, heading: NORTH });
    const cars = [WEST, SOUTH, EAST].map((h, i) => addCar(sim, i + 1, through[h]));

    const { entered } = watch(sim, cars, 40);

    expect(entered.size).toBe(3);
  });

  test('four cars arriving at once all get through, one at a time', () => {
    const sim = crossSim();
    const cars = [NORTH, WEST, SOUTH, EAST].map((h, i) => addCar(sim, i + 1, through[h]));

    const { entered, most } = watch(sim, cars, 40);

    expect(entered.size).toBe(4);
    expect(most).toBe(1);
    for (const c of cars) expect(sim.state.traffic.includes(c) && inCrossing(c)).toBe(false);
  });

  test('oncoming cars through two touching crossings take turns instead of waiting for each other inside', () => {
    const grid = `
      .#######
      ###.####
      ###.####
      ........
      ####.###
      ####.###`;
    const sim = createSim(quiet, parseMap(grid, quiet), seeded(1));
    Object.assign(sim.state.truck, { x: 0.5 * TILE, z: 0.5 * TILE, heading: SOUTH });
    // The westbound car starts at the edge of (4, 3), as a car can appear in the middle of any road tile.
    const east = addCar(sim, 1, [[2, 3], [3, 3], [4, 3], [5, 3], [6, 3]]);
    const west = addCar(sim, 2, [[4, 3], [3, 3], [2, 3], [1, 3]]);
    const pastBoth = (car) => !sim.state.traffic.includes(car) || (car.heading > 0 ? car.x > 5 * TILE : car.x < 3 * TILE);

    timeUntil(sim, IDLE, () => pastBoth(east) && pastBoth(west), 30);

    expect(pastBoth(east)).toBe(true);
    expect(pastBoth(west)).toBe(true);
  });

  const tileOf = ({ x, z }) => [Math.floor(x / TILE), Math.floor(z / TILE)];

  test('back on the road never puts the truck on an AI car', () => {
    const sim = crossSim();
    const car = addCar(sim, 1, [[3, 4], [3, 3], [3, 2]]);
    // Standing across the middle of the south arm, where the truck's north–south pose would be.
    Object.assign(car, { x: 3.5 * TILE, z: 4.5 * TILE, heading: EAST });
    Object.assign(sim.state.truck, { x: 3.5 * TILE, z: 4.5 * TILE + 1 });

    sim.resetToRoad();

    expect(tileOf(sim.state.truck)).not.toEqual([3, 4]);
  });

  test('back on the road avoids crossings, where the cars would wait for the truck', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, { x: 3.5 * TILE, z: 3.5 * TILE + 1 });

    sim.resetToRoad();

    expect(tileOf(sim.state.truck)).toEqual([3, 4]); // the nearest tile that isn't the crossing
  });

  test('an AI car keeps out of a crossing whose exit is queued up, and lets the others go meanwhile', () => {
    const sim = crossSim();
    // The truck stands in the northbound lane 2 m past the crossing.
    Object.assign(sim.state.truck, { x: 3.5 * TILE + laneOffset, z: 3 * TILE - 2 - tables.vehicle.length / 2, heading: NORTH });
    const a = addCar(sim, 1, through[NORTH]);
    const b = addCar(sim, 2, through[EAST]); // a is on its right, but waiting for room

    const { entered } = watch(sim, [a, b], 15);

    expect(entered.has(a)).toBe(false);
    expect(a.speed).toBe(0);
    expect(shortOfCrossing(a)).toBeCloseTo(stopGap, 1);
    expect(entered.has(b)).toBe(true);

    // Once the truck drives off, a goes.
    const { entered: later } = watch(sim, [a], 10, GAS);
    expect(later.has(a)).toBe(true);
    expect(sim.state.lastFine).toBe(null);
  });

  describe('left turns at a light junction', () => {
    // The north–south axis is green for the first 14 s.
    const LIGHT = CROSS.replace('.......', '...+...');
    const lightSim = () => {
      const sim = createSim(quiet, parseMap(LIGHT, quiet), seeded(1));
      Object.assign(sim.state.truck, { x: 0.5 * TILE, z: 0.5 * TILE, heading: SOUTH });
      return sim;
    };
    const northThenWest = [[3, 5], [3, 4], [3, 3], [2, 3], [1, 3]];

    test('a car turning left waits for the oncoming car going straight on', () => {
      const sim = lightSim();
      const a = addCar(sim, 1, northThenWest);
      const b = addCar(sim, 2, through[SOUTH]);

      const { entered, most } = watch(sim, [a, b], 12);

      expect(sim.state.lights.find((l) => l.dir === 0).phase).toBe('green');
      expect(entered.get(b)).toBeLessThan(entered.get(a));
      expect(most).toBe(1);
    });

    test('two cars turning left from opposite sides, one with a car queued behind it, all go', () => {
      // #43 review: the northbound turner waits for the southbound car going straight, which is behind the
      // southbound turner; that one mustn't wait for the northbound turner then.
      const sim = lightSim();
      const a = addCar(sim, 1, northThenWest);
      const b = addCar(sim, 2, [[3, 2], [3, 3], [4, 3], [5, 3]]);
      const c = addCar(sim, 3, through[SOUTH]);

      const { entered } = watch(sim, [a, b, c], 14);

      expect([a, b, c].map((car) => entered.has(car))).toEqual([true, true, true]);
    });

    test('two cars turning left from opposite sides, each with a car going straight queued behind it, all go', () => {
      // #46: each turner waited for the oncoming car going straight, which can't go before the other turner.
      const sim = lightSim();
      const a = addCar(sim, 1, northThenWest.slice(1));
      const b = addCar(sim, 2, through[NORTH]);
      const c = addCar(sim, 3, [[3, 2], [3, 3], [4, 3], [5, 3]]);
      const d = addCar(sim, 4, through[SOUTH]);

      const { entered } = watch(sim, [a, b, c, d], 14);

      expect([a, b, c, d].map((car) => entered.has(car))).toEqual([true, true, true, true]);
    });

    test('two cars turning left from opposite sides both go', () => {
      const sim = lightSim();
      const a = addCar(sim, 1, northThenWest);
      const c = addCar(sim, 2, [[3, 1], [3, 2], [3, 3], [4, 3], [5, 3]]);

      const { entered } = watch(sim, [a, c], 12);

      expect(entered.has(a)).toBe(true);
      expect(entered.has(c)).toBe(true);
    });

    test('a car turning left waits for the truck coming the other way', () => {
      const sim = lightSim();
      Object.assign(sim.state.truck, { x: 3.5 * TILE - laneOffset, z: 1.5 * TILE, heading: SOUTH });
      const a = addCar(sim, 1, northThenWest.slice(1)); // one tile out, so it would be in first
      let truckOut = Infinity; // when the truck's front leaves the junction
      const entered = new Map();
      for (let t = 0; t < 12; t += DT) {
        sim.step(DT, GAS);
        if (truckOut === Infinity && sim.state.truck.z + tables.vehicle.length / 2 > 4 * TILE) truckOut = t;
        if (inCrossing(a) && !entered.has(a)) entered.set(a, t);
      }

      expect(truckOut).toBeLessThan(12);
      expect(entered.get(a)).toBeGreaterThan(truckOut);
      expect(sim.state.lastFine).toBe(null);
    });
  });

  test('driving into an AI car fines once per contact, stops both, floors money at 0 and damages fragile cargo', () => {
    const glass = { name: 'Glas', weight: 4, fragile: true };
    const onlyGlass = { ...quiet, orders: { ...quiet.orders, cargo: [glass] } };
    const profile = { ...freshProfile(), money: 30, rankPoints: tables.rank.tiers[tables.orders.types.fragile].points };
    // A long north–south lane: A's zone is the tile below A.
    const sim = createSim(onlyGlass, parseMap(`#A#\n${'#.#\n'.repeat(14)}#B#`, onlyGlass), seeded(1), profile);
    acceptFrom(sim, 'A');
    parkAt(sim, 'A');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expect(sim.state.order).toMatchObject({ type: 'fragile', phase: 'dropoff', damage: 0 });

    // The truck faces south in the northbound lane; a northbound car comes up and stops in front of it.
    Object.assign(sim.state.truck, { x: 1.5 * TILE + laneOffset, z: 6.5 * TILE, heading: SOUTH });
    const car = addCar(sim, 1, [[1, 10], [1, 9], [1, 8]]);
    drive(sim, 15, IDLE);
    expect(car.speed).toBe(0);
    expect(sim.state.lastFine).toBe(null);

    let fines = 0;
    let last = null;
    let stopped = false;
    for (let t = 0; t < 4; t += DT) {
      sim.step(DT, GAS); // into the car, then pushing on against it
      if (sim.state.lastFine !== last) {
        [fines, last] = [fines + 1, sim.state.lastFine];
        stopped = sim.state.truck.speed === 0 && car.speed === 0;
      }
    }

    expect(fines).toBe(1);
    expect(stopped).toBe(true);
    expect(car.speed).toBe(0);
    expect(sim.state.lastFine).toEqual({ reason: 'collision', amount: 30 }); // all the money there was
    expect(sim.state.profile.money).toBe(0);
    expect(sim.state.order.damage).toBe(tables.orders.hitDamage);

    // Backing well off and driving into it again is a new contact.
    drive(sim, 2, BRAKE);
    drive(sim, 0.5, IDLE);
    timeUntil(sim, GAS, () => sim.state.lastFine !== last, 10);
    expect(sim.state.lastFine).not.toBe(last);
  });

  test('a car turned across the truck’s corner that touches it costs no fine and stops the truck; unturned it would not touch', () => {
    // A car whose long side points at the truck's front right corner, its centre 1.4 m out each way: turned
    // 45° its front reaches 2.25 m along the diagonal, into the truck; unturned its box stays 0.45 m clear.
    // Placed there, the car drove into the truck, which rolls on at 1 m/s.
    const contact = (heading) => {
      const sim = crossSim({ ...freshProfile(), money: 500 });
      const car = addCar(sim, 1, through[NORTH]);
      const { x, z } = sim.state.truck;
      Object.assign(car, { x: x - tables.vehicle.width / 2 - 1.4, z: z + tables.vehicle.length / 2 + 1.4, heading });
      sim.state.truck.speed = 1;
      sim.step(DT, IDLE);
      return { fine: sim.state.lastFine, stopped: sim.state.truck.speed === 0 };
    };

    expect(contact(-Math.PI / 4)).toEqual({ fine: null, stopped: true });
    expect(contact(0)).toEqual({ fine: null, stopped: false });
    expect(contact(Math.PI / 2)).toEqual({ fine: null, stopped: false });
  });

  test('pushing on into a car that drove into the truck is the truck’s move: it stops and is fined once', () => {
    // The truck stands the wrong way in the northbound lane of the south arm, its front 0.5 m into a car
    // whose lane starts there: the car drove into it, which costs nothing and holds the car.
    const sim = crossSim({ ...freshProfile(), money: 500 });
    const car = addCar(sim, 1, through[NORTH]);
    const { truck } = sim.state;
    Object.assign(truck, { x: car.x, z: car.z - CAR.length / 2 - tables.vehicle.length / 2 + 0.5, heading: SOUTH });
    sim.step(DT, IDLE);
    expect(sim.state.lastFine).toBe(null);
    const start = { x: truck.x, z: truck.z };

    const fines = new Set();
    for (let t = 0; t < 2; t += DT) {
      sim.step(DT, GAS); // into the car, then pushing on against it
      if (sim.state.lastFine) fines.add(sim.state.lastFine);
    }

    expect([...fines]).toEqual([{ reason: 'collision', amount: tables.fines.collision }]);
    expect(Math.hypot(truck.x - start.x, truck.z - start.z)).toBeLessThan(0.01);
    expect(car.speed).toBe(0);

    // Backing away is free.
    drive(sim, 1.5, BRAKE);
    expect(truck.z).toBeLessThan(start.z - 0.5);
    expect(sim.state.lastFine).toBe([...fines][0]);
  });

  test('driving on past a car that drove into the truck’s side is free: sliding along it isn’t pushing', () => {
    // The truck stands facing north beside a car whose lane starts there, the car 2 m ahead of the truck's
    // middle and 0.3 m into its right side.
    const sim = crossSim({ ...freshProfile(), money: 500 });
    const car = addCar(sim, 1, through[NORTH]);
    const { truck } = sim.state;
    Object.assign(truck, { x: car.x - CAR.width / 2 + 0.3 - tables.vehicle.width / 2, z: car.z + 2, heading: NORTH });
    sim.step(DT, IDLE);
    const start = truck.z;

    drive(sim, 2, GAS);

    expect(truck.z).toBeLessThan(start - 2);
    expect(sim.state.lastFine).toBe(null);
  });

  describe('the truck standing in a crossing or a light junction', () => {
    const LIGHT = CROSS.replace('.......', '...+...');
    // From two tiles out on every approach, turning right, going straight and turning left.
    const routes = [
      [[3, 5], [3, 4], [3, 3], [4, 3], [5, 3]],
      [[1, 3], [2, 3], [3, 3], [3, 4], [3, 5]],
      [[3, 1], [3, 2], [3, 3], [2, 3], [1, 3]],
      [[5, 3], [4, 3], [3, 3], [3, 2], [3, 1]],
      through[NORTH],
      through[EAST],
      through[SOUTH],
      through[WEST],
      [[3, 5], [3, 4], [3, 3], [2, 3], [1, 3]],
      [[1, 3], [2, 3], [3, 3], [3, 2], [3, 1]],
    ];
    // Middle (in every car's way), turned, and half in it on the southbound lane.
    const poses = [
      { x: 3.5 * TILE, z: 3.5 * TILE, heading: EAST },
      { x: 3.5 * TILE + 1, z: 3.5 * TILE - 1, heading: EAST - 0.6 },
      { x: 3.5 * TILE - laneOffset, z: 3 * TILE, heading: SOUTH },
    ];

    // #43: the truck holds only the ways through that it blocks, so some cars pass it where it stands half in.
    test.each([['an unsignalled crossing', CROSS], ['a light junction', LIGHT]])(
      'in %s is never driven into: the cars it is in the way of wait outside, the others pass',
      (_, grid) => {
        const passed = poses.map(() => 0);
        for (const [k, pose] of poses.entries()) {
          // One car per approach at a time, each run cycling through the routes.
          for (let first = 0; first < routes.length; first += 4) {
            const sim = createSim(quiet, parseMap(grid, quiet), seeded(1));
            Object.assign(sim.state.truck, pose);
            const cars = routes.slice(first, first + 4).map((r, i) => addCar(sim, i + 1, r));
            let into = 0;
            let entered = 0;
            for (let t = 0; t < 40; t += DT) {
              sim.step(DT, IDLE);
              into += cars.filter((c) => sim.state.traffic.includes(c) && vehiclesOverlap(c, CAR, sim.state.truck, tables.vehicle)).length;
              entered += cars.filter((c) => sim.state.traffic.includes(c) && inCrossing(c)).length;
            }
            const left = cars.filter((c) => sim.state.traffic.includes(c));

            expect(into).toBe(0);
            if (k === 0) expect(entered).toBe(0);
            expect(left.filter(inCrossing)).toEqual([]); // nobody waits inside
            expect(left.every((c) => c.speed === 0)).toBe(true);
            passed[k] += cars.length - left.length;
          }
        }
        expect(passed[0]).toBe(0);
        expect(passed[2]).toBeGreaterThan(0);
      },
    );

    test('with its nose just past the stop line it holds only the lane it blocks', () => {
      // On the east arm facing west, standing at red with its front bumper `into` m past the stop line; the
      // north–south axis is green. 1 m in blocks no way through, 5 m in the northbound lane.
      const standing = (into) => {
        const sim = createSim(quiet, parseMap(LIGHT, quiet), seeded(1));
        Object.assign(sim.state.truck, { x: 4 * TILE + tables.vehicle.length / 2 - into, z: 3.5 * TILE - laneOffset, heading: WEST });
        const cars = [NORTH, SOUTH].map((h, i) => addCar(sim, i + 1, through[h]));
        const { entered } = watch(sim, cars, 12);
        expect(sim.state.lights.find((l) => l.dir === 3).phase).toBe('red');
        return cars.map((c) => entered.has(c));
      };

      expect(standing(1)).toEqual([true, true]);
      expect(standing(5)).toEqual([false, true]);
    });
  });
});

describe('Sim: collider broad phase', () => {
  test('the indexed collision check agrees with testing every collider, on tile borders, corners and turned', () => {
    const noCars = { ...tables, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 0 })) } };
    const map = parseMap(city, tables);
    // The city's colliders each sit inside one tile; add one spanning several on the open ground, as a longer obstacle would.
    map.colliders.push({ kind: 'wide', minX: 25.6 * TILE, maxX: 28.3 * TILE, minZ: 25.2 * TILE, maxZ: 27.7 * TILE });
    const sim = createSim(noCars, map, seeded(1));
    const { length, width } = tables.vehicle;
    // Brute force: the truck's box against the map edge and every collider, touching isn't overlapping.
    const blocked = ({ x, z, heading }) => {
      const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
      const [l, w] = [length / 2, width / 2];
      const cs = [[l, w], [l, -w], [-l, -w], [-l, w]].map(([a, b]) => ({ x: x + fx * a - fz * b, z: z + fz * a + fx * b }));
      if (cs.some((c) => c.x < 0 || c.z < 0 || c.x > map.cols * TILE || c.z > map.rows * TILE)) return true;
      return map.colliders.some((b) => {
        if (cs.every((c) => c.x <= b.minX) || cs.every((c) => c.x >= b.maxX)) return false;
        if (cs.every((c) => c.z <= b.minZ) || cs.every((c) => c.z >= b.maxZ)) return false;
        const bc = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]];
        const along = bc.map(([px, pz]) => (px - x) * fx + (pz - z) * fz);
        const right = bc.map(([px, pz]) => -(px - x) * fz + (pz - z) * fx);
        if (along.every((a) => a >= l) || along.every((a) => a <= -l)) return false;
        return !(right.every((r) => r >= w) || right.every((r) => r <= -w));
      });
    };
    // Every light junction (signal posts), the map's corners, the tiles round the wide box, and every 11th tile;
    // on each, the tile corner, border midpoints and inner points, at headings along, across and between the axes.
    const tiles = [...map.lights, { col: 0, row: 0 }, { col: map.cols - 1, row: map.rows - 1 }];
    for (let col = 24; col <= 29; col++) for (let row = 24; row <= 28; row++) tiles.push({ col, row });
    for (let i = 0; i < map.cols * map.rows; i += 11) tiles.push({ col: i % map.cols, row: Math.floor(i / map.cols) });
    const mismatches = [];
    let hits = 0;
    let poses = 0;
    for (const { col, row } of tiles) {
      for (const fx of [0, 0.25, 0.5, 0.9]) {
        for (const fz of [0, 0.25, 0.5, 0.9]) {
          for (const heading of [0, 0.3, Math.PI / 4, Math.PI / 2, 2.5, Math.PI]) {
            const pose = { x: (col + fx) * TILE, z: (row + fz) * TILE, heading };
            Object.assign(sim.state.truck, pose, { speed: 0 });
            sim.step(DT, IDLE);
            const expected = blocked(pose);
            if (sim.state.collision !== expected) mismatches.push({ ...pose, expected });
            hits += expected;
            poses++;
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
    expect(hits).toBeGreaterThan(poses / 10); // both outcomes well represented
    expect(hits).toBeLessThan(poses * 0.9);
  });
});

describe('Sim: traffic soak', () => {
  // The city with 40 cars near the truck, over several seeds. The parked truck tours awkward spots, 20 s each so the queues it
  // causes clear, then random poses anywhere on the road; besides, the truck drives the ?perf&auto loop and
  // reverses back and forth. A car driving into the truck shows as a car's footprint newly overlapping the
  // truck's after a step: the truck's own move into a car is undone, so it never leaves them overlapping. Cars
  // driving into each other show the same way (#43).
  const busy = {
    ...tables,
    rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 40 })) },
    traffic: { ...tables.traffic, spawnDistance: [45, 120], despawnDistance: 140 }, // the cars kept around the truck
  };
  const map = parseMap(city, busy);
  const [NORTH, EAST] = [0, 1].map((d) => Math.atan2(DIRS[d][0], DIRS[d][1]));
  const CAR = tables.city.obstacles.car;
  // Within 6 m of the truck's footprint, as a car waiting at the crossing the truck stands in.
  const CLOSE = { length: tables.vehicle.length + 12, width: tables.vehicle.width + 12 };
  const { laneOffset } = tables.traffic;
  const at = (col, row, heading, dx = 0, dz = 0) => ({ x: (col + 0.5) * TILE + dx, z: (row + 0.5) * TILE + dz, heading, speed: 0 });
  const spots = {
    'in a crossing': at(8, 8, EAST),
    'turned in a crossing': at(36, 22, EAST - 0.6, 2, -1),
    'in a light junction': at(15, 15, NORTH),
    'half in a light junction': at(43, 29, EAST, -7),
    'across both lanes': at(11, 8, NORTH),
    'at an angle': at(32, 36, EAST + Math.PI / 4, 0, 1),
    'half on the pavement': at(18, 43, EAST, 0, 4.5),
    'the wrong way in a lane': at(25, 22, EAST, 0, -laneOffset),
    'just past a crossing': at(9, 15, EAST, 0, laneOffset),
  };

  // Steps `seconds` with the truck driven by `drive(sim)` (returns step i → input), or parked at each of `poses`
  // in turn for an equal share of the time. Returns the car-made contacts with the truck and between cars and, per
  // pose, the cars that came close.
  function soak(seed, seconds, drive, poses = []) {
    const sim = createSim(busy, map, seeded(seed));
    const input = drive?.(sim);
    const steps = seconds * 60;
    const near = poses.map(() => new Set());
    let touching = new Set(); // ids of the cars touching the truck, and 'id,id' of pairs of cars touching
    let contacts = 0;
    let crashes = 0;
    for (let i = 0; i < steps; i++) {
      const k = Math.floor((i * poses.length) / steps);
      if (poses.length && i === Math.ceil((k * steps) / poses.length)) Object.assign(sim.state.truck, poses[k]);
      sim.step(DT, input ? input(i) : IDLE);
      const { truck, traffic } = sim.state;
      const now = new Set();
      for (const [a, car] of traffic.entries()) {
        if (poses.length && vehiclesOverlap(car, CAR, truck, CLOSE)) near[k].add(car.id);
        if (vehiclesOverlap(car, CAR, truck, tables.vehicle)) now.add(car.id);
        for (const other of traffic.slice(a + 1)) {
          const pair = `${Math.min(car.id, other.id)},${Math.max(car.id, other.id)}`;
          if ((car.x - other.x) ** 2 + (car.z - other.z) ** 2 < CAR.length ** 2 && vehiclesOverlap(car, CAR, other, CAR)) now.add(pair);
        }
      }
      for (const id of now) if (!touching.has(id)) typeof id === 'number' ? contacts++ : crashes++;
      touching = now;
    }
    return { contacts, crashes, near: near.map((n) => n.size) };
  }

  test('AI cars never drive into the truck or into each other', () => {
    const names = Object.keys(spots);
    const near = names.map(() => 0);
    let contacts = 0;
    let crashes = 0;
    const add = (run) => {
      contacts += run.contacts;
      crashes += run.crashes;
      return run;
    };
    for (const seed of [1, 2, 3]) {
      const tour = add(soak(seed, 30 * names.length, null, Object.values(spots)));
      tour.near.forEach((n, i) => (near[i] += n));
      // Anywhere across a road tile, any heading.
      const random = seeded(seed + 100);
      const poses = Array.from({ length: 10 }, () => {
        const { col, row } = map.roads[Math.floor(random() * map.roads.length)];
        return at(col, row, random() * 2 * Math.PI, (random() - 0.5) * 0.6 * TILE, (random() - 0.5) * 0.6 * TILE);
      });
      add(soak(seed, 20 * poses.length, null, poses));
      const autopilot = (sim) => {
        const pilot = createAutopilot(sim, map, busy);
        pilot.place();
        return () => pilot.update(DT);
      };
      add(soak(seed, 120, autopilot));
      const reversing = (sim) => {
        Object.assign(sim.state.truck, at(20, 8, EAST, 0, laneOffset));
        return (i) => (i % 600 < 200 ? GAS : BRAKE);
      };
      add(soak(seed, 120, reversing));
    }

    expect(contacts).toBe(0);
    expect(crashes).toBe(0);
    // Cars came close at every spot.
    for (const [i, name] of names.entries()) expect([name, near[i]]).not.toEqual([name, 0]);
  }, 120_000);
});

describe('Sim: traffic gridlock soak', () => {
  // #46: over long runs at the top tier's count and at 40, with the truck parked off the road (cars only meet
  // cars) or driving the ?perf&auto loop, no car stands for more than `limit` s, not counting the time it waits
  // at a light that isn't green, near the truck, or queued behind the truck or a car that is moving or itself
  // waiting so.
  // s; "about 30" in #46. At 40 cars round the truck's block, right before left can hold a car up to ~36 s behind
  // a steady stream from its right, which then lets it go; the gridlocks held cars 90–414 s.
  const limit = 40;
  const { stopSpeed } = tables.vehicle;

  // shortcut: "queued" is the nearest vehicle centre up to 12 m ahead within 1.5 m of the car's heading, and a
  // light is "ahead" within 40 m of route, both judged from straight-line poses; good enough for queues in
  // lanes, which is all the Sim has. Upgrade if turns or longer cars start to fool it.
  function waiting(car, sim, excused) {
    if (excused.has(car)) return excused.get(car);
    excused.set(car, false); // a cycle of cars each queued behind the next is stuck
    const { traffic, truck, lights } = sim.state;
    let ok = car.speed >= stopSpeed || Math.hypot(car.x - truck.x, car.z - truck.z) < 30;
    let dist = -car.s;
    for (const p of car.route) {
      if (ok || dist > 40) break;
      ok = lights.some((l) => l.col === p.col && l.row === p.row && l.dir === p.from && l.phase !== 'green');
      dist += TILE;
    }
    if (!ok) {
      const [fx, fz] = [Math.sin(car.heading), Math.cos(car.heading)];
      let ahead = null;
      let best = 12;
      for (const o of [...traffic, truck]) {
        const along = (o.x - car.x) * fx + (o.z - car.z) * fz;
        const side = -(o.x - car.x) * fz + (o.z - car.z) * fx;
        if (o !== car && along > 0 && along < best && Math.abs(side) < 1.5) [ahead, best] = [o, along];
      }
      ok = ahead === truck || (ahead !== null && waiting(ahead, sim, excused));
    }
    excused.set(car, ok);
    return ok;
  }

  // The longest any car was stuck, in s, with the truck parked off the road or driven by the autopilot.
  function longestStuck(cars, seed, auto) {
    const counted = { ...tables, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: cars })) } };
    const map = parseMap(city, counted);
    const sim = createSim(counted, map, seeded(seed));
    let input = () => IDLE;
    if (auto) {
      const pilot = createAutopilot(sim, map, counted);
      pilot.place();
      input = () => pilot.update(DT);
    } else {
      Object.assign(sim.state.truck, { x: 25.5 * TILE, z: 11.5 * TILE, heading: 0, speed: 0 }); // in a block
    }
    const stuck = new Map(); // car → s
    let longest = 0;
    for (let i = 0; i < 600 * 60; i++) {
      sim.step(DT, input());
      const excused = new Map();
      for (const car of sim.state.traffic) {
        // The count pauses while the car waits and starts over once it moves, so a gridlock at a light still adds up.
        const s = car.speed >= stopSpeed ? 0 : (stuck.get(car) ?? 0) + (waiting(car, sim, excused) ? 0 : DT);
        stuck.set(car, s);
        longest = Math.max(longest, s);
      }
    }
    return longest;
  }

  const top = tables.rank.tiers.at(-1).traffic;
  for (const cars of [top, 40]) {
    for (const auto of [false, true]) {
      test(`${cars} cars, the truck ${auto ? 'on the autopilot loop' : 'parked'}: no car stuck for over ${limit} s`, () => {
        const longest = [1, 2, 3].map((seed) => Math.round(longestStuck(cars, seed, auto)));
        expect(longest.filter((s) => s > limit)).toEqual([]);
      }, 120_000);
    }
  }
});
