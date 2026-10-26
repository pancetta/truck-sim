import { describe, it, expect } from 'vitest';
import * as tables from './tables.js';
import { parseMap } from './sim/map.js';
import city from './city.txt?raw';
import { pavementLayout, lanternSpots } from './streets.js';

const map = parseMap(city, tables);
const ts = map.tileSize;
const { width } = tables.streets.pavement;
const isBlock = (x, z) => map.colliders.some((b) => (b.kind === 'building' || b.kind === 'spot') && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
const tileOf = (x, z) => [Math.floor(x / ts), Math.floor(z / ts)];

describe('Streets: pavements', () => {
  const { pavements, kerbs } = pavementLayout(map, width);
  const paved = (x, z) => pavements.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);

  it('lie on road tiles, only in the outer band the Sim keeps clear of the lanes, and never overlap', () => {
    for (const r of pavements) {
      const [cx, cz] = [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
      const [col, row] = tileOf(cx, cz);
      expect(map.isRoad(col, row)).toBe(true);
      const fromEdge = Math.min(cx - col * ts, (col + 1) * ts - cx, cz - row * ts, (row + 1) * ts - cz);
      expect(fromEdge).toBeLessThanOrEqual(width / 2 + 1e-9);
    }
    const area = pavements.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
    const cells = new Set(pavements.map((r) => `${r.minX},${r.minZ}`));
    expect(cells.size).toBe(pavements.length);
    expect(area).toBeGreaterThan(0);
  });

  it('run along every side of a road tile beside a building, except across a dock from its zone', () => {
    const docks = map.spots.filter((s) => s.dock);
    expect(docks.length).toBeGreaterThan(0);
    let sides = 0;
    for (const { col, row } of map.roads) {
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const [x, z] = [(col + 0.5 + dc * (0.5 - width / 2 / ts)) * ts, (row + 0.5 + dr * (0.5 - width / 2 / ts)) * ts];
        const beside = isBlock(x + dc * width, z + dr * width);
        const dock = docks.some((s) => s.zoneTile.col === col && s.zoneTile.row === row && (s.dir + 2) % 4 === [[0, -1], [1, 0], [0, 1], [-1, 0]].findIndex(([a, b]) => a === dc && b === dr));
        expect(paved(x, z)).toBe(beside && !dock);
        sides += beside;
      }
    }
    expect(sides).toBeGreaterThan(1000);
  });

  it('have a kerb wherever they meet the road or open ground, and none against a wall or more pavement', () => {
    for (const { x0, z0, x1, z1, dx, dz } of kerbs) {
      const [x, z] = [(x0 + x1) / 2, (z0 + z1) / 2];
      expect(paved(x - dx * 0.01, z - dz * 0.01)).toBe(true);
      expect(paved(x + dx * 0.01, z + dz * 0.01)).toBe(false);
      expect(isBlock(x + dx * 0.01, z + dz * 0.01)).toBe(false);
    }
    // A street side's kerb runs the tile's full length: middle strip and both corners.
    const [col, row] = [1, 3]; // the left column road, buildings either side
    expect(map.isRoad(col, row) && !map.isRoad(col - 1, row) && !map.isRoad(col + 1, row)).toBe(true);
    const side = kerbs.filter((k) => k.dx === 1 && k.x0 === col * ts + width && k.z0 >= row * ts && k.z1 <= (row + 1) * ts);
    expect(side.reduce((sum, k) => sum + k.z1 - k.z0, 0)).toBeCloseTo(ts);
  });
});

describe('Streets: lanterns', () => {
  const spots = lanternSpots(map, tables.streets.lantern);
  const walls = spots.filter((s) => !s.pole);

  it('hang on walls that face a road, turned out over it', () => {
    expect(walls.length).toBeGreaterThan(300);
    for (const { x, z, angle } of walls) {
      const [ox, oz] = [Math.sin(angle), Math.cos(angle)];
      expect(isBlock(x - ox * 0.5, z - oz * 0.5)).toBe(true);
      expect(map.isRoad(...tileOf(x + ox * 0.5, z + oz * 0.5))).toBe(true);
    }
  });

  it('run on about every `spacing` m along a straight wall', () => {
    const { spacing } = tables.streets.lantern;
    // The east wall of the left column's buildings, rows 2 to 7, faces the road in column 1... from column 2.
    const x = 2 * ts;
    const along = walls.filter((s) => Math.abs(s.x - x) < 1e-9 && s.z > 2 * ts && s.z < 8 * ts).map((s) => s.z).sort((a, b) => a - b);
    expect(along.length).toBeGreaterThan(1);
    for (let i = 1; i < along.length; i++) expect(along[i] - along[i - 1]).toBeCloseTo(spacing);
  });

  it('hang one on each pole, on its side towards the middle of the road', () => {
    const poles = map.colliders.filter((c) => c.kind === 'pole');
    const onPoles = spots.filter((s) => s.pole);
    expect(onPoles).toHaveLength(poles.length);
    onPoles.forEach(({ x, z, angle }, i) => {
      const p = poles[i];
      expect(Math.hypot(x - (p.minX + p.maxX) / 2, z - (p.minZ + p.maxZ) / 2)).toBeCloseTo(tables.streets.lantern.post);
      const [col, row] = tileOf(x, z);
      const [ox, oz] = [Math.sin(angle), Math.cos(angle)];
      const toMiddle = [(col + 0.5) * ts - x, (row + 0.5) * ts - z];
      expect(ox * toMiddle[0] + oz * toMiddle[1]).toBeGreaterThan(0.99 * Math.hypot(...toMiddle));
    });
  });
});
