import { describe, expect, test } from 'vitest';
import { createSim, freshProfile } from './sim.js';
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

function acceptFrom(sim, pickup) {
  const offer = sim.requestOffers().find((o) => o.pickup === pickup);
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
    // The truck starts on the bottom row facing east and turns left onto the open ground. The bottom row
    // is nearest and A is nearest in a straight line, but the right road is the shortest way to A's zone.
    const grid = `
      A......
      .#####.
      .,,,,,.
      .,,,,,.
      .......
      B......`;
    const map = parseMap(grid, tables);
    const sim = createSim(tables, map, seeded(1));
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

  test('a fine larger than the money leaves 0', () => {
    const sim = createSim(tables, parseMap(CROSSING, tables), seeded(1), { ...profile, money: 30 });
    placeAt(sim, 1, 3, EAST);

    driveThrough(sim, () => sim.state.truck.x > 4.5 * TILE);

    expect(sim.state.lastFine.amount).toBe(tables.fines.redLight);
    expect(sim.state.profile.money).toBe(0);
  });
});
