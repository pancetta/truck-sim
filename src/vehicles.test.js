import { describe, it, expect } from 'vitest';
import { Box3 } from 'three/webgpu';
import { carGeometries } from './vehicles.js';
import { vehicles, city } from './tables.js';

describe('Vehicles: generated cars', () => {
  const footprint = city.obstacles.car;
  const cars = carGeometries(vehicles.types, footprint);

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
