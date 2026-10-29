import { describe, expect, test } from 'vitest';
import { freshProfile } from './sim.js';
import * as tables from '../tables.js';
import { BRAKE, DT, GAS, IDLE, acceptFrom, box, build, createSim, deliver, drive, lane, monti, parkAt, seeded, timeUntil, way } from './fixtures.js';

function withMass(emptyMass) {
  return { ...tables, fleet: { ...tables.fleet, truck: { ...tables.fleet.truck, emptyMass } } };
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
      expect(sim.state.truck.rpm).toBeGreaterThanOrEqual(tables.fleet.truck.idleRpm);
      expect(sim.state.truck.rpm).toBeLessThanOrEqual(tables.fleet.truck.torqueCurve.at(-1)[0]);
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
  const { reverseDelay, reverseSpeed } = tables.fleet.truck;

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
    const light = run(tables.fleet.truck.emptyMass);
    const heavy = run(tables.fleet.truck.emptyMass * 2);

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
    expect(lean(tables.fleet.truck.emptyMass)).toBeLessThan(0);
    expect(lean(tables.fleet.truck.emptyMass * 1.5)).toBeLessThan(lean(tables.fleet.truck.emptyMass));
  });
});
const { lane: laneOffset } = tables.osm.classes.residential;

// The lane (fixtures.js): Vicolo, a north–south dead end with a spot at each end, the truck in the middle facing south.
const { t: laneTables, map: laneMap, wall } = lane();
const laneSim = (seed = 1, profile) => createSim(laneTables, laneMap, seeded(seed), profile);

// Whether the truck is on the road of `map`.
function onRoad(map, sim) {
  const here = map.graph.nearest(sim.state.truck.x, sim.state.truck.z);
  return here.d <= here.edge.width / 2;
}

describe('Sim: city', () => {
  test('on load the truck stands still on a road of the Monti map', () => {
    const map = monti();
    const sim = createSim(tables, map);

    expect(onRoad(map, sim)).toBe(true);
    expect(sim.state.truck.speed).toBe(0);
  });

  test('driving into a building stops the truck outside it and flags the collision', () => {
    const sim = laneSim();
    expect(sim.state.truck.heading).toBeCloseTo(0);

    drive(sim, 1, GAS);
    expect(sim.state.collision).toBe(false);
    drive(sim, 10, GAS);

    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.truck.z + tables.fleet.truck.length / 2).toBeLessThanOrEqual(wall);
  });

  test('driving into the map edge stops the truck inside the map', () => {
    const map = build([way('residential', [[-50, 0], [50, 0]])]);
    const sim = createSim(tables, map);
    Object.assign(sim.state.truck, { x: 0, z: 50, heading: 0 }); // off the road, facing the south edge

    drive(sim, 10, GAS);

    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.truck.z + tables.fleet.truck.length / 2).toBeLessThanOrEqual(map.bounds.maxZ);
  });

  test('driving at an angle past a building corner without touching it does not stop the truck', () => {
    // South-east on the line x = z, past the north-west corner of a building at (3, 0): 2.1 m off the line, clear of the
    // truck's half width, though the truck's bounding box at that angle reaches over the corner.
    const map = build([way('residential', [[-90, 80], [90, 80]]), box(3, -20, 20, 0)]);
    const sim = createSim(tables, map);
    Object.assign(sim.state.truck, { x: -12, z: -12, heading: Math.PI / 4 });
    let hit = false;
    timeUntil(sim, GAS, () => (hit ||= sim.state.collision) || sim.state.truck.z > 10, 10);

    expect(hit).toBe(false);
    expect(sim.state.truck.z).toBeGreaterThan(10);
  });

  test('resetToRoad() from off the road puts the truck in the right-hand lane of the nearest road, along it, stopped in first gear', () => {
    const sim = laneSim();
    Object.assign(sim.state.truck, { x: 4.5, heading: 0.6 }); // askew on the pavement, off the road
    expect(onRoad(laneMap, sim)).toBe(false);

    sim.resetToRoad();

    const { x, heading } = sim.state.truck;
    expect(Math.sin(heading)).toBeCloseTo(0); // facing north or south
    // #43: where the AI cars drive, right of the centre line (right is -cos heading in x), leaving the other lane free.
    expect(x).toBeCloseTo(-Math.cos(heading) * laneOffset);
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.truck.gear).toBe(1);
  });
});

describe('Sim: profile', () => {
  const profile = { ...freshProfile(), money: 500, stars: 5, distance: 1000, vehicles: { truck: { motor: 2 } }, owned: ['red'], equipped: { paint: 'red' } };

  test('a fresh Sim starts with no money and no payment', () => {
    const sim = laneSim();
    expect(sim.state.profile).toMatchObject({ version: 6, money: 0, stars: 0, distance: 0, fuel: tables.fleet.truck.tank, energy: 1 });
    expect(sim.state.lastPayment).toBe(null);
  });

  test('a given profile comes back unchanged, and a delivery adds its pay to its money', () => {
    const sim = laneSim(1, profile);
    expect(sim.state.profile).toEqual(profile);

    const offer = deliver(sim, true);

    expect(sim.state.profile).toEqual({
      ...profile,
      money: 500 + offer.pay,
      stars: 5 + 2, // delivered and clean, but late
      distance: sim.state.profile.distance, // see 'Sim: distance'
      timeOfDay: sim.state.profile.timeOfDay, // see 'Sim: clock'
      timePlayed: sim.state.profile.timePlayed,
      fuel: sim.state.profile.fuel, // see 'Sim: fuel'
      energy: sim.state.profile.energy, // see 'Sim: driver energy'
    });
    expect(profile.money).toBe(500); // the caller's object is left alone
  });

  test('the profile round-trips into a new Sim', () => {
    const sim = laneSim(1, laneSim(1, profile).state.profile);
    expect(sim.state.profile).toEqual(profile);
  });
});

describe('Sim: clock', () => {
  test('timeOfDay starts at 08:00 and advances at the table rate; timePlayed counts the s played', () => {
    const sim = createSim(tables);
    expect(sim.state.timeOfDay).toBe(8 * 60);
    for (let i = 0; i < 90 * 60; i++) sim.step(DT, IDLE); // 90 s; drive() may take a step more
    expect(sim.state.timeOfDay).toBeCloseTo(8 * 60 + 90 * tables.clock.minutesPerSecond, 6);
    expect(sim.state.profile.timeOfDay).toBe(sim.state.timeOfDay);
    expect(sim.state.profile.timePlayed).toBeCloseTo(90, 6);
  });

  test('timeOfDay wraps at midnight; timePlayed carries on from a given profile', () => {
    const t = { ...tables, clock: { ...tables.clock, minutesPerSecond: 10 } };
    const sim = createSim(t, undefined, Math.random, { ...freshProfile(), timeOfDay: 24 * 60 - 5, timePlayed: 1000 });
    for (let i = 0; i < 60; i++) sim.step(DT, IDLE);
    expect(sim.state.timeOfDay).toBeCloseTo(5, 6);
    expect(sim.state.profile.timePlayed).toBeCloseTo(1001, 6);
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
    drive(sim, tables.fleet.truck.reverseDelay + 3, BRAKE);
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
    expect(sim.state.profile.distance - blocked).toBeLessThan(0.2); // only the creep up to the wall, under one step at 12 m/s

    const before = sim.state.profile.distance;
    sim.resetToRoad();
    sim.resetToRoad();
    expect(sim.state.profile.distance).toBe(before);
  });
});

describe('Sim: Werkstatt', () => {
  const MONEY = 100000;
  const rich = (upgrades = {}, stars = 0) => ({ ...freshProfile(), money: MONEY, stars, vehicles: { truck: upgrades } });
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
    expect(tuned.state.profile.vehicles.truck.motor).toBe(1);
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
    expect(heaviest(sim)).toBe(tables.fleet.truck.maxCargo);

    sim.buyUpgrade('cargoBed');

    expect(heaviest(sim)).toBe(tables.fleet.truck.maxCargo * tables.upgrades.cargoBed.levels[0].factor);
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
    const sim = plane(rich({ motor: 1 }, tables.rank.tiers[rank].stars));

    expect(sim.buyUpgrade('motor').ok).toBe(true);
    expect(sim.state.profile.vehicles.truck.motor).toBe(2);
  });
});

describe('Sim: Vehicles', () => {
  const OK = { ok: true, reason: null };
  const { van } = tables.fleet;
  const vanTier = tables.rank.tiers[van.rank].stars;
  const rich = (profile = {}) => ({ ...freshProfile(), money: 100000, stars: vanTier, ...profile });
  const plane = (profile = rich()) => createSim(tables, undefined, Math.random, profile);
  const withVan = (upgrades = {}) => rich({ vehicles: { truck: {}, van: upgrades } });

  test('buying the van costs its price and drives it from then on, with no upgrades; the truck stays owned', () => {
    const sim = plane();
    expect(sim.buyVehicle('van')).toEqual(OK);
    expect(sim.state.profile).toMatchObject({ money: 100000 - van.price, vehicle: 'van', vehicles: { truck: {}, van: {} } });
    expect(sim.state.truck.mass).toBe(van.emptyMass);
    expect(sim.chooseVehicle('truck')).toEqual(OK);
    expect(sim.state.profile.vehicle).toBe('truck');
    expect(sim.state.truck.mass).toBe(tables.fleet.truck.emptyMass);
  });

  test('each refused purchase or choice gives its reason and changes nothing', () => {
    const moving = plane(withVan());
    drive(moving, 1, GAS);
    const onOrder = laneSim(1, withVan());
    acceptFrom(onOrder, 'A');
    const cases = [
      [plane(), 'buyVehicle', 'rocket', 'unknown'],
      [plane(), 'buyVehicle', 'toString', 'unknown'],
      [plane(), 'chooseVehicle', 'rocket', 'unknown'],
      [moving, 'buyVehicle', 'van', 'notIdle'],
      [moving, 'chooseVehicle', 'truck', 'notIdle'],
      [onOrder, 'chooseVehicle', 'truck', 'notIdle'],
      [plane(rich({ stars: vanTier - 1 })), 'buyVehicle', 'van', 'rankTooLow'],
      [plane(rich({ money: van.price - 1 })), 'buyVehicle', 'van', 'noMoney'],
      [plane(withVan()), 'buyVehicle', 'van', 'owned'],
      [plane(withVan()), 'buyVehicle', 'truck', 'owned'],
      [plane(), 'chooseVehicle', 'van', 'notOwned'],
    ];
    for (const [sim, command, id, reason] of cases) {
      const before = structuredClone(sim.state.profile);
      expect(sim[command](id), `${command} ${id}`).toEqual({ ok: false, reason });
      expect(sim.state.profile, `${command} ${id}`).toEqual(before);
    }
  });

  test('each Vehicle keeps its own upgrades, and they apply to the current one', () => {
    const sim = plane(withVan());
    expect(sim.buyUpgrade('motor')).toEqual(OK); // the truck's
    expect(sim.chooseVehicle('van')).toEqual(OK);
    expect(sim.buyUpgrade('brakes')).toEqual(OK);
    expect(sim.buyUpgrade('brakes')).toEqual(OK);
    expect(sim.state.profile.vehicles).toEqual({ truck: { motor: 1 }, van: { brakes: 2 } });

    // The van's brakes stop it shorter than a van without them.
    const stop = (s) => {
      timeUntil(s, GAS, () => s.state.truck.speed >= 40 / 3.6);
      const start = snapshot(s);
      timeUntil(s, BRAKE, () => s.state.truck.speed === 0);
      return moved(s, start).forward;
    };
    const plain = plane(withVan());
    plain.chooseVehicle('van');
    expect(stop(sim)).toBeLessThan(stop(plain) * 0.8);
  });

  test('the van is quicker to 50 km/h and stops shorter than the truck', () => {
    const [truck, vanSim] = [plane(withVan()), plane(withVan())];
    vanSim.chooseVehicle('van');
    const to50 = (s) => timeUntil(s, GAS, () => s.state.truck.speed >= 50 / 3.6);
    const [truckTime, vanTime] = [to50(truck), to50(vanSim)];
    expect(vanTime).toBeLessThan(truckTime * 0.7);
    const stop = (s) => {
      const start = snapshot(s);
      timeUntil(s, BRAKE, () => s.state.truck.speed === 0);
      return moved(s, start).forward;
    };
    expect(stop(vanSim)).toBeLessThan(stop(truck));
  });

  test("the van loads only what it carries, its Ladefläche raising that, and holds its own tank's fuel", () => {
    const heaviest = (sim) => {
      let max = 0;
      for (let i = 0; i < 100; i++) for (const o of sim.requestOffers()) max = Math.max(max, o.cargo.weight);
      return max;
    };
    const sim = laneSim(3, withVan());
    expect(heaviest(sim)).toBe(tables.fleet.truck.maxCargo);
    expect(sim.state.fuel).toBe(tables.fleet.truck.tank);

    expect(sim.chooseVehicle('van')).toEqual(OK);
    expect(sim.state.offers).toEqual([]); // offered for the truck's load
    expect(heaviest(sim)).toBe(van.maxCargo);
    expect(sim.state.tank).toBe(van.tank);
    expect(sim.state.fuel).toBe(van.tank); // cut to its tank
    sim.buyUpgrade('cargoBed');
    expect(heaviest(sim)).toBeGreaterThan(van.maxCargo);
    expect(heaviest(sim)).toBeLessThanOrEqual(van.maxCargo * tables.upgrades.cargoBed.levels[0].factor);
  });

  test("the van's footprint is its own: driving into a building, it stops with its own front at the wall", () => {
    const sim = laneSim(1, withVan());
    sim.chooseVehicle('van');
    drive(sim, 10, GAS);
    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.z + van.length / 2).toBeLessThanOrEqual(wall);
    expect(sim.state.truck.z + van.length / 2).toBeGreaterThan(wall - 0.5);
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
  const { tiers } = tables.rank;
  const at = (stars) => laneSim(1, { ...freshProfile(), stars });

  test('a fresh Sim starts at the lowest tier', () => {
    expect(laneSim().state.rank).toEqual({ tier: 0, title: tiers[0].title, stars: 0, next: tiers[1].stars, progress: 0 });
  });

  test("a delivery adds its Stars, and crossing a tier's Stars changes the tier and title", () => {
    const sim = at(tiers[1].stars - 2);
    expect(sim.state.rank.tier).toBe(0);

    deliver(sim, true); // late: delivered and clean

    expect(sim.state.profile.stars).toBe(tiers[1].stars);
    expect(sim.state.rank).toEqual({ tier: 1, title: tiers[1].title, stars: tiers[1].stars, next: tiers[2].stars, progress: 0 });
    expect(tiers[1].title).not.toBe(tiers[0].title);
  });

  test('progress runs towards the next tier and stays full at the top', () => {
    expect(at((tiers[1].stars + tiers[2].stars) / 2).state.rank).toMatchObject({ tier: 1, progress: 0.5 });
    expect(at(tiers.at(-1).stars + 1).state.rank).toMatchObject({ tier: tiers.length - 1, next: null, progress: 1 });
  });

  test("the new tiers come after #58's five, each with its own title, and keep the busiest traffic", () => {
    expect(tiers.slice(0, 5).map((t) => t.stars)).toEqual([0, 6, 20, 50, 100]); // #58's rank points / 10
    expect(tiers.length).toBeGreaterThan(5);
    expect(new Set(tiers.map((t) => t.title)).size).toBe(tiers.length);
    for (const [i, t] of tiers.entries()) {
      if (i) expect(t.stars).toBeGreaterThan(tiers[i - 1].stars);
      if (i >= 5) expect(t.traffic).toBe(tiers[4].traffic);
    }
  });
});
