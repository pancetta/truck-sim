import { expect, test } from 'vitest';
import * as tables from '../tables.js';
import { createGraph } from './graph.js';
import { poseAt } from './lanes.js';

const { laneOffset } = tables.traffic;
const { cell } = tables.city;

test('a two-way edge has a lane each way, laneOffset right of the centre line, round its bends too', () => {
  // An L: down from the top dead end, then right to the other.
  const nodes = [{ x: 0, z: 0 }, { x: 28, z: 28 }];
  const edges = [{ from: 0, to: 1, class: 'residential', width: 14, name: '', oneWay: false, points: [nodes[0], { x: 0, z: 28 }, nodes[1]] }];
  const [edge] = createGraph(nodes, edges, laneOffset, cell).edges;
  expect(edge.length).toBeCloseTo(56);
  const [forward, backward] = edge.lanes.map((l) => l.points);
  // Down (+z, right is -x), round the corner, then along the bottom (+x, right is +z).
  expect(forward.at(0)).toEqual({ x: -laneOffset, z: 0 });
  expect(forward[1].x).toBeCloseTo(-laneOffset);
  expect(forward[1].z).toBeCloseTo(28 + laneOffset);
  expect(forward.at(-1).z).toBeCloseTo(28 + laneOffset);
  // The other way it keeps to the inside of the bend.
  expect(backward[1].x).toBeCloseTo(laneOffset);
  expect(backward[1].z).toBeCloseTo(28 - laneOffset);
});

test('lane paths run smoothly along edges and through junctions of 3, 5 and 6 arms, into every other arm', () => {
  // One junction, its arms out to dead ends at the given angles (degrees, atan2(dz, dx)); one arm bends half way out.
  for (const angles of [[90, 0, 180], [90, 18, -54, -126, 162], [90, 30, -30, -90, -150, 150]]) {
    const out = (a, m) => ({ x: Math.cos((a * Math.PI) / 180) * m, z: Math.sin((a * Math.PI) / 180) * m });
    const nodes = [{ x: 0, z: 0 }, ...angles.map((a) => out(a, 60))];
    const edges = angles.map((a, i) => ({ from: 0, to: i + 1, class: 'residential', width: 7, name: '', oneWay: false, points: [{ x: 0, z: 0 }, out(a, 30), nodes[i + 1]] }));
    edges[0].points[1] = { x: 6, z: 30 };
    const { paths, nodes: [centre] } = createGraph(nodes, edges, laneOffset, cell);

    const turns = paths.filter((p) => p.kind === 'turn' && p.node === 0);
    expect(turns).toHaveLength(angles.length * (angles.length - 1));
    for (const { in: run } of centre.slots) expect(new Set(run.next.map((t) => t.outSlot)).size).toBe(angles.length - 1);
    // Every way through the junction, sampled every 0.1 m: no jump in place or heading, at the joins either. The
    // tightest curve, 1.3 m, is the inner lane round the kerb corner between two arms 60° apart: a jump would turn by
    // far more.
    for (const turn of turns) {
      const poses = [turn.in, turn, turn.out].flatMap((p) => Array.from({ length: Math.floor(p.length * 10) + 1 }, (_, k) => pose(p, k / 10)));
      for (let k = 1; k < poses.length; k++) {
        const [a, b] = [poses[k - 1], poses[k]];
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.1 + 1e-6);
        expect(Math.abs(Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading)))).toBeLessThan(0.1);
      }
    }
  }
});

test('a one-way edge has one lane, along its centre line, and no turn leads into it the wrong way', () => {
  // A T: the east arm one-way out of the junction.
  const nodes = [{ x: 0, z: 0 }, { x: 0, z: 50 }, { x: 50, z: 0 }, { x: -50, z: 0 }];
  const edges = [1, 2, 3].map((to) => ({ from: 0, to, class: 'residential', width: 7, name: '', oneWay: to === 2, points: [nodes[0], nodes[to]] }));
  const { paths, nodes: [centre] } = createGraph(nodes, edges, laneOffset, cell);

  const oneWay = paths.filter((p) => p.kind === 'run' && p.edge === edges[1]);
  expect(oneWay.map((p) => [p.from, p.to])).toEqual([[0, 2]]);
  expect(oneWay[0].prims[0].z).toBe(0);
  expect(paths.filter((p) => p.kind === 'turn' && p.node === 0)).toHaveLength(4); // from each other arm to the two others
  expect(centre.slots[1].in).toBe(null);
});

test('routes obey one-ways: the shortest legal way, round the block where the short one runs against one', () => {
  // A 100 m square, its north side one-way east (node 0 to 1), the rest two-way.
  const nodes = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }];
  const edges = [0, 1, 2, 3].map((from) => ({ from, to: (from + 1) % 4, class: 'residential', width: 7, name: '', oneWay: from === 0, points: [nodes[from], nodes[(from + 1) % 4]] }));
  const { route } = createGraph(nodes, edges, laneOffset, cell);
  const [north, east] = edges;

  expect(route({ edge: north, s: 20 }, { edge: north, s: 80 }).length).toBeCloseTo(60); // along it
  expect(route({ edge: north, s: 80 }, { edge: north, s: 20 }).length).toBeCloseTo(20 + 300 + 20); // on and round
  expect(route({ edge: east, s: 50 }, { edge: north, s: 50 }).length).toBeCloseTo(50 + 200 + 50); // not back along it
  expect(route({ edge: north, s: 50 }, { edge: east, s: 50 }).length).toBeCloseTo(100);
});

const pose = (p, s) => {
  const out = { x: 0, z: 0, heading: 0 };
  poseAt(p, s, out);
  return out;
};
