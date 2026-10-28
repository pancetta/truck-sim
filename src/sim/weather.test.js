import { describe, expect, test } from 'vitest';
import { freshProfile } from './sim.js';
import * as tables from '../tables.js';
import { BRAKE, GAS, IDLE, build, createSim, drive, monti, seeded, timeUntil, way, withSpots } from './fixtures.js';

// Tables with only rain (no clear spells, no fog) or only clear weather.
const only = (kind, t = tables) => ({ ...t, weather: { ...t.weather, clear: kind === 'rain' ? [0, 0] : [1e9, 1e9], fog: 0 } });
const noon = { ...freshProfile(), timeOfDay: 12 * 60 };

describe('Sim: weather (#53)', () => {
  // The weather every second over `hours` of play from `profile`, as [kind, intensity].
  const record = (t, hours, profile = freshProfile()) => {
    const sim = createSim(t, undefined, Math.random, profile);
    const out = [];
    for (let s = 0; s < hours * 3600; s++) {
      sim.step(1, IDLE);
      out.push([sim.state.weather.kind, sim.state.weather.intensity]);
    }
    return out;
  };

  test('the schedule is the same for a seed and another for another seed; intensity ramps, and the kind changes only at 0', () => {
    const run = record(tables, 4);
    expect(record(tables, 4)).toEqual(run);
    expect(record({ ...tables, weather: { ...tables.weather, seed: 7 } }, 4)).not.toEqual(run);
    expect(new Set(run.map(([kind]) => kind))).toEqual(new Set(['clear', 'rain', 'fog']));
    expect(run.some(([, i]) => i === 1)).toBe(true);
    for (let s = 1; s < run.length; s++) {
      expect(Math.abs(run[s][1] - run[s - 1][1])).toBeLessThanOrEqual(1 / tables.weather.ramp + 1e-9);
      if (run[s][0] !== run[s - 1][0]) expect(run[s][1]).toBe(0);
    }
    // Timed on the play time: a Sim loaded in the middle of a spell ramps into that spell's weather.
    const s = run.findIndex(([kind, i], k) => kind === 'rain' && i === 1 && run[k + tables.weather.ramp]?.[1] === 1);
    expect(record(tables, 1 / 60, { ...freshProfile(), timePlayed: s + 1 - tables.weather.ramp }).at(-1)).toEqual(['rain', 1]);
  });

  // m the truck takes to brake to a stop from 50 km/h on the open plane, once the weather has ramped in.
  function brakingDistance(t) {
    const sim = createSim(t);
    drive(sim, t.weather.ramp, IDLE);
    timeUntil(sim, GAS, () => sim.state.truck.speed >= 50 / 3.6);
    const z = sim.state.truck.z;
    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
    return sim.state.truck.z - z;
  }

  test('rain lowers the grip: braking from 50 km/h takes longer', () => {
    const dry = brakingDistance(only('clear'));
    const wet = brakingDistance(only('rain'));
    expect(wet).toBeGreaterThan(dry * 1.2);
  });

  test('in rain the AI cars drive at rain.traffic of their speeds', () => {
    const top = (t) => {
      const t0 = { ...t, police: { ...t.police, count: 0 } };
      const sim = createSim(t0, monti(t0), seeded(1), noon);
      drive(sim, t.weather.ramp, IDLE);
      let most = 0;
      for (let s = 0; s < 60 * 60; s++) {
        sim.step(1 / 60, IDLE);
        for (const car of sim.state.traffic) most = Math.max(most, car.speed);
      }
      return most;
    };
    const cruise = Math.max(...Object.values(tables.osm.classes).map((c) => c.limit ?? 0)) / 3.6;
    const dry = top(only('clear'));
    expect(dry).toBeGreaterThan(cruise * tables.weather.rain.traffic + 0.5);
    expect(top(only('rain'))).toBeLessThanOrEqual(dry * tables.weather.rain.traffic + 1e-6);
  });

  // The nook (as in night.test.js): A and B in one 12 m dead end; base + distance is 100.
  function nookSim(t0) {
    const vicolo = way('residential', [[0, -6], [0, 6]], { name: 'Vicolo' });
    const spot = (id) => ({ id, name: `Bottega ${id}`, street: 'Vicolo', way: vicolo.id, at: 6, side: 'right' });
    const t = withSpots([spot('A'), spot('B')], [], 'A', { ...t0, orders: { ...t0.orders, basePay: 100, loadTime: 30, slack: 60 } });
    const sim = createSim(t, build([vicolo], t, undefined, { minX: -20, minZ: -7, maxX: 20, maxZ: 7 }), seeded(1), noon);
    sim.acceptOrder(sim.requestOffers()[0].id);
    drive(sim, 61, IDLE);
    return sim.state.lastPayment;
  }

  test('a delivery completed in rain adds the rain line; one in clear weather does not', () => {
    expect(nookSim(only('rain')).lines).toContainEqual({ label: 'rain', amount: tables.orders.rainBonus * 100 });
    expect(nookSim(only('clear')).lines.map((l) => l.label)).not.toContain('rain');
  });
});
