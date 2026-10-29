import { describe, expect, test } from 'vitest';
import { freshProfile, inside } from './sim.js';
import * as tables from '../tables.js';
import { BRAKE, DT, GAS, IDLE, build, createSim, drive, mapOf, monti, seeded, timeUntil, way, withSpots } from './fixtures.js';

const { perKm, perTonne, perPedal, price, fillTime, towFee, towTime, emergency } = tables.fuel;
const { tank } = tables.fleet.truck;

// Via Pompa: a two-way street 200 m north–south, with the petrol stations S (60 m in from its north end) and T (180 m
// in), and the order spots A and B. A new game starts in S's kerb lane, facing south.
function pompa(profile = freshProfile(), t = tables) {
  const street = way('residential', [[0, -100], [0, 100]], { name: 'Via Pompa' });
  const spot = (id, at) => ({ id, name: `Bottega ${id}`, street: 'Via Pompa', way: street.id, at, side: 'right' });
  const spots = withSpots([spot('A', 20), spot('S', 60), spot('B', 120), spot('T', 180)], [], 'S', t, ['S', 'T']);
  return createSim(spots, build([street], spots), seeded(1), profile);
}
const at = (sim, z) => Object.assign(sim.state.truck, { z, speed: 0 }); // along the kerb lane
const used = (sim, before) => before - sim.state.fuel;

describe('Sim: fuel', () => {
  test('driving burns perKm litres per km, more with the pedal down and more when loaded', () => {
    const sim = createSim(tables);
    let fuel = sim.state.fuel;
    drive(sim, 10, GAS);
    let distance = sim.state.profile.distance;
    expect(used(sim, fuel)).toBeCloseTo((distance / 1000) * perKm * (1 + perPedal), 6); // 60 L/km at full gas

    [fuel, distance] = [sim.state.fuel, sim.state.profile.distance];
    drive(sim, 2, IDLE); // coasting
    expect(used(sim, fuel)).toBeCloseTo(((sim.state.profile.distance - distance) / 1000) * perKm, 6);

    sim.state.truck.mass += 10_000; // 10 t of cargo
    [fuel, distance] = [sim.state.fuel, sim.state.profile.distance];
    drive(sim, 2, GAS);
    expect(used(sim, fuel)).toBeCloseTo(((sim.state.profile.distance - distance) / 1000) * perKm * (1 + 10 * perTonne) * (1 + perPedal), 6);
  });

  test("the van burns its thirst's share of what the truck burns on the same metres", () => {
    const sim = createSim(tables, undefined, Math.random, { ...freshProfile(), vehicles: { truck: {}, van: {} } });
    sim.chooseVehicle('van');
    const fuel = sim.state.fuel;
    drive(sim, 10, GAS);
    expect(used(sim, fuel)).toBeCloseTo((sim.state.profile.distance / 1000) * perKm * tables.fleet.van.thirst * (1 + perPedal), 6);
  });

  test('worked example: 1 km at full gas with 10 t loaded burns 72 L; a standing truck burns none', () => {
    expect(perKm * (1 + 10 * perTonne) * (1 + perPedal)).toBeCloseTo(72, 9);
    const sim = createSim(tables);
    drive(sim, 5, IDLE);
    expect(sim.state.fuel).toBe(tank);
  });

  test('with an empty tank the gas does nothing: the truck coasts', () => {
    const sim = createSim(tables, undefined, Math.random, { ...freshProfile(), fuel: 0 });
    drive(sim, 2, GAS);
    expect(sim.state.truck.speed).toBe(0);
    expect(sim.state.lastTow).toBe(null); // no map, no station
  });
});

describe('Sim: petrol stations', () => {
  const half = { ...freshProfile(), fuel: tank / 2, money: 1000 };

  test('standing still in a station zone offers a fill-up for the missing litres; not moving, elsewhere or full', () => {
    const sim = pompa(half);
    sim.step(DT, IDLE);
    expect(sim.state.serviceOffer).toEqual([{ id: 'fuel', price: Math.ceil((tank / 2) * price) }]);
    drive(sim, 1, GAS);
    expect(sim.state.serviceOffer).toEqual([]);
    at(sim, 20); // A's zone
    sim.step(DT, IDLE);
    expect(sim.state.serviceOffer).toEqual([]);

    const full = pompa({ ...freshProfile(), money: 1000 });
    full.step(DT, IDLE);
    expect(full.state.serviceOffer).toEqual([]);
  });

  test('buying the fill-up runs a stop; when it completes the money is charged and the tank is full', () => {
    const sim = pompa(half);
    sim.step(DT, IDLE);
    const [{ price: cost }] = sim.state.serviceOffer;
    expect(sim.buyService('fuel')).toEqual({ ok: true, reason: null });
    expect(sim.state.service).toEqual({ id: 'fuel', price: cost, progress: 0 });
    expect(sim.state.serviceOffer).toEqual([]);
    expect(sim.buyService('fuel')).toEqual({ ok: false, reason: 'busy' });

    drive(sim, fillTime / 2, IDLE);
    expect(sim.state.service.progress).toBeCloseTo(0.5, 1);
    expect(sim.state.profile.money).toBe(1000);
    drive(sim, fillTime / 2 + 0.1, IDLE);
    expect(sim.state.service).toBe(null);
    expect(sim.state.fuel).toBe(tank);
    expect(sim.state.profile.money).toBe(1000 - cost);
  });

  test("it's refused without the money, for what isn't offered, and while moving; driving off ends a stop unpaid", () => {
    const poor = pompa({ ...half, money: 50 });
    poor.step(DT, IDLE);
    expect(poor.buyService('fuel')).toEqual({ ok: false, reason: 'noMoney' });
    expect(poor.buyService('snack')).toEqual({ ok: false, reason: 'unknown' });
    expect(poor.state.service).toBe(null);

    const sim = pompa(half);
    drive(sim, 1, GAS);
    expect(sim.buyService('fuel')).toEqual({ ok: false, reason: 'moving' });
    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0, 5);
    sim.step(DT, IDLE);
    expect(sim.buyService('fuel').ok).toBe(true);
    drive(sim, 1, GAS);
    expect(sim.state.service).toBe(null);
    expect(sim.state.profile.money).toBe(1000);
    expect(sim.state.fuel).toBeLessThan(tank);
  });

  test('an order keeps counting its time during a stop', () => {
    const sim = pompa(half);
    sim.acceptOrder(sim.requestOffers()[0].id);
    sim.step(DT, IDLE);
    sim.buyService('fuel');
    const { elapsed } = sim.state.order;
    drive(sim, 1, IDLE);
    expect(sim.state.order.elapsed).toBeCloseTo(elapsed + 1, 1);
  });

  test('stations never come up in offers', () => {
    const sim = pompa(half);
    const places = new Set();
    for (let i = 0; i < 30; i++) for (const o of sim.requestOffers()) places.add(o.pickup).add(o.dropoff);
    expect([...places].sort()).toEqual(['A', 'B']);
  });
});

describe('Sim: tow', () => {
  const dry = { ...freshProfile(), fuel: 0, money: 1000 };

  test('an empty tank at a standstill tows the truck to the station nearest by road, for the fee, the time and emergency fuel', () => {
    const sim = pompa(dry);
    at(sim, 50); // 30 m from B, 70 m before T: T is nearest
    const clock = sim.state.timeOfDay;
    sim.step(DT, IDLE);
    const t = mapOf(sim).spots.find((s) => s.id === 'T');
    expect(sim.state.truck).toMatchObject({ x: t.lane.x, z: t.lane.z, heading: t.lane.heading, speed: 0 });
    expect(sim.state.lastTow).toEqual({ station: 'T', fee: towFee });
    expect(sim.state.profile.money).toBe(1000 - towFee);
    expect(sim.state.timeOfDay).toBeCloseTo(clock + towTime + DT * tables.clock.minutesPerSecond, 6);
    expect(sim.state.fuel).toBe(emergency);
  });

  test('the tow works without money: the fee takes what there is, never below 0', () => {
    for (const money of [0, 100]) {
      const sim = pompa({ ...dry, money });
      at(sim, -60);
      sim.step(DT, IDLE);
      expect(sim.state.lastTow).toEqual({ station: 'S', fee: money });
      expect(sim.state.profile.money).toBe(0);
      expect(sim.state.fuel).toBe(emergency);
    }
  });

  test('a truck running dry coasts to a stop before the tow', () => {
    const sim = pompa({ ...freshProfile(), fuel: 0.5 });
    at(sim, -90);
    drive(sim, 3, GAS);
    expect(sim.state.fuel).toBe(0);
    expect(sim.state.lastTow).toBe(null);
    const speed = sim.state.truck.speed;
    drive(sim, 1, GAS);
    expect(sim.state.truck.speed).toBeLessThan(speed);
    timeUntil(sim, GAS, () => sim.state.lastTow, 200);
    expect(sim.state.lastTow).toEqual({ station: 'S', fee: 0 });
  });

  test('a truck running dry in its pickup zone loads first, then is towed', () => {
    const sim = pompa({ ...dry, fuel: 0 });
    let offer;
    for (let i = 0; i < 20 && !offer; i++) offer = sim.requestOffers().find((o) => o.pickup === 'A');
    sim.acceptOrder(offer.id);
    const a = mapOf(sim).spots.find((s) => s.id === 'A');
    Object.assign(sim.state.truck, a.lane, { speed: 0 });
    timeUntil(sim, IDLE, () => sim.state.lastTow, 10);
    expect(sim.state.order.phase).toBe('dropoff');
    expect(sim.state.lastTow.station).toBe('S');
  });

  test('standing dry in a station zone with the money to fill up, no tow: the player buys the fuel', () => {
    const sim = pompa(dry);
    drive(sim, 1, IDLE);
    expect(sim.state.lastTow).toBe(null);
    sim.buyService('fuel');
    drive(sim, fillTime + 0.1, IDLE);
    expect(sim.state.lastTow).toBe(null);
    expect(sim.state.fuel).toBe(tank);
  });
});

describe('Monti: petrol stations', () => {
  const map = monti();
  const stations = map.spots.filter((s) => s.station);

  test('each station is on the network every spot reaches, and its pump island stands clear of every other collider', () => {
    expect(stations.map((s) => s.id)).toEqual(tables.osm.stations);
    for (const s of stations) {
      for (const o of map.spots.filter((o) => !o.station)) {
        expect(map.graph.route(o.pose, s.pose), `${o.id} → ${s.id}`).toBeTruthy();
        expect(map.graph.route(s.pose, o.pose), `${s.id} → ${o.id}`).toBeTruthy();
      }
    }
    const islands = map.colliders.filter((c) => c.kind === 'station');
    expect(islands).toHaveLength(stations.length);
    // shortcut: samples the island on a 0.25 m grid of its bounds that falls inside it, so a sliver under that is missed.
    for (const i of islands) {
      const hits = new Set();
      for (let x = i.minX; x <= i.maxX; x += 0.25) {
        for (let z = i.minZ; z <= i.maxZ; z += 0.25) {
          if (!inside(x, z, i.points)) continue;
          for (const c of map.colliders) if (c !== i && inside(x, z, c.points)) hits.add(c.kind);
        }
      }
      expect([...hits]).toEqual([]);
    }
  });

  test('a truck parked in a station zone fits there', () => {
    for (const s of stations) {
      const sim = createSim(tables, map, seeded(1));
      Object.assign(sim.state.truck, s.lane, { speed: 0 });
      sim.step(DT, IDLE);
      expect(sim.state.collision, s.id).toBe(false);
    }
  });
});
