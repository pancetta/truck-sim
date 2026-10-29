import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { createSim } from './sim.js';
import { createAutopilot } from '../autopilot.js';
import { outOfView } from './traffic.js';
import { inside } from './sim.js';
import { box, build, lane, monti, seeded, undrained, way } from './fixtures.js';

const { pavement } = tables.osm;
const p = tables.pedestrians;
const viewCos = Math.cos(tables.traffic.spawnView);

// For a graph, a function giving the m from (x, z) to the road surface (every edge segment and node disc, as roads.js
// draws them), negative on it. By brute force, so it doesn't share the code it checks.
function roadOf({ nodes, edges }) {
  const pieces = [
    ...edges.filter((e) => !e.pedestrian).flatMap((e) => e.points.slice(1).map((b, k) => ({ a: e.points[k], b, r: e.width / 2 }))),
    ...nodes.filter((n) => n.arms.length).map((n) => ({ a: n, b: n, r: Math.max(...n.arms.map((id) => edges[id].width / 2)) })),
  ];
  return (x, z) => {
    let d = Infinity;
    for (const { a, b, r } of pieces) {
      const [dx, dz] = [b.x - a.x, b.z - a.z];
      const t = dx || dz ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))) : 0;
      d = Math.min(d, Math.hypot(a.x + t * dx - x, a.z + t * dz - z) - r);
    }
    return d;
  };
}

// The point `s` m along a line.
function pointAt(line, s) {
  let k = 0;
  while (k < line.points.length - 2 && line.at[k + 1] <= s) k++;
  const t = (s - line.at[k]) / (line.at[k + 1] - line.at[k]);
  return { x: line.points[k].x + t * (line.points[k + 1].x - line.points[k].x), z: line.points[k].z + t * (line.points[k + 1].z - line.points[k].z) };
}

// Whether (x, z) is inside one of the colliders.
const within = (colliders, x, z) => colliders.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && inside(x, z, b.points));

describe('pavement lines', () => {
  test('a crossroads has a line round each corner, in the middle of the pavements, stopping at the edge exits', () => {
    const map = build([way('residential', [[-150, 0], [0, 0], [150, 0]]), way('residential', [[0, -150], [0, 0], [0, 150]])]);
    const { width } = tables.osm.classes.residential;
    const r = width / 2 + pavement / 2;
    expect(map.pavements).toHaveLength(4);
    for (const line of map.pavements) {
      expect(line.closed).toBe(false);
      for (const q of line.points) expect(roadOf(map.graph)(q.x, q.z)).toBeCloseTo(pavement / 2, 6);
      const [a, b] = [line.points[0], line.points.at(-1)];
      expect(Math.max(Math.abs(a.x), Math.abs(a.z))).toBeCloseTo(100 - 2 * tables.osm.barrier, 6); // short of the barrier
      expect(Math.max(Math.abs(b.x), Math.abs(b.z))).toBeCloseTo(100 - 2 * tables.osm.barrier, 6);
      expect(line.points.some((q) => Math.abs(Math.abs(q.x) - r) < 1e-6 && Math.abs(Math.abs(q.z) - r) < 1e-6)).toBe(true); // the corner
    }
  });

  test('round a dead-end street the line is one ring', () => {
    const { map } = lane();
    const r = tables.osm.classes.residential.width / 2 + pavement / 2;
    expect(map.pavements).toHaveLength(1);
    const [ring] = map.pavements;
    expect(ring.closed).toBe(true);
    expect(ring.length).toBeCloseTo(2 * 56 + 2 * Math.PI * r, 0); // both sides, and half a circle round each end
  });

  test('round the sharp corner of a fork the line keeps clear of a building in the corner', () => {
    const map = build([way('residential', [[-90, 0], [0, 0], [90, 0]]), way('residential', [[0, 0], [60, 15], [60, 90]]), box(70, 6, 85, 10)]);
    const [building] = map.colliders.filter((c) => c.kind === 'building');
    for (const line of map.pavements) for (let s = 0; s <= line.length; s += 0.5) expect(within([building], pointAt(line, s).x, pointAt(line, s).z)).toBe(false);
  });

  test('on Monti the lines cover most of both sides of the streets, in the map, clear of the road, buildings, barriers and docks', () => {
    const map = monti();
    const sides = map.graph.edges.filter((e) => !e.pedestrian).reduce((s, e) => s + 2 * e.length, 0);
    expect(map.pavements.reduce((s, l) => s + l.length, 0)).toBeGreaterThan(0.85 * sides);
    const solid = map.colliders.filter((c) => ['building', 'barrier', 'dock'].includes(c.kind));
    const offRoad = roadOf(map.graph);
    const { minX, minZ, maxX, maxZ } = map.bounds;
    for (const line of map.pavements) {
      for (let s = 0; s <= line.length; s += 1) {
        const { x, z } = pointAt(line, s);
        expect(offRoad(x, z)).toBeGreaterThan(p.keepRight + p.clear - 0.01);
        expect(within(solid, x, z)).toBe(false);
        expect(x > minX && x < maxX && z > minZ && z < maxZ).toBe(true);
      }
    }
  });
});

describe('pedestrians', () => {
  // The autopilot's loop round Monti with an order on, `seconds` long; `check` sees the Sim after every step.
  function drive(seconds, check) {
    const t = undrained(tables);
    const map = monti(t);
    const sim = createSim(t, map, seeded(t.perf.seed));
    const autopilot = createAutopilot(sim, map, t);
    sim.requestOffers();
    sim.acceptOrder(sim.state.offers[0].id);
    autopilot.place();
    const { step } = t.loop;
    for (let i = 0; i < seconds / step; i++) {
      sim.step(step, autopilot.update(step));
      check(sim, map, step);
    }
    return sim;
  }

  test('they walk the pavements at walking pace, on the road only over zebra crossings, as many as the tables say', () => {
    // Long enough for people to turn back at the ends of open lines (about 50 times), which they walk round too.
    const last = new Map(); // id → its pose the step before
    let [turned, steps, offRoad] = [0, 0, null];
    const sim = drive(300, ({ state }, { graph }, dt) => {
      offRoad ??= roadOf(graph);
      const checked = steps++ % 30 === 0; // every half second: the road check is brute force
      for (const q of state.pedestrians) {
        const onStrip = q.zebra >= 0 && !q.waiting; // on the road only on its zebra crossing's strip
        if (checked && onStrip) expect(inside(q.x, q.z, state.zebras[q.zebra].strip) || offRoad(q.x, q.z) >= 0).toBe(true);
        else if (checked) expect(offRoad(q.x, q.z)).toBeGreaterThan(p.clear - 0.01);
        const before = last.get(q.id);
        if (before) {
          expect(Math.hypot(q.x - before.x, q.z - before.z)).toBeLessThanOrEqual((q.hurry || before.hurry ? tables.zebras.stepBack : p.speed) * dt * 1.001); // no jumps, to rounding
          if (Math.abs(Math.sin(q.heading - before.heading)) > 0.01) turned++;
        }
        last.set(q.id, { x: q.x, z: q.z, heading: q.heading, hurry: q.hurry });
      }
    });
    expect(sim.state.pedestrians).toHaveLength(p.count);
    expect(turned).toBeGreaterThan(0); // round corners and bends
  }, 60_000);

  test('they appear and leave out of the truck’s view', () => {
    let seen = new Map(); // id → pose last step
    let [came, went] = [0, 0];
    drive(90, ({ state }) => {
      const { truck } = state;
      const now = new Map(state.pedestrians.map((q) => [q.id, { x: q.x, z: q.z }]));
      for (const q of state.pedestrians) {
        if (seen.has(q.id) || seen.size === 0) continue;
        came++;
        expect(outOfView(q, truck, p.spawnDistance[0] - 1, Math.cos(tables.traffic.spawnView - 0.01))).toBe(true); // a step on from where it appeared
      }
      for (const [id, q] of seen) {
        if (now.has(id)) continue;
        went++;
        expect(outOfView(q, truck, p.despawnDistance - 1, viewCos)).toBe(true);
      }
      seen = now;
    });
    expect(came).toBeGreaterThan(0);
    expect(went).toBeGreaterThan(0);
  });
});
