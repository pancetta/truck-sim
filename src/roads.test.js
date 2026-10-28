import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import * as tables from './tables.js';
import { buildOsmMap } from './sim/osm.js';
import { inside } from './sim/sim.js';
import { createCells } from './sim/cells.js';
import { roadSurface, osmPavements, pavementGeometry } from './roads.js';
import { roadPieces } from './sim/paved.js';

// The normal of each triangle of a non-indexed geometry, by its winding (three draws only the front face).
function normals(geometry) {
  const p = geometry.getAttribute('position').array;
  const out = [];
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.slice(i, i + 9);
    const [ux, uy, uz, vx, vy, vz] = [bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az];
    out.push({ n: [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], at: [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3] });
  }
  return out;
}

const way = (id, points, highway = 'residential', more = {}) => ({ id, tags: { highway, ...more }, nodes: points.map(String), points });
const fixture = buildOsmMap({
  bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
  ways: [
    way(1, [[-50, 0], [0, 0], [30, 30]]),
    way(2, [[0, 0], [0, -50]], 'secondary'),
    way(3, [[-60, 40], [-20, 40]], 'pedestrian'),
    way(4, [[20, -60], [60, -60], [60, -20], [20, -20], [20, -60]], 'pedestrian', { area: 'yes' }),
  ],
}, tables);

// Whether (x, z) is on a pavement top or on the road.
const on = (rings, x, z) => rings.some((ring) => inside(x, z, ring.map(([x, z]) => ({ x, z }))));

describe('Monti roads and pavements (#65)', () => {
  const pieces = roadPieces(fixture.graph);
  const layout = osmPavements(fixture, pieces, tables);
  const road = pieces.map((p) => p.ring);

  test('the road surface and the paving face up everywhere, bends and junctions included', () => {
    const faces = [...normals(roadSurface(pieces, 0.03)), ...normals(pavementGeometry(layout, tables.streets.pavement, 0.03).top)];
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.filter(({ n }) => n[1] <= 0)).toEqual([]);
  });

  test('a pavement runs along both sides of each road, right up to its edge, and never onto it', () => {
    const w = tables.osm.classes.residential.width / 2;
    const half = tables.osm.pavement / 2;
    for (const x of [-40, -20]) {
      for (const side of [-1, 1]) {
        expect(on(layout.tops, x, side * (w + half))).toBe(true);
        expect(on(layout.tops, x, side * (w - 0.05))).toBe(false);
        expect(on(road, x, side * (w - 0.05))).toBe(true);
      }
    }
    // Every kerb faces a road, from a pavement.
    for (const { a, b, out } of layout.kerbs) {
      const [x, z] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      expect(on(road, x + out[0] * 0.05, z + out[1] * 0.05)).toBe(true);
    }
    expect(layout.kerbs.length).toBeGreaterThan(0);
  });

  test('pedestrian ways and squares are paved, not where they meet the road', () => {
    expect(on(layout.flush, -40, 40)).toBe(true); // the way
    expect(on(layout.flush, 40, -40)).toBe(true); // the square
    expect(on(layout.flush, -22, 40)).toBe(true);
  });

  test('on the real extract, no pavement covers a road piece or a lane', () => {
    const data = JSON.parse(fs.readFileSync(new URL('../public/maps/monti.json', import.meta.url)));
    const map = buildOsmMap(data, tables);
    const all = roadPieces(map.graph);
    const { tops, flush } = osmPavements(map, all, tables);
    const top = pavementGeometry({ tops, kerbs: [], backs: [], flush }, tables.streets.pavement, 0.03).top.getAttribute('position').array;
    // Each paving triangle's middle, off every road piece by more than a centimetre (the cut's tolerance leaves slivers
    // thinner than that, under the kerb strip).
    const segment = (x, z, a, b) => {
      const [dx, dz] = [b.x - a.x, b.z - a.z];
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(a.x + t * dx - x, a.z + t * dz - z);
    };
    // Both looked up through a cell index, as the whole extract is too much to scan per point.
    const index = (rings) => {
      const cells = createCells(tables.city.cell);
      for (const ring of rings) cells.add(ring, Math.min(...ring.map((p) => p.x)), Math.min(...ring.map((p) => p.z)), Math.max(...ring.map((p) => p.x)), Math.max(...ring.map((p) => p.z)));
      return (x, z) => {
        let found = null;
        cells.some(x, z, x, z, (ring) => inside(x, z, ring) && (found = ring));
        return found;
      };
    };
    const roadAt = index(all.map((p) => p.points));
    let covered = 0;
    for (let i = 0; i < top.length; i += 9) {
      const [x, z] = [(top[i] + top[i + 3] + top[i + 6]) / 3, (top[i + 2] + top[i + 5] + top[i + 8]) / 3];
      const under = roadAt(x, z);
      if (under && Math.min(...under.map((a, k) => segment(x, z, a, under[(k + 1) % under.length]))) > 0.01) covered++;
    }
    expect(covered).toBe(0);
    // Every lane, sampled every 2 m, is off the paving.
    const pavedAt = index([...tops, ...flush].map((ring) => ring.map(([x, z]) => ({ x, z }))));
    let lanePoints = 0;
    for (const { points } of map.graph.edges.flatMap((e) => e.lanes)) {
      points.slice(1).forEach((b, k) => {
        const a = points[k];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
        for (let i = 0; i < steps; i++) {
          lanePoints++;
          expect(pavedAt(a.x + ((b.x - a.x) * i) / steps, a.z + ((b.z - a.z) * i) / steps)).toBe(null);
        }
      });
    }
    expect(lanePoints).toBeGreaterThan(1000);
  }, 30_000);
});
