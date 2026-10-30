import { describe, it, expect } from 'vitest';
import * as tables from './tables.js';
import { DIRS, planBuildings, facadeParts, groundAt } from './buildings.js';
import { way, building, build, monti } from './sim/fixtures.js';
import { inside } from './sim/sim.js';
import { createTerrain } from './sim/terrain.js';

describe('planBuildings (#65)', () => {
  // A road along z = 0, and two buildings north of it, back to back along x = 10; the second's outline runs the other
  // way round.
  const osm = build([
    way('residential', [[-50, 0], [50, 0]]),
    building([[0, -30], [10, -30], [10, -10], [0, -10]], { height: '15' }),
    building([[10, -10], [20, -10], [20, -30], [10, -30]], { height: '9' }),
  ]);
  const buildings = planBuildings(osm, tables);

  it('builds each outline at the map\'s height', () => {
    expect(buildings.map((b) => b.height)).toEqual([15, 9]);
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
          expect(p.y + p.size[1] / 2).toBeLessThanOrEqual(b.roof + 1e-9);
        }
      }
    }
  });
});

describe('Buildings stepped to the street on slopes (#107)', () => {
  const t = tables.buildings;
  const under = tables.drape.open + tables.drape.sink;
  const openings = (b, side) => facadeParts(b, side, tables).filter((p) => ['door', 'shop', 'roller'].includes(p.cell));
  // The pavement's height 0.5 m out in front of an opening, and how far the opening's foot is off it.
  const off = (map, side, p) => p.y - p.size[1] / 2 - groundAt(map, tables, p.x - side.uz * 0.42, p.z + side.ux * 0.42);
  const check = (map, buildings) => {
    for (const b of buildings) {
      for (const side of b.sides) {
        for (const run of side.runs) {
          const grounds = side.grounds.slice(run.from, run.to);
          expect(Math.max(...grounds) - Math.min(...grounds)).toBeLessThanOrEqual(t.step + 1e-9);
          expect(run.level + b.height).toBeLessThanOrEqual(b.roof + 1e-9); // its walls reach the roof
          // No gap under the wall: its foot is under the open ground all along it.
          for (let a = run.a0; a <= run.a1; a += 0.5) expect(run.foot).toBeLessThanOrEqual(map.heightAt(side.x + side.ux * a, side.z + side.uz * a) - under + 1e-9);
        }
        if (side.street) for (const p of openings(b, side)) expect(Math.abs(off(map, side, p)), `${p.cell} at ${p.x}, ${p.z}`).toBeLessThanOrEqual(t.door);
      }
    }
  };

  it('on a street climbing 12 %, steps a long front in runs, its doors on the pavement and its walls reaching the ground', () => {
    // A street along z = 0 on ground rising 12 % to the east, and an 80 m long building north of it.
    const h = Array.from({ length: 21 * 21 }, (_, k) => 0.12 * ((k % 21) * 10 - 100));
    const map = { ...build([way('residential', [[-95, 0], [95, 0]]), building([[-40, -30], [40, -30], [40, -8], [-40, -8]], { height: '15' })]), ...createTerrain({ minX: -100, minZ: -100, cell: 10, nx: 21, nz: 21, h }) };
    const buildings = planBuildings(map, tables);
    check(map, buildings);
    const front = buildings[0].sides.find((s) => s.street && Math.abs(s.ux) > 0.9);
    expect(front.runs.length).toBeGreaterThan(4); // 9 m of rise along it
    expect(openings(buildings[0], front).length).toBeGreaterThan(5);
  });

  it('on Monti, every door and shop front meets the pavement and no wall leaves a gap under it', () => {
    const map = monti();
    check(map, planBuildings(map, tables));
  });
});
