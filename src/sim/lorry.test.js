import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { freshProfile } from './sim.js';
import { createSim, monti, seeded } from './fixtures.js';

// The Schwerlaster (#90) on Monti: Schwertransport offers are its alone and keep to wide streets like Oversized ones; it
// gets no dock offers where it is longer than the map's bays; and it is bought, chosen and upgraded like any Vehicle.
describe('Sim: the Schwerlaster', () => {
  const map = monti();
  const { lorry } = tables.fleet;
  const top = tables.rank.tiers.at(-1).stars;
  const all = Object.fromEntries(Object.keys(tables.fleet).map((id) => [id, {}]));
  const rich = (profile = {}) => ({ ...freshProfile(), money: 100000, stars: top, vehicles: all, ...profile });
  const spot = (id) => map.spots.find((s) => s.id === id);

  // 100 rounds of offers at home, in Vehicle `id`, with `t` and `vehicles` (each owned one's upgrades).
  function offers(id, t = tables, vehicles = all) {
    const sim = createSim(t, map, seeded(1), rich({ vehicle: id, vehicles }));
    return Array.from({ length: 100 }, () => sim.requestOffers()).flat();
  }

  test('Schwertransport offers go only to it, carry the loads too heavy for the others, and keep to wide streets', () => {
    const best = Object.fromEntries(Object.keys(tables.upgrades).map((u) => [u, tables.upgrades[u].levels.length]));
    for (const id of Object.keys(tables.fleet).filter((k) => k !== 'lorry')) {
      const theirs = offers(id, tables, { ...all, [id]: best }); // with the biggest Ladefläche
      expect(theirs.filter((o) => o.type === 'schwertransport' || o.cargo.weight > tables.orders.schwertransport), id).toEqual([]);
    }
    const own = offers('lorry');
    const heavy = own.filter((o) => o.type === 'schwertransport');
    expect(heavy.length).toBeGreaterThan(own.length / 5);
    expect(own.filter((o) => o.cargo.weight > tables.orders.schwertransport)).toEqual(heavy);
    for (const o of heavy) {
      const [from, to] = [spot(o.pickup), spot(o.dropoff)];
      expect([from, to].map((s) => s.pose.edge.width >= tables.orders.oversizedWidth && !s.dock)).toEqual([true, true]);
      // the wide route, leaving the pickup the way the truck arrives there (#99); its arrow: orders.test.js
      const ways = [true, false, undefined].map((forward) => map.graph.route({ ...from.pose, forward }, to.pose, tables.orders.oversizedWidth).length);
      expect(ways.some((l) => Math.abs(l - o.distance) < 1e-6)).toBe(true);
    }
  });

  test('it gets no dock offers where it is longer than the bays, and does where they hold it', () => {
    expect(lorry.length).toBeGreaterThan(tables.osm.bayLength);
    const docks = (o) => spot(o.pickup).dock || o.drops.some((d) => spot(d.spot).dock);
    expect(offers('lorry').filter(docks)).toEqual([]);
    expect(offers('truck').some(docks)).toBe(true);
    const long = { ...tables, osm: { ...tables.osm, bayLength: lorry.length } };
    expect(offers('lorry', long).some(docks)).toBe(true);
  });

  test('it is bought from its rank tier, chosen and upgraded like any Vehicle', () => {
    const tier = tables.rank.tiers[lorry.rank].stars;
    const fresh = { vehicles: { truck: {} }, stars: tier };
    expect(createSim(tables, map, seeded(1), rich({ ...fresh, stars: tier - 1 })).buyVehicle('lorry')).toEqual({ ok: false, reason: 'rankTooLow' });
    const sim = createSim(tables, map, seeded(1), rich(fresh));
    expect(sim.buyVehicle('lorry')).toEqual({ ok: true, reason: null });
    expect(sim.state.profile).toMatchObject({ money: 100000 - lorry.price, vehicle: 'lorry' });
    expect(sim.state.truck.mass).toBe(lorry.emptyMass);
    expect(sim.buyUpgrade('brakes').ok).toBe(true);
    expect(sim.chooseVehicle('truck').ok).toBe(true);
    expect(sim.chooseVehicle('lorry').ok).toBe(true);
    expect(sim.state.profile.vehicles).toEqual({ truck: {}, lorry: { brakes: 1 } });
  });
});
