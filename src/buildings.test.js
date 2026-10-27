import { describe, it, expect } from 'vitest';
import * as tables from './tables.js';
import { DIRS, planBuildings, facadeParts } from './buildings.js';
import { way, building, build } from './sim/fixtures.js';
import { inside } from './sim/sim.js';

describe('planBuildings (#65)', () => {
  // A road along z = 0, and two buildings north of it, back to back along x = 10; the second's outline runs the other
  // way round.
  const osm = build([
    way('residential', [[-50, 0], [50, 0]]),
    building([[0, -30], [10, -30], [10, -10], [0, -10]], { height: '15' }),
    building([[10, -10], [20, -10], [20, -30], [10, -30]], { height: '9' }),
  ]);
  const buildings = planBuildings(osm, tables);

  it('builds each outline at the map\'s height, with as many floors as fit under it', () => {
    expect(buildings.map((b) => b.height)).toEqual([15, 9]);
    const t = tables.buildings;
    for (const b of buildings) expect(t.groundFloor + (b.floors - 1) * t.floor + t.parapet).toBeLessThanOrEqual(b.height);
  });

  it('builds the same city each time', () => {
    expect(JSON.stringify(planBuildings(osm, tables))).toBe(JSON.stringify(buildings));
  });

  it('gives each wall a side, outside to its left, and leaves the party wall blank', () => {
    for (const b of buildings) {
      expect(b.sides).toHaveLength(4);
      for (const side of b.sides) {
        const [x, z] = [side.x + (side.ux * side.length) / 2 - side.uz * 0.5, side.z + (side.uz * side.length) / 2 + side.ux * 0.5];
        expect(inside(x, z, b.points)).toBe(false);
        expect(side.street).toBe(Math.abs(side.x + (side.ux * side.length) / 2 - 10) > 1e-6); // only the wall along x = 10 is shared
        expect(DIRS[side.dir][0] * -side.uz + DIRS[side.dir][1] * side.ux).toBeGreaterThan(0.7); // dir is the way it faces
      }
    }
  });

  it('puts the facades on the outside of the walls', () => {
    for (const b of buildings) {
      for (const side of b.sides.filter((s) => s.street)) {
        for (const p of facadeParts(b, side, tables)) {
          expect(inside(p.x, p.z, b.points)).toBe(false);
          expect(p.y + p.size[1] / 2).toBeLessThanOrEqual(b.height + 1e-9);
        }
      }
    }
  });
});
