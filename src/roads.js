// An OSM map's ground (#65): the road surface along the road graph's edges, with junction surfaces, and raised
// pavements with stone kerbs along every road edge and over the pedestrian ways and squares. Both come from the same
// convex road pieces: a pavement is what is left of its strip once every road piece is cut out of it, so it stops
// exactly where the road surface starts and never covers a lane.
import * as THREE from 'three/webgpu';
import { subtract } from './sim/osm.js';
import { createCells } from './sim/cells.js';
import { inside } from './sim/sim.js';
import { quads } from './streets.js';

const { ShapeUtils } = THREE;
const CORNERS = 12; // per disc
const xz = (ring) => ring.map(([x, z]) => ({ x, z }));
const bounds = (ring) => [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))];
const area2 = (ring) => ring.reduce((s, [x, z], i) => s + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * z, 0);

// A disc of radius r round point c, as a ring of [x, z].
const disc = (c, r) => Array.from({ length: CORNERS }, (_, k) => [c.x + Math.cos((2 * Math.PI * k) / CORNERS) * r, c.z + Math.sin((2 * Math.PI * k) / CORNERS) * r]);

// The strip beside segment a→b from `from` to `to` m left of it, `past` m beyond each end; null for a point.
function strip(a, b, from, to, past = 0) {
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  if (l < 1e-6) return null;
  const [ux, uz] = [(b.x - a.x) / l, (b.z - a.z) / l];
  const at = (p, s, across) => [p.x + ux * s + uz * across, p.z + uz * s - ux * across];
  return [at(a, -past, from), at(b, past, from), at(b, past, to), at(a, -past, to)];
}

// At the bend in a→p→b, the sector of radius r round p between the ends of the strips on the outside of the bend, where
// the strip along a→p ends square and the one along p→b starts square; null without a bend.
function wedge(a, p, b, r) {
  const unit = (from, to) => {
    const l = Math.hypot(to.x - from.x, to.z - from.z);
    return l < 1e-6 ? null : [(to.x - from.x) / l, (to.z - from.z) / l];
  };
  const [u, v] = [unit(a, p), unit(p, b)];
  if (!u || !v) return null;
  // Outside, the normal turns forwards from one strip's to the next's.
  const s = (v[1] - u[1]) * u[0] - (v[0] - u[0]) * u[1] > 0 ? 1 : -1;
  const [from, to] = [Math.atan2(-u[0] * s, u[1] * s), Math.atan2(-v[0] * s, v[1] * s)];
  const sweep = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  if (Math.abs(sweep) < 1e-3) return null;
  const steps = Math.ceil(Math.abs(sweep) / (Math.PI / 6));
  return [[p.x, p.z], ...Array.from({ length: steps + 1 }, (_, k) => [p.x + Math.cos(from + (sweep * k) / steps) * r, p.z + Math.sin(from + (sweep * k) / steps) * r])];
}

// Pieces along each of a polyline's segments and round each of its points, `half` m either side.
const ribbon = (points, half) => [
  ...points.slice(1).map((p, k) => strip(points[k], p, -half, half)).filter(Boolean),
  ...points.map((p) => disc(p, half)),
];

// The road as convex pieces ({ ring, points, round }, `points` the ring as { x, z }): a box per edge segment, a
// centimetre past its ends so the pieces of a bend overlap, a disc on each of its points, and a disc on each node as
// wide as its widest arm, which closes the junction and rounds its corners.
export function roadPieces(graph) {
  const pieces = [];
  for (const e of graph.edges) {
    e.points.slice(1).forEach((p, k) => {
      const ring = strip(e.points[k], p, -e.width / 2, e.width / 2, 0.01);
      if (ring) pieces.push({ ring, round: false });
    });
    for (const p of e.points.slice(1, -1)) pieces.push({ ring: disc(p, e.width / 2), round: true });
  }
  for (const n of graph.nodes) pieces.push({ ring: disc(n, Math.max(...n.arms.map((id) => graph.edges[id].width / 2))), round: true });
  return pieces.map((piece) => ({ points: xz(piece.ring), ...piece }));
}

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
  const sources = [];
  for (const e of map.graph.edges) {
    const [half, points] = [e.width / 2, e.points];
    points.slice(1).forEach((p, k) => sources.push(strip(points[k], p, half, half + width), strip(points[k], p, -half - width, -half)));
    // A disc round each end, for the junction's corners or a dead end; at a bend, the wedge its strips leave open.
    sources.push(disc(points[0], half + width), disc(points.at(-1), half + width));
    for (let k = 1; k < points.length - 1; k++) sources.push(wedge(points[k - 1], points[k], points[k + 1], half + width));
  }
  const squares = [...map.pedestrian.lines.flatMap((line) => ribbon(line, pedestrian / 2)), ...map.pedestrian.squares.map((square) => square.map(({ x, z }) => [x, z]))];

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
