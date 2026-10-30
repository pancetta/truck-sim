import { describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import * as tables from './tables.js';
import { drape, onGround } from './drape.js';
import { createTerrain } from './sim/terrain.js';
import { monti } from './sim/fixtures.js';
import { roadSurface, osmPavements, pavementGeometry } from './roads.js';
import { roadPieces } from './sim/paved.js';

// A 10 m grid that is flat for x < 0 and climbs 10 % for x > 0: one bend, along x = 0.
const nx = 21;
const bent = createTerrain({ minX: -100, minZ: -100, cell: 10, nx, nz: nx, h: Array.from({ length: nx * nx }, (_, k) => Math.max(0, (k % nx) * 10 - 100) * 0.1) });
const flat = createTerrain(null);
const square = (half) => roadSurface([{ ring: [[-half, -half], [half, -half], [half, half], [-half, half]] }], 0);
const triangles = (g) => g.getAttribute('position').count / 3;
const corners = (g) => Array.from({ length: g.getAttribute('position').count }, (_, i) => new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'), i));

describe('drape (#106)', () => {
  test('on flat ground it only lifts by the offset, splitting nothing', () => {
    const out = drape(square(40), flat, 0.01, -0.15);
    expect(triangles(out)).toBe(2);
    for (const p of corners(out)) expect(p.y).toBeCloseTo(-0.15, 6);
  });

  test('on a plain slope it splits nothing either, and tilts the normals up the slope', () => {
    const slope = createTerrain({ minX: -100, minZ: -100, cell: 10, nx, nz: nx, h: Array.from({ length: nx * nx }, (_, k) => (k % nx) * 1) });
    const out = drape(square(40), slope, 0.01);
    expect(triangles(out)).toBe(2);
    const n = new THREE.Vector3().fromBufferAttribute(out.getAttribute('normal'), 0);
    expect(n.x).toBeCloseTo(-0.1 / Math.hypot(0.1, 1), 4);
    expect(n.y).toBeCloseTo(1 / Math.hypot(0.1, 1), 4);
  });

  test('every point of a draped surface is within the tolerance of the ground', () => {
    const out = drape(square(40), bent, 0.01);
    expect(triangles(out)).toBeGreaterThan(2);
    const p = out.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k));
      for (const [u, v] of [[1 / 3, 1 / 3], [0.5, 0], [0, 0.5], [0.5, 0.5], [0.1, 0.1]]) {
        const q = a.clone().multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
        expect(Math.abs(q.y - bent.heightAt(q.x, q.z))).toBeLessThan(0.0101);
      }
    }
  });

  test('finds a bump inside a triangle whose edges and middle miss it, and splits nothing it shares', () => {
    // Flat but for one grid point 0.5 m up at (30, -10), inside the square's lower triangle, its influence (10 m round)
    // reaching none of its edges nor its middle.
    const bump = createTerrain({ minX: -100, minZ: -100, cell: 10, nx, nz: nx, h: Array.from({ length: nx * nx }, (_, k) => (k === 9 * nx + 13 ? 0.5 : 0)) });
    const out = drape(square(40), bump, 0.01);
    expect(bump.heightAt(30, -10)).toBe(0.5);
    const p = out.getAttribute('position');
    const near = Array.from({ length: p.count }, (_, i) => Math.hypot(p.getX(i) - 30, p.getZ(i) + 10));
    expect(p.getY(near.indexOf(Math.min(...near)))).toBeGreaterThan(0.49);
    // No corner lies inside another triangle's edge (a T-junction would crack the surface).
    for (let i = 0; i < p.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => [p.getX(i + k), p.getZ(i + k)]);
      for (let j = 0; j < p.count; j++) {
        const q = [p.getX(j), p.getZ(j)];
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          const t = ((q[0] - u[0]) * (v[0] - u[0]) + (q[1] - u[1]) * (v[1] - u[1])) / ((v[0] - u[0]) ** 2 + (v[1] - u[1]) ** 2);
          const off = Math.abs((q[0] - u[0]) * (v[1] - u[1]) - (q[1] - u[1]) * (v[0] - u[0]));
          expect(t > 1e-6 && t < 1 - 1e-6 && off < 1e-6).toBe(false);
        }
      }
    }
  });

  test("onGround lays a point onto the ground's plane, upright lines staying upright", () => {
    const slope = createTerrain({ minX: -100, minZ: -100, cell: 10, nx, nz: nx, h: Array.from({ length: nx * nx }, (_, k) => (k % nx) + 2 * Math.floor(k / nx)) });
    const m = onGround(slope, 5, 5, 3);
    for (const [x, y, z] of [[5, 0, 5], [8, 0, 4], [5, 2, 5]]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
      expect([p.x, p.z]).toEqual([x, z]);
      expect(p.y).toBeCloseTo(slope.heightAt(x, z) + y, 6);
    }
  });

  test('keeps upright faces upright and the other attributes interpolated', () => {
    const wall = new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute([-40, 0, 0, 40, 0, 0, 40, 1, 0, -40, 0, 0, 40, 1, 0, -40, 1, 0], 3))
      .setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: 6 }, () => [0, 0, 1]).flat(), 3))
      .setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    const out = drape(wall, bent, 0.01);
    expect(triangles(out)).toBeGreaterThan(2);
    const [p, n, uv] = ['position', 'normal', 'uv'].map((a) => out.getAttribute(a));
    for (let i = 0; i < p.count; i++) {
      expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([0, 0, 1]);
      expect(uv.getX(i)).toBeCloseTo((p.getX(i) + 40) / 80, 5);
      // The bottom on the ground, the top 1 m over it.
      expect(p.getY(i) - bent.heightAt(p.getX(i), p.getZ(i))).toBeCloseTo(uv.getY(i), 5);
    }
  });

  test("Monti's roads, pavements and kerbs grow within the budget", () => {
    const map = monti();
    const pieces = roadPieces(map.graph);
    const { top, stones } = pavementGeometry(osmPavements(map, pieces, tables), tables.streets.pavement, 0.03);
    const { road, paving, budget } = tables.drape;
    const meshes = [[roadSurface(pieces, 0.03), road], [top, paving], [stones, paving]];
    const flatCount = meshes.reduce((n, [g]) => n + triangles(g), 0);
    const draped = meshes.reduce((n, [g, tolerance]) => n + triangles(drape(g, map, tolerance)), 0);
    expect(draped / flatCount).toBeLessThanOrEqual(budget);
  });
});
