import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { strings } from '../strings.js';
import { createSim, deliver, lane, monti, seeded } from './fixtures.js';
import { freshProfile } from './sim.js';

// Clients and Reputation (#86): every place has a kind; a Client's Reputation rises with the Stars of its orders, per map,
// and its levels raise their event and add better-paying offers.

const { levels } = tables.reputation;
const map = tables.osm.id;
const payOf = (distance, factor) => Math.round(factor * (tables.orders.basePay + (tables.orders.payPerKm * distance) / 1000));
const laneSim = (reputation = {}, seed = 1) => {
  const { t, map: m } = lane();
  return createSim(t, m, seeded(seed), { ...freshProfile(), reputation });
};

describe('spot kinds', () => {
  test('every place in the spot table has a kind with a name, and every one that takes orders a thank-you line', () => {
    const { stations, restaurant, home } = tables.osm;
    for (const s of tables.osm.spots) {
      expect(strings.spotKinds[s.kind], s.id).toBeTruthy();
      if (!stations.includes(s.id) && s.id !== restaurant && s.id !== home) expect(strings.thanks[s.kind], s.id).toBeTruthy();
    }
  });

  test('the map carries its id and every spot its kind', () => {
    const m = monti();
    expect(m.id).toBe(map);
    expect(m.spots.map((s) => s.kind)).toEqual(tables.osm.spots.map((s) => s.kind));
  });
});

describe('Reputation', () => {
  test("rises with the Stars of the Client's orders on this map, raising its event once at each level", () => {
    const sim = laneSim({ other: { A: 20 } });
    const events = [];
    let stars = 0;
    for (let i = 0; i < 6; i++) {
      deliver(sim); // A to B: A is the Client
      stars += sim.state.lastPayment.stars.filter((s) => !s.reasons.length).length;
      expect(sim.state.profile.reputation[map].A).toBe(stars);
      if (!events.includes(sim.state.lastReputation)) events.push(sim.state.lastReputation);
    }
    expect(stars).toBeGreaterThanOrEqual(levels[3].stars);
    const reached = levels.findLastIndex((l) => stars >= l.stars);
    expect(events).toEqual(Array.from({ length: reached }, (_, i) => ({ client: 'A', level: i + 1 }))); // the first clean delivery brings level 1
    expect(sim.state.profile.reputation[map].B).toBeUndefined(); // the drop-off isn't the Client
    expect(sim.state.profile.reputation.other).toEqual({ A: 20 }); // another map's stays as it was
  });

  test('offers carry their Client\'s level and pay its factor more; a regular adds one more offer of its own', () => {
    const offers = (reputation) => laneSim(reputation).requestOffers();
    const plain = offers({});
    expect(plain).toHaveLength(tables.orders.offerCount);
    expect(plain.every((o) => o.reputation === 0)).toBe(true);

    // Level 1 for A: the same draws, then one more offer from A, a normal one.
    const known = offers({ [map]: { A: levels[1].stars } });
    expect(known).toHaveLength(tables.orders.offerCount + 1);
    for (const [i, o] of plain.entries()) {
      expect(known[i].reputation).toBe(o.pickup === 'A' ? 1 : 0);
      expect(known[i].pay).toBe(o.pickup === 'A' ? payOf(o.distance, levels[1].pay) : o.pay);
    }
    expect(known.at(-1)).toMatchObject({ pickup: 'A', reputation: 1, type: 'normal' });
    expect(offers({ other: { A: 99 } })).toEqual(plain); // another map's doesn't count here
  });

  test("from the level that has it, the regular's offer is express, whatever the Tier", () => {
    const level = levels.findIndex((l) => l.express);
    expect(tables.orders.types.express).toBeGreaterThan(0); // not offered at Tier 0 otherwise
    const sim = laneSim({ [map]: { B: levels[level].stars } });
    const offer = sim.requestOffers().at(-1);
    expect(offer).toMatchObject({ pickup: 'B', reputation: level, type: 'express' });
    expect(offer.pay).toBe(payOf(offer.distance, tables.orders.express.pay * levels[level].pay));
  });
});
