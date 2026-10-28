// The paved area (glossary): the road, its pavements and the pedestrian ways and squares, as overlapping convex pieces
// and squares (rings of [x, z]), which the renderer paves; and its open edges, where it meets open ground that no
// building closes off, which osm.js lines with edge walls. All of it comes from the map's road graph and pedestrian
// ways, so any map gets it.
import { createCells } from './cells.js';
import { inside } from './sim.js';

const CORNERS = 12; // per disc
const xz = (ring) => ring.map(([x, z]) => ({ x, z }));
const box = (ring) => [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))];
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

// The pavements as convex rings: `width` m wide strips along both sides of every edge, a square cap as far past each end
// (a junction's corners or a dead end's), and at a bend the wedge its strips leave open. They overlap the road, and
// reach as far as osm.js cuts the buildings back.
export function pavementPieces(graph, width) {
  const pieces = [];
  // The box across the road and its pavements from b to `c` m on past it, away from a.
  const cap = (a, b, c) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    return l < 1e-6 ? null : strip(b, { x: b.x + ((b.x - a.x) / l) * c, z: b.z + ((b.z - a.z) / l) * c }, -c, c);
  };
  for (const e of graph.edges) {
    const [half, points] = [e.width / 2, e.points];
    points.slice(1).forEach((p, k) => pieces.push(strip(points[k], p, half, half + width), strip(points[k], p, -half - width, -half)));
    pieces.push(cap(points[1], points[0], half + width), cap(points.at(-2), points.at(-1), half + width));
    for (let k = 1; k < points.length - 1; k++) pieces.push(wedge(points[k - 1], points[k], points[k + 1], half + width));
  }
  return pieces.filter(Boolean);
}

// The pedestrian ways (`width` m wide) and squares (map.pedestrian) as rings.
export const pedestrianPieces = ({ lines, squares }, width) => [...lines.flatMap((line) => ribbon(line, width / 2)), ...squares.map((square) => square.map(({ x, z }) => [x, z]))];

// The open edges of the paved area made of `rings`: each { a, b, out }, a stretch of a ring's side ([x, z] ends) with
// `out` the unit normal away from the paving, where the ground beyond is neither paved nor has one of `closers`
// (colliders: buildings) within `closed` m, the truck being wider than that; and along the map's `bounds` where the
// paving reaches them, unless a closer (an edge exit's barrier) stands within `closed` m inside. `cell` sizes the
// spatial index.
export function openEdges(rings, closers, bounds, closed, cell) {
  const paving = createCells(cell);
  for (const ring of rings) paving.add(xz(ring), ...box(ring));
  const solid = createCells(cell);
  for (const c of closers) solid.add(c.points, c.minX, c.minZ, c.maxX, c.maxZ);
  const paved = (x, z) => paving.some(x, z, x, z, (points) => inside(x, z, points));
  const shut = (x, z, [ox, oz]) => {
    for (const d of [0.05, closed / 3, (2 * closed) / 3, closed]) {
      const [px, pz] = [x + ox * d, z + oz * d];
      if (solid.some(px, pz, px, pz, (points) => inside(px, pz, points))) return true;
    }
    return false;
  };
  const { minX, minZ, maxX, maxZ } = bounds;
  const within = (x, z) => x > minX && x < maxX && z > minZ && z < maxZ;

  const edges = [];
  // The open stretches of side a→b, where open(x, z) holds: sampled every half m, each end found to a centimetre; slivers
  // under 5 cm (where pieces' corners meet) are left out, far too narrow a gap for the truck.
  const stretches = (a, b, out, open) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const ok = (t) => open(...at(t));
    const change = (lo, hi) => {
      const from = ok(lo);
      while ((hi - lo) * l > 0.01) {
        const t = (lo + hi) / 2;
        [lo, hi] = ok(t) === from ? [t, hi] : [lo, t];
      }
      return (lo + hi) / 2;
    };
    const n = Math.ceil(l / 0.5);
    let [was, start] = [ok(0), 0];
    for (let i = 1; i <= n; i++) {
      const now = ok(i / n);
      if (now === was) continue;
      const t = change((i - 1) / n, i / n);
      if (now) start = t;
      else if ((t - start) * l > 0.05) edges.push({ a: at(start), b: at(t), out });
      was = now;
    }
    if (was && (1 - start) * l > 0.05) edges.push({ a: at(start), b, out });
  };

  for (const ring of rings) {
    const turn = Math.sign(area2(ring));
    if (!turn) continue; // no inside, so no side faces out
    ring.forEach((a, k) => {
      const b = ring[(k + 1) % ring.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-3) return;
      const out = [(turn * (b[1] - a[1])) / l, (-turn * (b[0] - a[0])) / l]; // right of a→b on a counter-clockwise ring
      stretches(a, b, out, (x, z) => within(x, z) && !paved(x + out[0] * 0.05, z + out[1] * 0.05) && !shut(x, z, out));
    });
  }
  const frame = [[[minX, minZ], [maxX, minZ], [0, -1]], [[maxX, minZ], [maxX, maxZ], [1, 0]], [[maxX, maxZ], [minX, maxZ], [0, 1]], [[minX, maxZ], [minX, minZ], [-1, 0]]];
  for (const [a, b, out] of frame) {
    const into = [-out[0], -out[1]];
    stretches(a, b, out, (x, z) => paved(x + into[0] * 0.05, z + into[1] * 0.05) && !shut(x, z, into));
  }
  return edges;
}
