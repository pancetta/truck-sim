import { expect, test } from 'vitest';
import { freshProfile } from '../src/sim/sim.js';
import { montiMap, runEconomy } from './economy.js';

const map = montiMap();

// No soft lock (#58): whatever the money, a dry tank and an exhausted driver, a player who never refuels (the tow is its
// only fuel) keeps delivering and getting paid.
test.each([0, 50, 100000])('from %i € with a dry tank and an exhausted driver, the economy run keeps earning', (money) => {
  const r = runEconomy({ map, hours: 0.25, profile: { ...freshProfile(), money, fuel: 0, energy: 0 }, refuel: 0 });
  expect(r.tows).toBeGreaterThan(0);
  expect(r.rescues).toBe(0); // a rescue's jump could hide a soft lock
  expect(r.deliveries).toBeGreaterThanOrEqual(2);
  expect(Object.values(r.pay).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  if (money === 0) expect(r.money).toBeGreaterThan(0);
});
