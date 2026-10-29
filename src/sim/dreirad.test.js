import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { freshProfile } from './sim.js';
import { createSim, monti, seeded } from './fixtures.js';

// The Dreirad (#89) on Monti: the offers to and from the spots on pedestrian edges are its alone, and it is bought,
// chosen and upgraded like any Vehicle. Its way through a bollard gate, which the truck and van can't take, is in
// osm.test.js.
describe('Sim: the Dreirad', () => {
  const map = monti();
  const { dreirad } = tables.fleet;
  const tier = tables.rank.tiers[dreirad.rank].stars;
  const rich = (profile = {}) => ({ ...freshProfile(), money: 100000, stars: tier, ...profile });
  const walks = new Set(map.spots.filter((s) => s.pose.edge.pedestrian).map((s) => s.id));
  const pedestrian = (o) => walks.has(o.pickup) || walks.has(o.dropoff);

  // 100 rounds of offers at home, in Vehicle `id`; and the Sim.
  function offers(id) {
    const sim = createSim(tables, map, seeded(1), rich({ vehicle: id, vehicles: { truck: {}, van: {}, dreirad: {} } }));
    return { sim, offers: Array.from({ length: 100 }, () => sim.requestOffers()).flat() };
  }

  test('offers to or from a spot on a pedestrian edge go only to it, as pedestrian ones, and lead there', () => {
    expect(walks.size).toBeGreaterThanOrEqual(3);
    for (const id of ['truck', 'van']) expect(offers(id).offers.filter(pedestrian), id).toEqual([]);
    const { sim, offers: own } = offers('dreirad');
    const theirs = own.filter(pedestrian);
    expect(theirs.length).toBeGreaterThan(own.length / 10);
    expect(own.filter((o) => o.type === 'pedestrian')).toEqual(theirs);
    expect(Math.max(...own.map((o) => o.cargo.weight))).toBeLessThanOrEqual(dreirad.maxCargo);
    // Accepted, its route arrow leads into the pedestrian edge, to the pickup's place on it.
    let offer;
    for (let i = 0; i < 50 && !offer; i++) offer = sim.requestOffers().find((o) => walks.has(o.pickup));
    sim.acceptOrder(offer.id);
    const to = map.spots.find((s) => s.id === offer.pickup).pose;
    expect(sim.state.route.at(-1).x).toBeCloseTo(to.x);
    expect(sim.state.route.at(-1).z).toBeCloseTo(to.z);
  });

  test('from every road end of a pedestrian spot\'s edge, it drives in through the bollard gate to the spot', () => {
    const quiet = { ...tables, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 0 })) } };
    for (const spot of map.spots.filter((s) => walks.has(s.id))) {
      const e = spot.pose.edge;
      for (const end of [e.from, e.to].filter((n) => map.graph.nodes[n].arms.length)) {
        const sim = createSim(quiet, map, seeded(1), rich({ vehicle: 'dreirad', vehicles: { truck: {}, dreirad: {} } }));
        const way = end === e.from ? 1 : -1; // along the edge, into it
        const p = map.graph.pointAt(e, end === e.from ? 1 : e.length - 1);
        const at = () => map.graph.project(e, sim.state.truck.x, sim.state.truck.z).s;
        Object.assign(sim.state.truck, p, { heading: 0, speed: 0 });
        let collided = false;
        // Steers for the middle 4 m on, at a walk.
        for (let t = 0; t < 60 && way * (spot.pose.s - at()) > 0; t += 1 / 60) {
          const q = map.graph.pointAt(e, Math.max(0, Math.min(e.length, at() + 4 * way)));
          const { truck } = sim.state;
          if (t === 0) truck.heading = Math.atan2(q.x - truck.x, q.z - truck.z);
          const turn = Math.atan2(Math.sin(Math.atan2(q.x - truck.x, q.z - truck.z) - truck.heading), Math.cos(Math.atan2(q.x - truck.x, q.z - truck.z) - truck.heading));
          sim.step(1 / 60, { steer: Math.max(-1, Math.min(1, -2 * turn)), gas: truck.speed < 2 ? 1 : 0, brake: 0 });
          collided ||= sim.state.collision;
        }
        expect([spot.id, end, collided, way * (spot.pose.s - at()) <= 0]).toEqual([spot.id, end, false, true]);
      }
    }
  });

  test('it is bought from its rank tier, chosen and upgraded like any Vehicle', () => {
    expect(createSim(tables, map, seeded(1), rich({ stars: tier - 1 })).buyVehicle('dreirad')).toEqual({ ok: false, reason: 'rankTooLow' });
    const sim = createSim(tables, map, seeded(1), rich());
    expect(sim.buyVehicle('dreirad')).toEqual({ ok: true, reason: null });
    expect(sim.state.profile).toMatchObject({ money: 100000 - dreirad.price, vehicle: 'dreirad' });
    expect(sim.state.truck.mass).toBe(dreirad.emptyMass);
    expect(sim.buyUpgrade('motor').ok).toBe(true);
    expect(sim.chooseVehicle('truck').ok).toBe(true);
    expect(sim.chooseVehicle('dreirad').ok).toBe(true);
    expect(sim.state.profile.vehicles).toEqual({ truck: {}, dreirad: { motor: 1 } });
  });
});
