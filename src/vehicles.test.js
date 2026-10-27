import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three/webgpu';
import { carGeometries } from './vehicles.js';
import { vehicles, city, police } from './tables.js';

describe('Vehicles: generated cars', () => {
  const footprint = city.obstacles.car;
  // The police car too, with its roof bar and bands.
  const cars = { ...carGeometries(vehicles.types, footprint), ...carGeometries({ police: vehicles.types[police.body] }, footprint, police) };

  it('fills the footprint the Sim collides with, front towards +z, at every detail level', () => {
    for (const [type, car] of Object.entries(cars)) {
      for (const lod of ['near', 'far']) {
        const box = new Box3();
        for (const g of Object.values(car[lod])) {
          g.computeBoundingBox();
          box.union(g.boundingBox);
        }
        const size = `${type} ${lod}`;
        expect(box.min.y, size).toBeCloseTo(0, 2);
        // Bumpers reach out to the footprint's ends where the body's end is upright; mirrors to its sides.
        expect(box.max.z - box.min.z, size).toBeGreaterThan(footprint.length - 0.15);
        expect(box.max.z - box.min.z, size).toBeLessThanOrEqual(footprint.length + 1e-6);
        expect(box.max.x - box.min.x, size).toBeLessThanOrEqual(footprint.width + 1e-6);
        expect(Math.abs(box.max.z + box.min.z), size).toBeLessThan(0.1); // centred
      }
    }
  });

  it('closes every body into an outward-facing shell, so nothing shows through its ends', () => {
    // shortcut: welds by position at 0.1 mm, enough while no two body vertices sit closer than that without being one.
    const key = (p, i) => [0, 1, 2].map((a) => Math.round(p.array[i * 3 + a] * 1e4)).join(',');
    for (const [type, car] of Object.entries(cars)) {
      for (const lod of ['near', 'far']) {
        const g = car[lod].body;
        const [p, index] = [g.getAttribute('position'), g.getIndex().array];
        const edges = new Map();
        let volume = 0;
        const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
        for (let t = 0; t < index.length; t += 3) {
          const ids = [0, 1, 2].map((j) => key(p, index[t + j]));
          for (let j = 0; j < 3; j++) {
            const e = `${ids[j]}>${ids[(j + 1) % 3]}`;
            edges.set(e, (edges.get(e) ?? 0) + 1);
          }
          volume += a.fromBufferAttribute(p, index[t]).dot(b.fromBufferAttribute(p, index[t + 1]).cross(c.fromBufferAttribute(p, index[t + 2]))) / 6;
        }
        // Every directed edge once, with its reverse once: each edge is shared by two triangles, oriented consistently.
        const open = [...edges].filter(([e, n]) => n !== 1 || edges.get(e.split('>').reverse().join('>')) !== 1);
        expect(open.length, `${type} ${lod} open or doubled edges`).toBe(0);
        expect(volume, `${type} ${lod} signed volume`).toBeGreaterThan(1);
      }
    }
  });

  it('faces the end caps outwards, rear and front', () => {
    for (const [type, car] of Object.entries(cars)) {
      for (const lod of ['near', 'far']) {
        const g = car[lod].body;
        g.computeBoundingBox();
        const { min, max } = g.boundingBox;
        const [p, index] = [g.getAttribute('position'), g.getIndex().array];
        const [a, b, c, n] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
        const caps = { rear: 0, front: 0 };
        for (let t = 0; t < index.length; t += 3) {
          [a, b, c].forEach((v, j) => v.fromBufferAttribute(p, index[t + j]));
          n.subVectors(b, a).cross(c.clone().sub(a));
          // Mirrors reach past the ends' sides, not their length, so the z extremes are the caps' and the bodies' ends.
          const z = [a.z, b.z, c.z];
          if (Math.max(...z) - Math.min(...z) > 1e-3) continue;
          if (Math.abs(a.z - min.z) < 0.01) caps.rear += n.z < 0 ? 1 : 1e6;
          if (Math.abs(a.z - max.z) < 0.01) caps.front += n.z > 0 ? 1 : 1e6;
        }
        expect(caps.rear, `${type} ${lod} rear cap`).toBeGreaterThan(0);
        expect(caps.rear, `${type} ${lod} rear cap`).toBeLessThan(1e6);
        expect(caps.front, `${type} ${lod} front cap`).toBeGreaterThan(0);
        expect(caps.front, `${type} ${lod} front cap`).toBeLessThan(1e6);
      }
    }
  });

  it('keeps a headlight part at the front of every car', () => {
    for (const [type, car] of Object.entries(cars)) {
      for (const lod of ['near', 'far']) {
        const { details } = car[lod];
        const lit = details.getAttribute('headlight');
        const p = details.getAttribute('position');
        const zs = [];
        for (let i = 0; i < lit.count; i++) if (lit.getX(i) === 1) zs.push(p.getZ(i));
        expect(zs.length, `${type} ${lod}`).toBeGreaterThan(0);
        expect(Math.min(...zs), `${type} ${lod}`).toBeGreaterThan(footprint.length / 2 - 0.6);
      }
    }
  });
});
