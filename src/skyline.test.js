import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three/webgpu';
import * as tables from './tables.js';
import { ringMeshes, cutRing } from './skyline.js';

describe('ringMeshes', () => {
  // Each triangle of a mesh as its three corners.
  const triangles = ({ geometry }) => {
    const [p, index] = [geometry.getAttribute('position'), geometry.index];
    return Array.from({ length: index.count / 3 }, (_, t) => [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(p, index.getX(3 * t + k))));
  };
  const normal = ([a, b, c]) => new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));

  it('raises each outline from its base to its top, walls facing out and into its courtyard, under a flat roof', () => {
    // A 20 m square, either way round, with a 6 m courtyard, on a 4 m base.
    const square = [[0, 0], [20, 0], [20, 20], [0, 20]];
    const yard = [[7, 7], [13, 7], [13, 13], [7, 13]];
    for (const r of [square, square.toReversed()]) {
      const [walls, roof] = ringMeshes([{ r, h: [yard], top: 15, base: 4 }], tables, { walls: null, roof: null });
      const wallTriangles = triangles(walls);
      expect(wallTriangles).toHaveLength(16);
      for (const t of wallTriangles) {
        for (const v of t) expect([4, 15]).toContain(v.y);
        const middle = t.reduce((m, v) => m.add(v), new Vector3()).divideScalar(3);
        const out = new Vector3(middle.x - 10, 0, middle.z - 10); // from the square's middle
        const yard = Math.max(Math.abs(out.x), Math.abs(out.z)) < 4;
        expect(normal(t).dot(out) * (yard ? -1 : 1)).toBeGreaterThan(0);
      }
      const roofTriangles = triangles(roof);
      for (const t of roofTriangles) expect(normal(t).y).toBeGreaterThan(0);
      expect(roofTriangles.reduce((sum, t) => sum + normal(t).length() / 2, 0)).toBeCloseTo(400 - 36);
    }
  });

  it('draws the real ring round Monti outside the map and within the camera\'s reach, light enough to draw whole', () => {
    const items = JSON.parse(readFileSync(`public/${tables.osm.ring}`, 'utf8'));
    const { bounds } = JSON.parse(readFileSync(`public/${tables.osm.file}`, 'utf8'));
    expect(items.length).toBeGreaterThan(1000);
    const outside = (x, z) => Math.hypot(Math.max(bounds.minX - x, 0, x - bounds.maxX), Math.max(bounds.minZ - z, 0, z - bounds.maxZ));
    for (const { r } of items) {
      expect(r.some(([x, z]) => x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ)).toBe(false); // the map has its own
      expect(Math.min(...r.map(([x, z]) => outside(x, z)))).toBeLessThan(tables.camera.fog[1]);
    }
    const meshes = ringMeshes(items, tables, { walls: null, roof: null });
    expect(meshes).toHaveLength(2);
    expect(meshes.reduce((n, { geometry }) => n + geometry.index.count / 3, 0)).toBeLessThan(100000);
  });
});

describe('cutRing', () => {
  it('cuts the exit roads out of the buildings they cross, which lose their courtyards and domes, and keeps the rest', () => {
    const square = { r: [[0, 0], [20, 0], [20, 20], [0, 20]], h: [[[2, 2], [4, 2], [4, 4], [2, 4]]], top: 15, base: 0, dome: true };
    const away = { r: [[50, 0], [60, 0], [60, 10], [50, 10]], top: 12, base: 0 };
    const road = [[8, -5], [12, -5], [12, 25], [8, 25]];
    const [left, right, kept] = cutRing([square, away], [road]).sort((a, b) => a.r[0][0] - b.r[0][0]);
    const xs = (b) => b.r.map(([x]) => Math.round(x * 100) / 100); // subtract leaves a 0.1 mm margin
    expect([Math.min(...xs(left)), Math.max(...xs(left))]).toEqual([0, 8]);
    expect([Math.min(...xs(right)), Math.max(...xs(right))]).toEqual([12, 20]);
    for (const b of [left, right]) expect([b.h, b.dome, b.top]).toEqual([undefined, undefined, 15]);
    expect(kept).toBe(away);
  });
});
