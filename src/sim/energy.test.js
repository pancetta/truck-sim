import { describe, expect, test } from 'vitest';
import { freshProfile, inside } from './sim.js';
import * as tables from '../tables.js';
import { BRAKE, DT, GAS, IDLE, build, createSim, drive, monti, seeded, timeUntil, way, withSpots } from './fixtures.js';

const { drive: driveTime, tired, exhausted, snack, meal } = tables.energy;

// Via Cena: a two-way street 200 m north–south, with the petrol station S (60 m in from its north end), the restaurant R
// (140 m in) and the order spots A and B. A new game starts in S's kerb lane, facing south.
function cena(profile = freshProfile()) {
  const street = way('residential', [[0, -100], [0, 100]], { name: 'Via Cena' });
  const spot = (id, at) => ({ id, name: `Bottega ${id}`, street: 'Via Cena', way: street.id, at, side: 'right' });
  const t = withSpots([spot('A', 20), spot('S', 60), spot('B', 100), spot('R', 140)], [], 'S', tables, ['S'], 'R');
  return createSim(t, build([street], t), seeded(1), profile);
}
const rested = (energy) => ({ ...freshProfile(), energy, money: 1000 });
const atR = (sim) => Object.assign(sim.state.truck, { z: 40, speed: 0 }); // in R's zone, along the kerb lane

describe('Sim: driver energy', () => {
  test('energy drains over driving time, from 1 to 0 in tables.energy.drive s; standing still drains none', () => {
    const sim = createSim(tables);
    drive(sim, 5, IDLE);
    expect(sim.state.energy).toBe(1);
    drive(sim, 60, GAS);
    expect(sim.state.energy).toBeCloseTo(1 - 60 / driveTime, 3);
    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0, 30);
    const energy = sim.state.energy;
    drive(sim, 5, IDLE);
    expect(sim.state.energy).toBe(energy);
  });

  test('the tired and exhausted flags flip at their thresholds', () => {
    const sim = createSim(tables, undefined, Math.random, rested(tired + 0.002));
    expect([sim.state.tired, sim.state.exhausted]).toEqual([false, false]);
    drive(sim, 0.004 * driveTime, GAS);
    expect([sim.state.tired, sim.state.exhausted]).toEqual([true, false]);
    sim.state.profile.energy = exhausted + 0.001;
    expect(sim.state.exhausted).toBe(false);
    drive(sim, 0.002 * driveTime, GAS);
    expect([sim.state.tired, sim.state.exhausted]).toEqual([true, true]);
  });

  // The heading turned by 0.3 s of full right lock, and the speed shed by 0.3 s of full brake, from 10 s of gas.
  function response(energy) {
    const sim = createSim(tables, undefined, Math.random, rested(energy));
    drive(sim, 10, GAS);
    const { heading, speed } = sim.state.truck;
    drive(sim, 0.3, { ...GAS, steer: 1 });
    const turned = heading - sim.state.truck.heading;
    drive(sim, 0.3, GAS); // let the wheel come back
    const before = sim.state.truck.speed;
    drive(sim, 0.3, BRAKE);
    return { turned, braked: before - sim.state.truck.speed, speed };
  }

  test('exhausted, steering and brake lag behind the input, more at lower energy', () => {
    const fresh = response(1);
    const spent = response(exhausted - 0.001);
    const empty = response(0);
    expect(fresh.speed).toBeCloseTo(empty.speed, 6); // the gas isn't touched
    expect(spent.turned).toBeLessThan(fresh.turned * 0.95);
    expect(empty.turned).toBeLessThan(spent.turned * 0.95);
    expect(spent.braked).toBeLessThan(fresh.braked * 0.95);
    expect(empty.braked).toBeLessThan(spent.braked * 0.95);
    expect(empty.braked).toBeGreaterThan(0); // slower, but it still brakes
    expect(response(tired - 0.01)).toEqual(fresh); // tired alone changes nothing
  });
});

describe('Sim: snack and meal', () => {
  test('a petrol station offers a snack while the driver is below full energy, after the fill-up', () => {
    const sim = cena({ ...rested(0.5), fuel: tables.fuel.tank / 2 });
    sim.step(DT, IDLE);
    expect(sim.state.serviceOffer.map((s) => s.id)).toEqual(['fuel', 'snack']);
    expect(sim.state.serviceOffer[1]).toEqual({ id: 'snack', price: snack.price });
    const full = cena(rested(1));
    full.step(DT, IDLE);
    expect(full.state.serviceOffer).toEqual([]);
  });

  test('a snack restores some energy, paid when its stop completes', () => {
    const sim = cena(rested(0.2));
    sim.step(DT, IDLE);
    expect(sim.buyService('snack').ok).toBe(true);
    drive(sim, snack.time + 0.1, IDLE);
    expect(sim.state.service).toBe(null);
    expect(sim.state.energy).toBeCloseTo(0.2 + snack.restore, 9);
    expect(sim.state.profile.money).toBe(1000 - snack.price);

    const near = cena(rested(0.9));
    near.step(DT, IDLE);
    near.buyService('snack');
    drive(near, snack.time + 0.1, IDLE);
    expect(near.state.energy).toBe(1); // never over full
  });

  test('the restaurant sells a meal that restores all of it, like a refuel; driving off ends it unpaid', () => {
    const sim = cena(rested(0.05));
    atR(sim);
    sim.step(DT, IDLE);
    expect(sim.state.serviceOffer).toEqual([{ id: 'meal', price: meal.price }]);
    expect(sim.buyService('fuel')).toEqual({ ok: false, reason: 'unknown' });
    expect(sim.buyService('meal')).toEqual({ ok: true, reason: null });
    expect(sim.buyService('meal')).toEqual({ ok: false, reason: 'busy' });
    drive(sim, meal.time / 2, IDLE);
    expect(sim.state.service.progress).toBeCloseTo(0.5, 1);
    drive(sim, meal.time / 2 + 0.1, IDLE);
    expect(sim.state.energy).toBe(1);
    expect(sim.state.profile.money).toBe(1000 - meal.price);
    expect(sim.state.serviceOffer).toEqual([]);

    const poor = cena({ ...rested(0.5), money: meal.price - 1 });
    atR(poor);
    poor.step(DT, IDLE);
    expect(poor.buyService('meal')).toEqual({ ok: false, reason: 'noMoney' });

    const leaving = cena(rested(0.5));
    atR(leaving);
    leaving.step(DT, IDLE);
    leaving.buyService('meal');
    drive(leaving, 1, GAS);
    expect(leaving.state.service).toBe(null);
    expect(leaving.state.profile.money).toBe(1000);
  });

  test('the restaurant never comes up in offers', () => {
    const sim = cena(rested(1));
    const places = new Set();
    for (let i = 0; i < 30; i++) for (const o of sim.requestOffers()) places.add(o.pickup).add(o.dropoff);
    expect([...places].sort()).toEqual(['A', 'B']);
  });
});

describe('Monti: the restaurant', () => {
  const map = monti();
  const restaurant = map.spots.find((s) => s.restaurant);

  test('it is on a main street every spot reaches, its terrace clear of every other collider, and a truck fits in its zone', () => {
    expect(restaurant.id).toBe(tables.osm.restaurant);
    expect(tables.osm.lightClasses).toContain(restaurant.pose.edge.class);
    for (const o of map.spots.filter((o) => o !== restaurant)) {
      expect(map.graph.route(o.pose, restaurant.pose), `${o.id} → R`).toBeTruthy();
      expect(map.graph.route(restaurant.pose, o.pose), `R → ${o.id}`).toBeTruthy();
    }
    const [terrace, ...more] = map.colliders.filter((c) => c.kind === 'restaurant');
    expect(more).toEqual([]);
    // shortcut: samples the terrace on a 0.25 m grid of its bounds that falls inside it, so a sliver under that is missed.
    const hits = new Set();
    for (let x = terrace.minX; x <= terrace.maxX; x += 0.25) {
      for (let z = terrace.minZ; z <= terrace.maxZ; z += 0.25) {
        if (!inside(x, z, terrace.points)) continue;
        for (const c of map.colliders) if (c !== terrace && inside(x, z, c.points)) hits.add(c.kind);
      }
    }
    expect([...hits]).toEqual([]);

    const sim = createSim(tables, map, seeded(1));
    Object.assign(sim.state.truck, restaurant.lane, { speed: 0 });
    sim.step(DT, IDLE);
    expect(sim.state.collision).toBe(false);
  });
});
