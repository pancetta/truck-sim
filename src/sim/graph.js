// The road graph (spec #59, "Map module"): edges along the streets' centre lines between nodes (junctions and dead
// ends), each with its lanes, and nodes with their arms. It doesn't know where its data comes from: buildOsmMap (osm.js)
// builds it. A graph pose is { edge, s }: s m along the edge from its `from` node.

import { createCells } from './cells.js';
import { lanePaths } from './lanes.js';

// `nodes`: [{ x, z }]. `edges`: [{ from, to (node indices), class, width (m), name, oneWay, limit (km/h), laneOffset?,
// pedestrian?, points: [{ x, z }] }], the points running from the `from` node to the `to` node. Fills in each node's
// `arms` (edge indices; a loop counts twice) and `walks` (the same for its pedestrian edges, #89: no arms, so AI traffic,
// the junctions and their rules never see them; routes follow them only when asked) and each edge's `id`, `length`, `at`
// (m along it at each point), `laneOffset` (the
// edge's own, else `laneOffset`) and `lanes` ([{ points }] the way each runs: a one-way edge's one lane on its centre
// line, else one laneOffset m right of it each way, the forward one first).
// Edge segments are filed in a spatial cell index of `cellSize` m. `paths` are the lane paths AI cars drive (lanes.js).
export function createGraph(nodes, edges, laneOffset, cellSize) {
  const index = createCells(cellSize);
  for (const n of nodes) [n.arms, n.walks] = [[], []];
  edges.forEach((e, id) => {
    e.id = id;
    nodes[e.from][e.pedestrian ? 'walks' : 'arms'].push(id);
    nodes[e.to][e.pedestrian ? 'walks' : 'arms'].push(id);
    e.at = e.points.map((p, k) => (k ? Math.hypot(p.x - e.points[k - 1].x, p.z - e.points[k - 1].z) : 0));
    for (let k = 1; k < e.at.length; k++) e.at[k] += e.at[k - 1];
    e.length = e.at.at(-1);
    e.laneOffset ??= laneOffset;
    e.lanes = e.oneWay ? [{ points: e.points }] : [{ points: offset(e.points, e.laneOffset) }, { points: offset(e.points.toReversed(), e.laneOffset) }];
    for (let k = 0; k < segments(e); k++) {
      const [a, b] = [e.points[k], e.points[Math.min(k + 1, e.points.length - 1)]];
      index.add({ edge: e, k }, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
    }
  });

  // The pose nearest (x, z) on segment k of edge e, if nearer than `best`, which is updated in place: { edge, k (the
  // segment), s, x, z (the point on the edge), d (m from (x, z)) }.
  // Plain assignments, no destructuring: it runs for every segment near the truck every step, where arrays would
  // allocate.
  function closer(e, k, x, z, best) {
    const a = e.points[k];
    const b = e.points[Math.min(k + 1, e.points.length - 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    // Math.sqrt, not Math.hypot: V8 boxes hypot's result on every call (3 KB a step in the traffic bench)
    const len = Math.sqrt(dx * dx + dz * dz);
    // m along the segment; divided once, so a point on a straight road lands on whole metres exactly
    const u = len ? Math.max(0, Math.min(len, ((x - a.x) * dx + (z - a.z) * dz) / len)) : 0;
    const t = len ? u / len : 0;
    const ex = a.x + t * dx - x;
    const ez = a.z + t * dz - z;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d >= best.d) return;
    best.edge = e;
    best.k = k;
    best.d = d;
    best.s = e.at[k] + u;
    best.x = a.x + t * dx;
    best.z = a.z + t * dz;
  }
  const far = () => ({ edge: null, k: 0, s: 0, x: 0, z: 0, d: Infinity });

  // The pose on edge e nearest (x, z), as closer() describes it.
  function project(e, x, z) {
    const best = far();
    for (let k = 0; k < segments(e); k++) closer(e, k, x, z, best);
    return best;
  }

  // The pose on the graph nearest (x, z), as closer() describes it. The cells within one cell of it settle it when
  // they hold an edge that near; otherwise every edge is tried, unless the caller only wants one that `near` (then the
  // pose has d over a cell and maybe no edge).
  // shortcut: off the road (on a square) that is every edge on every call, about 60 µs a step on Monti's segments;
  // search ring by ring if a bigger map or open area makes it show in ?perf.
  function nearest(x, z, near = false) {
    const best = far();
    index.some(x - cellSize, z - cellSize, x + cellSize, z + cellSize, (seg) => {
      closer(seg.edge, seg.k, x, z, best);
    });
    if (best.d > cellSize && !near) for (const e of edges) for (let k = 0; k < segments(e); k++) closer(e, k, x, z, best);
    return best;
  }

  // Whether (x, z) lies on the road: within half its width of the nearest edge's centre line.
  function onRoad(x, z) {
    const p = nearest(x, z);
    return p.d <= p.edge.width / 2;
  }

  // Where (x, z) lies on the road, facing (fx, fz) within 45° of its edge either way: the `edge`, whether it faces
  // along it (`forward`, from its `from` node to its `to`), the node `next` it faces and the m to it (`ahead`), and
  // the node `last` behind it and the m from it (`behind`); null off the road or across it.
  function along(x, z, fx, fz) {
    const p = nearest(x, z, true);
    const e = p.edge;
    if (!e || p.d > e.width / 2 || e.points.length < 2) return null;
    const a = e.points[p.k];
    const b = e.points[p.k + 1];
    const c = ((b.x - a.x) * fx + (b.z - a.z) * fz) / Math.hypot(b.x - a.x, b.z - a.z);
    if (Math.abs(c) <= Math.SQRT1_2) return null;
    const forward = c > 0;
    return { edge: e, forward, next: forward ? e.to : e.from, last: forward ? e.from : e.to, ahead: forward ? e.length - p.s : p.s, behind: forward ? p.s : e.length - p.s };
  }

  // The point s m along edge e.
  function pointAt(e, s) {
    const { points: p, at } = e;
    let k = 0;
    while (k < p.length - 2 && at[k + 1] <= s) k++;
    const j = Math.min(k + 1, p.length - 1);
    const t = at[j] > at[k] ? (s - at[k]) / (at[j] - at[k]) : 0;
    return { x: p[k].x + t * (p[j].x - p[k].x), z: p[k].z + t * (p[j].z - p[k].z) };
  }

  // The polyline along edge e from a m to b m along it, either way, both ends included.
  function cut(e, a, b) {
    const inner = e.points.filter((_, k) => (a < b ? e.at[k] > a && e.at[k] < b : e.at[k] < a && e.at[k] > b));
    return [pointAt(e, a), ...(a < b ? inner : inner.reverse()), pointAt(e, b)];
  }

  // Shortest legal ways by length to the pose `to`, one search for any number of starts: a function from a start pose
  // to { length (m), points } (the polyline from the start to `to`, both ends included), or null where no road leads.
  // One-way edges are only followed from their `from` node to their `to` node, unless `legal` is false. Edges narrower
  // than `minWidth` m are never followed, nor is one the way ends on; the one it starts on always is. Edges whose ids
  // are in `closed` (a Set; street events, #80) are not driven along: from a pose on one, only out by its nearer end.
  // Pedestrian edges are followed, and ended on, only with `walk` (a Vehicle narrow enough for their bollard gates);
  // without it, a pose on one (at its mouth, whose middle is nearer there than the road's) leaves it as a closed one.
  function towards(to, legal = true, minWidth = 0, closed = null, walk = false) {
    const t = to.edge;
    if (t.width < minWidth || (t.pedestrian && !walk)) return () => null;
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const via = new Array(nodes.length).fill(null); // the edge on from each node towards `to`; null: on along t
    const done = new Uint8Array(nodes.length);
    dist[t.from] = to.s;
    const against = (e) => legal && e.oneWay; // whether e may only be followed its own way
    if (!against(t)) dist[t.to] = Math.min(dist[t.to], t.length - to.s);
    for (;;) {
      let n = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (n < 0 || dist[i] < dist[n])) n = i;
      if (n < 0) break;
      done[n] = 1;
      for (const id of walk ? [...nodes[n].arms, ...nodes[n].walks] : nodes[n].arms) {
        const e = edges[id];
        if ((against(e) && e.to !== n) || e.width < minWidth || closed?.has(id)) continue; // m → n would run against it, is too narrow or is closed
        const m = e.from === n ? e.to : e.from;
        if (dist[n] + e.length < dist[m]) [dist[m], via[m]] = [dist[n] + e.length, e];
      }
    }

    return (from) => {
      const f = from.edge;
      const shut = (closed?.has(f.id) ?? false) || (f.pedestrian && !walk);
      const direct = f === t && !shut && (!against(f) || to.s >= from.s) ? Math.abs(from.s - to.s) : Infinity;
      const back = against(f) || (shut && from.s > f.length / 2) ? Infinity : from.s + dist[f.from];
      const ahead = shut && from.s <= f.length / 2 ? Infinity : f.length - from.s + dist[f.to];
      const length = Math.min(direct, back, ahead);
      if (length === Infinity) return null;
      if (length === direct) return { length, points: tidy(cut(t, from.s, to.s)) };
      let n = length === back ? f.from : f.to;
      const points = cut(f, from.s, length === back ? 0 : f.length);
      for (let e = via[n]; e; e = via[n]) {
        const rev = e.to === n;
        points.push(...cut(e, rev ? e.length : 0, rev ? 0 : e.length).slice(1));
        n = rev ? e.from : e.to;
      }
      // On a loop both ends are n: leave it by the nearer one.
      const start = n === t.from && (against(t) || n !== t.to || to.s <= t.length - to.s) ? 0 : t.length;
      points.push(...cut(t, start, to.s).slice(1));
      return { length, points: tidy(points) };
    };
  }

  const route = (from, to, minWidth = 0, closed = null, walk = false) => towards(to, true, minWidth, closed, walk)(from);

  return { nodes, edges, paths: lanePaths(nodes, edges), nearest, project, onRoad, along, pointAt, towards, route };
}

// Segments of edge e; an edge of one point has one of no length.
const segments = (e) => Math.max(1, e.points.length - 1);

// The points without repeats in a row (where a route starts or ends on a node).
const tidy = (points) => points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.z !== points[i - 1].z);

// The polyline moved `d` m to the right of travel (right of (dx, dz) is (-dz, dx)), mitred at the bends.
export function offset(points, d) {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const unit = (a, b) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    return [(b.x - a.x) / l, (b.z - a.z) / l];
  };
  return points.map((p, i) => {
    const [ix, iz] = unit(points[Math.max(0, i - 1)], points[Math.max(1, i)]);
    const [ox, oz] = unit(points[Math.min(i, points.length - 2)], points[Math.min(i + 1, points.length - 1)]);
    // The bisector of the two right-hand normals, long enough to sit d m from both sides.
    const [nx, nz] = [-iz - oz, ix + ox];
    const scale = d / (nx * -iz + nz * ix);
    return { x: p.x + nx * scale, z: p.z + nz * scale };
  });
}
