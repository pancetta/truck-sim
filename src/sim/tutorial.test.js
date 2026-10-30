import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { freshProfile } from './sim.js';
import { poseAt } from './lanes.js';
import { BRAKE, DT, GAS, IDLE, acceptFrom, createSim, drive, lane, mapOf, parkAt, seeded, timeUntil } from './fixtures.js';

// The guided first delivery (#113): profile.tutorial is the step it waits at, passed by the player's action or, for a
// step that only shows something, by nextTutorial(); no fines while it runs.
const noCars = { ...tables, rank: { ...tables.rank, tiers: tables.rank.tiers.map((x) => ({ ...x, traffic: 0 })) } };
const laneSim = (profile) => {
  const { t, map } = lane(noCars);
  return createSim(t, map, seeded(1), profile);
};
const at = (sim) => sim.state.profile.tutorial;
// A car standing in the truck's lane, 8 m ahead of its front.
function carAhead(sim) {
  const run = mapOf(sim).graph.paths.find((p) => p.kind === 'run' && p.startDir.z > 0);
  const ahead = sim.state.truck.z + tables.fleet.truck.length / 2 + 8 + tables.city.obstacles.car.length / 2;
  const pose = { x: 0, z: 0, heading: 0 };
  let s = 0;
  while (s < run.length && (poseAt(run, s, pose), pose.z < ahead)) s += 0.1;
  sim.state.traffic.push({ id: 99, x: 0, z: 0, heading: 0, speed: 0, lane: run, route: [run], s, police: false, halt: 1e9 });
}

describe('Sim: the tutorial', () => {
  test('a new Profile has none; startTutorial() starts it at its first step', () => {
    const sim = laneSim();
    expect(at(sim)).toBe(null);
    sim.startTutorial();
    expect(at(sim)).toBe(tables.tutorial.steps[0]);
  });

  test('each step waits for the player: driving, braking, Weiter, accepting, the Zone, loading, the delivery, reversing', () => {
    const sim = laneSim();
    sim.startTutorial();
    drive(sim, 3, IDLE);
    sim.nextTutorial(); // a step passed by an action has no Weiter
    expect(at(sim)).toBe('drive');

    // On the lane the truck faces south towards B, 28 m on.
    timeUntil(sim, GAS, () => at(sim) !== 'drive', 10);
    expect(at(sim)).toBe('brake');
    expect(sim.state.profile.distance).toBeGreaterThanOrEqual(tables.tutorial.drive);
    timeUntil(sim, BRAKE, () => at(sim) !== 'brake', 10);
    expect(at(sim)).toBe('signs');
    expect(Math.abs(sim.state.truck.speed)).toBeLessThan(tables.fleet.truck.stopSpeed);

    drive(sim, 0.5, IDLE);
    expect(at(sim)).toBe('signs');
    sim.nextTutorial();
    expect(at(sim)).toBe('offers');
    drive(sim, 1, IDLE);
    expect(at(sim)).toBe('offers');

    acceptFrom(sim, 'A');
    sim.step(DT, IDLE);
    expect(at(sim)).toBe('pickup');
    parkAt(sim, 'A'); // reverses into A's zone at the north end, and stops there
    expect(at(sim)).toBe('load');
    expect(sim.state.progress).toBeGreaterThan(0);
    expect(sim.state.order.phase).toBe('pickup');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expect(at(sim)).toBe('dropoff');

    parkAt(sim, 'B');
    expect(at(sim)).toBe('dropoff');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expect(sim.state.lastPayment.stars.length).toBeGreaterThan(0);
    expect(at(sim)).toBe('reverse');

    // Against B's wall: holding the brake at a standstill reverses.
    timeUntil(sim, BRAKE, () => at(sim) !== 'reverse', 10);
    expect(at(sim)).toBe('home');
    expect(sim.state.truck.gear).toBe('R');
    sim.nextTutorial();
    expect(at(sim)).toBe(null);
  });

  test('steps the player has already done pass at once', () => {
    const sim = laneSim();
    sim.startTutorial();
    acceptFrom(sim, 'A');
    parkAt(sim, 'A');
    drive(sim, tables.orders.loadTime + 0.1, IDLE); // loaded, on the way to B
    expect(at(sim)).toBe('dropoff'); // reversed 20 m into A, stood on the brake there; signs pass with an order on
  });

  test('loaded with a step on the way through an order, which is not saved, it goes back to accepting one', () => {
    for (const step of ['pickup', 'load', 'dropoff']) expect(at(laneSim({ ...freshProfile(), tutorial: step })), step).toBe('offers');
    for (const step of ['signs', 'offers', 'reverse', 'home']) expect(at(laneSim({ ...freshProfile(), tutorial: step })), step).toBe(step);
  });

  test('it can be skipped at any step, and replayed', () => {
    for (const step of tables.tutorial.steps) {
      const sim = laneSim({ ...freshProfile(), tutorial: step });
      sim.skipTutorial();
      drive(sim, 1, IDLE);
      expect(at(sim), step).toBe(null);
    }
    const sim = laneSim({ ...freshProfile(), tutorial: 'reverse' });
    sim.startTutorial();
    expect(at(sim)).toBe('drive');
  });

  test('after the delivery, at the steps left, the fines are back', () => {
    const sim = laneSim({ ...freshProfile(), money: 1000, tutorial: 'reverse' });
    carAhead(sim);
    timeUntil(sim, GAS, () => sim.state.lastFine, 10);
    expect(sim.state.lastFine).toEqual({ reason: 'collision', amount: tables.fines.collision });
    expect(at(sim)).toBe('reverse');
  });

  test('no fines while it guides the delivery, and none of its faults cost the clean Star; skipped, the fines are back', () => {
    const sim = laneSim({ ...freshProfile(), money: 1000 });
    sim.startTutorial();
    const order = acceptFrom(sim, 'B');
    expect(order).toBeTruthy();
    carAhead(sim);

    drive(sim, 2, GAS); // into it, and pushing on
    expect(sim.state.lastFine).toBe(null);
    expect(sim.state.profile.money).toBe(1000);
    expect(sim.state.order.faults).toEqual([]);

    sim.skipTutorial();
    drive(sim, 2, BRAKE);
    drive(sim, 0.5, IDLE);
    timeUntil(sim, GAS, () => sim.state.lastFine, 10);
    expect(sim.state.lastFine).toEqual({ reason: 'collision', amount: tables.fines.collision });
    expect(sim.state.order.faults).toEqual(['collision']);
  });
});
