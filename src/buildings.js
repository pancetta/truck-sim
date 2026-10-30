// Procedural buildings on the map's building outlines (#39, #65), in the style of the Monti prototype (ADR 0001),
// numbers in tables.buildings. planBuildings and facadeParts decide what stands where; buildingMeshes turns that into
// meshes.
import * as THREE from 'three/webgpu';
import { seeded } from './sim/sim.js';
import { ATLAS } from './facadePictures.js';
import { createCells } from './sim/cells.js';
import { inside } from './sim/sim.js';

// The four directions facades are sorted by, as [dx, dz]: north (-z), east, south, west.
export const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

// Half the width of a dock's edge: the bay the docking check allows for the truck, the widest Vehicle that docks, and
// 0.5 m each side.
export const dockHalf = (tables) => tables.fleet.truck.width / 2 + tables.orders.dockCentre + 0.5;

// A building's look: its `height`, `wall` (index into tables.buildings.walls), `tint`, `brightness`,
// `offset` (m, of the wall texture) and `seed` (for its facades), drawn from `random`.
function look(tables, random, height) {
  const t = tables.buildings;
  let r = random();
  const drawn = t.walls.findIndex((w) => (r -= w.share) < 0);
  const wall = drawn < 0 ? t.walls.length - 1 : drawn; // the shares' rounding
  return {
    height,
    wall,
    tint: t.walls[wall].tinted ? t.tints[Math.floor(random() * t.tints.length)] : 0xffffff,
    brightness: t.brightness[0] + random() * (t.brightness[1] - t.brightness[0]),
    offset: [random() * 20, random() * 20],
    seed: Math.floor(random() * 2 ** 32),
  };
}

// Ground height at (x, z), off the road, on the terrain: the raised pavement within tables.osm.pavement m of a road's
// edge, else open ground (pedestrian paving, a pedestrian edge's too, is only 3 cm up).
export function groundAt(map, tables, x, z) {
  let p = map.graph.nearest(x, z);
  // A pedestrian edge is flush, but a road's pavement may still lie beside it under (x, z).
  if (p.edge.pedestrian) p = map.graph.edges.filter((e) => !e.pedestrian).map((e) => map.graph.project(e, x, z)).reduce((a, b) => (b.d < a.d ? b : a));
  return map.heightAt(x, z) + (p.d <= p.edge.width / 2 + tables.osm.pavement ? tables.streets.pavement.height : 0);
}

// The city's buildings, one per outline (map.buildings, cut back from the roads), with the height from the map. Each
// has its footprint's box and `points`, turned so its sides run with the outside to their left, `height`, the look
// (see look()), its flat `roof`'s height and a side per wall from each corner to the next; `dir` is the DIRS direction
// nearest to the way it faces. A side is a street side unless another building stands against it: a party wall, left
// blank. Spots are on the street (the spot table), so no building is a spot's and none has a dock opening: a dock's
// edge stands on its own (see the renderer's dock bays).
// On a slope (#107) a side steps with the ground: `grounds` is the pavement's height (groundAt) in front of each window
// bay (one for a side too short for any), and `runs` cut it into whole bays `from`..`to` (`a0`..`a1` m along) whose
// grounds lie at most `step` apart. A run's floors stand at its `level`, the middle of those, and its wall reaches from
// `foot`, under the open ground all along it, up to the roof, `height` over the highest run's level.
export function planBuildings(map, tables) {
  const t = tables.buildings;
  const under = tables.drape.open + tables.drape.sink; // the open ground's lowest, under the terrain
  const random = seeded(t.seed);
  const index = createCells(tables.city.cell);
  const buildings = map.buildings.map(({ points, height }) => {
    // Without corners within a centimetre of the next, whose side would face any way.
    const corners = points.filter((p, k) => Math.hypot(points[(k + 1) % points.length].x - p.x, points[(k + 1) % points.length].z - p.z) > 0.01);
    const ring = THREE.ShapeUtils.isClockWise(corners.map((p) => new THREE.Vector2(p.x, p.z))) ? corners : corners.toReversed();
    const [xs, zs] = [ring.map((p) => p.x), ring.map((p) => p.z)];
    const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), points: ring, ...look(tables, random, height) };
    index.add(b, b.minX, b.minZ, b.maxX, b.maxZ);
    return b;
  });
  const against = (own, x, z) => index.some(x, z, x, z, (b) => b !== own && inside(x, z, b.points));
  for (const b of buildings) {
    const ring = b.points;
    b.sides = ring.map((p, index) => {
      const q = ring[(index + 1) % ring.length];
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      const [ux, uz] = [(q.x - p.x) / length, (q.z - p.z) / length];
      const [nx, nz] = [-uz, ux];
      const dir = DIRS.reduce((best, [dx, dz], d) => (dx * nx + dz * nz > DIRS[best][0] * nx + DIRS[best][1] * nz ? d : best), 0);
      const street = !against(b, (p.x + q.x) / 2 + nx * 0.5, (p.z + q.z) / 2 + nz * 0.5);
      const n = Math.max(1, Math.floor((length - 1) / t.bay)); // as facadeParts lays the bays out
      const grounds = Array.from({ length: n }, (_, k) => {
        const a = ((k + 0.5) * length) / n;
        return groundAt(map, tables, p.x + ux * a + nx * 0.5, p.z + uz * a + nz * 0.5);
      });
      const runs = [];
      for (let k = 0; k < n; k++) {
        const run = runs.at(-1);
        const [lo, hi] = run ? [Math.min(run.lo, grounds[k]), Math.max(run.hi, grounds[k])] : [];
        if (run && hi - lo <= t.step) Object.assign(run, { to: k + 1, lo, hi });
        else runs.push({ from: k, to: k + 1, lo: grounds[k], hi: grounds[k] });
      }
      return {
        x: p.x, z: p.z, ux, uz, length, dir, index, street, grounds,
        runs: runs.map(({ from, to, lo, hi }) => {
          const [a0, a1, level] = [(from * length) / n, (to * length) / n, (lo + hi) / 2];
          let low = level;
          for (let a = a0; a < a1 + 0.5; a += 0.5) low = Math.min(low, map.heightAt(p.x + ux * Math.min(a, a1), p.z + uz * Math.min(a, a1)));
          return { from, to, a0, a1, level, foot: low - under };
        }),
      };
    });
    b.roof = Math.max(...b.sides.flatMap((s) => s.runs.map((r) => r.level))) + b.height;
  }
  return buildings;
}

// The parts on one street side of a building, in the prototype's style. Per window bay: on the ground floor a shop
// window (some with a sign), a pulled-down shop shutter, a wooden door or plain wall, standing on the pavement in front
// of it; above, a window per floor with a stone surround, a sill, and louvred shutters, open beside it or closed over
// it, as many floors as fit under the roof from its run's level. A cornice runs along the top, a plinth per run along
// the foot.
// Each part is { cell (facadePictures.js), x, y, z (its centre), ux, uz (along its face), size [along, up, out],
// colour, front (only the face that points out), skip (faces left out: t top, b bottom), slope (m down per m out),
// near (only drawn close up) }.
export function facadeParts(building, side, tables) {
  const t = tables.buildings;
  const random = seeded(building.seed + side.index);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const parts = [];
  const { length: L, ux, uz } = side;
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

  // Half a metre past each end, so two cornices meet in full at a corner.
  put('plain', L / 2, building.roof - 0.3, 0.2, [L + 1, 0.6, 0.6], t.stone);
  for (const run of side.runs) {
    const { level, foot } = run;
    // From the wall's foot, its front behind the ground floor's leaves (0.08 m out): coplanar faces flickered in the
    // prototype.
    const [p0, p1] = [run.from ? run.a0 : -0.05, run === side.runs.at(-1) ? L + 0.05 : run.a1];
    put('plain', (p0 + p1) / 2, (foot + level + 0.7) / 2, 0.03, [p1 - p0, level + 0.7 - foot, 0.06], t.plinth, { skip: 'b' });
  }

  const bays = Math.floor((L - 1) / t.bay);
  for (let k = 0; k < bays; k++) {
    const along = ((k + 0.5) * L) / bays;
    const { level } = side.runs.find((run) => k < run.to);
    const ground = side.grounds[k];
    // As many as fit under the roof: more down the slope, under its level cornice.
    const floors = Math.max(1, Math.floor((building.roof - level - t.groundFloor - t.parapet) / t.floor) + 1);
    const r = random();
    if (r < 0.6) {
      const [cell, w, h, colour] = r < 0.25 ? ['shop', 2.2, 2.8, 0xffffff] : r < 0.45 ? ['roller', 2.2, 2.8, pick(t.rollers)] : ['door', 1.6, 2.9, door];
      opening(cell, along, ground + h / 2, w, h, 0.07, colour);
      if (cell === 'shop' && random() < 0.6) put('plain', along, ground + h + 0.5, 0.1, [w + 0.4, 0.5, 0.06], pick(t.signs));
    }
    for (let f = 1; f < floors; f++) {
      const y = level + t.groundFloor + (f - 1) * t.floor + 1.6;
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

  return parts;
}

// Meshes for the planned buildings, cut by `chunk` m squares of the map (by each building's middle) so that they are
// culled piece by piece: per chunk its walls (a mesh per wall material), its roofs, and its facade parts, those always
// drawn in one mesh and the `near` ones in a mesh per direction the facades face, for the renderer to draw only close
// up and from in front. `cells` are the facade pictures' places (facadePictures.js), `materials` { walls: [...], roof,
// parts }, flat-shaded: the meshes have no normals. Returns all `meshes`, and `near` as [{ mesh, dir }]. The roofs
// are flat, on the outlines; each wall runs from its runs' feet to the roof (see planBuildings).
export function buildingMeshes(buildings, tables, cells, materials) {
  const t = tables.buildings;
  const uvOf = Object.fromEntries(Object.entries(cells).map(([name, [x, y, w, h]]) => {
    // A pixel in from the cell's edges, so mipmaps don't blend in the neighbours; the canvas is flipped in v.
    const [u0, u1, v0, v1] = [(x + 1) / ATLAS, (x + w - 1) / ATLAS, 1 - (y + h - 1) / ATLAS, 1 - (y + 1) / ATLAS];
    return [name, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]];
  }));
  const plainUV = [(uvOf.plain[0][0] + uvOf.plain[1][0]) / 2, (uvOf.plain[0][1] + uvOf.plain[2][1]) / 2];
  const colour = new THREE.Color();
  const grimy = new THREE.Color();
  const lit = new THREE.Color();

  const mesh = (data, material, castShadow = true) => {
    const m = new THREE.Mesh(toGeometry(data), material);
    Object.assign(m, { castShadow, receiveShadow: true });
    return m;
  };
  const meshes = [];
  const nearMeshes = [];
  // Chunk by chunk, so only one chunk's arrays are filled at a time.
  const chunkOf = (b) => `${Math.floor((b.minX + b.maxX) / 2 / t.chunk)},${Math.floor((b.minZ + b.maxZ) / 2 / t.chunk)}`;
  const byChunk = new Map();
  for (const b of buildings) {
    const key = chunkOf(b);
    (byChunk.get(key) ?? byChunk.set(key, []).get(key)).push(b);
  }
  for (const list of byChunk.values()) {
    const walls = t.walls.map(() => newData());
    const roofs = newData();
    const base = newData();
    // Near parts by the DIRS direction nearest the way their facade faces, and by `nearChunk` m square, as most of a
    // chunk's lie further away than detailDistance.
    const near = new Map();
    const nearOf = (b, dir) => {
      const key = `${Math.floor((b.minX + b.maxX) / 2 / t.nearChunk)},${Math.floor((b.minZ + b.maxZ) / 2 / t.nearChunk)},${dir}`;
      return (near.get(key) ?? near.set(key, { data: newData(), dir }).get(key)).data;
    };
    for (const b of list) {
      lit.setHex(b.tint).multiplyScalar(b.brightness);
      grimy.copy(lit).multiplyScalar(t.grimeShade);
      const { repeat } = t.walls[b.wall];
      const data = walls[b.wall];
      let perimeter = b.offset[0];
      // Round the building, so the wall texture runs on from side to side.
      for (const side of b.sides) {
        const at = (a, y) => [side.x + side.ux * a, y, side.z + side.uz * a];
        // Each run's wall, split where the grime fades out `grime` m over its level.
        for (const { a0, a1, level, foot } of side.runs) {
          const shade = (y) => grimy.clone().lerp(lit, THREE.MathUtils.clamp((y - level) / t.grime, 0, 1));
          const ys = level + t.grime < b.roof ? [foot, level + t.grime, b.roof] : [foot, b.roof];
          for (let i = 1; i < ys.length; i++) {
            const [ya, yb] = [ys[i - 1], ys[i]];
            const uv = (a, y) => [(perimeter + a) / repeat, (b.offset[1] + y) / repeat];
            quad(data, [at(a0, ya), at(a1, ya), at(a1, yb), at(a0, yb)], [uv(a0, ya), uv(a1, ya), uv(a1, yb), uv(a0, yb)], [shade(ya), shade(ya), shade(yb), shade(yb)]);
          }
        }
        perimeter += side.length;
        if (!side.street) continue;
        for (const p of facadeParts(b, side, tables)) addPart(p.near ? nearOf(b, side.dir) : base, p);
      }
      // The roof: the outline's triangles, each turned to face up.
      const r = t.roof.repeat;
      colour.setRGB(1, 1, 1);
      const first = roofs.position.length / 3;
      for (const p of b.points) vertex(roofs, [p.x, b.roof, p.z], [p.x / r, -p.z / r], colour);
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(b.points.map((p) => new THREE.Vector2(p.x, p.z)), [])) {
        const [p, q, o] = [b.points[i], b.points[j], b.points[k]];
        const up = (q.x - p.x) * (o.z - p.z) - (q.z - p.z) * (o.x - p.x) < 0;
        roofs.index.push(first + i, ...(up ? [first + j, first + k] : [first + k, first + j]));
      }
    }
    walls.forEach((d, i) => d.position.length && meshes.push(mesh(d, materials.walls[i])));
    meshes.push(mesh(roofs, materials.roof));
    if (base.position.length) meshes.push(mesh(base, materials.parts));
    // The near parts cast no shadow: in the shadow map they held the iPad simulator under 60 fps at any resolution.
    for (const { data, dir } of near.values()) nearMeshes.push({ mesh: mesh(data, materials.parts, false), dir });
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

export const newData = () => ({ position: [], uv: [], color: [], index: [] });

export function vertex(data, [x, y, z], [u, v], colour) {
  data.position.push(x, y, z);
  data.uv.push(u, v);
  data.color.push(Math.round(colour.r * 255), Math.round(colour.g * 255), Math.round(colour.b * 255), 255);
}

// Two triangles, corners counter-clockwise seen from the front.
export function quad(data, corners, uvs, colours) {
  const first = data.position.length / 3;
  for (let i = 0; i < 4; i++) vertex(data, corners[i], uvs[i], colours[i]);
  data.index.push(first, first + 1, first + 2, first, first + 2, first + 3);
}

// Colours as bytes (four, as the GPU takes them), a quarter of the memory of floats.
export function toGeometry(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(data.color), 4, true));
  geometry.setIndex(data.index);
  geometry.computeBoundingBox();
  return geometry;
}
