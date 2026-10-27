import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three/webgpu';
import * as tables from './tables.js';
import { parseMap } from './sim/map.js';
import { planSkyline, skylineMeshes, ringMeshes } from './skyline.js';
import city from './city.txt?raw';

const map = parseMap(city, tables);
const [w, h] = [map.cols * map.tileSize, map.rows * map.tileSize];
const t = tables.skyline;
// m from (x, z) out to the map's edge, along x or z, whichever is further; negative inside.
const away = (x, z) => Math.max(-x, x - w, -z, z - h);

describe('planSkyline', () => {
  const ring = planSkyline(map, tables);

  it('builds the same ring each time', () => {
    expect(JSON.stringify(planSkyline(map, tables))).toBe(JSON.stringify(ring));
  });

  it('stands outside the map, from `gap` to `gap` + `depth` m out', () => {
    for (const b of ring) {
      // Nearest point of the footprint to the map, and its furthest corner.
      const near = Math.max(-b.maxX, b.minX - w, -b.maxZ, b.minZ - h);
      const far = Math.max(...[b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ].map((z) => away(x, z))));
      expect(near).toBeGreaterThanOrEqual(t.gap - 1e-6);
      expect(far).toBeLessThanOrEqual(t.gap + t.depth + 1e-6);
    }
  });

  it('closes every side, with no buildings overlapping but towers among their block', () => {
    for (const out of [(b) => b.maxZ < 0, (b) => b.minX > w, (b) => b.minZ > h, (b) => b.maxX < 0]) expect(ring.filter(out).length).toBeGreaterThan(50);
    const plain = ring.filter((b) => b.landmark !== 'tower');
    const overlaps = plain.filter((a, i) => plain.some((b, j) => j > i && a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minZ < b.maxZ - 1e-6 && b.minZ < a.maxZ - 1e-6));
    expect(overlaps).toEqual([]);
  });

  it('places every landmark near the city, taking turns round it', () => {
    const landmarks = ring.filter((b) => b.landmark);
    expect(landmarks.map((b) => b.landmark).sort()).toEqual([...t.landmarks].sort());
    for (const b of landmarks) expect(away((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)).toBeLessThan(t.near + t.block);
    const sides = new Set(landmarks.map((b) => [b.maxZ < 0, b.minX > w, b.minZ > h, b.maxX < 0].indexOf(true)));
    expect(sides.size).toBe(4);
  });

  it('puts each landmark at the end of a street running out to the edge, so it shows down that street', () => {
    const ts = map.tileSize;
    for (const b of ring.filter((r) => r.landmark)) {
      const [x, z] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
      // The road tiles just inside the edge on a line within a quarter block of the landmark's middle: the edge road
      // and the street off it.
      const northSouth = b.maxZ < 0 || b.minZ > h;
      const onStreet = (offset) => {
        const at = northSouth ? (k) => [Math.floor((x + offset) / ts), b.maxZ < 0 ? k : map.rows - 1 - k] : (k) => [x < 0 ? k : map.cols - 1 - k, Math.floor((z + offset) / ts)];
        return map.isRoad(...at(1)) && map.isRoad(...at(2));
      };
      expect([0, -1, 1, -2, 2].map((k) => (k * t.block) / 8).some(onStreet), `${b.landmark} at ${x}, ${z}`).toBe(true);
    }
  });
});

describe('skylineMeshes', () => {
  const meshes = skylineMeshes(planSkyline(map, tables), tables, { walls: null, roof: null });

  it('is two meshes, outside the map, light enough to draw whole', () => {
    expect(meshes).toHaveLength(2);
    let triangles = 0;
    for (const { geometry } of meshes) {
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) expect(away(p.getX(i), p.getZ(i))).toBeGreaterThanOrEqual(t.gap - 1e-3);
      triangles += geometry.index.count / 3;
    }
    expect(triangles).toBeLessThan(60000);
  });
});

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
