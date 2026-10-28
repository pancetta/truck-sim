// AI cars (spec #12, "Traffic"; on the road graph since #61), part of the headless Sim. They drive the graph's lane paths
// (lanes.js), turn at random at junctions, keep their distance to the car or truck ahead and stop at lights that aren't
// green. They appear and vanish out of the truck's view, keeping the count the Sim asks for. On top of those,
// tables.police.count police cars (`police: true`) drive the same rules anywhere in the city: they appear out of
// view anywhere and leave only at a dead end, whereupon a new one appears.
// A car's `route` is its way ahead as lane paths, `lane` the one it is on (route[0]), `s` the m driven along it and
// `prev` the path before; `prim` the line or arc of `lane` it is on (lanes.js); `via` the turn it drove into its
// crossing by; `at`, `seen` and `since` the crossing it was last the first car of an approach to, the last step it was
// and the step it became that (`first`: the step it first did, at that crossing; see rightOfWay); `passed` the nodes of its last PASSED turns, `turns` how many it took;
// `stopped` the turn off a stop approach it last came to a full stop before (see targetSpeed).
// Junctions are graph nodes of three or more arms. At unsignalled crossings the approaches drive in by priority (see
// rightOfWay): the higher road class, and right before left between equal ones; at a stop sign only after a full stop.
// Oncoming cars whose ways don't cross go together. At light junctions a car turning left waits for the traffic coming the other way (see atJunctions). No
// car drives into a crossing or junction whose exit lane is queued up (see exitBlocked), or where the truck stands in
// its way (see truckBlocks).
// The step allocates next to nothing (#31): footprints, poses and the neighbour grid are scratch that is
// reused every step, and per-path data is looked up by path id, so the cost grows about linearly with the cars.

import { poseAt } from './lanes.js';
import { createCells } from './cells.js';

const PLAN = 45; // m of route planned past the path a car is on, more than the longest stopping distance
const PASSED = 6; // nodes a car remembers going through, so it doesn't drive round in rings (see onward)
const SIGNS = [[1, 1], [1, -1], [-1, -1], [-1, 1]]; // footprint corners, front right first
const newBox = () => SIGNS.map(() => ({ x: 0, z: 0 }));
// A move through a one-node crossing as a bit, so the moves of the cars of an approach in it can be or-ed; a move
// through a crossing of several nodes is OTHER, which goes with nothing.
const MOVES = { straight: 1, right: 2, left: 4 };
const OTHER = 8;

export function createTraffic(tables, map, random) {
  const t = tables.traffic;
  const { nodes, paths } = map.graph;
  const size = tables.city.obstacles.car; // AI cars are the size of the parked ones
  const room = size.length + t.followGap; // m of lane a car takes up in a queue
  const lineBack = tables.lights.stopLine - tables.city.obstacles.signal.inset; // m from a stop line on to its junction (see osm.js)
  const truckSize = { length: tables.vehicle.length, width: tables.vehicle.width };
  const truckRadius = Math.hypot(truckSize.length, truckSize.width) / 2;
  const cars = [];
  let nextId = 1;
  let now = 0; // step count; a crossing's or junction's per-step fields are valid while their `stamp` is `now`
  const pick = (list) => list[Math.floor(random() * list.length)];
  const bit = (k) => 1 << k;

  // Each junction node's box: the hull of its arms' ends, `radius` out and as wide as each arm.
  const hullOf = (n) =>
    hull(n.slots.flatMap(({ edge, angle }) => {
      if (edge.points.length < 2) return [];
      const [cx, cz] = [n.x + Math.cos(angle) * n.radius, n.z + Math.sin(angle) * n.radius];
      const [px, pz] = [-Math.sin(angle) * (edge.width / 2), Math.cos(angle) * (edge.width / 2)];
      return [{ x: cx + px, z: cz + pz }, { x: cx - px, z: cz - pz }];
    }));
  const lit = new Set(map.lights.map((l) => l.node));
  const junctionNode = (n) => nodes[n].arms.length >= 3;
  // Whether edge e's end nodes' boxes touch, or lie too close to queue two cars between them (#63, on Monti: with room
  // for one at most, a car waited in one box for the other, and small rings of such boxes locked up).
  const touching = (e) => e.length < nodes[e.from].radius + nodes[e.to].radius + 2 * size.length + t.followGap + t.stopGap;

  // Unsignalled crossings: junction nodes without lights. Ones whose boxes touch (see touching) are one crossing (one group, the
  // right-of-way state shared by its nodes), so no car waits inside one of them for the next. A group's approaches
  // are the lane runs that drive into it from outside, each with its travel direction `dir`, its road class's
  // `rank` (tables.traffic.priority), the approach on its `right` (travelling round to the left of it by 45°–135°, the
  // nearest such) and the `opposite` one (within 45° of coming straight at it), -1 for none, and its `front`, the
  // first vehicle arriving by it this step.
  const groupAt = new Array(paths.length).fill(null); // path id → its crossing group: turns in it, runs between its nodes
  const approachAt = new Int32Array(paths.length).fill(-1); // path id → the approach of a turn into its group, or of a run
  const moveAt = new Int32Array(paths.length); // path id → a turn's move bit (MOVES, or OTHER)
  const groups = [];
  const groupOfNode = [];
  nodes.forEach((n, i) => {
    if (!junctionNode(i) || lit.has(i) || groupOfNode[i]) return;
    const g = { nodes: [], hulls: [], x: 0, z: 0, reach: 0, approaches: [], stamp: -1, inside: 0, blocked: false, go: 0, kinds: null, truck: -1 };
    groups.push(g);
    groupOfNode[i] = g;
    for (const queue = [i]; queue.length; ) {
      const k = queue.pop();
      g.nodes.push(k);
      g.hulls.push(hullOf(nodes[k]));
      for (const { edge: e } of nodes[k].slots) {
        const m = e.from === k ? e.to : e.from;
        if (!touching(e) || !junctionNode(m) || lit.has(m) || groupOfNode[m]) continue;
        groupOfNode[m] = g;
        queue.push(m);
      }
    }
  });
  for (const g of groups) {
    for (const k of g.nodes) {
      for (const { in: run } of nodes[k].slots) {
        if (!run) continue;
        const inner = groupOfNode[run.from] === g && touching(run.edge);
        if (inner) groupAt[run.id] = g;
        else approachAt[run.id] = g.approaches.push({ dir: run.endDir, rank: t.priority[run.edge.class] ?? 0, right: -1, opposite: -1, front: { on: false, car: null, short: 0, since: 0, first: 0, kind: 0, at: 0 } }) - 1;
        run.next.forEach((turn) => {
          groupAt[turn.id] = g;
          approachAt[turn.id] = approachAt[run.id];
          moveAt[turn.id] = g.nodes.length === 1 ? MOVES[turn.move] : OTHER;
        });
      }
    }
    const A = g.approaches;
    A.forEach((a, i) => {
      let nearest = Infinity;
      A.forEach((b, k) => {
        const turn = Math.atan2(-(a.dir.x * b.dir.z - a.dir.z * b.dir.x), a.dir.x * b.dir.x + a.dir.z * b.dir.z); // > 0: to the left
        if (turn > Math.PI / 4 && turn < (3 * Math.PI) / 4 && turn < nearest) [a.right, nearest] = [k, turn];
        if (Math.abs(turn) > (3 * Math.PI) / 4) a.opposite = k;
      });
    });
    g.kinds = new Int32Array(A.length);
    around(g);
  }

  // Crossing groups of several nodes let cars in by their paths through the group (see admit): `list` holds its turns
  // and the runs between its nodes, `localAt` each one's index there, and `clash`, per index, the ones a car on it would
  // come too near: centre lines closer than a car and its side gaps where they run alongside (within 20°), or than a
  // car's length at an angle; a path and the one it leads into don't. `occupied` and `reserved` mark, per step, the
  // ones cars in it still drive and the ones cars let in (or waiting to be) go on.
  const localAt = new Int32Array(paths.length).fill(-1);
  for (const g of groups) {
    if (g.nodes.length === 1) continue;
    g.list = paths.filter((p) => groupAt[p.id] === g);
    g.list.forEach((p, k) => (localAt[p.id] = k));
    const samples = g.list.map((p) => {
      const n = Math.ceil(p.length / 0.5);
      return Array.from({ length: n + 1 }, (_, k) => {
        const pose = { x: 0, z: 0, heading: 0 };
        poseAt(p, n ? (k * p.length) / n : 0, pose);
        return pose;
      });
    });
    const along = (p, q) => (p.kind === 'turn' ? p.out === q : q.kind === 'turn' && q.in === p);
    const near = (a, b) => {
      const d2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
      const alongside = Math.abs(Math.sin(a.heading - b.heading)) < Math.sin(Math.PI / 9);
      return d2 < (alongside ? size.width + 2 * t.sideGap : size.length) ** 2;
    };
    g.clash = g.list.map((p, i) =>
      g.list.flatMap((q, k) => (k !== i && !along(p, q) && !along(q, p) && samples[i].some((a) => samples[k].some((b) => near(a, b))) ? [k] : [])));
    g.occupied = new Uint8Array(g.list.length);
    g.reserved = new Uint8Array(g.list.length);
    g.scratch = new Uint8Array(g.list.length);
  }

  // Light junctions: who is there this step (see atJunctions), as bits by arm slot (lanes.js) in `inside` (in it),
  // `seen` (going straight or right), `left` (turning left, still able to stop) and `leftIn` (turning left, past
  // stopping), and `truck === now` while the truck stands in one (crossing groups have it too). `first` holds,
  // per slot, the m to it of the first car arriving by it (see atJunctions). Per slot, the `opposite` slot (of the
  // same light axis) and the slots `across` (of the other axis).
  const junctionAt = new Array(paths.length).fill(null); // path id → the light junction of a turn through one
  const lightAt = new Int32Array(paths.length).fill(-1); // path id → index in the lights of a turn's light
  const junctionOfNode = [];
  const junctions = [...lit].map((node) => {
    const n = nodes[node].slots.length;
    const j = { node, hulls: [hullOf(nodes[node])], x: 0, z: 0, reach: 0, stamp: -1, inside: 0, seen: 0, left: 0, leftIn: 0, first: new Float64Array(n), truck: -1 };
    const axis = nodes[node].slots.map((_, slot) => map.lights.find((l) => l.node === node && l.slot === slot)?.axis ?? -1);
    j.opposite = axis.map((a, slot) => (a < 0 ? -1 : axis.findIndex((b, k) => k !== slot && b === a)));
    j.across = axis.map((a) => axis.reduce((mask, b, k) => (b >= 0 && b !== a ? mask | bit(k) : mask), 0));
    for (const { in: run } of nodes[node].slots) for (const turn of run?.next ?? []) junctionAt[turn.id] = j;
    junctionOfNode[node] = j;
    around(j);
    return j;
  });
  map.lights.forEach((l, i) => {
    for (const turn of nodes[l.node].slots[l.slot].in?.next ?? []) lightAt[turn.id] = i;
  });
  // Turns off a stop approach (osm.js): a car comes to a full stop before one, once, before it gives way (see targetSpeed).
  const stopAt = new Uint8Array(paths.length); // path id → 1 for such a turn
  for (const n of nodes) for (const { in: run, stop } of n.slots) if (stop) for (const turn of run?.next ?? []) stopAt[turn.id] = 1;
  // The box a path is in, if any: its crossing's group (touching crossings share one) or its light junction.
  const boxOf = (p) => groupAt[p.id] ?? junctionAt[p.id];

  // Scratch, reused every step: the cars' footprints (by index in `cars`), the truck's, poses, and the
  // uniform grid the neighbour queries use. `found` holds the car indices of the last query, so a loop over it
  // must not call nearby() again.
  const footprints = [];
  const truckBox = newBox();
  const probe = newBox();
  const pathBox = newBox();
  const pathPose = { x: 0, z: 0, heading: 0 };
  const exitPose = { x: 0, z: 0, heading: 0 };
  const turnEnd = { x: 0, z: 0, heading: 0 };
  const { minX, minZ, maxX, maxZ } = map.bounds;
  const cellSize = 28; // m, near a car's look-ahead, so a neighbour query spans 3 or 4 cells each way
  const [gridCols, gridRows] = [Math.ceil((maxX - minX) / cellSize), Math.ceil((maxZ - minZ) / cellSize)];
  const cellStart = new Int32Array(gridCols * gridRows + 1);
  const cellFill = new Int32Array(gridCols * gridRows);
  let cellCars = new Int32Array(64);
  let found = new Int32Array(64);
  let targets = new Float64Array(64);

  let pace = 1; // the share of their cruise and turn speeds cars drive at (less in rain, see step())
  const turnSpeed = (r) => pace * Math.sqrt(t.turnAccel * r);

  // The runs cars drive (#63): along an edge two cars can pass on, a one-way or a two-way whose lanes lie a car and its
  // side gaps apart (Monti's two-way service edges are too narrow), and that comes no nearer than that to another run
  // away from its nodes (two of Monti's service edges leave the map 0.3 m apart). `ways` holds, per run id, the turns on
  // to such runs; with none, the run is a dead end, where cars leave. Through a light junction, no turn from or to a run
  // shorter than `room`: cars don't drive between a light junction and a junction box less than a car from it, as
  // Monti's one light junction has two crossings (#63: a car waiting at the light from one held that crossing up all
  // through the red, and cars that had come out of the junction waited for it). Between two nodes of a crossing group,
  // no turn straight back to the node the car came from; and none on to a run these leave no way on from.
  // `exits` are the runs in from an edge exit, where cars come and go on the map side of its barrier (see comeAt).
  // On a map with edge exits (`through`, Monti), where cars flow through and leave, also none along a run to a dead end
  // (cars would vanish there in view), nor on a run or turn where a car would touch another exit's barrier, or a run
  // out of the map too short to leave by before touching its own (#63 QA: cars drove through them, and a 1.6 m run out
  // put its barrier across a junction: turns there are `barred`); a closed map (a test's) keeps its dead ends.
  const through = nodes.some((n) => n.exit);
  const barriers = map.colliders.filter((c) => c.kind === 'barrier');
  const ownBarrier = (n) => (n.exit ? barriers.find((b) => Math.hypot((b.minX + b.maxX) / 2 - n.x, (b.minZ + b.maxZ) / 2 - n.z) < 2) : null);
  const foot = newBox();
  const footPose = { x: 0, z: 0, heading: 0 };
  const touches = (p, s, b) => {
    poseAt(p, s, footPose);
    return boxesOverlap(corners(footPose, size, foot), b.points);
  };
  // m along each run where a car comes in (a run from an exit) and leaves (one to an exit, `leaveAt`): where its
  // footprint clears the exit's barrier by half a m, at whatever slant the run meets the edge.
  const comeAt = new Float64Array(paths.length);
  const leaveAt = new Float64Array(paths.length);
  for (const p of paths) {
    leaveAt[p.id] = p.length;
    if (p.kind !== 'run') continue;
    const [inner, outer] = [ownBarrier(nodes[p.from]), ownBarrier(nodes[p.to])];
    if (inner) {
      for (comeAt[p.id] = size.length / 2; comeAt[p.id] < p.length && touches(p, comeAt[p.id], inner); ) comeAt[p.id] += 0.25;
      comeAt[p.id] += 0.5;
    }
    if (outer) {
      for (leaveAt[p.id] -= size.length / 2; leaveAt[p.id] >= 0 && touches(p, leaveAt[p.id], outer); ) leaveAt[p.id] -= 0.25;
      leaveAt[p.id] -= 0.5;
    }
  }
  const passable = (e) => e.oneWay || 2 * e.laneOffset >= size.width + 2 * t.sideGap;
  const driven = new Uint8Array(paths.length);
  for (const p of paths) driven[p.id] = p.kind === 'run' && passable(p.edge) && leaveAt[p.id] >= 0 ? 1 : 0;
  const barred = new Uint8Array(paths.length);
  for (const p of paths) {
    const mine = p.kind === 'run' ? [ownBarrier(nodes[p.from]), ownBarrier(nodes[p.to])] : [];
    poseAt(p, 0, footPose);
    const reach = p.length + size.length + 20; // m, a path's farthest point from its start, plus a car and a barrier
    const others = barriers.filter((b) => !mine.includes(b) && Math.hypot(b.minX - footPose.x, b.minZ - footPose.z) < reach);
    for (let s = 0; others.length && (p.kind === 'turn' || driven[p.id]) && !barred[p.id] && s <= leaveAt[p.id]; s += 1) {
      if (!others.some((b) => touches(p, s, b))) continue;
      driven[p.id] = 0;
      barred[p.id] = 1;
    }
  }
  const pass = size.width + 2 * t.sideGap;
  const samples = []; // a pose every m along the driven runs, with its run
  const sampled = createCells(4);
  for (const p of paths) {
    for (let s = 0; driven[p.id] && s <= p.length; s += 1) {
      const q = { p, x: 0, z: 0, heading: 0 };
      poseAt(p, s, q);
      samples.push(q);
      sampled.add(q, q.x, q.z, q.x, q.z);
    }
  }
  const apart = (p, q) => p.edge === q.edge || p.from === q.from || p.from === q.to || p.to === q.from || p.to === q.to;
  for (const a of samples) {
    sampled.some(a.x - pass, a.z - pass, a.x + pass, a.z + pass, ({ p: q, x, z }) => {
      if (q.id > a.p.id && driven[a.p.id] && driven[q.id] && !apart(a.p, q) && Math.hypot(x - a.x, z - a.z) < pass) driven[q.id] = 0;
    });
  }
  const cramped = (turn) =>
    barred[turn.id] || (junctionAt[turn.id] && (turn.in.length < room || turn.out.length < room)) || (groupAt[turn.in.id] && groupAt[turn.out.id] && turn.out.to === turn.in.from);
  let ways;
  for (let changed = true; changed; ) {
    changed = false;
    ways = paths.map((p) => (p.kind === 'run' ? p.next.filter((turn) => driven[turn.out.id] && !cramped(turn)) : null));
    for (const p of paths) {
      if (!driven[p.id] || ways[p.id].length || (!p.next.length && (nodes[p.to].exit || !through))) continue;
      driven[p.id] = 0;
      changed = true;
    }
  }
  const exits = paths.filter((p) => driven[p.id] && nodes[p.from].exit && comeAt[p.id] + size.length < leaveAt[p.id]);

  // m/s each path is driven at, at most: its edge's limit; a turn takes the limit of the edge it turns onto.
  const cruise = new Float64Array(paths.length);
  for (const p of paths) cruise[p.id] = (p.kind === 'run' ? p.edge : p.out.edge).limit / 3.6;
  const top = Math.max(...cruise);

  // Sets the car's pose from its place on its lane, and the prim it is on.
  function place(car) {
    car.prim = poseAt(car.lane, car.s, car);
  }

  // Plans the route of `car` (null for one being made) on to PLAN m past the path it is on, and on out of a crossing
  // group of several nodes, which lets cars in by their way through it (see admit); it stays shorter at a dead end or
  // edge exit, where the car leaves.
  function extend(route, car) {
    let ahead = 0;
    for (let i = 1; i < route.length; i++) ahead += route[i].length;
    while (ahead < PLAN || groupAt[route.at(-1).id]?.list) {
      const last = route.at(-1);
      const next = last.kind === 'run' ? onward(route, last, car) : last.out;
      if (!next) return;
      route.push(next);
      ahead += next.length;
    }
  }
  // A turn on from run `last`, picked at random from the ones that lead to no node the car went through in its last
  // PASSED turns nor, in a crossing group of several nodes, to one of the group the route
  // passed already; from all, should none. #63: cars went round Monti's rings of junctions, its small ones twice at
  // times, holding the others up, and filled a ring of one-way streets until it locked.
  const fresh = (route, turn, car) => !revisits(route, turn) && !(car?.passed && leadsBack(turn, car.passed, route));
  // Whether the turn leads to a node in `passed` or one the route turns at already, at once or by runs with only one
  // way on (#63: a car entering a ring of one-way streets halfway went round it again).
  function leadsBack(turn, passed, route) {
    let run = turn.out;
    for (let k = 0; k < PASSED; k++) {
      if (passed.includes(run.to)) return true;
      for (let i = 0; i < route.length; i++) if (route[i].kind === 'turn' && route[i].node === run.to) return true;
      if (ways[run.id].length !== 1) return false;
      run = ways[run.id][0].out;
    }
    return false;
  }
  function onward(route, last, car) {
    const list = ways[last.id];
    let n = 0;
    for (let i = 0; i < list.length; i++) if (fresh(route, list[i], car)) n++;
    if (!n) return pick(list);
    let k = Math.floor(random() * n);
    for (let i = 0; i < list.length; i++) if (fresh(route, list[i], car) && k-- === 0) return list[i];
  }
  function revisits(route, turn) {
    const g = groupAt[turn.id];
    if (!g || groupAt[turn.out.id] !== g) return false;
    for (let i = route.length - 1; i >= 0 && groupAt[route[i].id] === g; i--) if (route[i].kind === 'turn' && route[i].node === turn.out.to) return true;
    return false;
  }

  // shortcut: "out of view" is far enough away and not within `spawnView` of the truck's heading, ahead or behind, nor
  // of the line across it: the street the cameras look along and the one the truck may stand at a junction of; the
  // blocks hide the rest. Across open ground cars can still appear or vanish in view; upgrade to a real line-of-sight
  // test if players notice.
  const viewCos = Math.cos(t.spawnView);
  const hidden = (at, truck, distance) => outOfView(at, truck, distance, viewCos);

  // Where a new car may appear: every 10 m along each driven lane run but the ones in a crossing group (between its
  // nodes), clear of its ends by half a car; and at each edge exit, just past its barrier.
  const slots = [];
  const slotAt = (path, s) => {
    const slot = { path, s, x: 0, z: 0, heading: 0 };
    poseAt(path, s, slot);
    return slot;
  };
  for (const p of paths) {
    if (!driven[p.id] || groupAt[p.id]) continue;
    for (let s = Math.max(size.length / 2, comeAt[p.id]); s <= Math.min(p.length - size.length / 2, leaveAt[p.id]); s += 10) slots.push(slotAt(p, s));
  }
  const exitSlots = exits.map((p) => slotAt(p, comeAt[p.id]));

  // One new car, standing, on a random hidden lane place in the spawn ring (for a police car, from outside its sight
  // radius as far out as the city goes, so it never witnesses as it appears) with no other car within the look-ahead;
  // or, for an `exitSpawn` share of them, at a hidden edge exit in the ring, coming in from beyond the map. The
  // place is drawn at random until one fits, up to SPAWN_TRIES times, so every place that does is as likely; with none
  // found, the next step tries again.
  const SPAWN_TRIES = 64; // a ring of ~1/13 of the places: under 1 % of calls in an empty city find none
  const clear = (p) => {
    for (let i = 0; i < cars.length; i++) if ((cars[i].x - p.x) ** 2 + (cars[i].z - p.z) ** 2 < t.lookAhead ** 2) return false;
    return true;
  };
  function spawn(truck, police) {
    const near = police ? Math.max(t.spawnDistance[0], tables.police.radius) : t.spawnDistance[0];
    const far = police ? Infinity : t.spawnDistance[1];
    const atExit = exitSlots.length > 0 && random() < t.exitSpawn; // no draw on a map without exits
    const list = atExit ? exitSlots : slots;
    let at = null;
    for (let i = 0; i < SPAWN_TRIES && !at && list.length; i++) {
      const p = pick(list);
      const d2 = (p.x - truck.x) ** 2 + (p.z - truck.z) ** 2;
      if (hidden(p, truck, near) && d2 <= far ** 2 && clear(p)) at = p;
    }
    if (!at) return;
    const { path, s } = at;
    const route = [path];
    extend(route);
    const car = { id: nextId++, x: 0, z: 0, heading: 0, speed: 0, lane: path, route, s, prev: null, police, prim: null, via: null, at: null, seen: -1, since: 0, first: 0, passed: new Int32Array(PASSED).fill(-1), turns: 0, stopped: null };
    place(car);
    cars.push(car);
  }

  // Sets `out` to the footprint corners of a vehicle (x, z, heading) of the given length and width, in order.
  function corners({ x, z, heading }, { length, width }, out) {
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    for (let i = 0; i < 4; i++) {
      const a = (length / 2) * SIGNS[i][0];
      const b = (width / 2) * SIGNS[i][1];
      out[i].x = x + fx * a - fz * b;
      out[i].z = z + fz * a + fx * b;
    }
    return out;
  }

  // How far ahead of the car's centre the nearest part of `box` (corners, in order) lies within the car's
  // path, as wide as the car plus `sideGap` each side. Infinity when it isn't in the path or lies behind.
  const along = new Float64Array(4); // scratch: the corners along the car's heading and to its right
  const right = new Float64Array(4);
  function aheadOf(car, box) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const w = size.width / 2 + t.sideGap;
    for (let i = 0; i < 4; i++) {
      along[i] = (box[i].x - car.x) * fx + (box[i].z - car.z) * fz;
      right[i] = -(box[i].x - car.x) * fz + (box[i].z - car.z) * fx;
    }
    let near = Infinity;
    let far = -Infinity;
    // Plain locals and loops here and in separates(): array destructuring would allocate on every call.
    for (let i = 0; i < 4; i++) {
      const pa = along[i];
      const pr = right[i];
      const qa = along[(i + 1) % 4];
      const qr = right[(i + 1) % 4];
      if (Math.abs(pr) <= w) {
        near = Math.min(near, pa);
        far = Math.max(far, pa);
      }
      for (let k = 0; k < 2; k++) {
        const side = k ? w : -w;
        if ((pr - side) * (qr - side) >= 0) continue;
        const a = pa + ((qa - pa) * (side - pr)) / (qr - pr);
        near = Math.min(near, a);
        far = Math.max(far, a);
      }
    }
    return far > 0 ? near : Infinity;
  }

  // Whether `other` drives ahead of `car` in roughly its direction, or turns off it (a slow car half way
  // round a corner is still in the way); never true both ways round, so two cars can't wait for each other.
  const ahead = (from, to) => (to.x - from.x) * Math.sin(from.heading) + (to.z - from.z) * Math.cos(from.heading);
  function follows(car, other) {
    const turn = Math.abs(Math.atan2(Math.sin(other.heading - car.heading), Math.cos(other.heading - car.heading)));
    return turn < (other.prim.r ? Math.PI / 2 : Math.PI / 4) && ahead(car, other) > 0 && ahead(other, car) < 0;
  }

  // The grid column or row of a position, clamped to the map, and the cell of a car.
  const cellOf = (v, n) => Math.min(Math.max(Math.floor(v / cellSize), 0), n - 1);
  const cell = (c) => cellOf(c.z - minZ, gridRows) * gridCols + cellOf(c.x - minX, gridCols);

  // Fills the grid with the car indices, from the cars' positions now.
  function fillGrid() {
    if (cellCars.length < cars.length) [cellCars, found] = [new Int32Array(cars.length * 2), new Int32Array(cars.length * 2)];
    cellStart.fill(0);
    for (const c of cars) cellStart[cell(c) + 1]++;
    for (let i = 0; i < gridCols * gridRows; i++) cellStart[i + 1] += cellStart[i];
    cellFill.set(cellStart.subarray(0, gridCols * gridRows));
    for (let i = 0; i < cars.length; i++) cellCars[cellFill[cell(cars[i])]++] = i;
  }

  // Puts the indices of the cars that may be within `r` m of (x, z) into `found` (more, by whole cells; the
  // caller checks the distance) and returns how many. Cars off the map count in the edge cells.
  function nearby(x, z, r) {
    let n = 0;
    for (let row = cellOf(z - minZ - r, gridRows); row <= cellOf(z - minZ + r, gridRows); row++) {
      for (let col = cellOf(x - minX - r, gridCols); col <= cellOf(x - minX + r, gridCols); col++) {
        for (let k = cellStart[row * gridCols + col]; k < cellStart[row * gridCols + col + 1]; k++) found[n++] = cellCars[k];
      }
    }
    return n;
  }

  // Who may drive into each unsignalled crossing that has traffic at it: sets the crossing group's `go` to the bits
  // of the approaches that may. Vehicles in a crossing, or too close to stop before it at `maxBrake`, hold it for
  // their approach (the truck for none, while it moves). With nobody in it, it goes to the first vehicle of an
  // approach that gives way to none of the others there: to none of a higher road class, nor of an equal one on its
  // right. When every approach there gives way to another, none would go, so the first to arrive goes (the first
  // vehicle of its approach the longest), and if that is the truck the cars wait for it. Of several that may go the
  // same, also the first to arrive. Beside the approaches in it (or the one that goes), another may drive in when its
  // move goes with theirs, coming straight at them with the same move, straight on or right (#69), and when it gives
  // way to no approach waiting there whose move doesn't. The truck counts as arriving while it drives towards the
  // crossing, and while it stands at its line (within `truckLine`) for up to `truckHold` s: after that a player waiting
  // there is letting the cars go, and a parked truck doesn't hold them up for good.
  const atCrossings = []; // scratch: the groups with traffic at them this step
  let truckAt = null; // the crossing group the truck is the first vehicle of an approach to, since step `truckSince`
  let truckSince = 0;
  let truckStill = 0; // s the truck has stood still
  // In steps, as `since` counts.
  const patience = t.patience / tables.loop.step;
  function at(g) {
    if (g.stamp === now) return g;
    g.stamp = now;
    g.inside = 0;
    g.blocked = false;
    g.kinds.fill(0);
    g.occupied?.fill(0);
    for (let a = 0; a < g.approaches.length; a++) g.approaches[a].front.on = false;
    atCrossings.push(g);
    return g;
  }
  function hold(g, a, kind) {
    at(g);
    if (a < 0) g.blocked = true;
    else {
      g.inside |= bit(a);
      g.kinds[a] |= kind;
    }
  }
  // Car `car` (the truck for null) first of approach a, `short` m from it, on route path `i` into it.
  function arrive(g, a, car, short, kind, i) {
    const f = at(g).approaches[a].front;
    if (f.on && f.short <= short) return;
    f.on = true;
    f.car = car;
    f.short = short;
    f.kind = kind;
    f.at = i;
  }
  // A car in crossing group g holds it for the approach it drove in by; in one of several nodes, the paths there it
  // still drives from route path `i` on (the one its rear is on for -1).
  function holdFor(g, car, i) {
    hold(g, car.via && groupAt[car.via.id] === g ? approachAt[car.via.id] : -1, car.via ? moveAt[car.via.id] : OTHER);
    if (!g.occupied) return;
    if (i < 0) g.occupied[localAt[car.prev.id]] = 1;
    else mark(g, car, i, g.occupied);
  }
  // Marks in `set` the paths of group g (of several nodes) on the car's route from path `i` on, as long as it stays in g.
  function mark(g, car, i, set) {
    for (let k = i; k < car.route.length && groupAt[car.route[k].id] === g; k++) set[localAt[car.route[k].id]] = 1;
  }
  // Whether one of those paths comes too near one marked in `set` (see clash).
  function clashes(g, car, i, set) {
    for (let k = i; k < car.route.length && groupAt[car.route[k].id] === g; k++) {
      const near = g.clash[localAt[car.route[k].id]];
      for (let n = 0; n < near.length; n++) if (set[near[n]]) return true;
    }
    return false;
  }

  function rightOfWay(truck) {
    atCrossings.length = 0;
    for (let ci = 0; ci < cars.length; ci++) {
      const car = cars[ci];
      const lg = groupAt[car.lane.id];
      if (lg) holdFor(lg, car, 0);
      const pg = car.prev && car.s < size.length / 2 ? groupAt[car.prev.id] : null; // its rear still in one
      if (pg && pg !== lg) holdFor(pg, car, -1);
      let dist = car.lane.length - car.s; // centre to the start of the next path
      for (let i = 1; i < car.route.length; i++) {
        const p = car.route[i];
        const short = dist - size.length / 2; // front bumper to the crossing
        const g = groupAt[p.id];
        const entering = g && g !== groupAt[car.route[i - 1].id];
        dist += p.length;
        if (!entering || short > t.giveWay) continue;
        // A car waiting for room past the crossing, or behind the truck, doesn't hold it up for the others.
        if (!stoppable(car, short)) {
          hold(g, approachAt[p.id], moveAt[p.id]);
          if (g.occupied) mark(g, car, i, g.occupied);
        } else if (!exitBlocked(car, i, truck) && !(g.truck === now && truckBlocks(car, i, truck)) && aheadOf(car, truckBox) - size.length / 2 >= short) {
          arrive(g, approachAt[p.id], car, short, moveAt[p.id], i);
        }
      }
    }

    // The truck in a crossing or light junction (holding a crossing for nobody while it moves, see truckBlocks),
    // or driving towards a crossing within `giveWay` along the road.
    const moving = Math.abs(truck.speed) > tables.vehicle.stopSpeed;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (!truckIn(g, truck)) continue;
      g.truck = now;
      if (moving) hold(g, -1, OTHER);
    }
    for (let i = 0; i < junctions.length; i++) if (truckIn(junctions[i], truck)) junctions[i].truck = now;
    const n = truckGoing(truck, truckStill < t.truckHold) ? truckCount : 0;
    for (let k = 0; k < n; k++) {
      const { node, slot, short, behind } = truckNodes[k];
      const g = groupOfNode[node];
      const run = slot >= 0 ? nodes[node].slots[slot].in : null; // none against a one-way
      if (behind || !g || !run || approachAt[run.id] < 0 || short <= 0 || short > (moving ? t.giveWay : t.truckLine)) continue;
      if (truckNodes[0].behind && groupOfNode[truckNodes[0].node] === g) continue; // on from a node of the same crossing
      arrive(g, approachAt[run.id], null, short, OTHER, -1);
    }

    // When each first vehicle arrived: a car or the truck that was already the first of an approach to this
    // crossing a step ago keeps its step, a new one gets this one.
    const truckWas = truckAt;
    truckAt = null;
    for (let i = 0; i < atCrossings.length; i++) {
      const g = atCrossings[i];
      for (let a = 0; a < g.approaches.length; a++) {
        const w = g.approaches[a].front;
        if (!w.on) continue;
        const c = w.car;
        if (c) {
          if (c.at !== g || c.seen !== now - 1) c.since = now;
          if (c.at !== g) c.first = now; // kept while it drops out for a step (its exit queued a moment, say)
          c.at = g;
          c.seen = now;
          w.since = c.since;
          w.first = c.first;
        } else {
          if (truckWas !== g) truckSince = now;
          truckAt = g;
          w.since = truckSince;
        }
      }
    }

    for (let i = 0; i < atCrossings.length; i++) {
      const g = atCrossings[i];
      g.go = 0;
      if (g.blocked) continue;
      if (g.list) {
        admit(g);
        continue;
      }
      const A = g.approaches;
      let inside = g.inside;
      // A car that has given way `patience` s since it first got there goes next (#63: a stream from its right held one
      // there 44 s and more; one merging into a steady stream, 150 s): no one else drives in, and once the crossing is
      // clear it does. Not while the truck is there: it has truckHold.
      let waited = -1;
      for (let a = 0; a < A.length; a++) {
        const w = A[a].front;
        if (w.on && !w.car) waited = -2;
        if (waited === -2) break;
        if (w.on && !(inside & bit(a)) && now - w.first > patience && (waited < 0 || w.first < A[waited].front.first)) waited = a;
      }
      if (waited >= 0) {
        if (!inside) g.go = bit(waited);
        continue;
      }
      if (!inside) {
        let anyFree = false;
        for (let a = 0; a < A.length; a++) anyFree ||= A[a].front.on && free(g, a);
        // The approach that goes: a free car's, the first to arrive (the lowest id on the same step, the truck's 0).
        let first = -1;
        for (let a = 0; a < A.length; a++) {
          const w = A[a].front;
          if (!w.on || (anyFree && (!w.car || !free(g, a)))) continue;
          const v = first < 0 ? null : A[first].front;
          if (!v || w.since < v.since || (w.since === v.since && (w.car?.id ?? 0) < (v.car?.id ?? 0))) first = a;
        }
        if (first < 0 || !A[first].front.car) continue;
        inside = bit(first);
        g.kinds[first] = A[first].front.kind;
      }
      for (let a = 0; a < A.length; a++) if (joins(g, a, inside)) g.go |= bit(a);
    }
  }

  // Who may drive into a crossing group of several nodes (#63: on Monti such groups are up to 70 m across, and one
  // approach at a time held cars there over 40 s): the first vehicle of each approach in turn, each car if none of its
  // paths through the group clashes with one a car in it still drives (see clash), nor with one of a vehicle before it
  // in turn. The turn: a car that has given way `patience` s, then one that gives way to none of the others whose way
  // clashes with its own; the first to arrive of each. After the truck, nobody.
  function admit(g) {
    const A = g.approaches;
    g.reserved.fill(0);
    let left = 0;
    for (let a = 0; a < A.length; a++) if (A[a].front.on) left |= bit(a);
    let truck = false;
    while (left) {
      let next = -1;
      let rank = 0;
      for (let a = 0; a < A.length; a++) {
        if (!(left & bit(a))) continue;
        const w = A[a].front;
        const r = w.car && now - w.first > patience ? 0 : unhindered(g, a, left) ? 1 : 2;
        const v = next < 0 ? null : A[next].front;
        if (!v || r < rank || (r === rank && (w.since < v.since || (w.since === v.since && (w.car?.id ?? 0) < (v.car?.id ?? 0))))) [next, rank] = [a, r];
      }
      left &= ~bit(next);
      const w = A[next].front;
      if (!w.car) truck = true;
      if (truck) continue;
      if (!clashes(g, w.car, w.at, g.occupied) && !clashes(g, w.car, w.at, g.reserved)) g.go |= bit(next);
      mark(g, w.car, w.at, g.reserved);
    }
  }
  // Whether the first vehicle of approach a of group g gives way to none of the others in `left` (bits) whose way
  // through the group clashes with its own (the truck's always does).
  function unhindered(g, a, left) {
    const A = g.approaches;
    const w = A[a].front;
    for (let b = 0; b < A.length; b++) {
      if (b === a || !(left & bit(b)) || !yields(A, a, b)) continue;
      const v = A[b].front;
      if (!w.car || !v.car) return false;
      g.scratch.fill(0);
      mark(g, v.car, v.at, g.scratch);
      if (clashes(g, w.car, w.at, g.scratch)) return false;
    }
    return true;
  }

  // Whether approach a of group g gives way to approach b: one of a higher road class, or of the same on its right.
  const yields = (A, a, b) => A[b].rank > A[a].rank || (A[b].rank === A[a].rank && A[a].right === b);
  // Whether approach a's move `ka` goes with approach b's moves `kb` (bits): coming straight at each other, both
  // straight on or both turning right.
  const goesWith = (A, a, ka, b, kb) => A[a].opposite === b && (ka === MOVES.straight || ka === MOVES.right) && kb === ka;
  // Whether approach a of group g has a front that gives way to none of the others there.
  function free(g, a) {
    const A = g.approaches;
    for (let b = 0; b < A.length; b++) if (b !== a && A[b].front.on && yields(A, a, b)) return false;
    return true;
  }
  // Whether approach a of group g may drive in beside the approaches `inside` (bits): its move goes with theirs, and
  // one not in it yet gives way to no approach waiting there whose move doesn't go with it. Through a crossing of
  // several nodes, a car follows the ones of its own approach in it only on the same first turn (#63: on another, it
  // met them again at a node further on).
  function joins(g, a, inside) {
    const A = g.approaches;
    const w = A[a].front;
    const ka = w.on ? w.kind : 0;
    for (let b = 0; b < A.length; b++) if (b !== a && inside & bit(b) && !goesWith(A, a, ka, b, g.kinds[b])) return false;
    if (inside & bit(a)) return true;
    if (!w.on || !w.car) return false;
    for (let b = 0; b < A.length; b++) if (b !== a && A[b].front.on && yields(A, a, b) && !goesWith(A, a, ka, b, A[b].front.kind)) return false;
    return true;
  }

  // Whether the truck's footprint overlaps the box (`hulls`, see hullOf) of a crossing group or light junction:
  // first whether its centre is within `reach` of the box's centre (x, z), so most boxes cost one test a step.
  function truckIn(box, truck) {
    if ((box.x - truck.x) ** 2 + (box.z - truck.z) ** 2 > box.reach ** 2) return false;
    for (const hull of box.hulls) if (!separates(hull, hull.length, hull, truckBox) && !separates(truckBox, 2, hull, truckBox)) return true;
    return false;
  }
  // Sets the box's centre and reach (see truckIn) from its hulls.
  function around(box) {
    const points = box.hulls.flat();
    box.x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    box.z = points.reduce((sum, p) => sum + p.z, 0) / points.length;
    box.reach = Math.max(...points.map((p) => Math.hypot(p.x - box.x, p.z - box.z))) + truckRadius;
  }

  // The junction nodes the truck's front bumper is in or faces along its edge (see graph.along), found once a step
  // into the scratch `truckNodes`: the node it is in past the middle (`behind`), then the one ahead, each with the
  // `slot` of the arm it drives in by (-1 for none) and `short`, the m from the bumper to the node's box, negative in
  // it. `truckCount` is how many.
  const truckNodes = [0, 1].map(() => ({ node: 0, slot: -1, short: 0, behind: false }));
  let truckCount = 0;
  function setNode(k, node, slot, short, behind) {
    const n = truckNodes[k];
    n.node = node;
    n.slot = slot;
    n.short = short;
    n.behind = behind;
  }
  function truckAhead(truck) {
    const fx = Math.sin(truck.heading);
    const fz = Math.cos(truck.heading);
    const on = map.graph.along(truck.x + (fx * truckSize.length) / 2, truck.z + (fz * truckSize.length) / 2, fx, fz);
    let n = 0;
    if (!on) return n;
    const { edge: e, next, last } = on;
    if (junctionNode(last) && on.behind < nodes[last].radius) {
      // The arm it drove in by: the one coming most nearly its way.
      let slot = -1;
      nodes[last].slots.forEach(({ angle }, k) => {
        if (-Math.cos(angle) * fx - Math.sin(angle) * fz > Math.SQRT1_2) slot = k;
      });
      setNode(n++, last, slot, -nodes[last].radius - on.behind, true);
    }
    if (junctionNode(next)) setNode(n++, next, on.forward ? nodes[next].arms.lastIndexOf(e.id) : nodes[next].arms.indexOf(e.id), on.ahead - nodes[next].radius, false);
    return n;
  }
  // Whether the truck drives forwards, or (if `still` counts) stands.
  function truckGoing(truck, still) {
    const { stopSpeed } = tables.vehicle;
    return truck.speed > stopSpeed || (still && Math.abs(truck.speed) <= stopSpeed);
  }

  // Who is at each light junction: sets the junction's bits (see junctions) to the slots of the arms the cars in
  // it (`inside`) or arriving within `giveWay` came by, and of the truck driving in. Of the cars arriving, only the
  // first of each approach counts: the ones queued behind it can't go before it (#46: two opposite left turners each
  // waited for a car going straight behind the other). A car turning left there waits for those coming towards it,
  // and they wait for it once it is past stopping. Two turning left from opposite sides would meet in the middle, so
  // they take turns: the one past stopping goes, and of two that can stop, the one on the lower slot, unless it waits
  // for traffic coming the other way itself (the truck queued behind the other turner, say, which would then wait
  // for good). No car drives in while one of the other axis is still in it (stuck behind the truck when the lights
  // changed, say).
  function junction(j) {
    if (j && j.stamp !== now) {
      j.stamp = now;
      j.seen = j.left = j.leftIn = j.inside = 0;
      j.first.fill(Infinity);
    }
    return j;
  }
  // Whether a car driving into the light junction on turn `p` must let the others there go first.
  const yieldsAt = (p) => {
    const j = junctionAt[p.id];
    if (j?.stamp !== now) return false;
    const opposite = j.opposite[p.slot];
    const first = opposite >= 0 && p.slot > opposite && (j.seen & bit(p.slot)) === 0; // the other turner can go first
    const towards = p.move === 'left' ? j.seen | j.leftIn | (first ? j.left : 0) : j.leftIn;
    return ((opposite >= 0 ? towards & bit(opposite) : 0) | (j.inside & j.across[p.slot])) !== 0;
  };
  function atJunctions(truck) {
    for (let ci = 0; ci < cars.length; ci++) {
      const car = cars[ci];
      let dist = -car.s; // centre to the start of the path
      for (let i = 0; i < car.route.length; i++) {
        const p = car.route[i];
        const short = dist - size.length / 2;
        const j = short <= t.giveWay ? junction(junctionAt[p.id]) : null;
        if (j) j.first[p.slot] = Math.min(j.first[p.slot], short);
        dist += p.length;
      }
    }
    for (let ci = 0; ci < cars.length; ci++) {
      const car = cars[ci];
      const rear = car.prev && car.s < size.length / 2 ? junction(junctionAt[car.prev.id]) : null;
      if (rear) rear.inside |= bit(car.prev.slot);
      const j = junction(junctionAt[car.lane.id]);
      if (j) j.inside |= bit(car.lane.slot);
      let dist = -car.s; // centre to the start of the path
      for (let i = 0; i < car.route.length; i++) {
        const p = car.route[i];
        const short = dist - size.length / 2;
        const j = short <= t.giveWay ? junctionAt[p.id] : null;
        if (j && j.first[p.slot] === short) {
          if (p.move !== 'left') j.seen |= bit(p.slot);
          else if (stoppable(car, short)) j.left |= bit(p.slot);
          else j.leftIn |= bit(p.slot);
        }
        dist += p.length;
      }
    }
    const n = truckGoing(truck, false) ? truckCount : 0;
    for (let k = 0; k < n; k++) {
      const { node, slot, short } = truckNodes[k];
      const j = slot >= 0 && short <= t.giveWay ? junction(junctionOfNode[node]) : null;
      if (j) j.seen |= bit(slot);
    }
  }

  // Don't block the box: whether the lane just past the box (crossing or light junction) that route path `i`
  // drives into has no room for the car, because a car or the truck slower than `boxSpeed` is less than a car
  // length and `followGap` beyond it. False while the planned route ends inside the box.
  // m from the exit to the centre of a car that can be queued there: the far corner of the strip `room` long,
  // plus half the car's diagonal, plus 1 m to spare against rounding
  const queueReach = Math.hypot(room, size.width / 2 + t.sideGap) + Math.hypot(size.length, size.width) / 2 + 1;
  const queued = (box, speed) => Math.abs(speed) < t.boxSpeed && aheadOf(exitPose, box) < room;
  function exitBlocked(car, i, truck) {
    let j = i;
    while (car.route[j] && boxOf(car.route[j]) === boxOf(car.route[i])) j++;
    if (!car.route[j]) return false;
    poseAt(car.route[j], 0, exitPose);
    if (queued(truckBox, truck.speed)) return true;
    for (let k = nearby(exitPose.x, exitPose.z, queueReach) - 1; k >= 0; k--) {
      const c = cars[found[k]];
      if (c !== car && queued(footprints[found[k]], c.speed)) return true;
    }
    return false;
  }

  // Whether the truck blocks the car's way through the box (crossing or light junction) that route path `i`
  // drives into, the truck standing in it: at some point along the car's paths in that box, sampled at most
  // 1 m apart, the truck is in the room the car keeps (see behind): `sideGap` each side and `followGap` in
  // front. A truck moving in a box blocks every way through.
  const pathSize = { length: size.length + t.followGap, width: size.width + 2 * t.sideGap };
  function truckBlocks(car, i, truck) {
    if (Math.abs(truck.speed) > tables.vehicle.stopSpeed) return true;
    for (let j = i; car.route[j] && boxOf(car.route[j]) === boxOf(car.route[i]); j++) {
      const p = car.route[j];
      const n = Math.ceil(p.length);
      for (let k = 0; k <= n; k++) {
        poseAt(p, n ? (k * p.length) / n : 0, pathPose);
        pathPose.x += (Math.sin(pathPose.heading) * t.followGap) / 2;
        pathPose.z += (Math.cos(pathPose.heading) * t.followGap) / 2;
        if (boxesOverlap(corners(pathPose, pathSize, pathBox), truckBox)) return true;
      }
    }
    return false;
  }

  // Whether the car can still stop `short` m ahead at `maxBrake`.
  const stoppable = (car, short) => short > 0 && car.speed ** 2 <= 2 * t.maxBrake * short;
  // The fastest a car may go to stop within `gap` m at `brake`, or to slow to `end` m/s there.
  const limit = (gap, end = 0) => Math.sqrt(end ** 2 + 2 * t.brake * Math.max(0, gap));

  // The fastest the car may go now: cruise, slower round curves, and able to stop at `brake` before a stop
  // line that isn't green, traffic in a light junction it must let go first (see atJunctions), a crossing it
  // may not drive into yet, a box whose exit is queued up or where the truck stands in its way, and behind the
  // car or truck ahead. A light it can't stop for at `maxBrake` (it turned amber too late) is driven through.
  // Goes into targets[ci] for cars[ci]: a returned number would be boxed on every call.
  function targetSpeed(ci, truck, lights) {
    const car = cars[ci];
    curves(ci);
    limits(ci);
    let speed = targets[ci];
    let dist = car.lane.length - car.s; // centre to the start of the next path
    for (let i = 1; i < car.route.length; i++) {
      const p = car.route[i];
      const light = lightAt[p.id] >= 0 ? lights[lightAt[p.id]] : undefined;
      const short = dist - size.length / 2; // front bumper to the path's start
      const g = groupAt[p.id];
      const barred = g && g !== groupAt[car.route[i - 1].id] && g.stamp === now && !(g.go & bit(approachAt[p.id]));
      const box = boxOf(p);
      const held = light && (light.phase !== 'green' || yieldsAt(p));
      const wait = held || barred || (box && box !== boxOf(car.route[i - 1]) && ((box.truck === now && truckBlocks(car, i, truck)) || exitBlocked(car, i, truck)));
      if (wait && stoppable(car, short)) speed = Math.min(speed, limit(short - t.stopGap));
      // A light holds a car at its stop line, `lineBack` before the junction, while it can stop there; one past the
      // line (it stopped there for the box) waits at the junction. Turning left on green, it yields at the line too:
      // from the junction (#70 review) the autopilot run met 4 cars instead of none.
      if (held && stoppable(car, short - lineBack)) speed = Math.min(speed, limit(short - lineBack - t.stopGap));
      // At a stop approach it stands still at the line (within tables.stopSign.reach of the junction) once, then goes on.
      if (stopAt[p.id] && car.stopped !== p) {
        if (car.speed === 0 && short <= tables.stopSign.reach) car.stopped = p;
        else if (stoppable(car, short)) speed = Math.min(speed, limit(short - t.stopGap));
      }
      dist += p.length;
    }
    targets[ci] = speed;
    // Looking ahead along the heading; on a curve also from its end, so a queue just round the corner is seen
    // before the car is half way round.
    behind(ci, car, 0);
    if (car.prim.r) behindCurve(ci, car);
    behindTurnedOff(ci, car);
  }

  // Sets targets[ci] to the fastest cars[ci] may go round the curves on its route: on the one it is on, and able
  // to slow to the speed of each one ahead by its start; and no faster than the limit of the path it is on. Apart from
  // targetSpeed, as are limits(), behindCurve() and behind(), so V8 still inlines the small helpers they call (#61: one
  // function holding them all allocated twice as much; #63 again, with the limits in here).
  const curveReach = top ** 2 / (2 * t.brake); // m from which a curve or limit can't slow a car below cruise
  function curves(ci) {
    const car = cars[ci];
    let speed = Math.min(pace * cruise[car.lane.id], car.prim.r ? turnSpeed(car.prim.r) : top);
    let dist = -car.s; // centre to the start of the path
    for (let i = 0; i < car.route.length && dist < curveReach; i++) {
      const p = car.route[i];
      for (let k = 0; k < p.prims.length; k++) {
        const prim = p.prims[k];
        if (prim.r && dist + prim.at > 0) speed = Math.min(speed, limit(dist + prim.at, turnSpeed(prim.r)));
      }
      dist += p.length;
    }
    targets[ci] = speed;
  }

  // Caps targets[ci] so cars[ci] slows to the limit of each path ahead by the time its front bumper gets there (#63).
  function limits(ci) {
    const car = cars[ci];
    let dist = car.lane.length - car.s; // centre to the start of route path i
    for (let i = 1; i < car.route.length && dist < curveReach; i++) {
      const p = car.route[i];
      targets[ci] = Math.min(targets[ci], limit(dist - size.length / 2, pace * cruise[p.id]));
      dist += p.length;
    }
  }

  function behindCurve(ci, car) {
    const end = car.prim.at + car.prim.length;
    poseAt(car.lane, end, turnEnd);
    behind(ci, turnEnd, end - car.s);
  }

  // Caps targets[ci] to keep `followGap` behind the car or truck ahead of `view`; `extra` is the lane from
  // cars[ci] to that view.
  const reach = t.lookAhead + size.length;
  function behind(ci, view, extra) {
    for (let k = nearby(view.x, view.z, reach) - 1; k >= 0; k--) {
      const other = cars[found[k]];
      if (found[k] === ci || (other.x - view.x) ** 2 + (other.z - view.z) ** 2 > reach ** 2 || !follows(view, other)) continue;
      targets[ci] = Math.min(targets[ci], limit(extra + aheadOf(view, footprints[found[k]]) - size.length / 2 - t.followGap));
    }
    targets[ci] = Math.min(targets[ci], limit(extra + aheadOf(view, truckBox) - size.length / 2 - t.followGap));
  }

  // Caps targets[ci] to keep `followGap` behind a car that turned off the car's route less than a car's length ago,
  // where its footprint is in the car's way, whichever way it now faces (#63: one stopped just round a tight right turn
  // on Monti, its rear still across the junction, was hit by the next car turning left; follows() let it go).
  function behindTurnedOff(ci, car) {
    for (let k = nearby(car.x, car.z, reach) - 1; k >= 0; k--) {
      const other = cars[found[k]];
      if (found[k] === ci || other.s >= size.length || !other.prev) continue;
      let off = other.prev === car.lane;
      let dist = car.lane.length - car.s; // centre to the start of route path i
      for (let i = 1; i < car.route.length && dist < reach && !off; i++) {
        off = other.prev === car.route[i];
        dist += car.route[i].length;
      }
      if (off) targets[ci] = Math.min(targets[ci], limit(aheadOf(car, footprints[found[k]]) - size.length / 2 - t.followGap));
    }
  }

  // Drops cars that left the road or (police aside) the truck's surroundings, spawns one while fewer than `count`
  // and a police car while fewer than tables.police.count, then drives each car at `share` of their cruise and turn
  // speeds; the ones in `held` (ids, a Set or Map) stand still.
  function step(dt, truck, lights, count, held = new Set(), share = 1) {
    pace = share;
    let police = 0;
    for (let i = cars.length - 1; i >= 0; i--) {
      if (cars[i].gone || (!cars[i].police && hidden(cars[i], truck, t.despawnDistance))) cars.splice(i, 1);
      else if (cars[i].police) police++;
    }
    if (cars.length - police < count) spawn(truck, false);
    if (police < tables.police.count) spawn(truck, true);

    now++;
    truckStill = Math.abs(truck.speed) > tables.vehicle.stopSpeed ? 0 : truckStill + dt;
    for (let i = 0; i < cars.length; i++) {
      if (!cars[i].prim) place(cars[i]); // added from outside (the tests do)
      corners(cars[i], size, (footprints[i] ??= newBox()));
    }
    corners(truck, truckSize, truckBox);
    fillGrid();
    truckCount = truckAhead(truck);
    rightOfWay(truck);
    atJunctions(truck);
    if (targets.length < cars.length) targets = new Float64Array(cars.length * 2);
    for (let i = 0; i < cars.length; i++) targetSpeed(i, truck, lights);
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      car.speed = held.has(car.id) ? 0 : Math.min(targets[i], car.speed + t.accel * dt);
      car.s += car.speed * dt;
      while (car.s >= (car.route.length === 1 ? leaveAt[car.lane.id] : car.lane.length)) {
        if (car.route.length === 1) {
          car.gone = true; // dead end or edge exit
          break;
        }
        car.s -= car.lane.length;
        car.prev = car.route.shift(); // its rear may still be in that box
        if (car.passed && car.prev.kind === 'turn') car.passed[car.turns++ % PASSED] = car.prev.node;
        extend(car.route, car);
        car.lane = car.route[0];
        if (car.lane === car.stopped) car.stopped = null; // done with that stop: next time by it, it stops again
        if (groupAt[car.lane.id] && approachAt[car.lane.id] >= 0) car.via = car.lane;
      }
      if (!car.gone) place(car);
    }
  }

  // The cars whose footprint overlaps `box` (corners in order). Cars too far for their bounding circles to
  // meet are skipped before the exact test.
  const carRadius = Math.hypot(size.length, size.width) / 2;
  function touchingCars(box) {
    const [cx, cz] = [(box[0].x + box[2].x) / 2, (box[0].z + box[2].z) / 2];
    const r = Math.hypot(box[0].x - box[2].x, box[0].z - box[2].z) / 2 + carRadius + 0.01; // 1 cm against rounding
    const out = [];
    for (const c of cars) if ((c.x - cx) ** 2 + (c.z - cz) ** 2 <= r ** 2 && boxesOverlap(box, corners(c, size, probe))) out.push(c);
    return out;
  }

  return { cars, step, touching: touchingCars };
}

// Whether `at` is out of the truck's view: `distance` m away or more and off the lines along and across the truck by
// more than the angle whose cosine is `viewCos` (see hidden above). `at` is a car, pedestrian or spawn place: passing
// its x and z would box them on every call.
export function outOfView(at, truck, distance, viewCos) {
  const dx = at.x - truck.x;
  const dz = at.z - truck.z;
  const away = dx * dx + dz * dz;
  const along = dx * Math.sin(truck.heading) + dz * Math.cos(truck.heading);
  const across = dx * Math.cos(truck.heading) - dz * Math.sin(truck.heading);
  return away >= distance ** 2 && along * along < away * viewCos * viewCos && across * across < away * viewCos * viewCos;
}

// Separating-axis test of two boxes, each given by its four corners in order, at any headings; touching
// isn't overlapping (within a µm, so vehicles exactly side by side in their lanes don't count).
function boxesOverlap(a, b) {
  return !separates(a, 2, a, b) && !separates(b, 2, a, b);
}

// Whether a normal of one of the first `sides` sides of convex polygon `poly` separates the convex polygons a and b
// (a box needs only two: the others are parallel to them).
function separates(poly, sides, a, b) {
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % poly.length;
    const nx = poly[j].z - poly[i].z; // normal of one side
    const nz = poly[i].x - poly[j].x;
    const len = Math.hypot(nx, nz);
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (let k = 0; k < a.length; k++) {
      const pa = (a[k].x * nx + a[k].z * nz) / len;
      minA = Math.min(minA, pa);
      maxA = Math.max(maxA, pa);
    }
    for (let k = 0; k < b.length; k++) {
      const pb = (b[k].x * nx + b[k].z * nz) / len;
      minB = Math.min(minB, pb);
      maxB = Math.max(maxB, pb);
    }
    if (maxA <= minB + 1e-6 || maxB <= minA + 1e-6) return true;
  }
  return false;
}

// The convex hull of the points, in order round it (Andrew's monotone chain), without points on its sides.
function hull(points) {
  const ps = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const turn = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out.at(-2), out.at(-1), p) <= 1e-9) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(ps), ...half(ps.reverse())];
}
