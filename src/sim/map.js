// Parses the ASCII city grid into tiles, spots and solid colliders (spec #1: "Map").
// Tile (col, row) covers x from col to col + 1 and z from row to row + 1, in tile sizes.
//   .  road               ,  open ground (drivable, not road; listed in `open`)
//   #  building           A–Z  spot: a building whose zone is the road tile beside it
//   c  parked car, p  pole: a road tile with the obstacle at its kerb
//   +  light junction: a road crossing with traffic lights on each road approach
// The road graph is the grid itself: road tiles are nodes, neighbouring road tiles are edges.

const ROAD = ['.', 'c', 'p', '+'];
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
  const open = [];
  const spots = [];
  const colliders = [];
  const lights = [];
  let junctions = 0;

  tiles.forEach((line, row) => {
    if (line.length !== cols) throw new Error(`Map row ${row + 1} has ${line.length} tiles, expected ${cols}`);
    [...line].forEach((t, col) => {
      const x = (col + 0.5) * tileSize;
      const z = (row + 0.5) * tileSize;
      const half = tileSize / 2;
      const where = `at column ${col + 1}, row ${row + 1}`;

      if (isRoad(col, row)) roads.push({ col, row });
      if (t === ',') open.push({ col, row });
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
      } else if (t === '+') {
        const approaches = DIRS.filter(([dc, dr]) => isRoad(col - dc, row - dr));
        if (approaches.length < 3) throw new Error(`Map light junction ${where} is not a crossing`);
        // One light per approach; `dir` is the DIRS index of travel into the junction, and (x, z) is the
        // middle of its stop line, the tile edge the approach crosses.
        for (const [dc, dr] of approaches) {
          lights.push({ junction: junctions, col, row, dir: DIRS.findIndex((d) => d[0] === dc && d[1] === dr), x: x - dc * half, z: z - dr * half });
        }
        junctions++;
      } else if (t !== '.' && t !== ',') {
        throw new Error(`Unknown map tile '${t}' ${where}`);
      }
    });
  });
  if (roads.length === 0) throw new Error('Map has no road');

  const key = ({ col, row }) => row * cols + col;

  // Breadth-first search outwards from the road tile `to` (every edge is one tile long): for each road
  // tile connected to it, the next tile on a shortest path to `to` and that path's length in tiles.
  function towards(to) {
    const next = new Map([[key(to), { tile: null, steps: 0 }]]);
    const queue = [to];
    for (let i = 0; i < queue.length; i++) {
      const tile = queue[i];
      const steps = next.get(key(tile)).steps + 1;
      for (const [dc, dr] of DIRS) {
        const n = { col: tile.col + dc, row: tile.row + dr };
        if (isRoad(n.col, n.row) && !next.has(key(n))) {
          next.set(key(n), { tile, steps });
          queue.push(n);
        }
      }
    }
    return next;
  }

  function pathFrom(next, from) {
    if (!next.has(key(from))) return null;
    const path = [];
    for (let t = from; t; t = next.get(key(t)).tile) path.push(t);
    return path;
  }

  // Shortest road path between two road tiles, both ends included; null if they aren't connected.
  const route = (from, to) => pathFrom(towards(to), from);

  // Shortest road path to the road tile `to` from the road tile under world position (x, z). Off the road,
  // it starts from the road tile beside the truck's patch of open ground that makes the trip shortest:
  // straight across to its centre, then by road. Null if no road reaches `to` from there.
  // shortcut: "straight across" assumes the open ground is convex (true for the plaza); upgrade if a map
  // gets an L-shaped open area.
  function routeFrom(x, z, to) {
    const next = towards(to);
    const here = { col: Math.floor(x / tileSize), row: Math.floor(z / tileSize) };
    if (isRoad(here.col, here.row)) return pathFrom(next, here);
    const seen = new Set([key(here)]);
    const patch = [here];
    const exits = [];
    for (let i = 0; i < patch.length; i++) {
      for (const [dc, dr] of DIRS) {
        const n = { col: patch[i].col + dc, row: patch[i].row + dr };
        if (seen.has(key(n))) continue;
        seen.add(key(n));
        if (isRoad(n.col, n.row)) exits.push(n);
        else if (tiles[n.row]?.[n.col] === ',') patch.push(n);
      }
    }
    const trip = (t) =>
      Math.hypot((t.col + 0.5) * tileSize - x, (t.row + 0.5) * tileSize - z) + (next.get(key(t))?.steps ?? Infinity) * tileSize;
    return exits.length ? pathFrom(next, exits.reduce((a, b) => (trip(b) < trip(a) ? b : a))) : null;
  }

  return { cols, rows, tileSize, isRoad, roads, open, spots, colliders, lights, route, routeFrom };
}

function box(x, z, hx, hz) {
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
}
