import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { shadowCentre } from './renderer.js';
import { lighting } from './tables.js';

describe('Renderer: shadow area', () => {
  // The shadow camera's axes as the renderer sets them up.
  const z = new Vector3(...lighting.sunDirection).normalize();
  const x = new Vector3().crossVectors(new Vector3(0, 1, 0), z).normalize();
  const y = new Vector3().crossVectors(z, x);
  const texel = (2 * lighting.shadow.extent) / lighting.shadow.mapSize;
  const across = (v, axis) => v.dot(axis) / texel; // texels across the sun's view

  it('keeps a fixed ground point at the same place within its texel while the camera moves', () => {
    const point = new Vector3(123.4, 0, 56.7);
    const fractions = [];
    for (let i = 0; i < 100; i++) {
      const focus = new Vector3(400 + i * 0.37, 2 + (i % 3), 300 - i * 0.23); // driving, in steps of under a texel and more
      const centre = shadowCentre(focus, { x, y, z }, texel, new Vector3());
      const offset = point.clone().sub(centre);
      fractions.push([x, y].map((axis) => across(offset, axis) - Math.floor(across(offset, axis))));
      // The area still follows the focus: at most half a texel off it across the view, on it along the light.
      for (const axis of [x, y]) expect(Math.abs(across(focus.clone().sub(centre), axis))).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(focus.clone().sub(centre).dot(z)).toBeCloseTo(0, 9);
    }
    for (const [fx, fy] of fractions) {
      expect(Math.min(Math.abs(fx - fractions[0][0]), 1 - Math.abs(fx - fractions[0][0]))).toBeLessThan(1e-6);
      expect(Math.min(Math.abs(fy - fractions[0][1]), 1 - Math.abs(fy - fractions[0][1]))).toBeLessThan(1e-6);
    }
  });
});
