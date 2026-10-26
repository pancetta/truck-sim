// Procedural buildings on the map's building tiles (#39), in the style of the Monti prototype (ADR 0001), numbers in
// tables.buildings. planBuildings and facadeParts decide what stands where; buildingMeshes turns that into meshes.
import * as THREE from 'three/webgpu';
import { DIRS } from './sim/map.js';
import { seeded } from './autopilot.js';

// Half the width of a dock's opening in its building's face: the bay the docking check allows, and 0.5 m each side.
export const dockHalf = (tables) => tables.vehicle.width / 2 + tables.orders.dockCentre + 0.5;

// The city's buildings. Every building tile (building or spot) that faces a tile that isn't one is built on: each run
// of such tiles along a face of a block is a row of buildings one tile deep, cut at random widths, a spot's tile always
// a building of its own. North and south faces go first, so their rows take the block's corners. Tiles further in
// stay empty, as courtyards. Each building has its footprint, `floors`, `height`, `wall` (index into
// tables.buildings.walls), `tint`, `brightness`, `offset` (m, of the wall texture), `seed` (for its facades), `spot`
// and `sides`.
export function planBuildings(map, tables) {
  const t = tables.buildings;
  const ts = map.tileSize;
  const random = seeded(t.seed);
  const between = ([lo, hi]) => lo + random() * (hi - lo);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const key = (col, row) => `${col},${row}`;
  const tiles = map.colliders.filter((c) => c.kind === 'building' || c.kind === 'spot').map((c) => ({ col: Math.floor(c.minX / ts), row: Math.floor(c.minZ / ts) }));
  const tileSet = new Set(tiles.map(({ col, row }) => key(col, row)));
  const spotAt = new Map(map.spots.map((s) => [key(s.zoneTile.col - DIRS[s.dir][0], s.zoneTile.row - DIRS[s.dir][1]), s]));
  const solid = (x, z) => tileSet.has(key(Math.floor(x / ts), Math.floor(z / ts)));

  const buildings = [];
  const claimed = new Set();
  for (const dir of [0, 2, 1, 3]) {
    const [dc, dr] = DIRS[dir];
    const alongX = dc === 0; // a north or south face runs along x
    const [lines, steps] = alongX ? [map.rows, map.cols] : [map.cols, map.rows];
    for (let line = 0; line < lines; line++) {
      let run = [];
      for (let step = 0; step <= steps; step++) {
        const [col, row] = alongX ? [step, line] : [line, step];
        if (step < steps && tileSet.has(key(col, row)) && !tileSet.has(key(col + dc, row + dr)) && !claimed.has(key(col, row))) {
          claimed.add(key(col, row));
          run.push({ col, row });
        } else if (run.length) {
          buildRow(run, alongX);
          run = [];
        }
      }
    }
  }
  return buildings;

  // A row of tiles along x or z, cut into buildings: m along the row from..to, with the spot whose tile it is.
  function buildRow(run, alongX) {
    const at = (tile) => (alongX ? tile.col : tile.row) * ts;
    const across = (alongX ? run[0].row : run[0].col) * ts;
    const cuts = [];
    const cutFree = (from, to) => {
      const [lo, hi] = t.width;
      while (to - from > hi) {
        let w = between(t.width);
        if (to - from - w < lo) w = (to - from) / 2; // no sliver at the end
        cuts.push([from, from + w]);
        from += w;
      }
      if (to - from > 1e-6) cuts.push([from, to]);
    };
    let from = at(run[0]);
    for (const tile of run) {
      const spot = spotAt.get(key(tile.col, tile.row));
      if (!spot) continue;
      cutFree(from, at(tile));
      cuts.push([at(tile), at(tile) + ts, spot]);
      from = at(tile) + ts;
    }
    cutFree(from, at(run.at(-1)) + ts);
    for (const [lo, hi, spot] of cuts) {
      const box = alongX ? { minX: lo, maxX: hi, minZ: across, maxZ: across + ts } : { minX: across, maxX: across + ts, minZ: lo, maxZ: hi };
      buildings.push(building(box, spot));
    }
  }

  function building(box, spot) {
    const floors = t.floors[0] + Math.floor(random() * (t.floors[1] - t.floors[0] + 1));
    let r = random();
    const drawn = t.walls.findIndex((w) => (r -= w.share) < 0);
    const wall = drawn < 0 ? t.walls.length - 1 : drawn; // the shares' rounding
    const b = {
      ...box,
      floors,
      height: t.groundFloor + (floors - 1) * t.floor + t.parapet,
      wall,
      tint: t.walls[wall].tinted ? pick(t.tints) : 0xffffff,
      brightness: between(t.brightness),
      offset: [random() * 20, random() * 20],
      seed: Math.floor(random() * 2 ** 32),
      spot: spot ?? null,
    };
    const { minX, maxX, minZ, maxZ } = box;
    // Each side from its start corner, along (ux, uz) to its end, with the outside to its left: seen from outside, it
    // runs left to right. In DIRS order, so a side's index is the direction it faces. A side is a street side if the
    // ground just outside its middle isn't a building tile; between buildings and towards a courtyard it is.
    // shortcut: judged at the middle only, which is exact for the rectangular blocks of today's map; an L-shaped block
    // could get a back wall that is half street.
    b.sides = [
      { x: maxX, z: minZ, ux: -1, uz: 0, length: maxX - minX },
      { x: maxX, z: maxZ, ux: 0, uz: -1, length: maxZ - minZ },
      { x: minX, z: maxZ, ux: 1, uz: 0, length: maxX - minX },
      { x: minX, z: minZ, ux: 0, uz: 1, length: maxZ - minZ },
    ].map((side, dir) => {
      const [nx, nz] = DIRS[dir];
      const street = !solid(side.x + (side.ux * side.length) / 2 + nx * 0.5, side.z + (side.uz * side.length) / 2 + nz * 0.5);
      const spotSide = spot?.dir === dir;
      const half = dockHalf(tables);
      // A dock's opening: m along the side, and up.
      const hole = spotSide && spot.dock ? { from: side.length / 2 - half, to: side.length / 2 + half, height: t.dock.height } : null;
      return { ...side, dir, street, spot: spotSide ? spot : null, hole };
    });
    return b;
  }
}

// The parts on one street side of a building, in the prototype's style. Per window bay: on the ground floor a shop
// window (some with a sign), a pulled-down shop shutter, a wooden door or plain wall; above, a window per floor with a
// stone surround, a sill, and louvred shutters, open beside it or closed over it. A cornice runs along the top, a plinth
// along the foot. A spot's side shows the spot colour: awnings over its shop windows and door, a band above them with
// its letter, and blade signs with its letter at either end; a dock's side has its opening instead of the middle bays'
// ground floor.
// Each part is { cell (facadePictures.js), x, y, z (its centre), ux, uz (along its face), size [along, up, out],
// colour, front (only the face that points out), skip (faces left out: t top, b bottom), slope (m down per m out),
// near (only drawn close up) }.
export function facadeParts(building, side, tables, spotColour) {
  const t = tables.buildings;
  const random = seeded(building.seed + side.dir);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const parts = [];
  const { length: L, ux, uz, spot, hole } = side;
  const [nx, nz] = [-uz, ux];
  // A part centred `along` m from the side's start, `y` up and `out` m out from the wall.
  const put = (cell, along, y, out, size, colour, more) => parts.push({ cell, x: side.x + ux * along + nx * out, y, z: side.z + uz * along + nz * out, ux, uz, size, colour, ...more });
  // An opening: its leaf (glass, door, shutter) `back` m out, inside a stone surround of three bars 14 cm deep.
  const opening = (cell, along, y, w, h, back, colour) => {
    put(cell, along, y, back + 0.01, [w, h, 0.02], colour, { front: true });
    surround(along, y, w, h);
  };
  // Side bars under the top bar and on the sill or ground, so their tops and bottoms never show.
  const surround = (along, y, w, h) => {
    for (const s of [-1, 1]) put('plain', along + s * (w / 2 + 0.08), y + 0.08, 0.07, [0.16, h + 0.16, 0.14], t.stone, { near: true, skip: 'tb' });
    put('plain', along, y + h / 2 + 0.08, 0.07, [w + 0.32, 0.16, 0.14], t.stone, { near: true });
  };
  const shutter = pick(t.shutters);
  const door = pick(t.doors);
  const fancy = random() < 0.4; // a cornice over the first floor's windows

  put('plain', L / 2, building.height - 0.3, 0.2, [L + 0.5, 0.6, 0.6], t.stone);
  // Its front behind the ground floor's leaves (0.08 m out): coplanar faces flickered in the prototype.
  if (hole) {
    for (const [a, b] of [[0, hole.from], [hole.to, L]]) put('plain', (a + b) / 2, 0.35, 0.03, [b - a, 0.7, 0.06], t.plinth, { skip: 'b' });
  } else put('plain', L / 2, 0.35, 0.03, [L + 0.1, 0.7, 0.06], t.plinth, { skip: 'b' });

  const bays = Math.floor((L - 1) / t.bay);
  const middle = Math.floor(bays / 2);
  for (let k = 0; k < bays; k++) {
    const along = ((k + 0.5) * L) / bays;
    if (spot) {
      const [cell, w, h, colour] = k === middle && !hole ? ['door', 1.6, 2.9, door] : ['shop', 2.2, 2.8, 0xffffff];
      if (!hole || along + w / 2 + 0.4 < hole.from || along - w / 2 - 0.4 > hole.to) {
        opening(cell, along, h / 2, w, h, 0.07, colour);
        put('plain', along, 3.05, 0.6, [w + 0.4, 0.06, 1.2], spotColour, { slope: 0.35 }); // awning
      }
    } else {
      const r = random();
      if (r < 0.6) {
        const [cell, w, h, colour] = r < 0.25 ? ['shop', 2.2, 2.8, 0xffffff] : r < 0.45 ? ['roller', 2.2, 2.8, pick(t.rollers)] : ['door', 1.6, 2.9, door];
        opening(cell, along, h / 2, w, h, 0.07, colour);
        if (cell === 'shop' && random() < 0.6) put('plain', along, h + 0.5, 0.1, [w + 0.4, 0.5, 0.06], pick(t.signs));
      }
    }
    for (let f = 1; f < building.floors; f++) {
      const y = t.groundFloor + (f - 1) * t.floor + 1.6;
      const glass = `glass${Math.floor(random() * 4)}`;
      if (random() < t.closedShutters) {
        for (const s of [-1, 1]) put('louvre', along + s * 0.275, y, 0.05, [0.55, 1.9, 0.03], shutter, { front: true });
      } else {
        put(glass, along, y, 0.01, [1.1, 1.9, 0.02], 0xffffff, { front: true });
        for (const s of [-1, 1]) put('louvre', along + s * 1.0, y, 0.035, [0.55, 1.9, 0.03], shutter, { front: true, near: true });
      }
      surround(along, y, 1.1, 1.9);
      put('plain', along, y - 1.01, 0.14, [1.6, 0.12, 0.28], t.stone, { near: true });
      if (f === 1 && fancy) put('plain', along, y + 1.25, 0.12, [1.75, 0.12, 0.24], t.stone, { near: true });
    }
  }

  if (spot) {
    // The ground floor clad in the spot colour above the plinth, a band across the top of it (over a dock's opening
    // and its frame) with the letter in the middle, and a blade sign at each end, seen from along the street.
    const signY = hole ? hole.height + 0.65 : t.groundFloor - 0.45;
    for (const [a0, a1] of hole ? [[0, hole.from - 0.2], [hole.to + 0.2, L]] : [[0, L]]) {
      put('plain', (a0 + a1) / 2, (0.7 + t.groundFloor) / 2, 0.01, [a1 - a0, t.groundFloor - 0.7, 0.02], spotColour, { front: true });
    }
    put('plain', L / 2, signY, 0.05, [L - 0.4, 0.8, 0.1], spotColour);
    put(`letter${spot.id}`, L / 2, signY, 0.1, [0.75, 0.75, 0.01], 0xffffff, { front: true });
    for (const along of [1, L - 1]) {
      const y = t.groundFloor + 1.4;
      put('plain', along, y, 0.75, [0.08, 1.2, 1.2], spotColour);
      // The letters face along the street both ways: ux, uz turned so that their front is +u and -u.
      put(`letter${spot.id}`, along + 0.045, y, 0.75, [1, 1, 0.01], 0xffffff, { front: true, ux: uz, uz: -ux });
      put(`letter${spot.id}`, along - 0.045, y, 0.75, [1, 1, 0.01], 0xffffff, { front: true, ux: -uz, uz: ux });
      put('plain', along, y + 0.63, 0.7, [0.04, 0.04, 1.4], t.plinth, { near: true }); // bracket
    }
  }
  if (hole) {
    // A frame in the spot colour round the dock's opening, and a roller door at its back above the dock edge.
    const mid = (hole.from + hole.to) / 2;
    const width = hole.to - hole.from;
    for (const s of [-1, 1]) put('plain', mid + s * (width / 2 + 0.1), hole.height / 2, 0.05, [0.2, hole.height, 0.1], spotColour);
    put('plain', mid, hole.height + 0.1, 0.05, [width + 0.4, 0.2, 0.1], spotColour);
    put('roller', mid, (t.dock.edge + hole.height) / 2, 0.01 - t.dock.depth, [width, hole.height - t.dock.edge, 0.02], t.dock.door, { front: true });
  }
  return parts;
}

// Meshes for the planned buildings, cut by `chunk` m squares of the map (by each building's middle) so that they are
// culled piece by piece: per chunk its walls (a mesh per wall material), its roofs, and its facade parts, those always
// drawn in one mesh and the `near` ones in a mesh per direction the facades face, for the renderer to draw only close
// up and from in front. `cells` are the facade pictures' places (facadePictures.js), `materials` { walls: [...], roof,
// parts }, flat-shaded: the meshes have no normals. Returns all `meshes`, and `near` as [{ mesh, dir }].
export function buildingMeshes(buildings, tables, spotColour, cells, materials) {
  const t = tables.buildings;
  const uvOf = Object.fromEntries(Object.entries(cells).map(([name, [x, y, w, h]]) => {
    // A pixel in from the cell's edges, so mipmaps don't blend in the neighbours; the canvas is flipped in v.
    const [u0, u1, v0, v1] = [(x + 1) / 1024, (x + w - 1) / 1024, 1 - (y + h - 1) / 1024, 1 - (y + 1) / 1024];
    return [name, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]];
  }));
  const plainUV = [(uvOf.plain[0][0] + uvOf.plain[1][0]) / 2, (uvOf.plain[0][1] + uvOf.plain[2][1]) / 2];
  const colour = new THREE.Color();
  const grimy = new THREE.Color();
  const lit = new THREE.Color();

  const mesh = (data, material) => {
    const m = new THREE.Mesh(toGeometry(data), material);
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const meshes = [];
  const nearMeshes = [];
  // Chunk by chunk, so only one chunk's arrays are filled at a time.
  const chunkOf = (b) => `${Math.floor((b.minX + b.maxX) / 2 / t.chunk)},${Math.floor((b.minZ + b.maxZ) / 2 / t.chunk)}`;
  for (const list of Map.groupBy(buildings, chunkOf).values()) {
    const walls = t.walls.map(() => newData());
    const roofs = newData();
    const base = newData();
    const near = DIRS.map(() => newData());
    for (const b of list) {
      lit.setHex(b.tint).multiplyScalar(b.brightness);
      grimy.copy(lit).multiplyScalar(t.grimeShade);
      const shade = (y) => grimy.clone().lerp(lit, Math.min(1, y / t.grime));
      const { repeat } = t.walls[b.wall];
      const data = walls[b.wall];
      let perimeter = b.offset[0];
      for (const side of [0, 3, 2, 1].map((dir) => b.sides[dir])) {
        const [nx, nz] = [-side.uz, side.ux];
        const at = (a, y, o = 0) => [side.x + side.ux * a + nx * o, y, side.z + side.uz * a + nz * o];
        // A piece of wall `a0`..`a1` m along and `y0`..`y1` up, split where the grime fades out.
        const piece = (a0, a1, y0, y1) => {
          const ys = y0 < t.grime && y1 > t.grime ? [y0, t.grime, y1] : [y0, y1];
          for (let i = 1; i < ys.length; i++) {
            const [ya, yb] = [ys[i - 1], ys[i]];
            const uv = (a, y) => [(perimeter + a) / repeat, (b.offset[1] + y) / repeat];
            quad(data, [at(a0, ya), at(a1, ya), at(a1, yb), at(a0, yb)], [uv(a0, ya), uv(a1, ya), uv(a1, yb), uv(a0, yb)], [shade(ya), shade(ya), shade(yb), shade(yb)]);
          }
        };
        const { hole } = side;
        if (hole) {
          piece(0, hole.from, 0, b.height);
          piece(hole.to, side.length, 0, b.height);
          piece(hole.from, hole.to, hole.height, b.height);
          // Its jambs and lintel, `depth` m deep.
          const d = t.dock.depth;
          const [h0, h1] = [hole.from, hole.to];
          const flat = (u, v) => [u / repeat, v / repeat];
          const shades = (y0, y1) => [y0, y0, y1, y1].map(shade);
          quad(data, [at(h0, 0, 0), at(h0, 0, -d), at(h0, hole.height, -d), at(h0, hole.height, 0)], [flat(0, 0), flat(d, 0), flat(d, hole.height), flat(0, hole.height)], shades(0, hole.height));
          quad(data, [at(h1, 0, -d), at(h1, 0, 0), at(h1, hole.height, 0), at(h1, hole.height, -d)], [flat(0, 0), flat(d, 0), flat(d, hole.height), flat(0, hole.height)], shades(0, hole.height));
          quad(data, [at(h0, hole.height, -d), at(h1, hole.height, -d), at(h1, hole.height, 0), at(h0, hole.height, 0)], [flat(0, 0), flat(h1 - h0, 0), flat(h1 - h0, d), flat(0, d)], shades(hole.height, hole.height));
        } else piece(0, side.length, 0, b.height);
        perimeter += side.length;
        if (!side.street) continue;
        for (const p of facadeParts(b, side, tables, spotColour)) addPart(p.near ? near[side.dir] : base, p);
      }
      const { minX, maxX, minZ, maxZ, height } = b;
      const r = t.roof.repeat;
      colour.setRGB(1, 1, 1);
      quad(roofs, [[minX, height, maxZ], [maxX, height, maxZ], [maxX, height, minZ], [minX, height, minZ]], [[minX / r, -maxZ / r], [maxX / r, -maxZ / r], [maxX / r, -minZ / r], [minX / r, -minZ / r]], [colour, colour, colour, colour]);
    }
    walls.forEach((d, i) => d.position.length && meshes.push(mesh(d, materials.walls[i])));
    meshes.push(mesh(roofs, materials.roof));
    if (base.position.length) meshes.push(mesh(base, materials.parts));
    near.forEach((d, dir) => d.position.length && nearMeshes.push({ mesh: mesh(d, materials.parts), dir }));
  }
  return { meshes: [...meshes, ...nearMeshes.map((n) => n.mesh)], near: nearMeshes };

  // A part's front with its picture, or a box of the plain patch (every box part is plain): corners from its centre `a`
  // along, `y` up and `o` out, sheared down by its slope. A box's faces share its eight corners; flat shading needs
  // no normals per face.
  function addPart(data, p) {
    const [hx, hy, ho] = p.size.map((s) => s / 2);
    const [nx, nz] = [-p.uz, p.ux];
    const at = (a, y, o) => [p.x + p.ux * a + nx * o, p.y + y - (p.slope ?? 0) * o, p.z + p.uz * a + nz * o];
    colour.setHex(p.colour);
    if (p.front) return quad(data, [at(-hx, -hy, ho), at(hx, -hy, ho), at(hx, hy, ho), at(-hx, hy, ho)], uvOf[p.cell], [colour, colour, colour, colour]);
    const first = data.position.length / 3;
    for (const o of [ho, -ho]) for (const [a, y] of [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]) vertex(data, at(a, y, o), plainUV, colour);
    // Front, ends along +a and -a, top, bottom; corners 0-3 at the front, 4-7 behind them.
    const faces = [[0, 1, 2, 3], [1, 5, 6, 2], [4, 0, 3, 7]];
    if (!p.skip?.includes('t')) faces.push([3, 2, 6, 7]);
    if (!p.skip?.includes('b')) faces.push([4, 5, 1, 0]);
    for (const [a, b, c, d] of faces) data.index.push(first + a, first + b, first + c, first + a, first + c, first + d);
  }
}

const newData = () => ({ position: [], uv: [], color: [], index: [] });

function vertex(data, [x, y, z], [u, v], colour) {
  data.position.push(x, y, z);
  data.uv.push(u, v);
  data.color.push(Math.round(colour.r * 255), Math.round(colour.g * 255), Math.round(colour.b * 255), 255);
}

// Two triangles, corners counter-clockwise seen from the front.
function quad(data, corners, uvs, colours) {
  const first = data.position.length / 3;
  for (let i = 0; i < 4; i++) vertex(data, corners[i], uvs[i], colours[i]);
  data.index.push(first, first + 1, first + 2, first, first + 2, first + 3);
}

// Colours as bytes (four, as the GPU takes them), a quarter of the memory of floats.
function toGeometry(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(data.color), 4, true));
  geometry.setIndex(data.index);
  geometry.computeBoundingBox();
  return geometry;
}
