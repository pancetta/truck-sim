import { expect, test } from 'vitest';
import * as tables from '../tables.js';
import { parseMap } from './map.js';

const TILE = tables.city.tileSize;
const { laneOffset } = tables.traffic;

test('a two-way edge has a lane each way, laneOffset right of the centre line, round its bends too', () => {
  // An L: down from the top dead end, then right to the other.
  const map = parseMap(
    `
    .##
    .##
    ...`,
    tables,
  );
  const [edge] = map.graph.edges;
  expect(map.graph.edges.length).toBe(1);
  expect(edge.length).toBeCloseTo(4 * TILE);
  const [forward, backward] = edge.lanes.map((l) => l.points);
  // Down the left (+z, right is -x), round the corner, then along the bottom (+x, right is +z).
  expect(forward.at(0)).toEqual({ x: 0.5 * TILE - laneOffset, z: 0.5 * TILE });
  expect(forward[1].x).toBeCloseTo(0.5 * TILE - laneOffset);
  expect(forward[1].z).toBeCloseTo(2.5 * TILE + laneOffset);
  expect(forward.at(-1).z).toBeCloseTo(2.5 * TILE + laneOffset);
  // The other way it keeps to the inside of the bend.
  expect(backward[1].x).toBeCloseTo(0.5 * TILE + laneOffset);
  expect(backward[1].z).toBeCloseTo(2.5 * TILE - laneOffset);
});
