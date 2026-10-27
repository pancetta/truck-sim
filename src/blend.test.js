import { expect, test } from 'vitest';
import * as tables from './tables.js';
import { createSim } from './sim/sim.js';
import { createBlend } from './blend.js';

// Steps the Sim as main.js does: the blend remembers the pose before each step.
function step(sim, blend, n, input = { steer: 0.5, gas: 1, brake: 0 }) {
  for (let i = 0; i < n; i++) {
    blend.remember(sim.state);
    sim.step(tables.loop.step, input);
  }
}

test('draws the truck alpha of the way from its pose before the latest step', () => {
  const sim = createSim(tables, null);
  const blend = createBlend();
  step(sim, blend, 30);
  const before = { ...sim.state.truck };
  step(sim, blend, 1);
  const after = sim.state.truck;
  expect(after.heading).not.toBe(before.heading);
  expect(blend.at(sim.state, 0).truck).toMatchObject({ x: before.x, z: before.z, heading: before.heading, roll: before.roll });
  const half = blend.at(sim.state, 0.5).truck;
  for (const key of ['x', 'z', 'heading', 'roll']) expect(half[key]).toBeCloseTo((before[key] + after[key]) / 2, 9);
  expect(half.speed).toBe(after.speed);
  expect(sim.state.truck).toBe(after); // the Sim's own state is left alone
  expect(after.x).not.toBe(half.x);
});

test('turns the short way across ±π', () => {
  const blend = createBlend();
  const truck = { x: 0, z: 0, heading: Math.PI - 0.1, roll: 0 };
  const state = { truck, traffic: [] };
  blend.remember(state);
  truck.heading = -Math.PI + 0.1;
  expect(blend.at(state, 0.5).truck.heading).toBeCloseTo(Math.PI, 9);
});

test('blends the AI cars and draws one new since the latest step as it is', () => {
  const blend = createBlend();
  const old = { id: 1, x: 0, z: 0, heading: 0 };
  const state = { truck: { x: 0, z: 0, heading: 0, roll: 0 }, traffic: [old] };
  blend.remember(state);
  old.z = 1;
  const fresh = { id: 2, x: 5, z: 5, heading: 1 };
  state.traffic.push(fresh);
  const [a, b] = blend.at(state, 0.25).traffic;
  expect(a).toMatchObject({ id: 1, z: 0.25 });
  expect(b).toBe(fresh);
});
