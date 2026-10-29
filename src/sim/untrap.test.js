// #110: AI cars never trap the truck: they keep a gap behind it, back off when it reverses towards them, wait while it
// turns round, and a safety net clears the ones that box it in anyway.
import { describe, expect, test } from 'vitest';
import * as base from '../tables.js';
import { freshProfile } from './sim.js';
import { outOfView } from './traffic.js';
import { poseAt } from './lanes.js';
import { way, build, box, createSim, mapOf, addCar, drive, timeUntil, vehiclesOverlap, seeded, DT, GAS, IDLE } from './fixtures.js';

// No AI cars, police or pedestrians of their own: each test adds the cars it needs.
const tables = {
  ...base,
  rank: { ...base.rank, tiers: base.rank.tiers.map((t) => ({ ...t, traffic: 0 })) },
  police: { ...base.police, count: 0 },
  pedestrians: { ...base.pedestrians, count: 0 },
  zebras: { ...base.zebras, use: 0 },
};
const { truckGap, trap } = tables.traffic;
const CAR = tables.city.obstacles.car;
const TRUCK = tables.fleet.truck;
const [EAST, WEST] = [Math.PI / 2, -Math.PI / 2];
const { width, lane } = tables.osm.classes.residential;

// A ring road round a 180 × 80 m block; along its north side (z = -40) a narrow two-way street between building walls
// just clear of its pavements. Eastbound cars drive at z = -40 + lane. With a street south from it at x = `cross`
// through the block (the cars' only), meeting it at an unsignalled crossing.
const wall = width / 2 + tables.osm.pavement;
const street = (cross = null) =>
  build([
    way('residential', cross === null ? [[-90, -40], [90, -40], [90, 40], [-90, 40]] : [[-90, -40], [cross, -40], [90, -40], [90, 40], [-90, 40]]),
    way('residential', [[-90, 40], [-90, -40]]),
    ...(cross === null ? [] : [way('residential', [[cross, -40], [cross, 40]])]),
    box(-80, -40 - wall - 10, 80, -40 - wall),
    box(-80, -40 + wall, 80, -40 + wall + 10),
  ], tables);
const EAST_LANE = -40 + lane;

// A Sim on the street with the truck standing at x in the eastbound lane, facing east; with its trailer hitched
// straight behind it if `hitched`.
const TR = tables.trailer;
function streetSim(x = 0, hitched = false, cross = null) {
  const profile = hitched ? { ...freshProfile(), stars: tables.rank.tiers.at(-1).stars, trailer: { level: 1, hitched: true } } : freshProfile();
  const sim = createSim(tables, street(cross), seeded(1), profile);
  Object.assign(sim.state.truck, { x, z: EAST_LANE, heading: EAST, speed: 0 });
  if (hitched) Object.assign(sim.state.trailer, { x: x - TR.hitch - TR.drawbar - TR.length / 2, z: EAST_LANE, heading: EAST });
  return sim;
}
// Eastbound cars from x0, stopped behind the truck, one by one.
function queueBehind(sim, xs) {
  const cars = xs.map((x, i) => addCar(sim, i + 1, [[x, -40], [90, -40]]));
  drive(sim, 25, IDLE);
  return cars;
}
// m from the car's front bumper to the rear of the truck, or of its trailer, all facing east.
const gapTo = (sim, car) => {
  const { truck, trailer } = sim.state;
  return (trailer ? trailer.x - TR.length / 2 : truck.x - TRUCK.length / 2) - (car.x + CAR.length / 2);
};
// The cars overlapping the truck or its trailer.
const touching = (sim) => sim.state.traffic.filter((c) => vehiclesOverlap(c, CAR, sim.state.truck, TRUCK) || (sim.state.trailer && vehiclesOverlap(c, CAR, sim.state.trailer, TR))).length;

// Steps with `input` until `done()` or `limit` s, counting the steps a car overlaps the truck and the fines for running
// into one.
function watch(sim, input, done, limit) {
  let [touches, fines] = [0, 0];
  for (let t = 0; t < limit && !done(); t += DT) {
    sim.state.lastFine = null;
    sim.step(DT, typeof input === 'function' ? input() : input);
    touches += touching(sim);
    fines += sim.state.lastFine?.reason === 'collision';
  }
  return { touches, fines };
}

// m along x where the eastbound lane run starts past the crossing at x = `cross`.
function runStart(map, cross) {
  const run = map.graph.paths.find((p) => p.kind === 'run' && Math.abs(map.graph.nodes[p.from].x - cross) < 0.1 && p.startDir.x > 0.99);
  const pose = { x: 0, z: 0, heading: 0 };
  poseAt(run, 0, pose);
  return pose.x;
}

// Whether a car is in the truck's view, as the chase camera sees: within 45° of the truck's heading from the camera
// (its 60° field of view, about that wide either side at a 16:10 screen), on the line the truck looks along or across.
const inView = (c, truck) => {
  const [fx, fz] = [Math.sin(truck.heading), Math.cos(truck.heading)];
  const along = (c.x - truck.x) * fx + (c.z - truck.z) * fz + tables.camera.chaseDistance;
  const across = (c.x - truck.x) * fz - (c.z - truck.z) * fx;
  return (along > 0 && Math.abs(across) < along) || !outOfView(c, truck, 0, Math.cos(tables.traffic.spawnView));
};

// Reverses gently (a light touch on the brake pedal drives backwards, see sim.js).
const REVERSE = { steer: 0, gas: 0, brake: 0.2 };

describe('Sim: AI cars never trap the truck (#110)', () => {
  test(`a car behind a stopping truck stops ${truckGap} m behind it`, () => {
    const sim = streetSim(-55);
    const { truck } = sim.state;
    const car = addCar(sim, 1, [[-75, -40], [90, -40]]);
    drive(sim, 4, GAS);
    expect(truck.speed).toBeGreaterThan(5);
    timeUntil(sim, { steer: 0, gas: 0, brake: 1 }, () => truck.speed === 0, 20);
    drive(sim, 10, IDLE);
    expect(car.speed).toBe(0);
    expect(gapTo(sim, car)).toBeCloseTo(truckGap, 1);
  });

  test.each([['', false], [' with its trailer', true]])('a queue behind the truck%s backs off as it reverses towards it, never touched', (_, hitched) => {
    const sim = streetSim(0, hitched);
    const { truck } = sim.state;
    const [first, second] = queueBehind(sim, [-40, -60]);
    expect(gapTo(sim, first)).toBeCloseTo(truckGap, 1);
    const [x1, x2, xt] = [first.x, second.x, truck.x];
    const { touches, fines } = watch(sim, REVERSE, () => xt - truck.x > 6, 15);
    expect(xt - truck.x).toBeGreaterThan(6);
    expect(touches + fines).toBe(0);
    expect(x1 - first.x).toBeGreaterThan(3);
    expect(x2 - second.x).toBeGreaterThan(3);
    expect(second.x + CAR.length / 2).toBeLessThan(first.x - CAR.length / 2); // still a queue
    // It stands: the queue stays about the gap behind it, backed off from the last of its reversing.
    drive(sim, 10, IDLE);
    expect(gapTo(sim, first)).toBeGreaterThan(truckGap - 1);
    expect(gapTo(sim, first)).toBeLessThan(truckGap + 0.1);
  });

  test('a three-point turn in the narrow street, a car behind and one coming, completes untouched', () => {
    const sim = streetSim();
    const { truck } = sim.state;
    queueBehind(sim, [-40]);
    addCar(sim, 2, [[75, -40], [-90, -40]]); // coming the other way
    // First back up 4 m, to swing the nose round clear of the car parked ahead.
    const back = watch(sim, REVERSE, () => truck.x < -4, 15);
    expect(truck.x).toBeLessThan(-4);
    expect(back.touches + back.fines).toBe(0);
    // Full lock left forwards, full lock right backwards, each leg until the truck meets the wall, until it faces west.
    let forward = true;
    const facing = () => Math.cos(truck.heading - WEST) > Math.cos(0.15);
    const input = () => {
      if (sim.state.collision && Math.abs(truck.speed) < 0.1) forward = !forward;
      return forward ? { steer: -1, gas: 0.4, brake: 0 } : { steer: 1, gas: 0, brake: 0.4 };
    };
    const { touches, fines } = watch(sim, input, facing, 60);
    expect(facing()).toBe(true);
    expect(touches + fines).toBe(0);
    // Then on along the westbound lane, steering into it (positive steer lowers the heading, towards its side).
    const towards = () => WEST - 0.3 * (truck.z - (-40 - lane));
    const steer = () => Math.max(-1, Math.min(1, 3 * Math.atan2(Math.sin(truck.heading - towards()), Math.cos(truck.heading - towards()))));
    const away = watch(sim, () => ({ steer: steer(), gas: 0.4, brake: 0 }), () => truck.x < -30, 20);
    expect(truck.x).toBeLessThan(-30);
    expect(away.touches + away.fines).toBe(0);
  });

  // Mid-street, and with the last car's rear at the start of its lane, a crossing behind it (QA: such cars never moved).
  test.each([['', null], [', the last at a crossing', -60]])(`a truck boxed in between a wall and cars%s gets free within ${trap.time} s, no car vanishing in view`, (_, cross) => {
    // The truck 8.35 m on from the lane's start past the crossing puts the second car's rear right at it (see below).
    const start = cross === null ? -40 : runStart(street(cross), cross) + 8.35;
    const sim = streetSim(start, false, cross);
    const { truck } = sim.state;
    // Half turned round, its nose against the north wall.
    timeUntil(sim, { steer: -1, gas: 0.4, brake: 0 }, () => sim.state.collision && truck.x > -39, 15);
    expect(sim.state.collision).toBe(true);
    // Two cars crept up close behind it, too close to each other to back off as a queue does.
    const near = (c, m) => vehiclesOverlap(c, CAR, truck, { length: TRUCK.length + 2 * m, width: TRUCK.width + 2 * m });
    const first = addCar(sim, 1, [[truck.x, -40], [90, -40]]);
    while (near(first, 0.7)) {
      first.s -= 0.1;
      sim.step(0, IDLE);
    }
    const second = addCar(sim, 2, [[first.x - CAR.length - 0.8, -40], [90, -40]]);
    if (cross !== null) {
      expect(second.s).toBeCloseTo(CAR.length / 2, 0);
      second.prev = mapOf(sim).graph.paths.find((p) => p.kind === 'turn' && p.out === second.lane && p.move === 'straight'); // it came through
    }
    // Reversing towards them, it would meet the first: it doesn't back off.
    let [touches, fines] = [0, 0];
    const vanished = [];
    const step = (input) => {
      const before = sim.state.traffic.map((c) => ({ c, seen: inView(c, truck) }));
      sim.state.lastFine = null;
      sim.step(DT, input);
      fines += sim.state.lastFine?.reason === 'collision';
      vanished.push(...before.filter(({ c }) => !sim.state.traffic.includes(c)).map((v) => v.seen));
      touches += touching(sim);
    };
    const x1 = first.x;
    for (let t = 0; t < 1; t += DT) step(REVERSE);
    expect(first.x).toBeCloseTo(x1, 5);
    // Kept from moving, forwards against the wall, for the safety net's time: they make way, and it reverses free.
    for (let t = 0; t < trap.time + 2; t += DT) step({ steer: 0, gas: 0.3, brake: 0 });
    expect(first.clearing && second.clearing).toBe(true);
    expect(near(first, 1.5)).toBe(false);
    const [xt, zt] = [truck.x, truck.z];
    for (let t = 0; t < 8; t += DT) step(REVERSE);
    expect(Math.hypot(truck.x - xt, truck.z - zt)).toBeGreaterThan(3);
    expect(vanished.filter(Boolean)).toEqual([]);
    expect(touches + fines).toBe(0);
    // Cleared, they leave the city once out of the truck's view (turned away from them across the block, if they
    // haven't yet), never in it.
    Object.assign(truck, { x: 0, z: 20, heading: 0 });
    step(IDLE);
    expect(sim.state.traffic).not.toContain(first);
    expect(sim.state.traffic).not.toContain(second);
    expect(vanished).toEqual([false, false]);
  });
});
