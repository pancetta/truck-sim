// The skyline ring round the city (#42): background buildings outside the map's edge, so the city fades into haze
// instead of stopping. Numbers in tables.skyline. planSkyline decides what stands where; skylineMeshes turns that into
// two meshes, walls and roofs.
import * as THREE from 'three/webgpu';
import { seeded } from './autopilot.js';
import { newData, quad, toGeometry } from './buildings.js';

// The ring's buildings: [{ minX, maxX, minZ, maxZ, height, colour, landmark }], `landmark` null or 'dome' (with
// `radius`), 'tower' or 'arcade'. The ring is four strips round the map, north and south the full width with the
// corners; each strip is a grid of blocks `street` m apart, and each block two rows of buildings along its longer side.
// A landmark takes a block near the city at the end of a street; a tower stands among the block's buildings, on the
// street's line, the others replace them.
export function planSkyline(map, tables) {
  const t = tables.skyline;
  const random = seeded(t.seed);
  const between = ([lo, hi]) => lo + random() * (hi - lo);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const [w, h] = [map.cols * map.tileSize, map.rows * map.tileSize];
  const o = t.gap - t.street / 2; // the strips start here, so the nearest walls stand `gap` m out
  const d = t.depth;
  const strips = [
    { minX: -o - d, maxX: w + o + d, minZ: -o - d, maxZ: -o }, // north
    { minX: w + o, maxX: w + o + d, minZ: -o, maxZ: h + o }, // east
    { minX: -o - d, maxX: w + o + d, minZ: h + o, maxZ: h + o + d }, // south
    { minX: -o - d, maxX: -o, minZ: -o, maxZ: h + o }, // west
  ];
  const cells = (lo, hi) => {
    const n = Math.max(1, Math.round((hi - lo) / (t.block + t.street)));
    return Array.from({ length: n }, (_, i) => [lo + ((hi - lo) * i) / n + t.street / 2, lo + ((hi - lo) * (i + 1)) / n - t.street / 2]);
  };
  // m from a box to the map, along x or z, whichever is further.
  const away = (b) => Math.max(-b.maxX, b.minX - w, -b.maxZ, b.minZ - h);
  const sides = strips.map((s) => cells(s.minX, s.maxX).flatMap(([minX, maxX]) => cells(s.minZ, s.maxZ).map(([minZ, maxZ]) => ({ minX, maxX, minZ, maxZ }))));

  // Per side, m along it of the streets that run out to its edge road: a landmark stands at the end of one, so it shows
  // over the city's outer row down that street instead of hiding behind the buildings along it.
  const ts = map.tileSize;
  const lines = (n, isStreet) => Array.from({ length: n }, (_, i) => i).filter(isStreet).map((i) => (i + 0.5) * ts);
  const streets = [
    lines(map.cols, (c) => map.isRoad(c, 1) && map.isRoad(c, 2)),
    lines(map.rows, (r) => map.isRoad(map.cols - 2, r) && map.isRoad(map.cols - 3, r)),
    lines(map.cols, (c) => map.isRoad(c, map.rows - 2) && map.isRoad(c, map.rows - 3)),
    lines(map.rows, (r) => map.isRoad(1, r) && map.isRoad(2, r)),
  ];
  const along = (b, side) => (side % 2 ? [b.minZ, b.maxZ] : [b.minX, b.maxX]);
  // The street nearest a block's middle, and how far off the middle it is.
  const streetBy = (b, side) => {
    const [lo, hi] = along(b, side);
    return streets[side].reduce((best, s) => (Math.abs(s - (lo + hi) / 2) < Math.abs(best - (lo + hi) / 2) ? s : best), Infinity);
  };
  const off = (b, side) => Math.abs(streetBy(b, side) - (along(b, side)[0] + along(b, side)[1]) / 2);
  const landmarkAt = new Map();
  t.landmarks.forEach((kind, i) => {
    const side = i % 4;
    const free = sides[side].filter((b) => away(b) < t.near && !landmarkAt.has(b));
    const nearest = Math.min(...free.map((b) => off(b, side)));
    const best = free.filter((b) => off(b, side) <= Math.max(nearest, t.block / 4));
    if (best.length) landmarkAt.set(pick(best), { kind, side });
  });

  const buildings = [];
  const add = (box, height, tint, landmark = null, more = {}) => {
    const colour = new THREE.Color(tint).multiplyScalar(between(t.brightness)).getHex();
    buildings.push({ ...box, height, colour, landmark, ...more });
  };
  const storeys = ([lo, hi]) => lo + Math.floor(random() * (hi - lo + 1));
  for (const block of sides.flat()) {
    const { kind, side } = landmarkAt.get(block) ?? {};
    if (kind === 'dome') {
      const radius = Math.min(between(t.dome.radius), Math.min(block.maxX - block.minX, block.maxZ - block.minZ) / 2 - 2);
      add(block, t.dome.floors * t.floor, t.stone, 'dome', { radius });
      continue;
    }
    if (kind === 'arcade') {
      add(block, t.arcade.floors * t.floor, t.stone, 'arcade');
      continue;
    }
    if (kind === 'tower') {
      // On the street's line, kept inside the block.
      const s = t.tower.side / 2;
      const [lo, hi] = along(block, side);
      const on = Math.min(Math.max(streetBy(block, side), lo + s), hi - s);
      const [x, z] = side % 2 ? [(block.minX + block.maxX) / 2, on] : [on, (block.minZ + block.maxZ) / 2];
      add({ minX: x - s, maxX: x + s, minZ: z - s, maxZ: z + s }, between(t.tower.height), t.stone, 'tower');
    }
    // Two rows of buildings back to back along the block's longer side, each cut at random widths with no sliver at
    // the end.
    const alongX = block.maxX - block.minX >= block.maxZ - block.minZ;
    const [lo, hi] = alongX ? [block.minX, block.maxX] : [block.minZ, block.maxZ];
    const [a, b] = alongX ? [block.minZ, block.maxZ] : [block.minX, block.maxX];
    for (const [r0, r1] of [[a, (a + b) / 2], [(a + b) / 2, b]]) {
      const cut = (from, to) => add(alongX ? { minX: from, maxX: to, minZ: r0, maxZ: r1 } : { minX: r0, maxX: r1, minZ: from, maxZ: to }, storeys(t.floors) * t.floor, pick(t.tints));
      let from = lo;
      while (hi - from > t.width[1]) {
        let width = between(t.width);
        if (hi - from - width < t.width[0]) width = (hi - from) / 2;
        cut(from, from + width);
        from += width;
      }
      cut(from, hi);
    }
  }
  return buildings;
}

// The ring as two meshes: `walls` with the window picture (paintSkylineWindows) tinted by vertex colour, and `roofs`.
// No normals (flat shading), no shadows either way, and drawn after the city, so its depth test skips what the city
// hides. `materials` is { walls, roof }.
export function skylineMeshes(buildings, tables, materials) {
  const t = tables.skyline;
  const repeat = tables.buildings.roof.repeat;
  const walls = newData();
  const roofs = newData();
  const colour = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  const roofUV = ([x, , z]) => [x / repeat, -z / repeat];
  const plain = () => [0.02, 0.02]; // a corner of the window picture: bare wall

  // The four walls round a box from y0 to y1, facing out, each from its start corner to its end, seen from outside left
  // to right (as buildings.js). `uv(a, y, length)` maps a point `a` (0..1) along a wall of `length` m to the picture.
  const box = (b, y0, y1, uv) => {
    const corners = [[b.maxX, b.minZ], [b.minX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]];
    corners.forEach(([x0, z0], i) => {
      const [x1, z1] = corners[(i + 1) % 4];
      const length = Math.hypot(x1 - x0, z1 - z0);
      quad(walls, [[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]], [uv(0, y0, length), uv(1, y0, length), uv(1, y1, length), uv(0, y1, length)], [colour, colour, colour, colour]);
    });
  };
  // Whole windows: as many bays as fit, a row per storey from the ground.
  const windows = (a, y, length) => [a * Math.max(1, Math.round(length / t.bay)), y / t.floor];
  const flat = (b, y, data = roofs) => {
    const corners = [[b.minX, y, b.maxZ], [b.maxX, y, b.maxZ], [b.maxX, y, b.minZ], [b.minX, y, b.minZ]];
    const c = data === roofs ? white : colour;
    quad(data, corners, data === roofs ? corners.map(roofUV) : corners.map(plain), [c, c, c, c]);
  };
  // A hipped roof on a box at y, rising `pitch` m per m, its ridge along the longer side; on a square, a pyramid.
  const hipped = (b, y, pitch) => {
    const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
    const half = (alongX ? b.maxZ - b.minZ : b.maxX - b.minX) / 2;
    const [cx, cz, top] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, y + half * pitch];
    const ridge = alongX ? [[b.minX + half, top, cz], [b.maxX - half, top, cz]] : [[cx, top, b.minZ + half], [cx, top, b.maxZ - half]];
    const nearest = ([x, , z]) => ridge.reduce((p, q) => (Math.hypot(q[0] - x, q[2] - z) < Math.hypot(p[0] - x, p[2] - z) ? q : p));
    const corners = [[b.maxX, y, b.minZ], [b.minX, y, b.minZ], [b.minX, y, b.maxZ], [b.maxX, y, b.maxZ]];
    const slope = Math.hypot(1, pitch); // m up the roof per m across
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % 4];
      const face = [p, q, nearest(q), nearest(p)]; // a triangle where both ends meet the same ridge point
      // Tile courses along the eaves, on every face: u along the eave, v up the slope.
      const [ex, ez] = [(q[0] - p[0]) / Math.hypot(q[0] - p[0], q[2] - p[2]), (q[2] - p[2]) / Math.hypot(q[0] - p[0], q[2] - p[2])];
      const uv = ([x, , z]) => [((x - p[0]) * ex + (z - p[2]) * ez) / repeat, (((x - p[0]) * ez - (z - p[2]) * ex) * slope) / repeat];
      quad(roofs, face, face.map(uv), [white, white, white, white]);
    });
  };

  for (const b of buildings) {
    colour.setHex(b.colour);
    if (b.landmark === 'tower') {
      const { belfry, pitch } = t.tower;
      box(b, 0, b.height - belfry, plain);
      // One opening a side: the picture's window stretched over the belfry.
      box(b, b.height - belfry, b.height, (a, y) => [a, (y - b.height + belfry) / belfry]);
      hipped(b, b.height, pitch);
      continue;
    }
    box(b, 0, b.height, windows);
    if (b.landmark === 'dome') dome(b);
    else if (b.landmark === 'arcade') arcade(b);
    else hipped(b, b.height, t.roofPitch);
  }
  return [toGeometry(walls), toGeometry(roofs)].map((geometry, i) => {
    const mesh = new THREE.Mesh(geometry, i ? materials.roof : materials.walls);
    mesh.renderOrder = 0.5; // after the city, before the ground (renderer.js)
    return mesh;
  });

  // A flat-roofed base, a drum with windows in the middle, a dome of tiles on it, and a small lantern on top.
  function dome(b) {
    flat(b, b.height);
    const [x, z, r] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.radius];
    const [n, rings] = [16, 6];
    const y0 = b.height + t.dome.drum;
    // Round the circle clockwise from above, so each piece runs left to right seen from outside.
    const at = (i, radius, y) => [x + radius * Math.cos((-2 * Math.PI * i) / n), y, z + radius * Math.sin((-2 * Math.PI * i) / n)];
    const bays = Math.round((2 * Math.PI * r) / t.bay);
    for (let i = 0; i < n; i++) {
      const uv = (k, y) => [((i + k) / n) * bays, (y - b.height) / t.dome.drum]; // a row of windows round the drum
      quad(walls, [at(i, r, b.height), at(i + 1, r, b.height), at(i + 1, r, y0), at(i, r, y0)], [uv(0, b.height), uv(1, b.height), uv(1, y0), uv(0, y0)], [colour, colour, colour, colour]);
      for (let k = 0; k < rings; k++) {
        const [a0, a1] = [(k * Math.PI) / 2 / rings, ((k + 1) * Math.PI) / 2 / rings];
        const p = (j, a) => at(j, r * Math.cos(a), y0 + r * Math.sin(a));
        const uv = (j, a) => [(((i + j) / n) * 2 * Math.PI * r) / repeat, (a * r) / repeat];
        quad(roofs, [p(i, a0), p(i + 1, a0), p(i + 1, a1), p(i, a1)], [uv(0, a0), uv(1, a0), uv(1, a1), uv(0, a1)], [white, white, white, white]);
      }
    }
    const s = (r * t.dome.lantern) / 2;
    const lantern = { minX: x - s, maxX: x + s, minZ: z - s, maxZ: z + s };
    box(lantern, y0 + r - 0.5, y0 + r + 2 * s, plain);
    hipped(lantern, y0 + r + 2 * s, t.dome.pitch);
  }

  // A base with an open arcade on its roof: piers along every side, a slab over them, and a hipped roof.
  function arcade(b) {
    const { height, pitch, pier, slab } = t.arcade;
    const [y0, y1] = [b.height, b.height + height];
    flat(b, y0, walls);
    const corners = [[b.maxX, b.minZ], [b.minX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]];
    corners.forEach(([x0, z0], i) => {
      const [x1, z1] = corners[(i + 1) % 4];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / pitch));
      for (let k = 0; k < n; k++) {
        // Each pier just inside the edge, the first of each side on its corner.
        const [px, pz] = [x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n];
        const [cx, cz] = [Math.min(Math.max(px, b.minX + pier / 2), b.maxX - pier / 2), Math.min(Math.max(pz, b.minZ + pier / 2), b.maxZ - pier / 2)];
        box({ minX: cx - pier / 2, maxX: cx + pier / 2, minZ: cz - pier / 2, maxZ: cz + pier / 2 }, y0, y1, plain);
      }
    });
    box(b, y1, y1 + slab, plain);
    // The slab's underside, facing down.
    const under = [[b.minX, y1, b.minZ], [b.maxX, y1, b.minZ], [b.maxX, y1, b.maxZ], [b.minX, y1, b.maxZ]];
    quad(walls, under, under.map(plain), [colour, colour, colour, colour]);
    hipped(b, y1 + slab, t.roofPitch);
  }
}

// The ring's window picture, our own: a window bay one storey high (tables.skyline bay × floor), a dark window in a
// stone surround with open shutters and a sill, on white wall that the vertex colour tints. Repeated over the walls.
export function paintSkylineWindows() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ece7dd';
  g.fillRect(20, 14, 24, 36); // surround
  g.fillStyle = '#2a3038';
  g.fillRect(23, 17, 18, 31); // glass
  g.fillStyle = '#8f9a86';
  g.fillRect(12, 17, 8, 31); // shutters, tinted with the wall
  g.fillRect(44, 17, 8, 31);
  g.fillStyle = '#d8d2c6';
  g.fillRect(18, 50, 28, 3); // sill
  const map = new THREE.CanvasTexture(canvas);
  Object.assign(map, { colorSpace: THREE.SRGBColorSpace, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: 4 });
  return map;
}
