// Parses the ASCII city grid into tiles, spots and solid colliders (spec #1: "Map").
// Tile (col, row) covers x from col to col + 1 and z from row to row + 1, in tile sizes.
//   .  road               ,  open ground (drivable, not road)
//   #  building           A–Z  spot: a building whose zone is the road tile beside it
//   c  parked car, p  pole: a road tile with the obstacle at its kerb
// The road graph is the grid itself: road tiles are nodes, neighbouring road tiles are edges.

const ROAD = ['.', 'c', 'p'];
const OBSTACLES = { c: 'car', p: 'pole' };
export const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function parseMap(text, tables) {
  const { tileSize, obstacles } = tables.city;
  const tiles = text.trim().split('\n').map((line) => line.trim());
  const cols = tiles[0].length;
  const rows = tiles.length;
  const isRoad = (col, row) => ROAD.includes(tiles[row]?.[col]);
  const roads = [];
  const spots = [];
  const colliders = [];

  tiles.forEach((line, row) => {
    if (line.length !== cols) throw new Error(`Map row ${row + 1} has ${line.length} tiles, expected ${cols}`);
    [...line].forEach((t, col) => {
      const x = (col + 0.5) * tileSize;
      const z = (row + 0.5) * tileSize;
      const half = tileSize / 2;
      const where = `at column ${col + 1}, row ${row + 1}`;

      if (isRoad(col, row)) roads.push({ col, row });
      if (t === '#') {
        colliders.push({ kind: 'building', ...box(x, z, half, half) });
      } else if (/[A-Z]/.test(t)) {
        const d = DIRS.find(([dc, dr]) => tiles[row + dr]?.[col + dc] === '.');
        if (!d) throw new Error(`Map spot ${t} ${where} has no free road beside it`);
        if (spots.some((s) => s.id === t)) throw new Error(`Map spot ${t} appears twice`);
        colliders.push({ kind: 'spot', ...box(x, z, half, half) });
        const zoneTile = { col: col + d[0], row: row + d[1] };
        spots.push({ id: t, zoneTile, zone: box(x + d[0] * tileSize, z + d[1] * tileSize, half, half) });
      } else if (OBSTACLES[t]) {
        const d = DIRS.find(([dc, dr]) => !isRoad(col + dc, row + dr));
        if (!d) throw new Error(`Map obstacle ${t} ${where} needs a kerb (a non-road neighbour)`);
        const kind = OBSTACLES[t];
        const { length, width, kerbGap } = obstacles[kind];
        const offset = half - kerbGap - width / 2;
        // Long side along the kerb.
        const [hx, hz] = d[0] ? [width / 2, length / 2] : [length / 2, width / 2];
        colliders.push({ kind, ...box(x + d[0] * offset, z + d[1] * offset, hx, hz) });
      } else if (t !== '.' && t !== ',') {
        throw new Error(`Unknown map tile '${t}' ${where}`);
      }
    });
  });
  if (roads.length === 0) throw new Error('Map has no road');

  // Shortest road path between two road tiles, both ends included; null if they aren't connected.
  // Breadth-first search, since every edge is one tile long.
  function route(from, to) {
    const key = ({ col, row }) => row * cols + col;
    const prev = new Map([[key(from), null]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const tile = queue[i];
      if (key(tile) === key(to)) {
        const path = [];
        for (let t = tile; t; t = prev.get(key(t))) path.unshift(t);
        return path;
      }
      for (const [dc, dr] of DIRS) {
        const next = { col: tile.col + dc, row: tile.row + dr };
        if (isRoad(next.col, next.row) && !prev.has(key(next))) {
          prev.set(key(next), tile);
          queue.push(next);
        }
      }
    }
    return null;
  }

  return { cols, rows, tileSize, isRoad, roads, spots, colliders, route };
}

function box(x, z, hx, hz) {
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}
