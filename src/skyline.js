// The skyline ring round the city (#42): background buildings outside the map's edge, so the city fades into haze
// instead of stopping. Numbers in tables.skyline. ringMeshes draws the real buildings round the map (#66) as two
// meshes, walls and roofs.
import * as THREE from 'three/webgpu';
import { seeded } from './autopilot.js';
import { newData, quad, toGeometry, vertex } from './buildings.js';

// The real ring round the map (#66): the buildings in public/maps/monti-ring.json, OSM outlines in m, as the
// prototype made them ([{ r: [[x, z]], h?: courtyards, top, base (m), dome?, stone? }]; see scripts/maps.js). Two
// meshes: `walls` from `base` to `top`, with the window picture (paintSkylineWindows) in one of the tints (on churches
// and monuments, in stone and stretched into tall arches), and flat `roofs`, with a dome where OSM has one (`dome` its
// height, or true for a half sphere). No normals (flat shading), no shadows either way, and drawn after the city, so
// its depth test skips what the city hides. `materials` is { walls, roof }.
export function ringMeshes(items, tables, materials) {
  const t = tables.skyline;
  const random = seeded(t.seed);
  const repeat = tables.buildings.roof.repeat;
  const walls = newData();
  const roofs = newData();
  const colour = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  const clockwise = (ring) => THREE.ShapeUtils.isClockWise(ring.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const b of items) {
    colour.setHex(b.stone ? t.stone : t.tints[Math.floor(random() * t.tints.length)]).multiplyScalar(t.brightness[0] + random() * (t.brightness[1] - t.brightness[0]));
    // The outline clockwise and the courtyards not, so the walls face out of the building, as in buildings.js.
    const outer = clockwise(b.r) ? b.r : b.r.toReversed();
    const holes = (b.h ?? []).map((h) => (clockwise(h) ? h.toReversed() : h));
    const [bay, floor] = b.stone ? t.monument : [t.bay, t.floor];
    const uv = (along, y) => [along / bay, y / floor];
    for (const ring of [outer, ...holes]) {
      let along = 0; // m round the ring, so the windows run on round its corners
      ring.forEach(([x0, z0], k) => {
        const [x1, z1] = ring[(k + 1) % ring.length];
        const next = along + Math.hypot(x1 - x0, z1 - z0);
        quad(walls, [[x0, b.base, z0], [x1, b.base, z1], [x1, b.top, z1], [x0, b.top, z0]], [uv(along, b.base), uv(next, b.base), uv(next, b.top), uv(along, b.top)], [colour, colour, colour, colour]);
        along = next;
      });
    }
    // The roof's triangles, each turned to face up.
    const points = [...outer, ...holes.flat()];
    const first = roofs.position.length / 3;
    for (const [x, z] of points) vertex(roofs, [x, b.top, z], [x / repeat, -z / repeat], white);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer.map(([x, z]) => new THREE.Vector2(x, z)), holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))))) {
      const [p, q, o] = [points[i], points[j], points[k]];
      const up = (q[0] - p[0]) * (o[1] - p[1]) - (q[1] - p[1]) * (o[0] - p[0]) < 0;
      roofs.index.push(first + i, ...(up ? [first + j, first + k] : [first + k, first + j]));
    }
    if (b.dome) dome(b);
  }
  return [toGeometry(walls), toGeometry(roofs)].map((geometry, i) => {
    const mesh = new THREE.Mesh(geometry, i ? materials.roof : materials.walls);
    mesh.renderOrder = 0.5; // after the city, before the ground (renderer.js)
    return mesh;
  });

  // A dome on the roof, as wide as the outline's area allows, in the roof's tiles.
  function dome(b) {
    const area = Math.abs(b.r.reduce((sum, [x, z], k) => sum + x * b.r[(k + 1) % b.r.length][1] - b.r[(k + 1) % b.r.length][0] * z, 0)) / 2;
    const r = Math.sqrt(area / Math.PI);
    const h = b.dome === true ? r : b.dome;
    const [x, z] = b.r.reduce(([sx, sz], [px, pz]) => [sx + px / b.r.length, sz + pz / b.r.length], [0, 0]);
    const [n, rings] = [16, 6];
    // Round the circle clockwise from above, so each piece runs left to right seen from outside.
    const p = (i, a) => [x + r * Math.cos(a) * Math.cos((-2 * Math.PI * i) / n), b.top + h * Math.sin(a), z + r * Math.cos(a) * Math.sin((-2 * Math.PI * i) / n)];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < rings; k++) {
        const [a0, a1] = [(k * Math.PI) / 2 / rings, ((k + 1) * Math.PI) / 2 / rings];
        const uv = (j, a) => [(((i + j) / n) * 2 * Math.PI * r) / repeat, (a * r) / repeat];
        quad(roofs, [p(i, a0), p(i + 1, a0), p(i + 1, a1), p(i, a1)], [uv(0, a0), uv(1, a0), uv(1, a1), uv(0, a1)], [white, white, white, white]);
      }
    }
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
