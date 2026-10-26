import { describe, it, expect } from 'vitest';
import * as tables from './tables.js';
import { parseMap } from './sim/map.js';
import { planSkyline, skylineMeshes } from './skyline.js';
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
