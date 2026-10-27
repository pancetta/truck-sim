// AI cars (spec #12, "Traffic"; on the road graph since #61), part of the headless Sim. They drive the graph's lane paths
// (lanes.js), turn at random at junctions, keep their distance to the car or truck ahead and stop at lights that aren't
// green. They appear and vanish out of the truck's view, keeping the count the Sim asks for. On top of those,
// tables.police.count police cars (`police: true`) drive the same rules anywhere in the city: they appear out of
// view anywhere and leave only at a dead end, whereupon a new one appears.
// A car's `route` is its way ahead as lane paths, `lane` the one it is on (route[0]), `s` the m driven along it and
// `prev` the path before; `prim` the line or arc of `lane` it is on (lanes.js); `via` the turn it drove into its
// crossing by; `at`, `seen` and `since` the crossing it was last the first car of an approach to, the last step it was
// and the step it became that (see rightOfWay).
// Junctions are graph nodes of three or more arms. At unsignalled crossings the approaches drive in by priority (see
// rightOfWay): the higher road class, and right before left between equal ones; oncoming cars whose ways don't cross
// go together. At light junctions a car turning left waits for the traffic coming the other way (see atJunctions). No
// car drives into a crossing or junction whose exit lane is queued up (see exitBlocked), or where the truck stands in
// its way (see truckBlocks).
// The step allocates next to nothing (#31): footprints, poses and the neighbour grid are scratch that is
// reused every step, and per-path data is looked up by path id, so the cost grows about linearly with the cars.

import { poseAt } from './lanes.js';

const PLAN = 45; // m of route planned past the path a car is on, more than the longest stopping distance
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
  const lineBack = tables.lights.stopLine - tables.city.obstacles.signal.inset; // m from a stop line on to its junction (see parseMap)
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
  const touching = (e) => e.length <= nodes[e.from].radius + nodes[e.to].radius + 1e-6;

  // Unsignalled crossings: junction nodes without lights. Ones whose boxes touch are one crossing (one group, the
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
        else approachAt[run.id] = g.approaches.push({ dir: run.endDir, rank: t.priority[run.edge.class] ?? 0, right: -1, opposite: -1, front: { on: false, car: null, short: 0, since: 0, kind: 0 } }) - 1;
        for (const turn of run.next) {
          groupAt[turn.id] = g;
          approachAt[turn.id] = approachAt[run.id];
          moveAt[turn.id] = g.nodes.length === 1 ? MOVES[turn.move] : OTHER;
        }
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

  const turnSpeed = (r) => Math.sqrt(t.turnAccel * r);

  // Sets the car's pose from its place on its lane, and the prim it is on.
  function place(car) {
    car.prim = poseAt(car.lane, car.s, car);
  }

  // Plans the route on to PLAN m past the path the car is on; it stays shorter at a dead end, where the car leaves
  // at the lane's end.
  function extend(route) {
    let ahead = 0;
    for (let i = 1; i < route.length; i++) ahead += route[i].length;
    while (ahead < PLAN) {
      const last = route.at(-1);
      const next = last.kind === 'run' ? pick(last.next) : last.out;
      if (!next) return;
      route.push(next);
      ahead += next.length;
    }
  }

  // shortcut: "out of view" is far enough away and not within `spawnView` of the truck's heading, ahead or behind, nor
  // of the line across it: the street the cameras look along and the one the truck may stand at a junction of; the
  // blocks hide the rest. Across open ground cars can still appear or vanish in view; upgrade to a real line-of-sight
  // test if players notice.
  const viewCos = Math.cos(t.spawnView);
  // `at` is a car or a spawn place: passing its x and z would box them on every call.
  function hidden(at, truck, distance) {
    const dx = at.x - truck.x;
    const dz = at.z - truck.z;
    const away = dx * dx + dz * dz;
    const along = dx * Math.sin(truck.heading) + dz * Math.cos(truck.heading);
    const across = dx * Math.cos(truck.heading) - dz * Math.sin(truck.heading);
    return away >= distance ** 2 && along * along < away * viewCos * viewCos && across * across < away * viewCos * viewCos;
  }

  // Where a new car may appear: every 10 m along each lane run, clear of its ends by half a car.
  const slots = [];
  for (const p of paths) {
    if (p.kind !== 'run') continue;
    for (let s = size.length / 2; s <= p.length - size.length / 2; s += 10) {
      const slot = { path: p, s, x: 0, z: 0, heading: 0 };
      poseAt(p, s, slot);
      slots.push(slot);
    }
  }

  // One new car, standing, on a random hidden lane place in the spawn ring (for a police car, from outside its sight
  // radius as far out as the city goes, so it never witnesses as it appears) with no other car within the look-ahead.
  // The place is drawn at random until one fits, up to SPAWN_TRIES times, so every place that does is as likely; with
  // none found, the next step tries again.
  const SPAWN_TRIES = 64; // the grid city's ring is ~1/13 of its places: under 1 % of calls in an empty city find none
  const clear = (p) => {
    for (let i = 0; i < cars.length; i++) if ((cars[i].x - p.x) ** 2 + (cars[i].z - p.z) ** 2 < t.lookAhead ** 2) return false;
    return true;
  };
  function spawn(truck, police) {
    const near = police ? Math.max(t.spawnDistance[0], tables.police.radius) : t.spawnDistance[0];
    const far = police ? Infinity : t.spawnDistance[1];
    let at = null;
    for (let i = 0; i < SPAWN_TRIES && !at && slots.length; i++) {
      const p = pick(slots);
      if (hidden(p, truck, near) && (p.x - truck.x) ** 2 + (p.z - truck.z) ** 2 <= far ** 2 && clear(p)) at = p;
    }
    if (!at) return;
    const { path, s } = at;
    const route = [path];
    extend(route);
    const car = { id: nextId++, x: 0, z: 0, heading: 0, speed: 0, lane: path, route, s, prev: null, police, prim: null, via: null, at: null, seen: -1, since: 0 };
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
  function at(g) {
    if (g.stamp === now) return g;
    g.stamp = now;
    g.inside = 0;
    g.blocked = false;
    g.kinds.fill(0);
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
  function arrive(g, a, car, short, kind) {
    const f = at(g).approaches[a].front;
    if (f.on && f.short <= short) return;
    f.on = true;
    f.car = car;
    f.short = short;
    f.kind = kind;
  }
  // A car in crossing group g holds it for the approach it drove in by.
  const holdFor = (g, car) => hold(g, car.via && groupAt[car.via.id] === g ? approachAt[car.via.id] : -1, car.via ? moveAt[car.via.id] : OTHER);

  function rightOfWay(truck) {
    atCrossings.length = 0;
    for (let ci = 0; ci < cars.length; ci++) {
      const car = cars[ci];
      const lg = groupAt[car.lane.id];
      if (lg) holdFor(lg, car);
      const pg = car.prev && car.s < size.length / 2 ? groupAt[car.prev.id] : null; // its rear still in one
      if (pg && pg !== lg) holdFor(pg, car);
      let dist = car.lane.length - car.s; // centre to the start of the next path
      for (let i = 1; i < car.route.length; i++) {
        const p = car.route[i];
        const short = dist - size.length / 2; // front bumper to the crossing
        const g = groupAt[p.id];
        const entering = g && g !== groupAt[car.route[i - 1].id];
        dist += p.length;
        if (!entering || short > t.giveWay) continue;
        // A car waiting for room past the crossing, or behind the truck, doesn't hold it up for the others.
        if (!stoppable(car, short)) hold(g, approachAt[p.id], moveAt[p.id]);
        else if (!exitBlocked(car, i, truck) && !(g.truck === now && truckBlocks(car, i, truck)) && aheadOf(car, truckBox) - size.length / 2 >= short) {
          arrive(g, approachAt[p.id], car, short, moveAt[p.id]);
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
      arrive(g, approachAt[run.id], null, short, OTHER);
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
          c.at = g;
          c.seen = now;
          w.since = c.since;
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
      const A = g.approaches;
      let inside = g.inside;
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
  // one not in it yet gives way to no approach waiting there whose move doesn't go with it.
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
  const room = size.length + t.followGap;
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
      dist += p.length;
    }
    targets[ci] = speed;
    // Looking ahead along the heading; on a curve also from its end, so a queue just round the corner is seen
    // before the car is half way round.
    behind(ci, car, 0);
    if (car.prim.r) behindCurve(ci, car);
  }

  // Sets targets[ci] to the fastest cars[ci] may go round the curves on its route: on the one it is on, and able
  // to slow to the speed of each one ahead by its start. Apart from targetSpeed, as are behindCurve() and behind(),
  // so V8 still inlines the small helpers they call (#61: one function holding them all allocated twice as much).
  const curveReach = t.speed ** 2 / (2 * t.brake); // m from which a curve can't slow a car below cruise
  function curves(ci) {
    const car = cars[ci];
    let speed = car.prim.r ? turnSpeed(car.prim.r) : t.speed;
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

  // Drops cars that left the road or (police aside) the truck's surroundings, spawns one while fewer than `count`
  // and a police car while fewer than tables.police.count, then drives each car; the ones in `held` (ids, a Set
  // or Map) stand still.
  function step(dt, truck, lights, count, held = new Set()) {
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
      while (car.s >= car.lane.length) {
        if (car.route.length === 1) {
          car.gone = true; // dead end
          break;
        }
        car.s -= car.lane.length;
        car.prev = car.route.shift(); // its rear may still be in that box
        extend(car.route);
        car.lane = car.route[0];
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
