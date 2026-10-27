// Lane paths on the road graph (spec #59, "Junctions"), the ways AI cars drive: a run along each lane of an edge, cut
// back at each end to its node's box (see boxRadius), its bends rounded,
// and through each node a turn from every lane run arriving there to every one leaving, but straight back, joined by a
// smooth curve. A path is { id (index in `paths`), kind ('run' or 'turn'), prims, length } plus, for a run, its `edge`,
// `lane` (0 along the edge, 1 against it), `from` and `to` nodes and `next` (the turns at `to` from it), and for a turn
// its `node`, `in` and `out` runs, `slot` and `outSlot` (the arms they use, see below) and `move` ('straight', 'right'
// or 'left'). `prims` are its lines { x, z, dx, dz, at, length, r: 0 } and arcs { cx, cz, r, a, sweep, at, length }
// (a: the start's angle round the centre, atan2(dz, dx); sweep signed), `at` m along the path where each starts.
// Each node gets `slots`, one per arm in the order of `arms`: { edge, angle (atan2(dz, dx) of the way the arm leaves
// the node), in, out (the runs arriving and leaving by it, or null), stop (a stop approach, set by osm.js) }, and
// `radius`, its box's half size.
// Heading 0 faces +z and right of travel (dx, dz) is (-dz, dx), as in the Sim.

export function lanePaths(nodes, edges) {
  const paths = [];
  for (const n of nodes) n.slots = n.arms.map((id) => ({ edge: edges[id], angle: 0, in: null, out: null, stop: false }));
  // The slot of edge e at its `from` (or `to`) end; a loop's from end is its first slot there.
  const slotOf = (n, e, atFrom) => (atFrom ? nodes[n].arms.indexOf(e.id) : nodes[n].arms.lastIndexOf(e.id));
  const drivable = edges.filter((e) => e.points.length > 1); // an edge of one point has nowhere to drive
  for (const e of drivable) {
    const [a, b, y, z] = [e.points[0], e.points[1], e.points.at(-2), e.points.at(-1)];
    nodes[e.from].slots[slotOf(e.from, e, true)].angle = Math.atan2(b.z - a.z, b.x - a.x);
    nodes[e.to].slots[slotOf(e.to, e, false)].angle = Math.atan2(y.z - z.z, y.x - z.x);
  }
  for (const n of nodes) n.radius = boxRadius(n.slots.filter(({ edge }) => edge.points.length > 1));

  for (const e of drivable) {
    e.lanes.forEach(({ points }, lane) => {
      const [from, to] = lane ? [e.to, e.from] : [e.from, e.to];
      const cut = trim(points, nodes[from].radius, nodes[to].radius);
      const run = { id: paths.length, kind: 'run', edge: e, lane, from, to, next: [], startDir: cut.startDir, endDir: cut.endDir };
      Object.assign(run, fillet(cut.points, roundings(cut.points, e.width, e.oneWay ? 0 : e.laneOffset)));
      if (!run.length) [run.prims[0].dx, run.prims[0].dz] = [cut.startDir.x, cut.startDir.z]; // a run between touching boxes
      paths.push(run);
      nodes[from].slots[slotOf(from, e, !lane)].out = run;
      nodes[to].slots[slotOf(to, e, !!lane)].in = run;
    });
  }

  nodes.forEach((node, n) => {
    node.slots.forEach(({ in: run }, slot) => {
      if (!run) return;
      node.slots.forEach(({ out }, outSlot) => {
        if (!out || outSlot === slot) return; // not straight back the way it came
        const turn = { id: paths.length, kind: 'turn', node: n, in: run, out, slot, outSlot, move: move(run.endDir, out.startDir), ...join(run, out) };
        paths.push(turn);
        run.next.push(turn);
      });
    });
  });
  return paths;
}

// How far a node's box reaches out along its arms (`slots`): to where the kerbs of each two neighbouring arms meet,
// and at least half the widest arm's width; none at a dead end.
function boxRadius(slots) {
  if (slots.length < 2) return 0;
  const sorted = slots.map(({ edge, angle }) => ({ half: edge.width / 2, angle })).sort((a, b) => a.angle - b.angle);
  return sorted.reduce((r, a, i) => {
    const b = sorted[(i + 1) % sorted.length];
    const gap = (b.angle - a.angle + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI; // a loop's two ends may share an angle
    return Math.max(r, a.half, gap < Math.PI ? Math.max(a.half, b.half) / Math.tan(gap / 2) : 0);
  }, 0);
}

// Sets `out`'s { x, z, heading } to the pose `s` m along `path` (clamped to it) and returns the prim it lies on.
export function poseAt(path, s, out) {
  const { prims } = path;
  let i = 0;
  while (i < prims.length - 1 && prims[i + 1].at <= s) i++;
  const p = prims[i];
  const u = Math.max(0, Math.min(p.length, s - p.at));
  if (!p.r) {
    out.x = p.x + p.dx * u;
    out.z = p.z + p.dz * u;
    out.heading = Math.atan2(p.dx, p.dz);
  } else {
    const a = p.a + (p.sweep * u) / p.length;
    const sign = Math.sign(p.sweep);
    out.x = p.cx + p.r * Math.cos(a);
    out.z = p.cz + p.r * Math.sin(a);
    out.heading = Math.atan2(-sign * Math.sin(a), sign * Math.cos(a));
  }
  return p;
}

const unit = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
};
const cross = (u, v) => u.x * v.z - u.z * v.x; // > 0: turning right

// The polyline without its first `a` and last `b` m (to a point in its middle where they overlap), and the directions it
// starts and ends in.
function trim(points, a, b) {
  const at = [0];
  for (let k = 1; k < points.length; k++) at.push(at[k - 1] + Math.hypot(points[k].x - points[k - 1].x, points[k].z - points[k - 1].z));
  const length = at.at(-1);
  if (a + b > length) [a, b] = [(length * a) / (a + b || 1), (length * b) / (a + b || 1)];
  const point = (s) => {
    let k = 0;
    while (k < points.length - 2 && at[k + 1] <= s) k++;
    const t = (s - at[k]) / (at[k + 1] - at[k]);
    return { k, x: points[k].x + t * (points[k + 1].x - points[k].x), z: points[k].z + t * (points[k + 1].z - points[k].z) };
  };
  const [p, q] = [point(a), point(length - b)];
  const cut = [{ x: p.x, z: p.z }, ...points.slice(p.k + 1, q.k + 1), { x: q.x, z: q.z }];
  return {
    points: cut.filter((v, i) => i === 0 || v.x !== cut[i - 1].x || v.z !== cut[i - 1].z),
    startDir: unit(points[p.k], points[p.k + 1]),
    endDir: unit(points[q.k], points[q.k + 1]),
  };
}

// How far before and after each inner point of a lane's polyline its bend is rounded: as if the edge's centre line were
// rounded half the road's width before and after its bend, so the lane on the inside of a bend turns tighter than the
// one outside, as round a street corner; no more than the polyline has room for.
function roundings(points, width, offset) {
  return points.map((p, k) => {
    if (k === 0 || k === points.length - 1) return 0;
    const [u, v] = [unit(points[k - 1], p), unit(p, points[k + 1])];
    const half = Math.atan2(Math.abs(cross(u, v)), u.x * v.x + u.z * v.z) / 2;
    return width / 2 - Math.sign(cross(u, v)) * offset * Math.tan(half);
  });
}

// The prims along polyline `points`, each inner point's bend rounded by an arc that starts and ends `t[k]` m from it
// (at most half the segments either side, the whole of the first and the last).
function fillet(points, t) {
  const prims = [];
  let at = 0;
  let from = points[0];
  const line = (to) => {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length < 1e-9) return;
    prims.push({ x: from.x, z: from.z, dx: (to.x - from.x) / length, dz: (to.z - from.z) / length, at, length, r: 0 });
    at += length;
  };
  for (let k = 1; k < points.length - 1; k++) {
    const [p, prev, next] = [points[k], points[k - 1], points[k + 1]];
    const [u, v] = [unit(prev, p), unit(p, next)];
    const turn = Math.atan2(cross(u, v), u.x * v.x + u.z * v.z);
    const room = (a, b, whole) => Math.hypot(b.x - a.x, b.z - a.z) * (whole ? 1 : 0.5);
    const d = Math.min(t[k], room(prev, p, k === 1), room(p, next, k === points.length - 2));
    if (Math.abs(turn) < 1e-6 || d <= 0) continue;
    const start = { x: p.x - u.x * d, z: p.z - u.z * d };
    line(start);
    const r = d / Math.tan(Math.abs(turn) / 2);
    const side = Math.sign(turn); // the centre lies right of travel when turning right
    const [cx, cz] = [start.x - side * u.z * r, start.z + side * u.x * r];
    prims.push({ cx, cz, r, a: Math.atan2(start.z - cz, start.x - cx), sweep: turn, at, length: r * Math.abs(turn) });
    at += r * Math.abs(turn);
    from = { x: p.x + v.x * d, z: p.z + v.z * d };
  }
  line(points.at(-1));
  // A path of no length still has a pose: a line of none (lanePaths turns a run's along its lane).
  if (!prims.length) prims.push({ x: from.x, z: from.z, dx: 0, dz: 1, at: 0, length: 0, r: 0 });
  return { prims, length: at };
}

// A turn's prims from the end of run `a` to the start of run `b`: along a's end direction to where it meets b's start
// direction, then on to b, the corner rounded as far as both legs allow; a straight line where they don't meet ahead.
// shortcut: a lane that steps sideways through a node (two-way into one-way) gets a straight slanted line, and its
// heading jumps a little at each end; give it an S-curve if Monti's one-ways show it.
function join(a, b) {
  const [p, q] = [a.prims.at(-1), b.prims[0]];
  const start = endOf(p);
  const end = { x: q.r ? q.cx + q.r * Math.cos(q.a) : q.x, z: q.r ? q.cz + q.r * Math.sin(q.a) : q.z };
  const [u, v] = [a.endDir, b.startDir];
  const det = cross(u, v);
  const [dx, dz] = [end.x - start.x, end.z - start.z];
  const s = (dx * v.z - dz * v.x) / det; // m along u to the meeting point
  const w = (u.x * dz - u.z * dx) / det; // m on along v from it to the end
  if (Math.abs(det) < 1e-6 || !(s > 0 && w > 0)) return fillet([start, end], [0, 0]);
  const meet = { x: start.x + u.x * s, z: start.z + u.z * s };
  return fillet([start, meet, end], [0, Math.min(s, w), 0]);
}

// Where prim p ends.
function endOf(p) {
  if (!p.r) return { x: p.x + p.dx * p.length, z: p.z + p.dz * p.length };
  const a = p.a + p.sweep;
  return { x: p.cx + p.r * Math.cos(a), z: p.cz + p.r * Math.sin(a) };
}

// A turn's move from heading u to heading v: straight within 45° either way, else right or left.
function move(u, v) {
  const turn = Math.atan2(cross(u, v), u.x * v.x + u.z * v.z);
  return Math.abs(turn) < Math.PI / 4 ? 'straight' : turn > 0 ? 'right' : 'left';
}
