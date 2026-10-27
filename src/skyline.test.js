import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three/webgpu';
import * as tables from './tables.js';
import { ringMeshes } from './skyline.js';

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
