import { describe, expect, test } from 'vitest';
import { freshProfile, isNight } from './sim.js';
import * as tables from '../tables.js';
import { IDLE, build, createSim, drive, monti, seeded, way, withSpots } from './fixtures.js';

const at = (hours) => ({ ...freshProfile(), timeOfDay: hours * 60 });

describe('Sim: night (#52)', () => {
  test('night runs from clock.night[0] over midnight to clock.night[1]', () => {
    const [from, to] = tables.clock.night;
    expect([from - 1, from, 0, to - 1, to, 12 * 60].map((m) => isNight(m, tables.clock))).toEqual([false, true, true, true, false, false]);
  });

  // The nook (as in orders.test.js): A and B in one 12 m dead end, so the order loads and unloads where the truck stands.
  // Base + distance is 100; loading and unloading take 30 s each.
  function nookSim(profile) {
    const vicolo = way('residential', [[0, -6], [0, 6]], { name: 'Vicolo' });
    const spot = (id) => ({ id, name: `Bottega ${id}`, street: 'Vicolo', way: vicolo.id, at: 6, side: 'right' });
    const t = withSpots([spot('A'), spot('B')], [], 'A', { ...tables, orders: { ...tables.orders, basePay: 100, loadTime: 30, slack: 60 } });
    const sim = createSim(t, build([vicolo], t, undefined, { minX: -20, minZ: -7, maxX: 20, maxZ: 7 }), seeded(1), profile);
    sim.acceptOrder(sim.requestOffers()[0].id);
    drive(sim, 61, IDLE);
    return sim.state.lastPayment;
  }

  test('a delivery completed at night adds the night line, a share of base + distance; one by day does not', () => {
    expect(nookSim(at(23)).lines).toContainEqual({ label: 'night', amount: tables.orders.nightBonus * 100 });
    expect(nookSim(at(23)).amount).toBe(100 + 25 + tables.orders.nightBonus * 100);
    expect(nookSim(at(12)).lines.map((l) => l.label)).not.toContain('night');
  });

  test('at night the city has the traffic.night share of the rank tier\'s AI cars', () => {
    const t = { ...tables, police: { ...tables.police, count: 0 } };
    const map = monti(t);
    const carsAt = (hours) => {
      const sim = createSim(t, map, seeded(1), at(hours));
      drive(sim, 5, IDLE);
      return sim.state.traffic.length;
    };
    const day = tables.rank.tiers[0].traffic;
    expect(carsAt(12)).toBe(day);
    expect(carsAt(1)).toBe(Math.round(day * tables.traffic.night));
    expect(carsAt(1)).toBeLessThan(day);
  });
});
