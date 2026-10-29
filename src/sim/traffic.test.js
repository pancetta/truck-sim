import { describe, expect, test } from 'vitest';
import { freshProfile } from './sim.js';
import * as base from '../tables.js';
import { way, build, withSpots, createSim, mapOf, addCar, drive, timeUntil, vehiclesOverlap, offRoad, seeded, DT, GAS, BRAKE, IDLE } from './fixtures.js';

// No pedestrian crosses at the zebra crossings the fixtures' junctions get, so these rules play out alone (zebras.test.js).
const tables = { ...base, zebras: { ...base.zebras, use: 0 } };
const { classes } = tables.osm;
const CAR = tables.city.obstacles.car;
// The length of an AI vehicle of `kind` ('car' or a two-wheeler's).
const lengthOf = (kind) => (kind === 'car' ? CAR : tables.traffic.twoWheelers[kind]).length;
// Headings of travel: 0 faces +z (south on the map), as in the Sim.
const [NORTH, EAST, SOUTH, WEST] = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];

// Tables without police cars of their own: a test adds the ones it needs.
const noPolice = { ...tables, police: { ...tables.police, count: 0 } };
// No cars of their own either.
const quiet = { ...noPolice, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 0 })) } };

// The map's one four-arm junction node.
const crossingOf = (sim) => mapOf(sim).graph.nodes.find((n) => n.arms.length === 4);

// A closed lattice of two-way residential streets 60 m apart, five each way round the origin: room for the top tier's
// cars out of the truck's view. Its corner (-120, -120) is far from most of it.
const at = [-120, -60, 0, 60, 120];
const lattice = () => build([...at.map((z) => way('residential', at.map((x) => [x, z]))), ...at.map((x) => way('residential', at.map((z) => [x, z])))], tables, undefined, { minX: -150, minZ: -150, maxX: 150, maxZ: 150 });

// A plain crossing of two two-way residential streets at the origin, its arms out to dead ends 90 m off.
const CROSS = () => [way('residential', [[-90, 0], [0, 0], [90, 0]]), way('residential', [[0, -90], [0, 0], [0, 90]])];
// The same with two named tertiary streets, so it has lights; the north–south one (axis 0) is green for the first 14 s.
const LIGHT = () => [way('tertiary', [[0, -90], [0, 0], [0, 90]], { name: 'Via B' }), way('tertiary', [[-90, 0], [0, 0], [90, 0]], { name: 'Via A' })];

describe('Sim: traffic', () => {
  const { followGap, stopGap, truckGap } = tables.traffic;
  const { tiers } = tables.rank;

  const trafficSim = (map, seed = 1, profile) => createSim(tables, map, seeded(seed), profile);

  test('the number of AI cars comes from the rank tier, higher tiers bringing more', () => {
    const count = (stars) => {
      const sim = trafficSim(lattice(), 1, { ...freshProfile(), stars });
      drive(sim, 1, IDLE);
      return sim.state.traffic.filter((c) => !c.police).length;
    };

    expect(count(0)).toBe(tiers[0].traffic);
    expect(count(tiers.at(-1).stars)).toBe(tiers.at(-1).traffic);
    expect(tiers.at(-1).traffic).toBeGreaterThan(tiers[0].traffic);
  });

  // The van is chosen after the Sim is built, so traffic's view of the truck's size follows a switch (#88).
  test.each(['truck', 'van'])('AI cars stop behind the standing %s at the truck gap (#110) and never drive into it', (id) => {
    // A ring road round a 180 × 80 m block; the truck stands in the middle of its north side, in the eastbound lane.
    const ring = build([way('residential', [[-90, -40], [90, -40], [90, 40], [-90, 40]]), way('residential', [[-90, 40], [-90, -40]])]);
    const sim = trafficSim(ring, 3, { ...freshProfile(), vehicles: { truck: {}, van: {} } });
    const size = tables.fleet[id];
    expect(sim.chooseVehicle(id).ok).toBe(true);
    Object.assign(sim.state.truck, { x: 0, z: -40 + classes.residential.lane, heading: EAST });
    const truck = { ...sim.state.truck };

    let hits = 0;
    for (let t = 0; t < 120; t += DT) {
      sim.step(DT, IDLE);
      hits += sim.state.traffic.filter((c) => vehiclesOverlap(c, CAR, truck, size)).length;
    }

    // Eastbound cars in the truck's lane, nearest the truck's rear first.
    const behind = sim.state.traffic
      .filter((c) => Math.abs(c.z - truck.z) < 1 && Math.abs(c.heading - EAST) < 0.01 && c.x < truck.x)
      .sort((a, b) => b.x - a.x);
    expect(hits).toBe(0);
    expect(behind.length).toBeGreaterThan(0);
    expect(behind[0].speed).toBe(0);
    expect(truck.x - size.length / 2 - (behind[0].x + CAR.length / 2)).toBeCloseTo(truckGap, 1);
    // The next car keeps its distance to the first.
    if (behind[1]) expect(behind[0].x - behind[1].x - CAR.length).toBeGreaterThanOrEqual(followGap - 0.05);
  });

  // A ring round a 160 m square, with two named tertiary streets across it that meet at a light junction in the middle
  // and the ring at plain T-junctions. The truck stands off the road in a quarter, out of the cars' way.
  function windowSim(seed) {
    const sides = [[[-80, -80], [0, -80], [80, -80]], [[80, -80], [80, 0], [80, 80]], [[80, 80], [0, 80], [-80, 80]], [[-80, 80], [-80, 0], [-80, -80]]];
    const map = build([
      ...sides.map((p) => way('residential', p)),
      way('tertiary', [[0, -80], [0, 0], [0, 80]], { name: 'Via B' }),
      way('tertiary', [[-80, 0], [0, 0], [80, 0]], { name: 'Via A' }),
    ]);
    const sim = trafficSim(map, seed);
    Object.assign(sim.state.truck, offRoad(map, 40, 40));
    return sim;
  }

  // How far the car's front bumper is short of the light's stop line along its route (the line `lineBack` before the
  // turn into the junction); null if its route doesn't drive in there.
  const lineBack = tables.lights.stopLine - tables.city.obstacles.signal.inset;
  function short(car, l) {
    let dist = car.lane.length - car.s; // centre to the start of the next path
    for (const p of car.route.slice(1)) {
      if (p.kind === 'turn' && p.node === l.node && p.slot === l.slot) return dist - lineBack - lengthOf(car.kind) / 2;
      dist += p.length;
    }
    return null;
  }

  test('an AI car stops at the stop line of a red light and drives on at green', () => {
    const sim = windowSim(2);
    let car;
    let light;
    timeUntil(sim, IDLE, () => {
      light = sim.state.lights.find((l) => l.phase === 'red' && (car = sim.state.traffic.find((c) => c.speed === 0 && short(c, l) > 0 && short(c, l) < 3)));
      return light;
    }, 300);
    expect(light).toBeTruthy();
    expect(short(car, light)).toBeCloseTo(stopGap, 1);

    timeUntil(sim, IDLE, () => light.phase === 'green', 60);
    drive(sim, 5, IDLE);

    expect(sim.state.traffic).toContain(car);
    expect(short(car, light) ?? -1).toBeLessThan(0); // over the line, or through the junction
  });

  test('an AI car that meets an amber light it can stop for stops at the stop line', () => {
    const sim = windowSim(2);
    const heading = (car, l) => short(car, l) !== null;
    // The first car heading for an amber light, 15–30 m short of its line: room to stop at `brake`.
    let car;
    let light;
    timeUntil(sim, IDLE, () => {
      light = sim.state.lights.find((l) => {
        if (l.phase !== 'amber') return false;
        const coming = sim.state.traffic.filter((c) => heading(c, l) && short(c, l) > 0);
        car = coming.reduce((a, b) => (short(b, l) < short(a, l) ? b : a), coming[0]);
        return car && short(car, l) > 15 && short(car, l) < 30 && car.speed > 5;
      });
      return light;
    }, 600);
    expect(light).toBeTruthy();

    timeUntil(sim, IDLE, () => car.speed === 0, 10);

    expect(light.phase).not.toBe('green');
    expect(short(car, light)).toBeCloseTo(stopGap, 1);
  });

  test.each(['scooter', 'bicycle'])('a %s stops at the stop line of a red light and rides on only at green (#102)', (kind) => {
    const map = build(LIGHT(), quiet);
    const sim = createSim(quiet, map, seeded(1));
    Object.assign(sim.state.truck, offRoad(map, 40, 40));
    // Via A, east–west, is red for its first 19 s: the rider comes east along it from 60 m out.
    const rider = addCar(sim, 1, [[-60, 0], [0, 0], [60, 0]], false, kind);
    const light = sim.state.lights.find((l) => short(rider, l) !== null);
    let [still, entered] = [null, null];
    for (let t = 0; t < 40 && !entered; t += DT) {
      sim.step(DT, IDLE);
      if (rider.speed === 0 && short(rider, light) !== null) still ??= short(rider, light);
      if (short(rider, light) === null) entered = light.phase;
    }
    expect(still).toBeCloseTo(stopGap, 1);
    expect(entered).toBe('green');
  });

  test('AI cars cruise at the limit, take each turn at up to its curve speed, and right turns slower than left ones', () => {
    const sim = trafficSim(lattice(), 5);
    const { turnAccel } = tables.traffic;
    const fastest = { straight: 0, right: 0, left: 0 };
    let share = 0; // of the curve speed, sqrt(turnAccel · r), at most
    for (let t = 0; t < 120; t += DT) {
      sim.step(DT, IDLE);
      for (const { lane, prim, speed } of sim.state.traffic) {
        if (lane.kind === 'run') fastest.straight = Math.max(fastest.straight, speed);
        else if (prim.r) {
          fastest[lane.move] = Math.max(fastest[lane.move], speed);
          share = Math.max(share, speed / Math.sqrt(turnAccel * prim.r));
        }
      }
    }

    expect(fastest.straight).toBeCloseTo(classes.residential.limit / 3.6, 5);
    expect(share).toBeLessThan(1.05); // planned braking in whole steps overshoots by a little
    expect(share).toBeGreaterThan(0.95); // they don't crawl round
    expect(fastest.right).toBeGreaterThan(0);
    expect(fastest.left).toBeGreaterThan(fastest.right);
  });

  // How far a car is from the truck, and whether it is out of the truck's view: off the line its heading runs along.
  const away = (car, truck) => Math.hypot(car.x - truck.x, car.z - truck.z);
  const offView = (car, truck) =>
    [truck.heading, truck.heading + Math.PI / 2].every(
      (h) => Math.abs((car.x - truck.x) * Math.sin(h) + (car.z - truck.z) * Math.cos(h)) < away(car, truck) * Math.cos(tables.traffic.spawnView),
    );

  test("new cars appear out of the truck's view: far enough away, off the line it looks along and the line across it", () => {
    const sim = trafficSim(lattice(), 4);
    const [near, far] = tables.traffic.spawnDistance;
    const seen = new Set();
    for (let t = 0; t < 90; t += DT) {
      // Move the truck to a corner after a while, so cars left far behind give way to new ones.
      if (t > 30 && t < 30 + DT) Object.assign(sim.state.truck, { x: -120, z: -120 });
      sim.step(DT, IDLE);
      const { truck } = sim.state;
      for (const car of sim.state.traffic.filter((c) => !c.police && !seen.has(c.id))) {
        seen.add(car.id);
        expect(away(car, truck)).toBeGreaterThanOrEqual(near);
        expect(away(car, truck)).toBeLessThanOrEqual(far);
        expect(offView(car, truck)).toBe(true);
      }
    }
    expect(seen.size).toBeGreaterThan(tiers[0].traffic); // some cars left and new ones came
  });

  test('police cars come on top of the tier\'s, out of view anywhere in the city, and stay when the truck drives off', () => {
    const sim = trafficSim(lattice(), 4);
    const near = Math.max(tables.traffic.spawnDistance[0], tables.police.radius);
    const { truck } = sim.state;
    for (let i = 0; i < 2; i++) {
      for (const car of sim.state.traffic.filter((c) => c.police)) {
        expect(away(car, truck)).toBeGreaterThanOrEqual(near);
        expect(offView(car, truck)).toBe(true);
      }
      sim.step(DT, IDLE);
    }
    const police = sim.state.traffic.filter((c) => c.police);
    expect(police).toHaveLength(tables.police.count);

    // To the far corner, more than despawnDistance from the other side of the city: the other cars there go.
    Object.assign(sim.state.truck, { x: -120, z: -120 });
    const others = sim.state.traffic.filter((c) => !c.police);
    drive(sim, 60, IDLE);
    expect(sim.state.traffic.filter((c) => c.police)).toEqual(police);
    expect(others.some((c) => !sim.state.traffic.includes(c))).toBe(true);
  });

  test('traffic is the same for the same seed', () => {
    const run = (seed) => {
      const sim = trafficSim(lattice(), seed);
      drive(sim, 20, IDLE);
      return sim.state.traffic.map(({ x, z, heading, speed }) => ({ x, z, heading, speed }));
    };

    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});

describe('Sim: right of way and collisions', () => {
  const { stopGap, truckHold, truckLine } = tables.traffic;
  const lane = classes.residential.lane;
  const half = tables.fleet.truck.length / 2;

  // The crossing (CROSS unless `ways` says otherwise) with no cars of its own; the truck stands off the road, facing
  // south.
  function crossSim(profile, ways = CROSS) {
    const map = build(ways(), quiet);
    const sim = createSim(quiet, map, seeded(1), profile);
    Object.assign(sim.state.truck, offRoad(map, -50, -50), { heading: SOUTH });
    return sim;
  }
  // The crossing's box reaches this far out of its middle along each arm (CROSS's).
  const R = build(CROSS(), quiet).graph.nodes.find((n) => n.arms.length === 4).radius;

  // Straight through the crossing from 30 m out, by the direction of travel.
  const through = {
    [NORTH]: [[0, 30], [0, 0], [0, -30]],
    [WEST]: [[30, 0], [0, 0], [-30, 0]],
    [SOUTH]: [[0, -30], [0, 0], [0, 30]],
    [EAST]: [[-30, 0], [0, 0], [30, 0]],
  };
  const inCrossing = (car) => car.lane.kind === 'turn'; // on its way through the one junction
  // How far the front bumper of a northbound car is short of the crossing.
  const shortOfCrossing = (car) => car.z - CAR.length / 2 - R;

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

  // The truck in the westbound lane of the east arm, its front bumper `back` m short of the crossing.
  const eastArm = (back) => ({ x: R + back + half, z: -lane, heading: WEST });
  // The truck in the northbound lane of the south arm, its front bumper `back` m short of the crossing.
  const southArm = (back) => ({ x: lane, z: R + back + half, heading: NORTH });

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
    Object.assign(sim.state.truck, eastArm(22));
    const a = addCar(sim, 1, through[NORTH]);

    let waited = false;
    timeUntil(sim, GAS, () => {
      waited ||= a.speed === 0 && Math.abs(shortOfCrossing(a) - stopGap) < 0.1;
      return sim.state.truck.x + half < -R; // its rear is through
    }, 20);
    expect(waited).toBe(true);
    expect(inCrossing(a)).toBe(false);
    const { entered } = watch(sim, [a], 10);

    expect(entered.has(a)).toBe(true);
    expect(sim.state.lastFine).toBe(null);
  });

  test('a truck stopped at the line keeps its right of way: the car on its left waits until it drives in', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, eastArm(3));
    const a = addCar(sim, 1, through[NORTH]);

    expect(watch(sim, [a], truckHold - 2).entered.has(a)).toBe(false);
    expect(shortOfCrossing(a)).toBeCloseTo(stopGap, 1);
    timeUntil(sim, GAS, () => sim.state.truck.x + half < -R, 20); // its rear is through
    const { entered } = watch(sim, [a], 10);

    expect(entered.has(a)).toBe(true);
    expect(sim.state.lastFine).toBe(null);
  });

  test('a truck standing back from the line lets the car on its left go at once', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, eastArm(truckLine + 3));
    const a = addCar(sim, 1, through[NORTH]);

    const { entered } = watch(sim, [a], truckHold - 2);

    expect(entered.has(a)).toBe(true);
  });

  test(`a truck standing at the line longer than ${tables.traffic.truckHold} s lets the car on its left go`, () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, eastArm(5));
    const a = addCar(sim, 1, through[NORTH]);

    const { entered } = watch(sim, [a], truckHold + 6);

    expect(entered.get(a)).toBeGreaterThan(truckHold - 1);
  });

  test('a truck backing off from the line lets the car on its left go', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, eastArm(3));
    const a = addCar(sim, 1, through[NORTH]);
    drive(sim, tables.fleet.truck.reverseDelay + 0.5, BRAKE); // into reverse

    const { entered } = watch(sim, [a], 8, BRAKE);

    expect(entered.has(a)).toBe(true);
  });

  test('a truck waiting at the crossing lets the car on its left go after the hold, even with a car queued behind it', () => {
    // #43 QA: the car behind can't go first, so it mustn't hold the crossing for its approach.
    const sim = crossSim();
    Object.assign(sim.state.truck, eastArm(3));
    const behind = addCar(sim, 1, through[WEST]);
    const a = addCar(sim, 2, through[NORTH]);

    const { entered } = watch(sim, [a, behind], truckHold + 6);

    expect(entered.has(a)).toBe(true);
    expect(entered.has(behind)).toBe(false);
  });

  test('with the truck waiting on one approach, three cars arriving at once all get through', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, southArm(5));
    const cars = [WEST, SOUTH, EAST].map((h, i) => addCar(sim, i + 1, through[h]));

    const { entered } = watch(sim, cars, 40);

    expect(entered.size).toBe(3);
  });

  test('with all four approaches taken, the first car to arrive goes, not the one that came into the city first', () => {
    const sim = crossSim();
    // Arriving one step apart, from car 4 on round to the right, so each has the next on its right.
    const cars = [[4, NORTH], [1, EAST], [2, SOUTH], [3, WEST]].map(([id, h]) => addCar(sim, id, through[h]));

    const { entered } = watch(sim, cars, 10);

    expect([...entered.keys()][0]?.id).toBe(4);
  });

  test('with all four approaches taken and the truck first to arrive, the cars wait for it', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, southArm(3));
    sim.step(0, IDLE);
    const cars = [WEST, SOUTH, EAST].map((h, i) => addCar(sim, i + 1, through[h]));

    expect(watch(sim, cars, truckHold - 2).entered.size).toBe(0);
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
    // An east–west street with a side street off north at x = 0 and one off south at x = 10, too close to queue a
    // car between them: one crossing.
    const sim = crossSim(undefined, () => [
      way('residential', [[-90, 0], [0, 0], [10, 0], [90, 0]]),
      way('residential', [[0, -90], [0, 0]]),
      way('residential', [[10, 0], [10, 90]]),
    ]);
    // The westbound car starts just short of the east one's box, as a car can appear anywhere on a lane run.
    const east = addCar(sim, 1, [[-14 - R, 0], [0, 0], [10, 0], [40, 0]]);
    const west = addCar(sim, 2, [[10 + R + 3, 0], [10, 0], [0, 0], [-40, 0]]);
    const pastBoth = (car) => !sim.state.traffic.includes(car) || (car.heading > 0 ? car.x > 10 + R : car.x < -R);

    timeUntil(sim, IDLE, () => pastBoth(east) && pastBoth(west), 30);

    expect(pastBoth(east)).toBe(true);
    expect(pastBoth(west)).toBe(true);
  });

  test('back on the road never puts the truck on an AI car', () => {
    const sim = crossSim();
    const car = addCar(sim, 1, through[NORTH]);
    // Standing across the middle of the south arm, where the truck's north–south pose would be.
    Object.assign(car, { x: 0, z: 14, heading: EAST });
    Object.assign(sim.state.truck, { x: 0, z: 15 });

    sim.resetToRoad();

    expect(vehiclesOverlap(sim.state.truck, tables.fleet.truck, car, CAR)).toBe(false);
  });

  test('back on the road avoids crossings, where the cars would wait for the truck', () => {
    const sim = crossSim();
    Object.assign(sim.state.truck, { x: 0, z: 1 });

    sim.resetToRoad();

    // On an arm, along it, the truck's near bumper out of the crossing's box.
    const { x, z } = sim.state.truck;
    expect(Math.min(Math.abs(x), Math.abs(z))).toBeCloseTo(lane);
    expect(Math.max(Math.abs(x), Math.abs(z)) - half).toBeGreaterThanOrEqual(R);
  });

  test('an AI car keeps out of a crossing whose exit is queued up, and lets the others go meanwhile', () => {
    const sim = crossSim();
    // The truck stands in the northbound lane 2 m past the crossing.
    Object.assign(sim.state.truck, { x: lane, z: -R - 2 - half, heading: NORTH });
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
    const lightSim = () => crossSim(undefined, LIGHT);
    const northThenWest = [[0, 30], [0, 0], [-30, 0]];
    const southThenEast = (from) => [[0, -from], [0, 0], [30, 0]];
    // The north–south approaches' lights, axis 0.
    const northbound = (sim) => sim.state.lights.find((l) => l.dz < -0.9);

    test('a car turning left waits for the oncoming car going straight on', () => {
      const sim = lightSim();
      const a = addCar(sim, 1, northThenWest);
      const b = addCar(sim, 2, through[SOUTH]);

      const { entered, most } = watch(sim, [a, b], 12);

      expect(northbound(sim).phase).toBe('green');
      expect(entered.get(b)).toBeLessThan(entered.get(a));
      expect(most).toBe(1);
    });

    test('two cars turning left from opposite sides, one with a car queued behind it, all go', () => {
      // #43 review: the northbound turner waits for the southbound car going straight, which is behind the
      // southbound turner; that one mustn't wait for the northbound turner then.
      const sim = lightSim();
      const a = addCar(sim, 1, northThenWest);
      const b = addCar(sim, 2, southThenEast(20));
      const c = addCar(sim, 3, through[SOUTH]);

      const { entered } = watch(sim, [a, b, c], 14);

      expect([a, b, c].map((car) => entered.has(car))).toEqual([true, true, true]);
    });

    test('two cars turning left from opposite sides, each with a car going straight queued behind it, all go', () => {
      // #46: each turner waited for the oncoming car going straight, which can't go before the other turner.
      const sim = lightSim();
      const a = addCar(sim, 1, [[0, 20], ...northThenWest.slice(1)]);
      const b = addCar(sim, 2, through[NORTH]);
      const c = addCar(sim, 3, southThenEast(20));
      const d = addCar(sim, 4, through[SOUTH]);

      const { entered } = watch(sim, [a, b, c, d], 14);

      expect([a, b, c, d].map((car) => entered.has(car))).toEqual([true, true, true, true]);
    });

    test('two cars turning left from opposite sides both go', () => {
      const sim = lightSim();
      const a = addCar(sim, 1, northThenWest);
      const c = addCar(sim, 2, southThenEast(30));

      const { entered } = watch(sim, [a, c], 12);

      expect(entered.has(a)).toBe(true);
      expect(entered.has(c)).toBe(true);
    });

    test('a car turning left waits for the truck coming the other way', () => {
      const sim = lightSim();
      const r = crossingOf(sim).radius;
      Object.assign(sim.state.truck, { x: -classes.tertiary.lane, z: -28, heading: SOUTH });
      const a = addCar(sim, 1, [[0, 20], ...northThenWest.slice(1)]); // nearer than the truck, so it would be in first
      let truckOut = Infinity; // when the truck's front leaves the junction
      const entered = new Map();
      for (let t = 0; t < 12; t += DT) {
        sim.step(DT, GAS);
        if (truckOut === Infinity && sim.state.truck.z + half > r) truckOut = t;
        if (inCrossing(a) && !entered.has(a)) entered.set(a, t);
      }

      expect(truckOut).toBeLessThan(12);
      expect(entered.get(a)).toBeGreaterThan(truckOut);
      expect(sim.state.lastFine).toBe(null);
    });
  });

  test('driving into an AI car fines once per contact, stops both, floors money at 0 and damages fragile cargo', () => {
    const glass = { name: 'Glas', weight: 4, kind: 'fragile' };
    const onlyGlass = { ...quiet, orders: { ...quiet.orders, cargo: [glass] } };
    const profile = { ...freshProfile(), money: 30, stars: tables.rank.tiers[tables.orders.types.fragile].stars };
    // A long north–south street with two spots on it; the truck starts on A's.
    const street = way('residential', [[0, -90], [0, 90]], { name: 'Via Lunga' });
    const spot = (id, at) => ({ id, name: `Ditta ${id}`, street: 'Via Lunga', way: street.id, at, side: 'right' });
    const withAB = withSpots([spot('A', 20), spot('B', 160)], [], 'A', onlyGlass);
    const sim = createSim(withAB, build([street], withAB), seeded(1), profile);
    let offer;
    for (let i = 0; i < 20 && !offer; i++) offer = sim.requestOffers().find((o) => o.pickup === 'A');
    expect(offer, 'an offer from A').toBeTruthy();
    sim.acceptOrder(offer.id);
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expect(sim.state.order).toMatchObject({ type: 'fragile', phase: 'dropoff', damage: 0 });

    // The truck faces south in the northbound lane; a northbound car comes up and stops in front of it.
    Object.assign(sim.state.truck, { x: lane, z: 0, heading: SOUTH });
    const car = addCar(sim, 1, [[0, 60], [0, -60]]);
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
    expect(sim.state.order.damage).toBe(tables.orders.kinds.fragile.hit);
    expect(sim.state.order.faults).toEqual(['collision']); // the Contact costs the clean Star

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
      Object.assign(car, { x: x - tables.fleet.truck.width / 2 - 1.4, z: z + half + 1.4, heading });
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
    Object.assign(truck, { x: car.x, z: car.z - CAR.length / 2 - half + 0.5, heading: SOUTH });
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
    Object.assign(truck, { x: car.x - CAR.width / 2 + 0.3 - tables.fleet.truck.width / 2, z: car.z + 2, heading: NORTH });
    sim.step(DT, IDLE);
    const start = truck.z;

    drive(sim, 2, GAS);

    expect(truck.z).toBeLessThan(start - 2);
    expect(sim.state.lastFine).toBe(null);
  });

  describe('the truck standing in a crossing or a light junction', () => {
    // From 30 m out on every approach, turning right, going straight and turning left.
    const routes = [
      [[0, 30], [0, 0], [30, 0]],
      [[-30, 0], [0, 0], [0, 30]],
      [[0, -30], [0, 0], [-30, 0]],
      [[30, 0], [0, 0], [0, -30]],
      through[NORTH],
      through[EAST],
      through[SOUTH],
      through[WEST],
      [[0, 30], [0, 0], [-30, 0]],
      [[-30, 0], [0, 0], [0, -30]],
    ];
    // Middle, turned, and half in it on the southbound lane. In the middle of the crossing it is in every car's way;
    // the light junction is wide enough for a car to pass beside it in the eastbound lane (its middle pose stands a
    // little north, so that lane is clear by 0.2 m rather than exactly touching).
    const poses = (r, l) => [
      { x: 0, z: -0.2, heading: EAST },
      { x: 1, z: -1, heading: EAST - 0.6 },
      { x: -l, z: -r, heading: SOUTH },
    ];

    // #43: the truck holds only the ways through that it blocks, so some cars pass it where it stands half in.
    test.each([['an unsignalled crossing', CROSS, 'residential', true], ['a light junction', LIGHT, 'tertiary', false]])(
      'in %s is never driven into: the cars it is in the way of wait outside, the others pass',
      (_, ways, cls, middleBlocksAll) => {
        const passed = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          // One car per approach at a time, each run cycling through the routes.
          for (let first = 0; first < routes.length; first += 4) {
            const sim = crossSim(undefined, ways);
            Object.assign(sim.state.truck, poses(crossingOf(sim).radius, classes[cls].lane)[k]);
            const cars = routes.slice(first, first + 4).map((r, i) => addCar(sim, i + 1, r));
            let into = 0;
            let entered = 0;
            for (let t = 0; t < 40; t += DT) {
              sim.step(DT, IDLE);
              into += cars.filter((c) => sim.state.traffic.includes(c) && vehiclesOverlap(c, CAR, sim.state.truck, tables.fleet.truck)).length;
              entered += cars.filter((c) => sim.state.traffic.includes(c) && inCrossing(c)).length;
            }
            const left = cars.filter((c) => sim.state.traffic.includes(c));

            expect(into).toBe(0);
            if (k === 0 && middleBlocksAll) expect(entered).toBe(0);
            expect(left.filter(inCrossing)).toEqual([]); // nobody waits inside
            expect(left.every((c) => c.speed === 0)).toBe(true);
            passed[k] += cars.length - left.length;
          }
        }
        if (middleBlocksAll) expect(passed[0]).toBe(0);
        expect(passed[2]).toBeGreaterThan(0);
      },
    );

    test('with its nose just past the junction edge it holds only the lane it blocks', () => {
      // On the east arm facing west, standing at red with its front bumper `into` m past the junction edge; the
      // north–south axis is green. 1 m in blocks no way through, 5 m in the northbound lane.
      const standing = (into) => {
        const sim = crossSim(undefined, LIGHT);
        Object.assign(sim.state.truck, { x: crossingOf(sim).radius + half - into, z: -classes.tertiary.lane, heading: WEST });
        const cars = [NORTH, SOUTH].map((h, i) => addCar(sim, i + 1, through[h]));
        const { entered } = watch(sim, cars, 12);
        expect(sim.state.lights.find((l) => l.dx < -0.9).phase).toBe('red');
        return cars.map((c) => entered.has(c));
      };

      expect(standing(1)).toEqual([true, true]);
      expect(standing(5)).toEqual([false, true]);
    });
  });
});

describe('Sim: traffic on the road graph', () => {
  // A map of one junction at (0, 0) with arms out to dead ends 60 m off, at `arms` angles (degrees, atan2(dz, dx): 90
  // runs south, 0 east), of the road classes in `classes` (residential by default) and one-way out of the junction
  // where `oneWay` holds. The truck stands off the road in a corner.
  function star(arms, classes = [], oneWay = []) {
    const out = (a) => [Math.round(Math.cos((a * Math.PI) / 180) * 60), Math.round(Math.sin((a * Math.PI) / 180) * 60)];
    const map = build(arms.map((a, i) => way(classes[i] ?? 'residential', [[0, 0], out(a)], oneWay[i] ? { oneway: 'yes' } : {})), quiet);
    const sim = createSim(quiet, map, seeded(1));
    Object.assign(sim.state.truck, { x: -75, z: -75, heading: 0 });
    expect(map.graph.onRoad(-75, -75)).toBe(false);
    const centre = map.graph.nodes.find((n) => n.arms.length === arms.length);
    // Its slots run in the order of `arms`, as the ways do.
    expect(centre.slots.map((s) => Math.round((s.angle * 180) / Math.PI))).toEqual(arms);
    return { sim, centre };
  }

  // Adds an AI car (of `kind`) that drives in by arm `from` of the junction and out by arm `to`, `s` m along its way in
  // at `speed`.
  function through(sim, centre, id, from, to, s = 0, speed = 0, kind = 'car') {
    const run = centre.slots[from].in;
    const turn = run.next.find((t) => t.outSlot === to);
    const car = { id, kind, x: 0, z: 0, heading: 0, speed, lane: run, route: [run, turn, turn.out], s, police: false };
    sim.state.traffic.push(car);
    sim.step(0, IDLE);
    return car;
  }

  // The ids of the cars in the order they drove into the junction, at most `seconds` s on.
  function order(sim, cars, seconds = 20) {
    const entered = [];
    for (let t = 0; t < seconds && entered.length < cars.length; t += DT) {
      sim.step(DT, IDLE);
      for (const c of cars) if (c.lane.kind === 'turn' && !entered.includes(c.id)) entered.push(c.id);
    }
    return entered;
  }

  // Per junction: its arms, an arm, the arm on the right of a driver coming in by it (the next one counter-clockwise
  // seen from above, 45°–135° round) and an arm each goes out by, so that their ways cross.
  const junctions = {
    '3 arms (a T, the arm on the right one end of its bar)': { arms: [90, 0, 180], car: 0, right: 1, ways: [2, 2] },
    '4 arms': { arms: [90, 0, -90, 180], car: 0, right: 1, ways: [2, 3] },
    '5 arms': { arms: [90, 18, -54, -126, 162], car: 0, right: 1, ways: [3, 4] },
  };

  test.each(Object.entries(junctions))('right before left at %s: of two cars arriving at once, the one on the right goes first', (_, j) => {
    for (const [carId, rightId] of [[1, 2], [2, 1]]) {
      const { sim, centre } = star(j.arms);
      const a = through(sim, centre, carId, j.car, j.ways[0]);
      const b = through(sim, centre, rightId, j.right, j.ways[1]);

      expect(order(sim, [a, b])).toEqual([b.id, a.id]);
    }
  });

  test.each(Object.entries(junctions))('priority by road class at %s: the car on the higher class goes first, from the left too', (_, j) => {
    const classes = j.arms.map((_, i) => (i === j.car ? 'tertiary' : 'residential'));
    const { sim, centre } = star(j.arms, classes);
    const a = through(sim, centre, 1, j.car, j.ways[0]);
    const b = through(sim, centre, 2, j.right, j.ways[1]);

    expect(order(sim, [a, b])).toEqual([a.id, b.id]);
  });

  test('at the stem of a T nobody is on the right: the car there goes before the one coming along the bar', () => {
    const { sim, centre } = star([90, 0, 180]);
    const stem = through(sim, centre, 1, 0, 2); // north up the stem, then west
    const bar = through(sim, centre, 2, 2, 1); // from the west end along the bar, on the stem's left

    expect(order(sim, [stem, bar])).toEqual([stem.id, bar.id]);
  });

  test('oncoming cars whose ways don\'t cross go together: both straight on, or both turning right', () => {
    for (const ways of [[2, 0], [1, 3]]) {
      const { sim, centre } = star([90, 0, -90, 180]);
      const cars = [through(sim, centre, 1, 0, ways[0]), through(sim, centre, 2, 2, ways[1])];
      let together = false;
      for (let t = 0; t < 15; t += DT) {
        sim.step(DT, IDLE);
        together ||= cars.every((c) => c.lane.kind === 'turn');
      }
      expect(together).toBe(true);
    }
  });

  // #102: two-wheelers keep the junction rules as cars do, both ways round.
  describe.each(['scooter', 'bicycle'])('a %s at a junction', (kind) => {
    // Adds an AI vehicle of `kind` on arm `from` going out by `to`, standing with its front bumper 3 m short of the box.
    const standing = (sim, centre, id, from, to, k) => through(sim, centre, id, from, to, centre.slots[from].in.length - 3 - lengthOf(k) / 2, 0, k);

    test('right before left: it gives way to a car on its right, and a car on its left to it', () => {
      const j = junctions['4 arms'];
      for (const [left, right] of [[kind, 'car'], ['car', kind]]) {
        const { sim, centre } = star(j.arms);
        const a = standing(sim, centre, 1, j.car, j.ways[0], left);
        const b = standing(sim, centre, 2, j.right, j.ways[1], right);
        expect(order(sim, [a, b])).toEqual([2, 1]);
      }
    });

    test('at a give-way sign it lets a car on the priority road go first, from the left too', () => {
      for (const arm of [0, 2]) {
        const { sim, centre } = star([90, 0, -90, 180], ['tertiary', 'residential', 'tertiary', 'residential']);
        const yielding = standing(sim, centre, 1, 1, 3, kind);
        const priority = through(sim, centre, 2, arm, (arm + 2) % 4, centre.slots[arm].in.length - 20 - CAR.length / 2, 8);
        expect(order(sim, [yielding, priority])).toEqual([2, 1]);
      }
    });
  });

  // Puts the truck in its lane on arm `arm` of the junction, its middle `out` m from the junction's, facing in at `speed`.
  function truckOn(sim, centre, arm, out, speed = 0) {
    const { angle, edge } = centre.slots[arm];
    const [ux, uz] = [Math.cos(angle), Math.sin(angle)];
    const lane = edge.oneWay ? 0 : edge.laneOffset; // right of travel along -u is (uz, -ux)
    Object.assign(sim.state.truck, { x: ux * out + uz * lane, z: uz * out - ux * lane, heading: Math.atan2(-ux, -uz), speed });
  }

  test("the junction rule is the truck's approach's: give way to a higher class, priority over a lower one, else right before left", () => {
    const ruleFrom = ({ sim, centre }, arm) => {
      truckOn(sim, centre, arm, 30);
      sim.step(0, IDLE);
      return sim.state.junctionRule;
    };
    // A tertiary street (south and north arms) crossed by a residential one, and the same all residential.
    const cross = star([90, 0, -90, 180], ['tertiary', 'residential', 'tertiary', 'residential']);
    expect([0, 1, 2, 3].map((arm) => ruleFrom(cross, arm))).toEqual(['priority', 'giveWay', 'priority', 'giveWay']);
    const plain = star([90, 0, -90, 180]);
    expect([0, 1, 2, 3].map((arm) => ruleFrom(plain, arm))).toEqual(Array(4).fill('rightBeforeLeft'));
    // A T of two tertiary arms, south and east, and a residential one west: coming north, the east arm comes in from the
    // right; coming west, none does.
    const tee = star([90, 0, 180], ['tertiary', 'tertiary', 'residential']);
    expect([0, 1, 2].map((arm) => ruleFrom(tee, arm))).toEqual(['rightBeforeLeft', 'priority', 'giveWay']);
    // Residential streets meeting a secondary one, two classes up, have stop signs.
    const stops = star([90, 0, -90, 180], ['secondary', 'residential', 'secondary', 'residential']);
    expect([0, 1, 2, 3].map((arm) => ruleFrom(stops, arm))).toEqual(['priority', 'stop', 'priority', 'stop']);
  });

  describe('stop signs', () => {
    // A secondary street north–south crossed by a residential one, which has stop signs.
    const stopCross = () => star([90, 0, -90, 180], ['secondary', 'residential', 'secondary', 'residential']);
    const short = (car) => car.lane.length - car.s - lengthOf(car.kind) / 2; // front bumper to the end of its run

    test.each(['car', 'scooter', 'bicycle'])('an AI %s comes to a full stop at the line, then gives way', (kind) => {
      // Alone, coming west at 8 m/s: it stands still at the line, then drives on.
      const alone = stopCross();
      const car = through(alone.sim, alone.centre, 1, 1, 3, 20, 8, kind);
      let stoppedAt = null;
      for (let t = 0; t < 15 && car.lane.kind === 'run'; t += DT) {
        alone.sim.step(DT, IDLE);
        if (car.lane.kind === 'run' && car.speed === 0) stoppedAt ??= short(car);
      }
      expect(stoppedAt).toBeCloseTo(tables.traffic.stopGap, 0);
      expect(car.lane.kind).toBe('turn');
      expect(car.stopped).toBe(null); // the next time by this stop sign it stops again
      // Stopped at the line while a car on the secondary street comes: that one goes first.
      const { sim, centre } = stopCross();
      const stopping = through(sim, centre, 1, 1, 3, centre.slots[1].in.length - 10 - lengthOf(kind) / 2, 6, kind);
      const priority = through(sim, centre, 2, 0, 2, centre.slots[0].in.length - 40 - CAR.length / 2, 11);
      expect(order(sim, [stopping, priority])).toEqual([2, 1]);
    });

    // The truck coming west on the residential street, its front bumper `back` m short of the junction at `speed`, with
    // a police car behind it if `seen`: the stop-sign fines in the next 6 s at full gas.
    function rollIn(back, speed, seen = true) {
      const { sim, centre } = stopCross();
      if (seen) through(sim, centre, 99, 1, 3).police = true;
      truckOn(sim, centre, 1, centre.radius + tables.fleet.truck.length / 2 + back, speed);
      sim.step(DT, IDLE);
      let [fines, last, front] = [0, sim.state.lastFine, Infinity];
      for (let t = 0; t < 6; t += DT) {
        sim.step(DT, GAS);
        if (sim.state.lastFine !== last && sim.state.lastFine.reason === 'stopSign') fines++;
        last = sim.state.lastFine;
        front = Math.min(front, sim.state.truck.x - tables.fleet.truck.length / 2);
      }
      expect(front).toBeLessThan(centre.radius); // it drove in
      return fines;
    }

    test('the truck rolling through is fined once, while a police car sees it', () => {
      expect(rollIn(10, 6)).toBe(1);
      expect(rollIn(10, 6, false)).toBe(0);
      expect(rollIn(tables.stopSign.reach + 2, 0)).toBe(1); // it stood still, but too far back
    });

    test('stopping at the line first is free, and so is a full stop further back in the zone (#111)', () => {
      expect(rollIn(3, 0)).toBe(0);
      expect(rollIn(12, 0)).toBe(0);
    });

    test('a stop queued behind a car in the zone counts: rolling in after it is free (#111)', () => {
      const { sim, centre } = stopCross();
      through(sim, centre, 99, 1, 3).police = true;
      const run = centre.slots[1].in;
      const car = through(sim, centre, 1, 1, 3, run.length - tables.traffic.stopGap - CAR.length / 2, 0); // at the line
      truckOn(sim, centre, 1, car.x + CAR.length / 2 + 3 + tables.fleet.truck.length / 2, 2); // 3 m behind it at 2 m/s
      const { truck } = sim.state;
      const front = () => truck.x - tables.fleet.truck.length / 2 - centre.radius; // m short of the junction
      let stood = Infinity;
      for (let t = 0; t < 3 && stood === Infinity; t += DT) {
        sim.step(DT, BRAKE);
        if (Math.abs(truck.speed) < tables.fleet.truck.stopSpeed) stood = front();
      }
      expect(stood).toBeGreaterThan(6); // further back than the old 6 m reach
      expect(stood).toBeLessThan(tables.stopSign.reach);
      for (let t = 0; t < 10 && car.lane.kind === 'run'; t += DT) sim.step(DT, IDLE);
      let [fines, last] = [0, sim.state.lastFine];
      for (let t = 0; t < 4; t += DT) {
        sim.step(DT, GAS);
        if (sim.state.lastFine !== last && sim.state.lastFine.reason === 'stopSign') fines++;
        last = sim.state.lastFine;
      }
      expect(front()).toBeLessThan(0); // it drove in
      expect(fines).toBe(0);
    });
  });

  describe('the give-way fine', () => {
    // A tertiary street north–south crossed by a residential one; an AI car coming north on the tertiary street, its
    // front bumper `short` m from the junction at `speed`, and the truck coming west on the residential street at 5 m/s,
    // its front bumper half a m short of the junction, with a police car behind it if `seen`. Returns the give-way fines
    // in the next 4 s at full gas, and whether the AI car stopped.
    function giveWay(short, speed, seen = true) {
      const { sim, centre } = star([90, 0, -90, 180], ['tertiary', 'residential', 'tertiary', 'residential']);
      const car = through(sim, centre, 1, 0, 2, centre.slots[0].in.length - short - CAR.length / 2, speed);
      if (seen) through(sim, centre, 99, 1, 3).police = true;
      truckOn(sim, centre, 1, centre.radius + tables.fleet.truck.length / 2 + 0.5, 5);
      let [fines, last, stopped] = [0, sim.state.lastFine, false];
      for (let t = 0; t < 4; t += DT) {
        sim.step(DT, GAS);
        if (sim.state.lastFine !== last && sim.state.lastFine.reason === 'giveWay') fines++;
        last = sim.state.lastFine;
        stopped ||= car.speed === 0;
      }
      return { fines, stopped };
    }

    test('driving in so that a car with priority brakes hard is fined once, while a police car sees it', () => {
      expect(giveWay(12, 11)).toEqual({ fines: 1, stopped: true });
      expect(giveWay(12, 11, false)).toEqual({ fines: 0, stopped: true });
    });

    test('driving in while the car with priority is far enough off to slow down as planned is free', () => {
      expect(giveWay(35, 11).fines).toBe(0);
    });
  });

  test('AI cars drive one-way edges only their way, two-wheelers too; the truck may drive against them, unfined', () => {
    // A crossing whose east arm is one-way out of it and west arm one-way into it, busy with cars, scooters and cyclists.
    const { twoWheelers } = tables.traffic;
    const mixed = { scooter: { ...twoWheelers.scooter, share: 0.3 }, bicycle: { ...twoWheelers.bicycle, share: 0.3 } };
    const busy = { ...noPolice, traffic: { ...tables.traffic, spawnDistance: [20, 500], twoWheelers: mixed }, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 8 })) } };
    const map = build([
      way('residential', [[0, 0], [0, 60]]),
      way('residential', [[0, 0], [60, 0]], { oneway: 'yes' }),
      way('residential', [[0, 0], [0, -60]]),
      way('residential', [[-60, 0], [0, 0]], { oneway: 'yes' }),
    ], busy);
    const { nodes } = map.graph;
    const sim = createSim(busy, map, seeded(3), { ...freshProfile(), money: 500 });
    Object.assign(sim.state.truck, { x: -75, z: -75, heading: 0 });

    const seen = new Set();
    const kinds = new Set();
    for (let t = 0; t < 120; t += DT) {
      sim.step(DT, IDLE);
      for (const c of sim.state.traffic) {
        if (!c.lane.edge?.oneWay) continue;
        const { from, to } = c.lane.edge;
        seen.add(`${nodes[to].x},${nodes[to].z}`);
        kinds.add(c.kind);
        const way = Math.atan2(nodes[to].x - nodes[from].x, nodes[to].z - nodes[from].z);
        expect(Math.cos(c.heading - way)).toBeCloseTo(1, 6);
      }
    }
    expect([...seen].sort()).toEqual(['0,0', '60,0']); // cars drove both one-ways
    expect([...kinds].sort()).toEqual(['bicycle', 'car', 'scooter']);

    // The truck drives the east one-way the wrong way, into the crossing.
    sim.state.traffic.length = 0;
    Object.assign(sim.state.truck, { x: 50, z: 0, heading: -Math.PI / 2, speed: 0 });
    drive(sim, 4, GAS);
    expect(sim.state.truck.x).toBeLessThan(35);
    expect(sim.state.lastFine).toBe(null);
  });
});

describe('Sim: two-wheelers (#77)', () => {
  const { twoWheelers, followGap, truckGap } = tables.traffic;

  test('scooters and cyclists come at their share, each at its own size, scooters at the limit and cyclists at their top speed', () => {
    // No street events: their garbage trucks come on top of the shares.
    const busy = { ...noPolice, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 30 })) }, events: { ...tables.events, count: 0 } };
    const sim = createSim(busy, lattice(), seeded(2));
    const kinds = new Map(); // id → kind
    const fastest = { car: 0, scooter: 0, bicycle: 0 };
    for (let t = 0; t < 240; t += DT) {
      // The truck to the far corner and back now and then, so cars come and go.
      if (Math.round(t / DT) % 3600 === 1800) Object.assign(sim.state.truck, { x: -120, z: -120 });
      if (Math.round(t / DT) % 3600 === 0) Object.assign(sim.state.truck, { x: 0, z: 0 });
      sim.step(DT, IDLE);
      for (const c of sim.state.traffic) {
        if (!kinds.has(c.id)) {
          kinds.set(c.id, c.kind);
          const { length, width } = c.kind === 'car' ? CAR : twoWheelers[c.kind];
          expect(c.size).toMatchObject({ length, width });
        }
        if (c.lane.kind === 'run') fastest[c.kind] = Math.max(fastest[c.kind], c.speed);
      }
    }
    const all = [...kinds.values()];
    expect(all.length).toBeGreaterThan(60);
    for (const kind of ['scooter', 'bicycle']) expect(Math.abs(all.filter((k) => k === kind).length / all.length - twoWheelers[kind].share)).toBeLessThan(0.02);
    expect(fastest.car).toBeCloseTo(classes.residential.limit / 3.6, 5);
    expect(fastest.scooter).toBeCloseTo(classes.residential.limit / 3.6, 5);
    expect(fastest.bicycle).toBeCloseTo(twoWheelers.bicycle.top / 3.6, 5);
  }, 30_000);

  test('none with their shares at 0', () => {
    const none = { ...noPolice, traffic: { ...tables.traffic, twoWheelers: { scooter: { ...twoWheelers.scooter, share: 0 }, bicycle: { ...twoWheelers.bicycle, share: 0 } } } };
    const sim = createSim(none, lattice(), seeded(2));
    drive(sim, 30, IDLE);
    expect(sim.state.traffic.length).toBeGreaterThan(0);
    expect(sim.state.traffic.every((c) => c.kind === 'car')).toBe(true);
  });

  // A ring round a 180 × 80 m block; vehicles come along its north side, eastbound.
  const ring = () => build([way('residential', [[-90, -40], [90, -40], [90, 40], [-90, 40]]), way('residential', [[-90, 40], [-90, -40]])]);

  test('a car catching up with a cyclist follows it at its speed, never touching it', () => {
    const sim = createSim(quiet, ring(), seeded(1));
    Object.assign(sim.state.truck, offRoad(mapOf(sim), 0, 0));
    const bike = addCar(sim, 1, [[-50, -40], [90, -40]], false, 'bicycle');
    const car = addCar(sim, 2, [[-85, -40], [90, -40]]);
    let touches = 0;
    for (let t = 0; t < 25; t += DT) {
      sim.step(DT, IDLE);
      touches += vehiclesOverlap(car, car.size, bike, bike.size);
    }

    expect(touches).toBe(0);
    expect(bike.speed).toBeCloseTo(twoWheelers.bicycle.top / 3.6, 5);
    expect(car.speed).toBeCloseTo(bike.speed, 1);
    expect(Math.abs(bike.z - car.z)).toBeLessThan(0.01); // both on the straight, in one lane
    // At speed it keeps the gap and its braking distance at `brake`, as behind any car.
    expect(bike.x - car.x - (bike.size.length + car.size.length) / 2).toBeCloseTo(followGap + bike.speed ** 2 / (2 * tables.traffic.brake), 1);
  });

  // The truck stands on the north side facing east, just left of the room a cyclist keeps in the eastbound lane
  // (its width and the side gap each side, plus 5 cm), and the AI vehicle comes up behind it.
  function beside(kind) {
    const sim = createSim(quiet, ring(), seeded(1));
    const other = addCar(sim, 1, [[-80, -40], [90, -40]], false, kind);
    const z = other.z - twoWheelers.bicycle.width / 2 - tables.traffic.sideGap - 0.05 - tables.fleet.truck.width / 2;
    Object.assign(sim.state.truck, { x: 0, z, heading: EAST, speed: 0 });
    return { sim, other };
  }

  test('a cyclist rides past the truck where a car stops behind it; the truck reversing along it meets it at its size', () => {
    const { sim, other: bike } = beside('bicycle');
    const { truck } = sim.state;
    let [slowest, touches, blocked] = [Infinity, 0, 0];
    timeUntil(sim, IDLE, () => bike.x > -30, 30);
    // The truck reverses as the cyclist passes it: a car's footprint where the cyclist is would be in its way.
    for (let t = 0; t < 15 && bike.x < truck.x + 20; t += DT) {
      sim.step(DT, BRAKE);
      slowest = Math.min(slowest, bike.speed);
      touches += vehiclesOverlap(bike, bike.size, truck, tables.fleet.truck);
      blocked += sim.state.collision;
    }
    expect(bike.x).toBeGreaterThan(truck.x + 20);
    expect(truck.speed).toBeLessThan(0); // it did reverse
    expect(slowest).toBeCloseTo(twoWheelers.bicycle.top / 3.6, 5);
    expect(touches).toBe(0);
    expect(blocked).toBe(0);

    const { sim: carSim, other: car } = beside('car');
    timeUntil(carSim, IDLE, () => car.x > -30 && car.speed === 0, 60);
    expect(car.speed).toBe(0);
    expect(carSim.state.truck.x - tables.fleet.truck.length / 2 - (car.x + CAR.length / 2)).toBeCloseTo(truckGap, 1);
  });

  // #102: on a tertiary street the truck driving along the centre line leaves room in the lane for a two-wheeler's
  // path, not a car's; overtaking it there on the right, the riders cut in ahead of it.
  test.each(['scooter', 'bicycle'])('a %s never overtakes the truck driving along the centre line; it rides past it standing (#102)', (kind) => {
    const wide = build([way('tertiary', [[-90, -40], [90, -40], [90, 40], [-90, 40]]), way('tertiary', [[-90, 40], [-90, -40]])], quiet);
    const sim = createSim(quiet, wide, seeded(1));
    const rider = addCar(sim, 1, [[-80, -40], [90, -40]], false, kind);
    const { truck } = sim.state;
    Object.assign(truck, { x: -50, z: -40, heading: EAST, speed: 3 });
    expect(rider.z - classes.tertiary.lane).toBeCloseTo(-40, 6); // in the eastbound lane, the truck on the centre line
    let [ahead, touches] = [false, 0];
    for (let t = 0; t < 30; t += DT) {
      truck.speed = 3; // driving on at a crawl
      sim.step(DT, IDLE);
      ahead ||= rider.x > truck.x;
      touches += vehiclesOverlap(rider, rider.size, truck, tables.fleet.truck);
    }
    expect(ahead).toBe(false);
    expect(touches).toBe(0);
    // Standing there, it is an obstacle the rider rides past.
    truck.speed = 0;
    timeUntil(sim, BRAKE, () => rider.x > truck.x + 10, 30);
    expect(rider.x).toBeGreaterThan(truck.x + 10);
  });

  test.each(['scooter', 'bicycle'])('a %s stops for a pedestrian at a zebra crossing and rides on once it is clear (#102)', (kind) => {
    // Via A (tertiary) east–west, and Vicolo (residential) south from it, with a zebra crossing near its mouth.
    const map = build([way('tertiary', [[-90, 0], [0, 0], [90, 0]], { name: 'Via A' }), way('residential', [[0, 0], [0, 90]], { name: 'Vicolo' })], quiet);
    const sim = createSim(quiet, map, seeded(1));
    Object.assign(sim.state.truck, offRoad(map, 40, 40));
    const [zebra] = sim.state.zebras;
    // Someone waits at it for 20 s (no pedestrians walk here: the Sim's count of them would be 0).
    let people = 1;
    Object.defineProperty(zebra, 'people', { get: () => people, set: () => {} });
    const rider = addCar(sim, 1, [[0, 60], [0, 0], [60, 0]], false, kind); // north up Vicolo, then east
    const gap = () => rider.z - rider.size.length / 2 - (zebra.z + tables.zebras.depth / 2); // front bumper to the strip
    let [nearest, stood] = [Infinity, false];
    for (let t = 0; t < 20; t += DT) {
      sim.step(DT, IDLE);
      nearest = Math.min(nearest, gap());
      stood ||= rider.speed === 0;
    }
    expect(stood).toBe(true);
    expect(nearest).toBeGreaterThan(0);
    people = 0;
    timeUntil(sim, IDLE, () => rider.lane.kind === 'turn', 20);
    expect(rider.lane.kind).toBe('turn');
  });
});
