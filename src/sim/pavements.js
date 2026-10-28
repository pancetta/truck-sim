// Pavement lines (#78): where pedestrians walk, along the middle of the pavements (tables.osm.pavement wide) on both
// sides of every edge. At a node each side turns the corner onto the side of the next arm round: where the two cross,
// if that is ahead along both (inside an angle under 180°), else round an arc on the node, out past its road disc (the
// outside of a bend, a straight side, a dead end's end). Sides stop short of an edge exit's barrier. A stretch that
// comes within tables.pedestrians keepRight + clear m of the road (an edge, or a node's disc as roads.js draws it), into
// one of the `solid` colliders or out of the map's `bounds` is left out.
// The pieces are joined end to end into lines { points: [{ x, z }], at (m along at each point), length, closed }: a
// closed one runs round a block; an open one ends where a piece was left out or at an edge exit.
// shortcut: lines go through the props, signal posts, pump islands and terraces on the pavement (pedestrians aren't
// solid), as osm.js passes only buildings, barriers and docks as `solid`; add those kinds if players notice.
import { offset } from './graph.js';
import { createCells } from './cells.js';
import { inside } from './sim.js';

const STRAIGHT = Math.PI - 0.1; // rad between two arms, under which their sides meet in a corner, else round an arc

export function pavementLines(graph, solid, bounds, tables) {
  const { pavement, barrier } = tables.osm;
  const margin = tables.pedestrians.keepRight + tables.pedestrians.clear;
  const { nodes, edges } = graph;
  const disc = nodes.map((n) => Math.max(0, ...n.arms.map((id) => edges[id].width / 2))); // as roads.js roadPieces
  const piece = (points) => ({ points, trim: [0, 0], link: [null, null] });
  // Per edge its sides, right of its way (from → to) and left; `trim` the m cut off each end, `link` the piece end each
  // end joins ({ piece, end }) or null.
  const sides = edges.map((e) => (e.points.length < 2 ? null : [1, -1].map((side) => piece(offset(e.points, side * (e.width / 2 + pavement / 2))))));
  const arcs = [];
  const join = (a, ea, b, eb) => {
    a.link[ea] = { piece: b, end: eb };
    b.link[eb] = { piece: a, end: ea };
  };

  nodes.forEach((n, i) => {
    const slots = n.slots.map((slot, k) => ({ ...slot, k })).filter((s) => s.edge.points.length > 1);
    // The side of slot s facing round to increasing angles (`which` 0) or decreasing ones (1), and its end at this node.
    const sideOf = (s, which) => {
      const atFrom = s.edge.from === i && n.arms.indexOf(s.edge.id) === s.k; // a loop's from end is its first slot
      return [sides[s.edge.id][(atFrom ? 0 : 1) ^ which], atFrom ? 0 : 1];
    };
    if (n.exit) {
      for (const s of slots) {
        for (const which of [0, 1]) {
          const [p, end] = sideOf(s, which);
          p.trim[end] = 2 * barrier; // the barrier stands `barrier` in and is as thick
        }
      }
      return;
    }
    slots.sort((a, b) => a.angle - b.angle);
    slots.forEach((a, j) => {
      const b = slots[(j + 1) % slots.length];
      const gap = (b.angle - a.angle + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      const [pa, ea] = sideOf(a, 0);
      const [pb, eb] = sideOf(b, 1);
      const [ra, rb] = [a.edge.width / 2 + pavement / 2, b.edge.width / 2 + pavement / 2];
      const [ua, ub] = [[Math.cos(a.angle), Math.sin(a.angle)], [Math.cos(b.angle), Math.sin(b.angle)]];
      // Where the sides cross: node + ua·t + (a's normal towards b)·ra = node + ub·s + (b's towards a)·rb. Behind the
      // node along one (a wide street running nearly straight into a narrow one) that is off the pavement: round instead.
      const [t, s] = [(rb + ra * Math.cos(gap)) / Math.sin(gap), (ra + rb * Math.cos(gap)) / Math.sin(gap)];
      if (gap < STRAIGHT && t >= 0 && s >= 0) {
        [pa.trim[ea], pb.trim[eb]] = [t, s];
        return join(pa, ea, pb, eb);
      }
      // Round the node at radius r, just past its disc's edge; each side is cut back to where it meets the arc.
      const r = disc[i] + pavement / 2;
      [pa.trim[ea], pb.trim[eb]] = [Math.sqrt(r * r - ra * ra), Math.sqrt(r * r - rb * rb)];
      const from = a.angle + Math.atan2(ra, pa.trim[ea]);
      const angle = Math.max(0, gap - Math.atan2(ra, pa.trim[ea]) - Math.atan2(rb, pb.trim[eb])); // π round a dead end
      const steps = Math.max(1, Math.ceil(angle / (Math.PI / 8)));
      const arc = piece(Array.from({ length: steps + 1 }, (_, k) => ({ x: n.x + r * Math.cos(from + (angle * k) / steps), z: n.z + r * Math.sin(from + (angle * k) / steps) })));
      arcs.push(arc);
      join(pa, ea, arc, 0);
      join(arc, 1, pb, eb);
    });
  });

  // The road (every edge segment `width` / 2 either side, every node's disc), `margin` m out, and the solid colliders.
  const cells = createCells(tables.city.cell);
  const near = ({ a, b, r }) => cells.add({ a, b, r }, Math.min(a.x, b.x) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.z, b.z) + r);
  for (const e of edges) for (let k = 1; k < e.points.length; k++) near({ a: e.points[k - 1], b: e.points[k], r: e.width / 2 + margin });
  nodes.forEach((n, i) => near({ a: n, b: n, r: disc[i] + margin }));
  for (const c of solid) cells.add({ solid: c }, c.minX, c.minZ, c.maxX, c.maxZ);
  const clear = (x, z) =>
    x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ &&
    !cells.some(x, z, x, z, (c) => (c.solid ? inside(x, z, c.solid.points) : segmentDistance(x, z, c.a, c.b) < c.r));
  // Each piece, cut to its trims, splits into the runs of it that are clear (checked every m); a run reaching one of
  // its ends keeps that end's link, onto the run of the other piece that reaches the end it joins.
  const pieces = [...sides.flat().filter(Boolean), ...arcs];
  for (const p of pieces) {
    p.runs = [];
    const points = cut(p.points, p.trim[0], p.trim[1]);
    if (!points) continue;
    const corners = new Set(points);
    const samples = along(points, 1);
    let run = null;
    samples.forEach((q, k) => {
      if (!clear(q.x, q.z)) return void (run = null);
      if (!run) p.runs.push((run = { points: [], touches: [k === 0, false], link: [null, null] }));
      run.points.push(q);
      run.touches[1] = k === samples.length - 1;
    });
    for (const r of p.runs) r.points = r.points.filter((q, i, all) => i === 0 || i === all.length - 1 || corners.has(q));
  }
  const runAt = ({ piece, end }) => {
    const r = end ? piece.runs.at(-1) : piece.runs[0];
    return r?.touches[end] ? { piece: r, end } : null;
  };
  for (const p of pieces) for (const [end, r] of [[0, p.runs[0]], [1, p.runs.at(-1)]]) if (r?.touches[end] && p.link[end]) r.link[end] = runAt(p.link[end]);
  const kept = pieces.flatMap((p) => p.runs);

  // Joined end to end: from each open end first, then round what is left, which are rings.
  const lines = [];
  const done = new Set();
  const chain = (start, end) => {
    const points = [];
    let at = { piece: start, end };
    while (at && !done.has(at.piece)) {
      done.add(at.piece);
      const run = at.end ? at.piece.points.toReversed() : at.piece.points;
      for (const q of run) if (!points.length || Math.hypot(q.x - points.at(-1).x, q.z - points.at(-1).z) > 0.01) points.push(q);
      at = at.piece.link[1 - at.end];
    }
    const closed = at?.piece === start;
    const line = closed ? seam(points) : { points, closed };
    tidy(line.points);
    lines.push(line);
  };
  for (const p of kept) for (const end of [0, 1]) if (!p.link[end] && !done.has(p)) chain(p, end);
  for (const p of kept) if (!done.has(p)) chain(p, 0);
  return lines.filter((l) => l.points.length > 1).map((l) => ({ ...l, ...measure(l.points) })).filter((l) => l.length >= 2);
}

// A ring's points (its last joining back to its first) started and ended in the middle of its longest segment, so
// a line offset from it (keep right) runs on smoothly there.
function seam(points) {
  if (Math.hypot(points[0].x - points.at(-1).x, points[0].z - points.at(-1).z) < 0.01) points.pop();
  let k = 0;
  const len = (i) => Math.hypot(points[(i + 1) % points.length].x - points[i].x, points[(i + 1) % points.length].z - points[i].z);
  for (let i = 1; i < points.length; i++) if (len(i) > len(k)) k = i;
  const [a, b] = [points[k], points[(k + 1) % points.length]];
  const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  return { points: [m, ...points.slice(k + 1), ...points.slice(0, k + 1), m], closed: true };
}

// Drops, in place, the inner points under 0.25 m from the one before, or where the line doubles back (turns by over
// 150°) next to a segment under 1 m: where two pieces' cut ends overlap at a corner. Offset to keep right, either made a
// spike. A long sharp corner (an acute fork) stays: dropping it would cut across the wedge, which isn't checked.
function tidy(points) {
  for (let k = 1; k < points.length - 1; ) {
    const [a, p, b] = [points[k - 1], points[k], points[k + 1]];
    const [ux, uz, vx, vz] = [p.x - a.x, p.z - a.z, b.x - p.x, b.z - p.z];
    const [u, v] = [Math.hypot(ux, uz), Math.hypot(vx, vz)];
    if (u < 0.25 || (Math.min(u, v) < 1 && ux * vx + uz * vz < -0.87 * u * v)) {
      points.splice(k, 1);
      k = Math.max(1, k - 1);
    } else k++;
  }
}

// m from (x, z) to the segment from a to b ({ x, z }).
function segmentDistance(x, z, a, b) {
  const [dx, dz] = [b.x - a.x, b.z - a.z];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
  return Math.hypot(a.x + t * dx - x, a.z + t * dz - z);
}

// `at` (m along at each point) and `length` of a polyline.
export function measure(points) {
  const at = [0];
  for (let k = 1; k < points.length; k++) at.push(at[k - 1] + Math.hypot(points[k].x - points[k - 1].x, points[k].z - points[k - 1].z));
  return { at, length: at.at(-1) };
}

// The polyline less `from` m at its start and `to` m at its end; null where the cuts overlap.
function cut(points, from, to) {
  const { at, length } = measure(points);
  const [a, b] = [from, length - to];
  if (b < a) return null;
  const pointAt = (s) => {
    let k = 0;
    while (k < points.length - 2 && at[k + 1] <= s) k++;
    const t = at[k + 1] > at[k] ? (s - at[k]) / (at[k + 1] - at[k]) : 0;
    return { x: points[k].x + t * (points[k + 1].x - points[k].x), z: points[k].z + t * (points[k + 1].z - points[k].z) };
  };
  return [pointAt(a), ...points.filter((_, k) => at[k] > a && at[k] < b), pointAt(b)];
}

// Points every `step` m along a polyline, its ends included.
function along(points, step) {
  const out = [points[0]];
  for (let k = 1; k < points.length; k++) {
    const [a, b] = [points[k - 1], points[k]];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = step; s < l; s += step) out.push({ x: a.x + ((b.x - a.x) * s) / l, z: a.z + ((b.z - a.z) * s) / l });
    out.push(b);
  }
  return out;
}
