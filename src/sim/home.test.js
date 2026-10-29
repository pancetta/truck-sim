import { describe, expect, test } from 'vitest';
import { freshProfile, tankOf } from './sim.js';
import * as tables from '../tables.js';
import { DT, GAS, IDLE, acceptFrom, build, createSim, drive, monti, seeded, timeUntil, way, withSpots } from './fixtures.js';

const OK = { ok: true, reason: null };
const { wake } = tables.clock;

// Via Casa: a two-way street 200 m north–south, with the order spots A (20 m in from its north end) and B (140 m in),
// home H (60 m in) and the petrol station S (100 m in). A new game starts in H's kerb lane, facing south.
function casa(profile = freshProfile()) {
  const street = way('residential', [[0, -100], [0, 100]], { name: 'Via Casa' });
  const spot = (id, at) => ({ id, name: `Casa ${id}`, street: 'Via Casa', way: street.id, at, side: 'right' });
  const t = withSpots([spot('A', 20), spot('H', 60), spot('S', 100), spot('B', 140)], [], 'H', tables, ['S'], null, 'H');
  return createSim(t, build([street], t), seeded(1), profile);
}
const rich = (profile = {}) => ({ ...freshProfile(), money: 100000, ...profile });
const away = (sim) => Object.assign(sim.state.truck, { z: 40, speed: 0 }); // in B's zone
const atS = (sim) => Object.assign(sim.state.truck, { z: 0, speed: 0 });

describe('Sim: home', () => {
  test('a new game starts at home, which offers sleep and opens the Werkstatt', () => {
    const sim = casa();
    sim.step(DT, IDLE);
    expect(sim.state.serviceOffer).toEqual([{ id: 'sleep', price: 0 }]);
    expect(sim.state.garageAvailable).toBe(true);
  });

  test('sleep gives full energy and wakes the driver at 06:00, also through its service button', () => {
    for (const command of ['sleep', 'buyService']) {
      const sim = casa({ ...freshProfile(), energy: 0.1, timeOfDay: 23 * 60 });
      sim.step(DT, IDLE);
      expect(command === 'sleep' ? sim.sleep() : sim.buyService('sleep'), command).toEqual(OK);
      expect(sim.state.energy, command).toBe(1);
      expect(sim.state.timeOfDay, command).toBe(wake);
    }
  });

  test('sleep refuses away from home, while moving and with an active order, and changes nothing', () => {
    const tired = { ...freshProfile(), energy: 0.2 };
    const far = casa(tired);
    away(far);
    far.step(DT, IDLE);
    const moving = casa(tired);
    drive(moving, 0.5, GAS); // still in home's zone
    const onOrder = casa(tired);
    acceptFrom(onOrder, 'A');
    onOrder.step(DT, IDLE);
    expect(onOrder.state.serviceOffer).toEqual([]);

    for (const [sim, reason] of [[far, 'notAtHome'], [moving, 'moving'], [onOrder, 'notIdle']]) {
      const before = structuredClone(sim.state.profile);
      expect(sim.sleep(), reason).toEqual({ ok: false, reason });
      expect(sim.state.profile, reason).toEqual(before);
    }
  });

  test('away from home the Werkstatt is closed and its purchases refuse with notAtHome', () => {
    const [id] = Object.entries(tables.visuals).find(([, v]) => v.price > 0);
    const sim = casa(rich({ owned: [id], stars: 1000 }));
    away(sim);
    sim.step(DT, IDLE);
    expect(sim.state.garageAvailable).toBe(false);
    const before = structuredClone(sim.state.profile);
    for (const [command, item] of [['buyUpgrade', 'motor'], ['buyVisual', id], ['equipVisual', id], ['buyVehicle', 'van'], ['chooseVehicle', 'truck']]) {
      expect(sim[command](item), command).toEqual({ ok: false, reason: 'notAtHome' });
    }
    expect(sim.state.profile).toEqual(before);

    const home = casa(rich());
    expect(home.buyUpgrade('motor')).toEqual(OK);
  });

  test('home never comes up in offers', () => {
    const sim = casa();
    const places = new Set();
    for (let i = 0; i < 30; i++) for (const o of sim.requestOffers()) places.add(o.pickup).add(o.dropoff);
    expect([...places].sort()).toEqual(['A', 'B']);
  });
});

describe('Sim: tank upgrade', () => {
  const { levels } = tables.upgrades.tank;

  test('each tank level holds more, and a full tank drives further by as much', () => {
    // A thirsty truck, so a tank lasts a few hundred metres.
    const thirsty = { ...tables, fuel: { ...tables.fuel, perKm: 2000 } };
    const range = (level) => {
      const profile = { ...freshProfile(), vehicles: { truck: { tank: level } } };
      const sim = createSim(thirsty, undefined, Math.random, { ...profile, fuel: tankOf(profile, thirsty) });
      timeUntil(sim, GAS, () => sim.state.fuel === 0, 120);
      return sim.state.profile.distance;
    };
    const base = range(0);
    expect(base).toBeGreaterThan(0);
    levels.forEach(({ factor }, i) => {
      expect(tankOf({ vehicle: 'truck', vehicles: { truck: { tank: i + 1 } } }, tables)).toBe(tables.fleet.truck.tank * factor);
      expect(range(i + 1) / base).toBeCloseTo(factor, 1);
    });
  });

  test('a fill-up fills the upgraded tank', () => {
    const sim = casa(rich({ vehicles: { truck: { tank: 2 } }, fuel: 100 }));
    const tank = tables.fleet.truck.tank * levels[1].factor;
    atS(sim);
    sim.step(DT, IDLE);
    expect(sim.state.serviceOffer[0]).toEqual({ id: 'fuel', price: Math.ceil((tank - 100) * tables.fuel.price) });
    sim.buyService('fuel');
    drive(sim, tables.fuel.fillTime + 0.1, IDLE);
    expect(sim.state.fuel).toBe(tank);
  });
});

describe('Monti: home', () => {
  const map = monti();
  const home = map.spots.find((s) => s.home);

  test('every spot reaches it and it reaches every spot; a new game starts in its zone, clear of everything', () => {
    expect(home.id).toBe(tables.osm.home);
    for (const o of map.spots.filter((o) => o !== home)) {
      const walk = o.pose.edge.pedestrian; // only the Dreirad gets there
      expect(map.graph.route(o.pose, home.pose, 0, null, walk), `${o.id} → home`).toBeTruthy();
      expect(map.graph.route(home.pose, o.pose, 0, null, walk), `home → ${o.id}`).toBeTruthy();
    }
    expect(map.start).toEqual(home.lane);
    const sim = createSim(tables, map, seeded(1));
    sim.step(DT, IDLE);
    expect(sim.state.collision).toBe(false);
    expect(sim.state.garageAvailable).toBe(true);
    expect(sim.state.serviceOffer).toEqual([{ id: 'sleep', price: 0 }]);
  });
});
