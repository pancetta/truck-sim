// An OSM map's ground (#65): the road surface along the road graph's edges, with junction surfaces, and raised
// pavements with stone kerbs along every road edge and over the pedestrian ways and squares. Both come from the same
// convex road pieces: a pavement is what is left of its strip once every road piece is cut out of it, so it stops
// exactly where the road surface starts and never covers a lane.
import * as THREE from 'three/webgpu';
import { subtract } from './sim/osm.js';
import { createCells } from './sim/cells.js';
import { inside } from './sim/sim.js';
import { quads } from './streets.js';
import { pavementPieces, pedestrianPieces } from './sim/paved.js';

const { ShapeUtils } = THREE;
const xz = (ring) => ring.map(([x, z]) => ({ x, z }));
const bounds = (ring) => [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))];
const area2 = (ring) => ring.reduce((s, [x, z], i) => s + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * z, 0);

// The road surface at height y, facing up; no UVs.
export function roadSurface(pieces, y) {
  const pos = [];
  for (const { ring } of pieces) {
    const up = area2(ring) < 0; // counter-clockwise seen from above (+y)
    for (let k = 1; k < ring.length - 1; k++) {
      const [a, b, c] = up ? [ring[0], ring[k], ring[k + 1]] : [ring[0], ring[k + 1], ring[k]];
      pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// The pavements: `tables.osm.pavement` m wide strips along both sides of every edge and round its points, less the road
// `pieces`. Returns `tops`, rings of [x, z] counter-clockwise seen from above (they overlap where strips meet, and draw
// alike there), and their outline's `kerbs`, the sides along the road, and `backs`, the sides on open ground, each
// { a, b, out } with `out` the unit normal away from the pavement; sides inside another top are neither. Also `flush`,
// the pedestrian ways (`tables.osm.pedestrian` m wide) and squares less the road, paved level with it: OSM's squares
// stop short of our pavements, and raised they left a trench of bare ground between the two.
export function osmPavements(map, pieces, tables) {
  const { pavement: width, pedestrian } = tables.osm;
  const { cell } = tables.city;
  const sources = pavementPieces(map.graph, width);
  const squares = pedestrianPieces(map.pedestrian, pedestrian);

  const roads = createCells(cell);
  for (const piece of pieces) roads.add(piece, ...bounds(piece.ring));
  const onRoad = (x, z) => roads.some(x, z, x, z, (r) => inside(x, z, r.points));
  const offRoad = (list) => list.filter(Boolean).flatMap((source) => {
    const near = new Set();
    roads.some(...bounds(source), (r) => void near.add(r));
    // Boxes first: a disc wholly inside what is left of a strip would leave a hole (see minus), which a box through
    // it first prevents.
    let parts = [source];
    for (const r of [...near].sort((p, q) => p.round - q.round)) parts = parts.flatMap((p) => minus(p, r));
    return parts.filter((p) => p.length > 2 && Math.abs(area2(p)) > 1e-4).map((p) => (area2(p) < 0 ? p.toReversed() : p));
  });
  const tops = offRoad(sources);

  const paved = createCells(cell);
  const topPoints = tops.map(xz);
  topPoints.forEach((points, i) => paved.add(points, ...bounds(tops[i])));
  const kerbs = [];
  const backs = [];
  tops.forEach((ring, i) => {
    ring.forEach((p, k) => {
      const q = ring[(k + 1) % ring.length];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l < 1e-3) return;
      const out = [(q[1] - p[1]) / l, -(q[0] - p[0]) / l]; // right of p→q, the outside of a counter-clockwise ring
      const [x, z] = [(p[0] + q[0]) / 2 + out[0] * 0.05, (p[1] + q[1]) / 2 + out[1] * 0.05];
      const side = { a: p, b: q, out };
      if (onRoad(x, z)) kerbs.push(side);
      else if (!paved.some(x, z, x, z, (points) => points !== topPoints[i] && inside(x, z, points))) backs.push(side);
    });
  });
  return { tops, kerbs, backs, flush: offRoad(squares) };
}

// Ring p less the convex road piece r. A p within r is gone, even where its corners lie on r's outline (subtract()
// judges that by one corner). Where r lies wholly inside p, which subtract() can't cut (a hole), p is first split in
// two along a line through r's middle.
function minus(p, { ring: r }) {
  const turn = Math.sign(area2(r));
  const within = ([x, z]) => r.every((a, k) => {
    const b = r[(k + 1) % r.length];
    return turn * ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])) >= -0.01 * Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  if (p.every(within)) return [];
  const outline = xz(p);
  if (!r.every(([x, z]) => inside(x, z, outline))) return subtract(p, r);
  const [minX, minZ, maxX, maxZ] = bounds(p);
  const middle = r.reduce((s, c) => s + c[1], 0) / r.length;
  const box = (z0, z1) => [[minX - 1, z0], [maxX + 1, z0], [maxX + 1, z1], [minX - 1, z1]];
  return [box(minZ - 1, middle), box(middle, maxZ + 1)].flatMap((half) => subtract(p, half)).flatMap((h) => subtract(h, r));
}

// The pavements' meshes' geometries: `top`, the paving at `height` and the flush paving at `level`, with UVs from world
// x and z (`repeat` m per copy), and `stones`, a kerb strip `kerb` m wide along each kerb just above it, with each kerb's face down to the road and
// each back's face down to the ground.
export function pavementGeometry({ tops, kerbs, backs, flush }, { height, repeat, kerb }, level) {
  const pos = [];
  for (const [rings, y] of [[tops, height], [flush, level]]) {
    for (const ring of rings) {
      for (const corners of ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])) {
        const [a, b, c] = corners.map((i) => ring[i]);
        for (const p of area2([a, b, c]) < 0 ? [a, b, c] : [a, c, b]) pos.push(p[0], y, p[1]); // facing up
      }
    }
  }
  const top = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((v, i) => (i % 3 === 0 ? [v / repeat, -pos[i + 2] / repeat] : [])), 2));

  const y = height + 0.003; // over the paving, against depth fighting
  const face = ({ a, b, out }, top) => [[[a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], top, b[1]], [a[0], top, a[1]]], [out[0], 0, out[1]]];
  const stones = quads([
    ...kerbs.flatMap((s) => {
      const [ix, iz] = [-s.out[0] * kerb, -s.out[1] * kerb];
      return [[[[s.a[0], y, s.a[1]], [s.b[0], y, s.b[1]], [s.b[0] + ix, y, s.b[1] + iz], [s.a[0] + ix, y, s.a[1] + iz]], [0, 1, 0]], face(s, y)];
    }),
    ...backs.map((s) => face(s, height)),
  ]);
  return { top, stones };
}
