// AI cars (spec #12, "Traffic"), part of the headless Sim. They drive the road graph in the right-hand lane,
// turn at random at junctions, keep their distance to the car or truck ahead and stop at lights that aren't
// green. They appear and vanish out of the truck's view, keeping the count the Sim asks for.
// A car's `route` is its lane ahead, one piece per road tile: { col, row, from, to }, where `from` is the DIRS
// index it travels into the tile and `to` the one it leaves by; `lane` is the piece it is on, `s` the m
// driven along it and `prev` the piece before. A piece runs `laneOffset` right of the centre line: straight
// across the tile, or a quarter circle round the tile corner between its entry and exit edges.
// At unsignalled crossings one approach at a time drives in, chosen right before left (see rightOfWay); at
// light junctions a car turning left waits for the traffic coming the other way (see oncomingAt). No car
// drives into a crossing or junction whose exit lane is queued up (see exitBlocked), or that the truck stands in.
// The step allocates next to nothing (#31): footprints, poses and the neighbour grid are scratch that is
// reused every step, and tiles are looked up by index, so the cost grows about linearly with the cars.

import { DIRS } from './map.js';

const ROUTE = 4; // pieces planned: the current one and three ahead, more than the longest stopping distance
const SIGNS = [[1, 1], [1, -1], [-1, -1], [-1, 1]]; // footprint corners, front right first
const newBox = () => SIGNS.map(() => ({ x: 0, z: 0 }));

export function createTraffic(tables, map, random) {
  const t = tables.traffic;
  const ts = map.tileSize;
  const half = ts / 2;
  const size = tables.city.obstacles.car; // AI cars are the size of the parked ones
  const truckSize = { length: tables.vehicle.length, width: tables.vehicle.width };
  const cars = [];
  let nextId = 1;
  let now = 0; // step count; a crossing's or junction's per-step fields are valid while their `stamp` is `now`
  const pick = (list) => list[Math.floor(random() * list.length)];
  // Tiles by index, -1 off the map (and array[-1] is undefined).
  const { cols, rows } = map;
  const tileAt = (col, row) => (col >= 0 && col < cols && row >= 0 && row < rows ? row * cols + col : -1);
  const tileBox = ({ col, row }) => [[col, row], [col + 1, row], [col + 1, row + 1], [col, row + 1]].map(([c, r]) => ({ x: c * ts, z: r * ts }));

  // Unsignalled crossings: road tiles with three or more road sides and no lights, by tile, with their box.
  const crossings = map.roads
    .filter(({ col, row }) => DIRS.filter(([dc, dr]) => map.isRoad(col + dc, row + dr)).length >= 3 && !map.lights.some((l) => l.col === col && l.row === row))
    .map((tile) => ({ ...tile, box: tileBox(tile), group: null }));
  const crossingAt = [];
  for (const c of crossings) crossingAt[tileAt(c.col, c.row)] = c;
  // Crossing tiles that touch are one crossing (one group, the right-of-way state shared by its tiles), so no
  // car waits inside one of them for the next.
  for (const c of crossings) {
    if (c.group) continue;
    c.group = { stamp: -1, inside: 0, insideDir: 0, mixed: false, fronts: DIRS.map(() => ({ on: false, car: null, short: 0 })), way: -1 };
    for (const queue = [c]; queue.length; ) {
      const { col, row } = queue.pop();
      for (const [dc, dr] of DIRS) {
        const n = crossingAt[tileAt(col + dc, row + dr)];
        if (!n || n.group) continue;
        n.group = c.group;
        queue.push(n);
      }
    }
  }
  const groupAt = (col, row) => crossingAt[tileAt(col, row)]?.group;
  const groupOf = (p) => p && groupAt(p.col, p.row);
  // Light junction tiles: who comes the other way there this step (see oncomingAt), as DIRS bits in `seen`, and
  // `truck === now` while the truck stands in one.
  const junctionAt = [];
  const junctions = [];
  for (const { col, row } of map.lights) {
    if (!junctionAt[tileAt(col, row)]) junctions.push((junctionAt[tileAt(col, row)] = { col, row, box: tileBox({ col, row }), stamp: -1, seen: 0, truck: -1 }));
  }
  // The box a lane piece is in, if any: its crossing's group (touching crossings share one) or its light junction.
  const boxOf = (p) => groupOf(p) ?? (p && junctionAt[tileAt(p.col, p.row)]);
  // The lights by tile and direction of travel into it, indexed on first use (the Sim keeps its light objects).
  let lightAt = [];
  let indexed = null;
  function lightFor(p, lights) {
    if (lights !== indexed) {
      [lightAt, indexed] = [[], lights];
      for (const l of lights) if (tileAt(l.col, l.row) >= 0) lightAt[tileAt(l.col, l.row) * 4 + l.dir] ??= l;
    }
    const tile = tileAt(p.col, p.row);
    return tile < 0 ? undefined : lightAt[tile * 4 + p.from];
  }

  // Scratch, reused every step: the cars' footprints (by index in `cars`), the truck's, poses, and the
  // uniform grid the neighbour queries use. `found` holds the car indices of the last query, so a loop over it
  // must not call nearby() again.
  const footprints = [];
  const truckBox = newBox();
  const probe = newBox();
  const exitPose = { x: 0, z: 0, heading: 0 };
  const turnEnd = { x: 0, z: 0, heading: 0 };
  const cellSize = 2 * ts; // m, near a car's look-ahead, so a neighbour query spans 3 or 4 cells each way
  const [gridCols, gridRows] = [Math.ceil((cols * ts) / cellSize), Math.ceil((rows * ts) / cellSize)];
  const cellStart = new Int32Array(gridCols * gridRows + 1);
  const cellFill = new Int32Array(gridCols * gridRows);
  let cellCars = new Int32Array(64);
  let found = new Int32Array(64);
  let targets = new Float64Array(64);

  // Turning right is to = from + 1 (DIRS run clockwise seen from above). A turn's radius is round the tile corner.
  const radius = (p) => (p.to === (p.from + 1) % 4 ? half - t.laneOffset : half + t.laneOffset);
  const laneLength = (p) => (p.from === p.to ? ts : (Math.PI / 2) * radius(p));
  const turnSpeed = (p) => Math.sqrt(t.turnAccel * radius(p));

  // Sets `out`'s { x, z, heading } to the pose `s` m along lane piece `p`. Right of travel (dc, dr) is (-dr, dc).
  function pose(p, s, out) {
    const a = DIRS[p.from];
    const b = DIRS[p.to];
    const cx = (p.col + 0.5) * ts;
    const cz = (p.row + 0.5) * ts;
    const o = t.laneOffset;
    const ex = cx - a[0] * half - a[1] * o; // entry
    const ez = cz - a[1] * half + a[0] * o;
    const xx = cx + b[0] * half - b[1] * o; // exit
    const xz = cz + b[1] * half + b[0] * o;
    const f = s / laneLength(p);
    if (p.from === p.to) {
      out.x = ex + (xx - ex) * f;
      out.z = ez + (xz - ez) * f;
      out.heading = Math.atan2(a[0], a[1]);
      return out;
    }
    // Round the corner k: (u, w) are the equal, perpendicular radii to the entry and the exit.
    const kx = cx + (b[0] - a[0]) * half;
    const kz = cz + (b[1] - a[1]) * half;
    const ux = ex - kx;
    const uz = ez - kz;
    const wx = xx - kx;
    const wz = xz - kz;
    const cos = Math.cos((f * Math.PI) / 2);
    const sin = Math.sin((f * Math.PI) / 2);
    out.x = kx + cos * ux + sin * wx;
    out.z = kz + cos * uz + sin * wz;
    out.heading = Math.atan2(cos * wx - sin * ux, cos * wz - sin * uz);
    return out;
  }

  const place = (car) => pose(car.lane, car.s, car);

  // Ways out of tile (col, row) when entering it travelling `from`: every road side but the way back.
  const exits = (col, row, from) => [0, 1, 2, 3].filter((k) => k !== (from + 2) % 4 && map.isRoad(col + DIRS[k][0], row + DIRS[k][1]));

  // Plans the route up to ROUTE pieces; it stays shorter at a dead end, where the car leaves at the tile edge.
  function extend(route) {
    while (route.length < ROUTE) {
      const last = route.at(-1);
      const [col, row] = [last.col + DIRS[last.to][0], last.row + DIRS[last.to][1]];
      const out = exits(col, row, last.to);
      if (!out.length) return;
      route.push({ col, row, from: last.to, to: pick(out) });
    }
  }

  // shortcut: "out of view" is far enough away and not on the truck's row or column of tiles, the streets the
  // cameras look along; the blocks hide the rest. Across the open plaza cars can still appear or vanish in view
  // at 100–180 m; upgrade to a real line-of-sight test if players notice.
  function hidden(x, z, truck, distance) {
    const sameStreet = Math.floor(x / ts) === Math.floor(truck.x / ts) || Math.floor(z / ts) === Math.floor(truck.z / ts);
    return !sameStreet && (x - truck.x) ** 2 + (z - truck.z) ** 2 >= distance ** 2;
  }

  // One new car in the middle of a random hidden road tile in the spawn ring, standing, unless another car is
  // within the look-ahead there. Mid-tile, so none of it sticks out into the truck's street.
  const ring = []; // scratch: the road tiles in the spawn ring
  function spawn(truck) {
    const [near, far] = t.spawnDistance;
    ring.length = 0;
    for (const r of map.roads) {
      const x = (r.col + 0.5) * ts;
      const z = (r.row + 0.5) * ts;
      if (hidden(x, z, truck, near) && (x - truck.x) ** 2 + (z - truck.z) ** 2 <= far ** 2) ring.push(r);
    }
    if (!ring.length) return;
    const { col, row } = pick(ring);
    const from = pick([0, 1, 2, 3].filter((k) => map.isRoad(col - DIRS[k][0], row - DIRS[k][1])));
    const out = from === undefined ? [] : exits(col, row, from);
    if (!out.length) return;
    const route = [{ col, row, from, to: pick(out) }];
    extend(route);
    const car = { id: nextId++, x: 0, z: 0, heading: 0, speed: 0, lane: route[0], route, s: laneLength(route[0]) / 2 };
    place(car);
    if (cars.some((c) => (c.x - car.x) ** 2 + (c.z - car.z) ** 2 < t.lookAhead ** 2)) return;
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

  // Whether `other` drives ahead of `car` in roughly its direction; never true both ways round, so two cars
  // can't wait for each other.
  const ahead = (from, to) => (to.x - from.x) * Math.sin(from.heading) + (to.z - from.z) * Math.cos(from.heading);
  function follows(car, other) {
    const turn = Math.abs(Math.atan2(Math.sin(other.heading - car.heading), Math.cos(other.heading - car.heading)));
    return turn < Math.PI / 4 && ahead(car, other) > 0 && ahead(other, car) < 0;
  }

  // The grid column or row of a position, clamped to the map, and the cell of a car.
  const cellOf = (v, n) => Math.min(Math.max(Math.floor(v / cellSize), 0), n - 1);
  const cell = (c) => cellOf(c.z, gridRows) * gridCols + cellOf(c.x, gridCols);

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
    for (let row = cellOf(z - r, gridRows); row <= cellOf(z + r, gridRows); row++) {
      for (let col = cellOf(x - r, gridCols); col <= cellOf(x + r, gridCols); col++) {
        for (let k = cellStart[row * gridCols + col]; k < cellStart[row * gridCols + col + 1]; k++) found[n++] = cellCars[k];
      }
    }
    return n;
  }

  // Who may drive into each unsignalled crossing that has traffic at it: sets the crossing group's `way` to
  // the DIRS index of travel into it of the approach that may go, or -1 for none. Vehicles in a crossing, or
  // too close to stop before it at `maxBrake`, hold it for their approach (the truck for none). A free
  // crossing goes to the nearest car of an approach with no car or truck arriving on its right (travelling
  // dir + 3); when all four approaches have a car, none would, so the one that came into the city first goes.
  // Of several that may go the same, also the first. The truck counts as arriving only while it drives
  // towards the crossing: a player waiting there is letting the cars go.
  const atCrossings = []; // scratch: the groups with traffic at them this step
  function at(g) {
    if (g.stamp === now) return g;
    g.stamp = now;
    g.inside = 0;
    g.mixed = false;
    for (const f of g.fronts) f.on = false;
    atCrossings.push(g);
    return g;
  }
  function hold(g, dir) {
    if (at(g).inside++ === 0) g.insideDir = dir;
    else if (dir !== g.insideDir) g.mixed = true;
  }
  function arrive(g, dir, car, short) {
    const f = at(g).fronts[dir];
    if (f.on && f.short <= short) return;
    f.on = true;
    f.car = car;
    f.short = short;
  }
  function inCrossing(p, box) {
    const c = p && crossingAt[tileAt(p.col, p.row)];
    if (c && boxesOverlap(box, c.box)) hold(c.group, p.from);
  }

  function rightOfWay(truck) {
    atCrossings.length = 0;
    for (let ci = 0; ci < cars.length; ci++) {
      const car = cars[ci];
      inCrossing(car.prev, footprints[ci]);
      inCrossing(car.lane, footprints[ci]);
      let dist = laneLength(car.lane) - car.s; // centre to the start of the next piece
      for (let i = 1; i < car.route.length; i++) {
        const p = car.route[i];
        const short = dist - size.length / 2; // front bumper to the crossing
        const g = groupOf(p);
        const entering = g && g !== groupOf(car.route[i - 1]);
        dist += laneLength(p);
        if (!entering || short > t.giveWay) continue;
        // A car waiting for room past the crossing doesn't hold it up for the others.
        if (!stoppable(car, short)) hold(g, p.from);
        else if (!exitBlocked(car, i, truck)) arrive(g, p.from, car, short);
      }
    }

    // The truck, in a crossing or light junction, or driving towards a crossing within `giveWay` along the road.
    for (const c of crossings) if (truckIn(c, truck)) hold(c.group, -1);
    for (const j of junctions) if (truckIn(j, truck)) j.truck = now;
    const n = truckAhead(truck);
    for (let k = 1; k < n; k++) {
      const { dir, col, row, short } = truckTiles[k];
      const [bc, br] = [col - DIRS[dir][0], row - DIRS[dir][1]]; // the tile before
      const g = groupAt(col, row);
      if (!g || groupAt(bc, br) === g || !map.isRoad(bc, br) || short <= 0 || short > t.giveWay) continue;
      arrive(g, dir, null, short);
      break;
    }

    for (const g of atCrossings) {
      if (g.inside) {
        g.way = g.mixed ? -1 : g.insideDir;
        continue;
      }
      const f = g.fronts;
      let all = true;
      for (const w of f) all &&= w.on && w.car !== null;
      g.way = -1;
      for (let dir = 0; dir < 4; dir++) {
        const free = f[dir].on && f[dir].car && (all || !f[(dir + 3) % 4].on);
        if (free && (g.way < 0 || f[dir].car.id < f[g.way].car.id)) g.way = dir;
      }
    }
  }

  const truckIn = (tile, truck) =>
    Math.abs((tile.col + 0.5) * ts - truck.x) < ts && Math.abs((tile.row + 0.5) * ts - truck.z) < ts && boxesOverlap(truckBox, tile.box);

  // The tiles the truck drives into while it drives forwards along a road axis, from the one under its front
  // bumper to two ahead, into the scratch `truckTiles`: each with that axis' DIRS index and the m from the
  // bumper to the tile's near edge (negative for the tile under it). Returns how many: 3, or 0 otherwise.
  const truckTiles = [0, 1, 2].map(() => ({ dir: 0, col: 0, row: 0, short: 0 }));
  function truckAhead(truck) {
    const fx = Math.sin(truck.heading);
    const fz = Math.cos(truck.heading);
    let dir = -1;
    for (let k = 0; k < 4 && dir < 0; k++) if (DIRS[k][0] * fx + DIRS[k][1] * fz > Math.SQRT1_2) dir = k;
    if (dir < 0 || truck.speed <= tables.vehicle.stopSpeed) return 0;
    const dc = DIRS[dir][0];
    const dr = DIRS[dir][1];
    const x = truck.x + (fx * truckSize.length) / 2;
    const z = truck.z + (fz * truckSize.length) / 2;
    for (let k = 0; k < 3; k++) {
      const tile = truckTiles[k];
      tile.dir = dir;
      tile.col = Math.floor(x / ts) + dc * k;
      tile.row = Math.floor(z / ts) + dr * k;
      tile.short = ((tile.col + 0.5) * ts - x) * dc + ((tile.row + 0.5) * ts - z) * dr - half;
    }
    return 3;
  }

  // Who comes the other way at each light junction: sets the junction's `seen` bits to the DIRS indices of
  // travel into it of the cars in it or arriving within `giveWay` that don't turn left there, and of the truck
  // driving in. A car turning left there waits for those coming towards it (two turning left pass each other).
  function see(col, row, dir) {
    const j = junctionAt[tileAt(col, row)];
    if (!j) return;
    if (j.stamp !== now) {
      j.stamp = now;
      j.seen = 0;
    }
    j.seen |= 1 << dir;
  }
  const oncoming = (p, dir) => {
    const j = junctionAt[tileAt(p.col, p.row)];
    return j?.stamp === now && (j.seen & (1 << dir)) !== 0;
  };
  function oncomingAt(truck) {
    for (const car of cars) {
      let dist = -car.s; // centre to the start of the piece
      for (const p of car.route) {
        if (p.to !== (p.from + 3) % 4 && dist - size.length / 2 <= t.giveWay) see(p.col, p.row, p.from);
        dist += laneLength(p);
      }
    }
    const n = truckAhead(truck);
    for (let k = 0; k < n; k++) if (truckTiles[k].short <= t.giveWay) see(truckTiles[k].col, truckTiles[k].row, truckTiles[k].dir);
  }

  // Don't block the box: whether the lane just past the box (crossing or light junction) that route piece `i`
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
    pose(car.route[j], 0, exitPose);
    if (queued(truckBox, truck.speed)) return true;
    for (let k = nearby(exitPose.x, exitPose.z, queueReach) - 1; k >= 0; k--) {
      const c = cars[found[k]];
      if (c !== car && queued(footprints[found[k]], c.speed)) return true;
    }
    return false;
  }

  // Whether the car can still stop `short` m ahead at `maxBrake`.
  const stoppable = (car, short) => short > 0 && car.speed ** 2 <= 2 * t.maxBrake * short;
  // The fastest a car may go to stop within `gap` m at `brake`, or to slow to `end` m/s there.
  const limit = (gap, end = 0) => Math.sqrt(end ** 2 + 2 * t.brake * Math.max(0, gap));

  // The fastest the car may go now: cruise, slower through turns, and able to stop at `brake` before a stop
  // line that isn't green, a left turn with traffic coming the other way, a crossing it may not drive into
  // yet, a box whose exit is queued up or a light junction the truck stands in, and behind the car or truck
  // ahead. A light it can't stop for at `maxBrake` (it turned amber too late) is driven through. Goes into
  // targets[i] for cars[i]: a returned number would be boxed on every call.
  function targetSpeed(ci, truck, lights) {
    const car = cars[ci];
    let speed = car.lane.from === car.lane.to ? t.speed : turnSpeed(car.lane);
    let dist = laneLength(car.lane) - car.s; // centre to the start of the next piece
    for (let i = 1; i < car.route.length; i++) {
      const p = car.route[i];
      if (p.from !== p.to) speed = Math.min(speed, limit(dist, turnSpeed(p)));
      const light = lightFor(p, lights);
      const short = dist - size.length / 2; // front bumper to the stop line
      const g = groupOf(p);
      const way = g && g !== groupOf(car.route[i - 1]) && g.stamp === now ? g.way : undefined;
      const box = boxOf(p);
      const wait =
        (light && (light.phase !== 'green' || (p.to === (p.from + 3) % 4 && oncoming(p, (p.from + 2) % 4)))) ||
        (way !== undefined && way !== p.from) ||
        (box && box !== boxOf(car.route[i - 1]) && (box.truck === now || exitBlocked(car, i, truck)));
      if (wait && stoppable(car, short)) speed = Math.min(speed, limit(short - t.stopGap));
      dist += laneLength(p);
    }
    targets[ci] = speed;
    // Looking ahead along the heading; in a turn also from the turn's end, so a queue just round the
    // corner is seen before the car is half way round.
    behind(ci, car, 0);
    if (car.lane.from !== car.lane.to) behind(ci, pose(car.lane, laneLength(car.lane), turnEnd), laneLength(car.lane) - car.s);
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

  // Drops cars that left the road or the truck's surroundings, spawns one while fewer than `count`, then
  // drives each car; the ones in `held` (ids) stand still.
  function step(dt, truck, lights, count, held = new Set()) {
    for (let i = cars.length - 1; i >= 0; i--) {
      if (cars[i].gone || hidden(cars[i].x, cars[i].z, truck, t.despawnDistance)) cars.splice(i, 1);
    }
    if (cars.length < count) spawn(truck);

    now++;
    for (let i = 0; i < cars.length; i++) corners(cars[i], size, (footprints[i] ??= newBox()));
    corners(truck, truckSize, truckBox);
    fillGrid();
    rightOfWay(truck);
    oncomingAt(truck);
    if (targets.length < cars.length) targets = new Float64Array(cars.length * 2);
    for (let i = 0; i < cars.length; i++) targetSpeed(i, truck, lights);
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      car.speed = held.has(car.id) ? 0 : Math.min(targets[i], car.speed + t.accel * dt);
      car.s += car.speed * dt;
      while (car.s >= laneLength(car.lane)) {
        if (car.route.length === 1) {
          car.gone = true; // dead end
          break;
        }
        car.s -= laneLength(car.lane);
        car.prev = car.route.shift(); // its rear may still be in that tile
        extend(car.route);
        car.lane = car.route[0];
      }
      if (!car.gone) place(car);
    }
  }

  // The cars whose footprint overlaps `box` (corners in order). Cars too far for their bounding circles to
  // meet are skipped before the exact test.
  const carRadius = Math.hypot(size.length, size.width) / 2;
  function touching(box) {
    const [cx, cz] = [(box[0].x + box[2].x) / 2, (box[0].z + box[2].z) / 2];
    const r = Math.hypot(box[0].x - box[2].x, box[0].z - box[2].z) / 2 + carRadius + 0.01; // 1 cm against rounding
    const out = [];
    for (const c of cars) if ((c.x - cx) ** 2 + (c.z - cz) ** 2 <= r ** 2 && boxesOverlap(box, corners(c, size, probe))) out.push(c);
    return out;
  }

  return { cars, step, touching };
}

// Separating-axis test of two boxes, each given by its four corners in order, at any headings; touching
// isn't overlapping (within a µm, so vehicles exactly side by side in their lanes don't count).
function boxesOverlap(a, b) {
  return !separates(a, a, b) && !separates(b, a, b);
}

// Whether a normal of one of the first two sides of `box` separates boxes a and b.
function separates(box, a, b) {
  for (let i = 0; i < 2; i++) {
    const nx = box[i + 1].z - box[i].z; // normal of one side
    const nz = box[i].x - box[i + 1].x;
    const len = Math.hypot(nx, nz);
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (let k = 0; k < 4; k++) {
      const pa = (a[k].x * nx + a[k].z * nz) / len;
      const pb = (b[k].x * nx + b[k].z * nz) / len;
      minA = Math.min(minA, pa);
      maxA = Math.max(maxA, pa);
      minB = Math.min(minB, pb);
      maxB = Math.max(maxB, pb);
    }
    if (maxA <= minB + 1e-6 || maxB <= minA + 1e-6) return true;
  }
  return false;
}
