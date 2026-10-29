import { describe, it, expect } from 'vitest';
import { xz } from '../../scripts/maps.js';
import { build, monti, way } from './fixtures.js';
import { createTerrain } from './terrain.js';

describe('terrain (#104)', () => {
  it('is flat at 0 on an inline fixture without terrain', () => {
    const map = build([way('residential', [[0, -50], [0, 50]])]);
    expect(map.heightAt(10, -20)).toBe(0);
    expect(map.slopeAt(10, -20, 1, 0)).toBe(0);
  });

  it('interpolates bilinearly between grid points and clamps at the grid\'s edge', () => {
    const { heightAt, slopeAt } = createTerrain({ minX: 0, minZ: 0, cell: 10, nx: 2, nz: 2, h: [20, 30, 20, 40] });
    expect(heightAt(0, 0)).toBeCloseTo(20);
    expect(heightAt(5, 5)).toBeCloseTo(27.5);
    expect(heightAt(-50, 0)).toBeCloseTo(20);
    expect(heightAt(50, 50)).toBeCloseTo(40);
    expect(slopeAt(5, 0, 1, 0)).toBeCloseTo(1); // 10 m up over 10 m east along z = 0
    expect(slopeAt(5, 0, -1, 0)).toBeCloseTo(-1);
  });

  // The research note's TINITALY heights (docs/research/terrain-dem.md), to 0.5 m: the grid resamples the DEM they were read from.
  it('puts Monti\'s ground at the research points\' heights', () => {
    const map = monti();
    const at = (lat, lon) => map.heightAt(...xz(lat, lon));
    expect(at(41.8945, 12.4925)).toBeCloseTo(30.5, 0); // the Suburra
    expect(at(41.8937, 12.4931)).toBeCloseTo(46.5, 0); // San Pietro in Vincoli
    expect(at(41.8949, 12.4903)).toBeCloseTo(30.5, 0); // Piazza Madonna dei Monti
    expect(at(41.8935, 12.488)).toBeCloseTo(25.7, 0); // lower Via Cavour
  });
});
