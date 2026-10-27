// The road graph (spec #59, "Map module"): edges along the streets' centre lines between nodes (junctions and dead
// ends), each with its lanes, and nodes with their arms. It doesn't know where its data comes from: parseMap builds it
// from the grid city. A graph pose is { edge, s }: s m along the edge from its `from` node.

import { createCells } from './cells.js';

// `nodes`: [{ x, z }]. `edges`: [{ from, to (node indices), class, width (m), name, oneWay, points: [{ x, z }] }], the
// points running from the `from` node to the `to` node. Fills in each node's `arms` (edge indices; a loop counts twice)
// and each edge's `id`, `length`, `at` (m along it at each point) and `lanes` ([{ points }] the way each runs: a
// one-way edge's one lane on its centre line, else one `laneOffset` m right of it each way, the forward one first).
// Edge segments are filed in a spatial cell index of `cellSize` m.
export function createGraph(nodes, edges, laneOffset, cellSize) {
  const index = createCells(cellSize);
  for (const n of nodes) n.arms = [];
  edges.forEach((e, id) => {
    e.id = id;
    nodes[e.from].arms.push(id);
    nodes[e.to].arms.push(id);
    e.at = e.points.map((p, k) => (k ? Math.hypot(p.x - e.points[k - 1].x, p.z - e.points[k - 1].z) : 0));
    for (let k = 1; k < e.at.length; k++) e.at[k] += e.at[k - 1];
    e.length = e.at.at(-1);
    e.lanes = e.oneWay ? [{ points: e.points }] : [{ points: offset(e.points, laneOffset) }, { points: offset(e.points.toReversed(), laneOffset) }];
    for (let k = 0; k < segments(e); k++) {
      const [a, b] = [e.points[k], e.points[Math.min(k + 1, e.points.length - 1)]];
      index.add({ edge: e, k }, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z));
    }
  });

  // The pose nearest (x, z) on segment k of edge e, if nearer than `best`, which is updated in place: { edge, k (the
  // segment), s, x, z (the point on the edge), d (m from (x, z)) }.
  function closer(e, k, x, z, best) {
    const a = e.points[k];
    const b = e.points[Math.min(k + 1, e.points.length - 1)];
    const [dx, dz] = [b.x - a.x, b.z - a.z];
    const len = Math.hypot(dx, dz);
    // m along the segment; divided once, so a point on a grid road lands on whole metres exactly
    const u = len ? Math.max(0, Math.min(len, ((x - a.x) * dx + (z - a.z) * dz) / len)) : 0;
    const t = len ? u / len : 0;
    const d = Math.hypot(a.x + t * dx - x, a.z + t * dz - z);
    if (d >= best.d) return;
    [best.edge, best.k, best.d, best.s, best.x, best.z] = [e, k, d, e.at[k] + u, a.x + t * dx, a.z + t * dz];
  }
  const far = () => ({ edge: null, k: 0, s: 0, x: 0, z: 0, d: Infinity });

  // The pose on edge e nearest (x, z), as closer() describes it.
  function project(e, x, z) {
    const best = far();
    for (let k = 0; k < segments(e); k++) closer(e, k, x, z, best);
    return best;
  }

  // The pose on the graph nearest (x, z), as closer() describes it. The cells within one cell of it settle it when
  // they hold an edge that near; otherwise every edge is tried.
  // shortcut: off the road (on the plaza) that is every edge on every call, about 7 µs a step on the grid city's 132
  // segments; search ring by ring if a bigger map or open area makes it show in ?perf.
  function nearest(x, z) {
    const best = far();
    index.some(x - cellSize, z - cellSize, x + cellSize, z + cellSize, (seg) => {
      closer(seg.edge, seg.k, x, z, best);
    });
    if (best.d > cellSize) for (const e of edges) for (let k = 0; k < segments(e); k++) closer(e, k, x, z, best);
    return best;
  }

  // Whether (x, z) lies on the road: within half its width of the nearest edge's centre line.
  function onRoad(x, z) {
    const p = nearest(x, z);
    return p.d <= p.edge.width / 2;
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

  // Shortest ways by length to the pose `to`, one search for any number of starts: a function from a start pose to
  // { length (m), points } (the polyline from the start to `to`, both ends included), or null where no road leads.
  function towards(to) {
    const t = to.edge;
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const via = new Array(nodes.length).fill(null); // the edge on from each node towards `to`; null: on along t
    const done = new Uint8Array(nodes.length);
    dist[t.from] = to.s;
    dist[t.to] = Math.min(dist[t.to], t.length - to.s);
    for (;;) {
      let n = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (n < 0 || dist[i] < dist[n])) n = i;
      if (n < 0) break;
      done[n] = 1;
      for (const id of nodes[n].arms) {
        const e = edges[id];
        const m = e.from === n ? e.to : e.from;
        if (dist[n] + e.length < dist[m]) [dist[m], via[m]] = [dist[n] + e.length, e];
      }
    }

    return (from) => {
      const f = from.edge;
      const direct = f === t ? Math.abs(from.s - to.s) : Infinity;
      const [back, ahead] = [from.s + dist[f.from], f.length - from.s + dist[f.to]];
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
      const start = n === t.from && (n !== t.to || to.s <= t.length - to.s) ? 0 : t.length;
      points.push(...cut(t, start, to.s).slice(1));
      return { length, points: tidy(points) };
    };
  }

  const route = (from, to) => towards(to)(from);

  return { nodes, edges, nearest, project, onRoad, pointAt, towards, route };
}

// Segments of edge e; an edge of one point (a lone road tile) has one of no length.
const segments = (e) => Math.max(1, e.points.length - 1);

// The points without repeats in a row (where a route starts or ends on a node).
const tidy = (points) => points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.z !== points[i - 1].z);

// The polyline moved `d` m to the right of travel (right of (dx, dz) is (-dz, dx)), mitred at the bends.
function offset(points, d) {
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
