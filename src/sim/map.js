// Parses the ASCII city grid into tiles, spots and solid colliders (spec #1: "Map").
// Tile (col, row) covers x from col to col + 1 and z from row to row + 1, in tile sizes.
//   .  road               ,  open ground (drivable, not road; listed in `open`), with trees along its roads
//   #  building           A–Z  spot: a building whose zone is the road tile beside it
//   c  parked car, p  pole: a road tile with the obstacle at its kerb
//   +  light junction: a road crossing with traffic lights on each road approach
// The road graph (`graph`) runs along the road tiles' centres; the tiles stay for what still works on them.

import { createGraph } from './graph.js';

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
        // `dir`: DIRS index from the spot to its zone; a dock's bay opens that way.
        spots.push({ id: t, dir: DIRS.indexOf(d), dock: tables.city.docks.includes(t), zoneTile, zone: box(x + d[0] * tileSize, z + d[1] * tileSize, half, half) });
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
        // The stop line is most of a tile back (tables.lights.stopLine), so it must not land in another junction.
        const roadSides = (c, r) => DIRS.filter(([dc, dr]) => isRoad(c + dc, r + dr)).length;
        if (approaches.some(([dc, dr]) => roadSides(col - dc, row - dr) >= 3)) throw new Error(`Map light junction ${where} needs a plain road tile before each approach`);
        // One light per approach, German style; `dir` is the DIRS index of travel into the junction and (dx, dz) that
        // direction, `axis` 0 north–south and 1 east–west, `post` its signal post, a solid one on the junction's near
        // right corner where the approach enters it (right of travel (dc, dr) is (-dr, dc)), (x, z) the middle of its
        // stop line, tables.lights.stopLine before it, and `half` the m either side of that middle that are its road.
        const { width, inset } = obstacles.signal;
        const reach = half - inset;
        const back = reach + tables.lights.stopLine;
        for (const [dc, dr] of approaches) {
          const post = { x: x - (dc + dr) * reach, z: z + (dc - dr) * reach };
          const dir = DIRS.findIndex((d) => d[0] === dc && d[1] === dr);
          lights.push({ junction: junctions, col, row, dir, dx: dc, dz: dr, axis: dir % 2, half, x: x - dc * back, z: z - dr * back, post });
          colliders.push({ kind: 'signal', ...box(post.x, post.z, width / 2, width / 2) });
        }
        junctions++;
      } else if (t !== '.' && t !== ',') {
        throw new Error(`Unknown map tile '${t}' ${where}`);
      }
    });
  });
  if (roads.length === 0) throw new Error('Map has no road');

  // Trees and small props on open ground (tables.city.plaza), solid: a row along each edge it shares with a road,
  // except across the road from a dock, where trucks pull out of the bay and line up to back into it. Where two rows
  // meet at a corner, a tree too close to one already placed is left out, with its prop.
  const { inset, spacing, props, size } = tables.city.plaza;
  const trees = [];
  const solid = (kind, x, z) => colliders.push({ kind, ...box(x, z, size[kind] / 2, size[kind] / 2) });
  const facesDock = (col, row, [dc, dr]) =>
    spots.some((s) => s.dock && s.zoneTile.col === col && s.zoneTile.row === row && DIRS[s.dir][0] === dc && DIRS[s.dir][1] === dr);
  for (const { col, row } of open) {
    for (const [dc, dr] of DIRS) {
      if (!isRoad(col + dc, row + dr) || facesDock(col + dc, row + dr, [-dc, -dr])) continue;
      const alongX = dr !== 0; // a north or south edge runs along x
      const across = alongX ? (row + 0.5) * tileSize + dr * (tileSize / 2 - inset) : (col + 0.5) * tileSize + dc * (tileSize / 2 - inset);
      const start = (alongX ? col : row) * tileSize;
      // Trees stand at (k + 0.5) × spacing along the row, so rows line up across tiles.
      for (let k = Math.ceil(start / spacing - 0.5); (k + 0.5) * spacing < start + tileSize; k++) {
        const at = (along) => (alongX ? [along, across] : [across, along]);
        const [x, z] = at((k + 0.5) * spacing);
        if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < spacing / 2)) continue;
        trees.push({ x, z });
        solid('tree', x, z);
        const prop = props[k % props.length];
        if (prop) solid(prop[0], ...at((k + 0.5) * spacing + prop[1]));
      }
    }
  }

  // Road signs (tables.signs), each on the right-hand pavement of a road tile facing the traffic that drives along it
  // (`dir`, its DIRS index; `angle` turns a plate to face it), `along` m past where it drives into the tile; none on a dock's zone tile, where the truck
  // backs across the pavement into a dock, nor where the right side is road. Not solid (#43): a wide turn sweeps the
  // pavement there, and the plate is too wide to set the post back to the wall. `kind` 'speed', a speed limit sign
  // where a street begins: on every way out of a light junction, and on every way into the city out of a junction
  // on the road round its edge, `tables.signs.along` m into the street; 'rightBeforeLeft', a warning sign on every
  // approach to an unsignalled junction, in the middle of the tile before it (clear of a speed sign on that tile), or
  // 3 m nearer the junction where a pole stands there.
  const signs = [];
  const junction = (col, row) => isRoad(col, row) && DIRS.filter(([dc, dr]) => isRoad(col + dc, row + dr)).length >= 3;
  const cs = roads.map((r) => r.col);
  const rs = roads.map((r) => r.row);
  const [minCol, maxCol, minRow, maxRow] = [Math.min(...cs), Math.max(...cs), Math.min(...rs), Math.max(...rs)];
  const onEdge = (col, row) => col === minCol || col === maxCol || row === minRow || row === maxRow;
  // A pole's middle (the 'p' tile's kerb, mid-tile), so a sign that would stand in it moves `along` to the next spot.
  const poles = colliders.filter((b) => b.kind === 'pole').map((b) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }));
  function sign(kind, c, r, dir, ...alongs) {
    const [dc, dr] = DIRS[dir];
    const kerb = !isRoad(c - dr, r + dc); // right of travel (dc, dr) is (-dr, dc)
    if (!isRoad(c, r) || !kerb || junction(c, r) || spots.some((s) => s.dock && s.zoneTile.col === c && s.zoneTile.row === r)) return;
    const { inset } = tables.signs;
    const side = tileSize / 2 - inset; // from the tile's centre, right
    for (const along of alongs) {
      const a = along - tileSize / 2; // from the tile's centre, ahead
      const [x, z] = [(c + 0.5) * tileSize + dc * a - dr * side, (r + 0.5) * tileSize + dr * a + dc * side];
      if (poles.some((p) => Math.hypot(p.x - x, p.z - z) < 1.5)) continue;
      signs.push({ kind, x, z, dir, angle: Math.atan2(-dc, -dr), ...(kind === 'speed' && { limit: tables.speedLimit }) });
      return;
    }
  }
  for (const { col, row } of roads) {
    if (!junction(col, row)) continue;
    const light = tiles[row][col] === '+';
    DIRS.forEach(([dc, dr], dir) => {
      if (!light) sign('rightBeforeLeft', col - dc, row - dr, dir, tileSize / 2, tileSize / 2 - 3); // 3 m nearer the junction past a pole
      if (light || (onEdge(col, row) && !onEdge(col + dc, row + dr))) sign('speed', col + dc, row + dr, dir, tables.signs.along);
    });
  }
  // The rule at a junction tile (three or more road sides): 'light' or 'rightBeforeLeft'; null off a junction.
  const rule = (col, row) => (!junction(col, row) ? null : tiles[row][col] === '+' ? 'light' : 'rightBeforeLeft');

  // The road graph (graph.js) of the road tiles: a node at the centre of every road tile with other than two road
  // neighbours (junctions and dead ends), plus one on each loop of road that has none, and an edge through the tile
  // centres from node to node, with a point at every bend. A lone road tile is an edge of one point. Grid roads are all
  // residential, one tile wide, unnamed, two-way and at tables.speedLimit.
  const key = ({ col, row }) => row * cols + col;
  const centre = ({ col, row }) => ({ x: (col + 0.5) * tileSize, z: (row + 0.5) * tileSize });
  const sides = ({ col, row }) => DIRS.filter(([dc, dr]) => isRoad(col + dc, row + dr)).length;
  const nodeAt = new Map(); // tile key → node index
  const seen = new Set(); // keys of the tiles walked
  const walked = new Set(); // `${key},${DIRS index}` of every way out of a node walked
  const nodes = [];
  const edges = [];
  const edge = (from, to, points) => edges.push({ from, to, class: 'residential', width: tileSize, name: '', oneWay: false, limit: tables.speedLimit, points });
  function addNode(tile) {
    nodeAt.set(key(tile), nodes.length);
    nodes.push(centre(tile));
    seen.add(key(tile));
    if (sides(tile) === 0) edge(nodes.length - 1, nodes.length - 1, [centre(tile)]);
  }
  // Every edge out of the node on `start` not walked yet, each along its road to the next node.
  function walk(start) {
    DIRS.forEach(([dc, dr], out) => {
      if (!isRoad(start.col + dc, start.row + dr) || walked.has(`${key(start)},${out}`)) return;
      walked.add(`${key(start)},${out}`);
      const points = [centre(start)];
      let [tile, dir] = [{ col: start.col + dc, row: start.row + dr }, out];
      while (!nodeAt.has(key(tile))) {
        seen.add(key(tile));
        const next = DIRS.findIndex(([c, r], k) => k !== (dir + 2) % 4 && isRoad(tile.col + c, tile.row + r));
        if (next !== dir) points.push(centre(tile));
        [tile, dir] = [{ col: tile.col + DIRS[next][0], row: tile.row + DIRS[next][1] }, next];
      }
      walked.add(`${key(tile)},${(dir + 2) % 4}`);
      points.push(centre(tile));
      edge(nodeAt.get(key(start)), nodeAt.get(key(tile)), points);
    });
  }
  for (const tile of roads) if (sides(tile) !== 2) addNode(tile);
  for (const tile of roads) if (nodeAt.has(key(tile))) walk(tile);
  for (const tile of roads) {
    if (seen.has(key(tile))) continue;
    addNode(tile);
    walk(tile);
  }
  const graph = createGraph(nodes, edges, tables.traffic.laneOffset, tables.city.cell);
  // Each light on the graph: its junction's `node` and the `slot` (lanes.js) of the arm its traffic drives in by.
  for (const l of lights) {
    const node = nodeAt.get(key(l));
    const slot = nodes[node].slots.findIndex(({ angle }) => Math.abs(Math.cos(angle) + l.dx) < 1e-9 && Math.abs(Math.sin(angle) + l.dz) < 1e-9);
    Object.assign(l, { node, slot });
  }
  // A spot's place on the graph: the pose nearest its zone's centre.
  for (const s of spots) s.pose = graph.nearest((s.zone.minX + s.zone.maxX) / 2, (s.zone.minZ + s.zone.maxZ) / 2);
  const bounds = { minX: 0, minZ: 0, maxX: cols * tileSize, maxZ: rows * tileSize };

  return { cols, rows, tileSize, bounds, isRoad, roads, open, spots, colliders, lights, signs, rule, graph };
}

// An axis-aligned box: its bounds, and as a collider its outline (`points`), which the Sim tests.
function box(x, z, hx, hz) {
  const [minX, maxX, minZ, maxZ] = [x - hx, x + hx, z - hz, z + hz];
  return { minX, maxX, minZ, maxZ, points: [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }] };
}
