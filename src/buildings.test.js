import { describe, it, expect } from 'vitest';
import * as tables from './tables.js';
import { parseMap, DIRS } from './sim/map.js';
import { planBuildings, facadeParts, dockHalf } from './buildings.js';
import city from './city.txt?raw';

const map = parseMap(city, tables);
const ts = map.tileSize;

describe('planBuildings', () => {
  const buildings = planBuildings(map, tables);

  it('builds the same city each time', () => {
    expect(JSON.stringify(planBuildings(map, tables))).toBe(JSON.stringify(buildings));
  });

  it('builds once along every street face of a block, inside the block, without overlaps', () => {
    const solid = new Set(map.colliders.filter((c) => c.kind === 'building' || c.kind === 'spot').map((c) => `${c.minX},${c.minZ}`));
    const isSolid = (x, z) => solid.has(`${Math.floor(x / ts) * ts},${Math.floor(z / ts) * ts}`);
    // Each building tile's street-facing edge, by the middle of the edge, must lie on exactly one building's street side.
    for (const key of solid) {
      const [x0, z0] = key.split(',').map(Number);
      DIRS.forEach(([dc, dr], dir) => {
        const [mx, mz] = [x0 + ts / 2 + (dc * ts) / 2, z0 + ts / 2 + (dr * ts) / 2];
        if (isSolid(mx + dc, mz + dr)) return;
        const on = buildings.filter((b) => {
          const s = b.sides[dir];
          const [x1, z1] = [s.x + s.ux * s.length, s.z + s.uz * s.length];
          return s.street && Math.min(s.x, x1) <= mx && mx <= Math.max(s.x, x1) && Math.min(s.z, z1) <= mz && mz <= Math.max(s.z, z1) && (dc ? s.x === mx : s.z === mz);
        });
        expect(on.length, `edge at ${mx},${mz}`).toBeGreaterThanOrEqual(1);
        // A tile corner can touch two buildings of a row; the edge's middle lies inside exactly one.
        expect(on.filter((b) => (dc ? b.minZ < mz && mz < b.maxZ : b.minX < mx && mx < b.maxX)).length, `edge at ${mx},${mz}`).toBe(1);
      });
    }
    const outside = buildings.filter((b) => {
      for (let x = b.minX + 0.5; x < b.maxX; x += 1) for (let z = b.minZ + 0.5; z < b.maxZ; z += 1) if (!isSolid(x, z)) return true;
      return false;
    });
    expect(outside).toEqual([]);
    const overlaps = buildings.flatMap((a, i) => buildings.slice(i + 1).filter((b) => a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minZ < b.maxZ - 1e-6 && b.minZ < a.maxZ - 1e-6));
    expect(overlaps).toEqual([]);
  });

  it('cuts rows into buildings of the table widths, a spot tile its own building', () => {
    const [lo, hi] = tables.buildings.width;
    expect(hi).toBeGreaterThanOrEqual(2 * lo); // else a row's last cut can leave a sliver
    for (const b of buildings) {
      // One tile deep across the row; the other way is the width.
      const [dx, dz] = [b.maxX - b.minX, b.maxZ - b.minZ];
      expect([dx, dz]).toContain(ts);
      const width = dx === ts ? dz : dx;
      if (b.spot) expect(width).toBe(ts);
      else {
        expect(width).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(width).toBeLessThanOrEqual(hi + 1e-9);
      }
      expect(b.height).toBeLessThan(tables.city.markerHeight);
    }
  });

  it('gives each spot its building, facing its zone, with an opening as wide as the bay at docks', () => {
    for (const spot of map.spots) {
      const own = buildings.filter((b) => b.spot === spot);
      expect(own.length).toBe(1);
      const side = own[0].sides[spot.dir];
      expect(side).toMatchObject({ spot, street: true });
      if (spot.dock) expect(side.hole.to - side.hole.from).toBeCloseTo(2 * dockHalf(tables));
      else expect(side.hole).toBe(null);
    }
    expect(buildings.flatMap((b) => b.sides).filter((s) => s.spot).length).toBe(map.spots.length);
  });

  it('leaves the walls between buildings and towards courtyards without street sides', () => {
    const party = buildings.flatMap((b) => b.sides).filter((s) => !s.street);
    expect(party.length).toBeGreaterThan(0);
    // Back walls of rows face a courtyard or another row.
    expect(buildings.every((b) => b.sides.some((s) => !s.street))).toBe(true);
  });
});

describe('facadeParts', () => {
  const buildings = planBuildings(map, tables);
  const spotColour = tables.palette.spot;

  it('signs a spot with its letter in the spot colour, and opens a dock with a roller door at the back', () => {
    for (const spot of map.spots) {
      const b = buildings.find((x) => x.spot === spot);
      const parts = facadeParts(b, b.sides[spot.dir], tables, spotColour);
      expect(parts.filter((p) => p.cell === `letter${spot.id}`).length).toBeGreaterThanOrEqual(3);
      // Drawn at any distance, so the spot shows from afar.
      expect(parts.some((p) => p.colour === spotColour && !p.near)).toBe(true);
      const door = parts.find((p) => p.cell === 'roller' && p.size[0] > 3);
      if (spot.dock) {
        const [nx, nz] = DIRS[spot.dir];
        const side = b.sides[spot.dir];
        const out = (door.x - side.x) * nx + (door.z - side.z) * nz;
        expect(out).toBeCloseTo(0.01 - tables.buildings.dock.depth);
      } else expect(door).toBe(undefined);
    }
  });

  it('puts every part in front of its wall, within the wall and the building height', () => {
    for (const b of buildings.slice(0, 40)) {
      for (const side of b.sides.filter((s) => s.street)) {
        const [nx, nz] = [-side.uz, side.ux];
        for (const p of facadeParts(b, side, tables, spotColour)) {
          const along = (p.x - side.x) * side.ux + (p.z - side.z) * side.uz;
          const out = (p.x - side.x) * nx + (p.z - side.z) * nz;
          expect(along).toBeGreaterThanOrEqual(0);
          expect(along).toBeLessThanOrEqual(side.length);
          expect(out).toBeGreaterThanOrEqual(side.hole ? -tables.buildings.dock.depth : 0);
          expect(p.y + p.size[1] / 2).toBeLessThanOrEqual(b.height + 1e-9);
        }
      }
    }
  });
});
