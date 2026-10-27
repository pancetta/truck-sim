import { describe, expect, test } from 'vitest';
import * as tables from './tables.js';
import { buildOsmMap } from './sim/osm.js';
import { roadSurface, plainBuildings } from './plainCity.js';

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

describe('Plain city (an OSM map until #65)', () => {
  test('the road surface faces up everywhere, bends and junctions included', () => {
    const way = (id, points) => ({ id, tags: { highway: 'residential' }, nodes: points.map(String), points });
    const map = buildOsmMap({ bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 }, ways: [way(1, [[-50, 0], [0, 0], [30, 30]]), way(2, [[0, 0], [0, -50]])] }, tables);
    const faces = normals(roadSurface(map.graph, 0.03));
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.filter(({ n }) => n[1] <= 0)).toEqual([]);
  });

  test('walls face out and roofs face up, whichever way round the outline runs', () => {
    const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    for (const points of [square, square.toReversed()]) {
      for (const { n, at } of normals(plainBuildings([{ points, height: 12 }], [0xffffff]))) {
        if (Math.abs(n[1]) > 1e-9) expect(n[1]).toBeGreaterThan(0); // roof
        else expect(n[0] * (at[0] - 5) + n[2] * (at[2] - 5)).toBeGreaterThan(0); // wall, away from the middle
      }
    }
  });
});
