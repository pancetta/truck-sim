// AI cars (spec #12, "Traffic"), part of the headless Sim. They drive the road graph in the right-hand lane,
// turn at random at junctions, keep their distance to the car or truck ahead and stop at lights that aren't
// green. They appear and vanish out of the truck's view, keeping the count the Sim asks for.
// A car's `route` is its lane ahead, one piece per road tile: { col, row, from, to }, where `from` is the DIRS
// index it travels into the tile and `to` the one it leaves by; `lane` is the piece it is on, `s` the m
// driven along it and `prev` the piece before. A piece runs `laneOffset` right of the centre line: straight
// across the tile, or a quarter circle round the tile corner between its entry and exit edges.
// At unsignalled crossings one approach at a time drives in, chosen right before left (see rightOfWay); at
// light junctions a car turning left waits for the traffic coming the other way (see oncomingAt). No car
// drives into a crossing or junction whose exit lane is queued up (see exitBlocked).

import { DIRS } from './map.js';

const ROUTE = 3; // pieces planned: the current one and two ahead, more than the longest stopping distance

export function createTraffic(tables, map, random) {
  const t = tables.traffic;
  const ts = map.tileSize;
  const half = ts / 2;
  const size = tables.city.obstacles.car; // AI cars are the size of the parked ones
  const truckSize = { length: tables.vehicle.length, width: tables.vehicle.width };
  const cars = [];
  let nextId = 1;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const keyOf = ({ col, row }) => `${col},${row}`;
  const tileBox = ({ col, row }) => [[col, row], [col + 1, row], [col + 1, row + 1], [col, row + 1]].map(([c, r]) => ({ x: c * ts, z: r * ts }));

  // Unsignalled crossings: road tiles with three or more road sides and no lights, by key, with their box.
  const crossings = new Map(
    map.roads
      .filter(({ col, row }) => DIRS.filter(([dc, dr]) => map.isRoad(col + dc, row + dr)).length >= 3 && !map.lights.some((l) => l.col === col && l.row === row))
      .map((tile) => [keyOf(tile), { ...tile, box: tileBox(tile) }]),
  );
  // Crossing tiles that touch are one crossing (keyed by one of its tiles), so no car waits inside one of
  // them for the next.
  const groups = new Map();
  for (const [k, c] of crossings) {
    if (groups.has(k)) continue;
    groups.set(k, k);
    for (const queue = [c]; queue.length; ) {
      const { col, row } = queue.pop();
      for (const [dc, dr] of DIRS) {
        const n = keyOf({ col: col + dc, row: row + dr });
        if (!crossings.has(n) || groups.has(n)) continue;
        groups.set(n, k);
        queue.push(crossings.get(n));
      }
    }
  }
  const groupOf = (p) => p && groups.get(keyOf(p));
  // Light junction tiles by key.
  const junctions = new Set(map.lights.map(keyOf));
  // The box a lane piece is in, if any: its crossing's key (touching crossings share one) or its light junction's.
  const boxOf = (p) => groupOf(p) ?? (p && junctions.has(keyOf(p)) ? keyOf(p) : undefined);

  // Turning right is to = from + 1 (DIRS run clockwise seen from above).
  const laneLength = (p) => (p.from === p.to ? ts : (Math.PI / 2) * (p.to === (p.from + 1) % 4 ? half - t.laneOffset : half + t.laneOffset));

  // { x, z, heading } at `s` m along lane piece `p`. Right of travel (dc, dr) is (-dr, dc).
  function pose(p, s) {
    const [a, b] = [DIRS[p.from], DIRS[p.to]];
    const [cx, cz] = [(p.col + 0.5) * ts, (p.row + 0.5) * ts];
    const o = t.laneOffset;
    const [ex, ez] = [cx - a[0] * half - a[1] * o, cz - a[1] * half + a[0] * o]; // entry
    const [xx, xz] = [cx + b[0] * half - b[1] * o, cz + b[1] * half + b[0] * o]; // exit
    const f = s / laneLength(p);
    if (p.from === p.to) return { x: ex + (xx - ex) * f, z: ez + (xz - ez) * f, heading: Math.atan2(a[0], a[1]) };
    // Round the corner k: (u, w) are the equal, perpendicular radii to the entry and the exit.
    const [kx, kz] = [cx + (b[0] - a[0]) * half, cz + (b[1] - a[1]) * half];
    const [ux, uz, wx, wz] = [ex - kx, ez - kz, xx - kx, xz - kz];
    const [cos, sin] = [Math.cos((f * Math.PI) / 2), Math.sin((f * Math.PI) / 2)];
    return { x: kx + cos * ux + sin * wx, z: kz + cos * uz + sin * wz, heading: Math.atan2(cos * wx - sin * ux, cos * wz - sin * uz) };
  }

  const place = (car) => Object.assign(car, pose(car.lane, car.s));

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
    return !sameStreet && Math.hypot(x - truck.x, z - truck.z) >= distance;
  }

  // One new car in the middle of a random hidden road tile in the spawn ring, standing, unless another car is
  // within the look-ahead there. Mid-tile, so none of it sticks out into the truck's street.
  function spawn(truck) {
    const [near, far] = t.spawnDistance;
    const centre = ({ col, row }) => [(col + 0.5) * ts, (row + 0.5) * ts];
    const tiles = map.roads.filter((r) => {
      const [x, z] = centre(r);
      return hidden(x, z, truck, near) && Math.hypot(x - truck.x, z - truck.z) <= far;
    });
    if (!tiles.length) return;
    const { col, row } = pick(tiles);
    const from = pick([0, 1, 2, 3].filter((k) => map.isRoad(col - DIRS[k][0], row - DIRS[k][1])));
    const out = from === undefined ? [] : exits(col, row, from);
    if (!out.length) return;
    const route = [{ col, row, from, to: pick(out) }];
    extend(route);
    const car = { id: nextId++, x: 0, z: 0, heading: 0, speed: 0, lane: route[0], route, s: laneLength(route[0]) / 2 };
    place(car);
    if (cars.some((c) => Math.hypot(c.x - car.x, c.z - car.z) < t.lookAhead)) return;
    cars.push(car);
  }

  // Footprint corners of a vehicle (x, z, heading) of the given length and width.
  function corners({ x, z, heading }, { length, width }) {
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const [l, w] = [length / 2, width / 2];
    return [[l, w], [l, -w], [-l, -w], [-l, w]].map(([a, b]) => ({ x: x + fx * a - fz * b, z: z + fz * a + fx * b }));
  }

  // How far ahead of the car's centre the nearest part of `box` (corners, in order) lies within the car's
  // path, as wide as the car plus `sideGap` each side. Infinity when it isn't in the path or lies behind.
  function aheadOf(car, box) {
    const [fx, fz] = [Math.sin(car.heading), Math.cos(car.heading)];
    const w = size.width / 2 + t.sideGap;
    const pts = box.map((p) => ({ a: (p.x - car.x) * fx + (p.z - car.z) * fz, r: -(p.x - car.x) * fz + (p.z - car.z) * fx }));
    let near = Infinity;
    let far = -Infinity;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const hits = Math.abs(p.r) <= w ? [p.a] : [];
      for (const side of [-w, w]) if ((p.r - side) * (q.r - side) < 0) hits.push(p.a + ((q.a - p.a) * (side - p.r)) / (q.r - p.r));
      for (const a of hits) [near, far] = [Math.min(near, a), Math.max(far, a)];
    });
    return far > 0 ? near : Infinity;
  }

  // Whether `other` drives ahead of `car` in roughly its direction; never true both ways round, so two cars
  // can't wait for each other.
  function follows(car, other) {
    const turn = Math.abs(Math.atan2(Math.sin(other.heading - car.heading), Math.cos(other.heading - car.heading)));
    const along = (from, to) => (to.x - from.x) * Math.sin(from.heading) + (to.z - from.z) * Math.cos(from.heading);
    return turn < Math.PI / 4 && along(car, other) > 0 && along(other, car) < 0;
  }

  // Who may drive into each unsignalled crossing that has traffic at it: crossing key → the DIRS index of
  // travel into it of the approach that may go, or -1 for none. Vehicles in a crossing, or too close to
  // stop before it at `maxBrake`, hold it for their approach (the truck for none). A free crossing goes
  // to the nearest car of an approach with no car or truck arriving on its right (travelling dir + 3);
  // when all four approaches have a car, none would, so the one that came into the city first goes.
  // Of several that may go the same, also the first. The truck counts as arriving only while it drives
  // towards the crossing: a player waiting there is letting the cars go.
  function rightOfWay(truck, truckBox) {
    const ways = new Map();
    const at = (k) => {
      if (!ways.has(k)) ways.set(k, { inside: [], fronts: [] });
      return ways.get(k);
    };
    const arrive = (k, dir, car, short) => {
      const { fronts } = at(k);
      if (!(fronts[dir]?.short <= short)) fronts[dir] = { dir, car, short };
    };

    for (const car of cars) {
      const box = corners(car, size);
      for (const p of [car.prev, car.lane]) if (groupOf(p) && boxesOverlap(box, crossings.get(keyOf(p)).box)) at(groupOf(p)).inside.push(p.from);
      let dist = laneLength(car.lane) - car.s; // centre to the start of the next piece
      for (let i = 1; i < car.route.length; i++) {
        const p = car.route[i];
        const short = dist - size.length / 2; // front bumper to the crossing
        const g = groupOf(p);
        const entering = g && g !== groupOf(car.route[i - 1]);
        dist += laneLength(p);
        if (!entering || short > t.giveWay) continue;
        // A car waiting for room past the crossing doesn't hold it up for the others.
        if (!stoppable(car, short)) at(g).inside.push(p.from);
        else if (!exitBlocked(car, i, truck, truckBox)) arrive(g, p.from, car, short);
      }
    }

    // The truck, in a crossing or driving towards one within `giveWay` along the road.
    for (const [k, c] of crossings) {
      const near = Math.abs((c.col + 0.5) * ts - truck.x) < ts && Math.abs((c.row + 0.5) * ts - truck.z) < ts;
      if (near && boxesOverlap(truckBox, c.box)) at(groups.get(k)).inside.push(-1);
    }
    for (const { dir, tile, short } of truckAhead(truck).slice(1)) {
      const [dc, dr] = DIRS[dir];
      const back = { col: tile.col - dc, row: tile.row - dr };
      if (!groupOf(tile) || groupOf(back) === groupOf(tile) || !map.isRoad(back.col, back.row) || short <= 0 || short > t.giveWay) continue;
      arrive(groupOf(tile), dir, null, short);
      break;
    }

    const first = (list) => list.reduce((a, b) => (b.car.id < a.car.id ? b : a));
    for (const [k, { inside, fronts }] of ways) {
      if (inside.length) {
        ways.set(k, inside.every((d) => d === inside[0]) ? inside[0] : -1);
        continue;
      }
      const waiting = fronts.filter((f) => f.car);
      const free = waiting.length === 4 ? waiting : waiting.filter((f) => !fronts[(f.dir + 3) % 4]);
      ways.set(k, free.length ? first(free).dir : -1);
    }
    return ways;
  }

  // The tiles the truck drives into while it drives forwards along a road axis, from the one under its front
  // bumper to two ahead: each with that axis' DIRS index and the m from the bumper to the tile's near edge
  // (negative for the tile under it). None otherwise.
  function truckAhead(truck) {
    const [fx, fz] = [Math.sin(truck.heading), Math.cos(truck.heading)];
    const dir = DIRS.findIndex(([dc, dr]) => dc * fx + dr * fz > Math.SQRT1_2);
    if (dir < 0 || truck.speed <= tables.vehicle.stopSpeed) return [];
    const [dc, dr] = DIRS[dir];
    const [x, z] = [truck.x + (fx * truckSize.length) / 2, truck.z + (fz * truckSize.length) / 2];
    return [0, 1, 2].map((k) => {
      const tile = { col: Math.floor(x / ts) + dc * k, row: Math.floor(z / ts) + dr * k };
      return { dir, tile, short: ((tile.col + 0.5) * ts - x) * dc + ((tile.row + 0.5) * ts - z) * dr - half };
    });
  }

  // Who comes the other way at each light junction: junction key → the DIRS indices of travel into it of the
  // cars in it or arriving within `giveWay` that don't turn left there, and of the truck driving in. A car
  // turning left there waits for those coming towards it (two turning left pass each other).
  function oncomingAt(truck) {
    const seen = new Map();
    const add = (p, dir) => junctions.has(keyOf(p)) && (seen.get(keyOf(p)) ?? seen.set(keyOf(p), new Set()).get(keyOf(p))).add(dir);
    for (const car of cars) {
      let dist = -car.s; // centre to the start of the piece
      for (const p of car.route) {
        if (p.to !== (p.from + 3) % 4 && dist - size.length / 2 <= t.giveWay) add(p, p.from);
        dist += laneLength(p);
      }
    }
    for (const { dir, tile, short } of truckAhead(truck)) if (short <= t.giveWay) add(tile, dir);
    return seen;
  }

  // Don't block the box: whether the lane just past the box (crossing or light junction) that route piece `i`
  // drives into has no room for the car, because a car or the truck slower than `boxSpeed` is less than a car
  // length and `followGap` beyond it. False while the planned route ends inside the box.
  function exitBlocked(car, i, truck, truckBox) {
    let j = i;
    while (car.route[j] && boxOf(car.route[j]) === boxOf(car.route[i])) j++;
    if (!car.route[j]) return false;
    const exit = pose(car.route[j], 0);
    const queued = (box, speed) => Math.abs(speed) < t.boxSpeed && aheadOf(exit, box) < size.length + t.followGap;
    return queued(truckBox, truck.speed) || cars.some((c) => c !== car && queued(corners(c, size), c.speed));
  }

  // Whether the car can still stop `short` m ahead at `maxBrake`.
  const stoppable = (car, short) => short > 0 && car.speed ** 2 <= 2 * t.maxBrake * short;

  // The fastest the car may go now: cruise, slower through turns, and able to stop at `brake` before a stop
  // line that isn't green, a left turn with traffic coming the other way, a crossing it may not drive into
  // yet or a box whose exit is queued up, and behind the car or truck ahead. A light it can't stop for at
  // `maxBrake` (it turned amber too late) is driven through.
  function targetSpeed(car, truck, truckBox, lights, ways, oncoming) {
    let speed = car.lane.from === car.lane.to ? t.speed : t.turnSpeed;
    const limit = (gap, end = 0) => (speed = Math.min(speed, Math.sqrt(end ** 2 + 2 * t.brake * Math.max(0, gap))));
    let dist = laneLength(car.lane) - car.s; // centre to the start of the next piece
    for (let i = 1; i < car.route.length; i++) {
      const p = car.route[i];
      if (p.from !== p.to) limit(dist, t.turnSpeed);
      const light = lights.find((l) => l.col === p.col && l.row === p.row && l.dir === p.from);
      const short = dist - size.length / 2; // front bumper to the stop line
      const g = groupOf(p);
      const way = g && g !== groupOf(car.route[i - 1]) ? ways.get(g) : undefined;
      const wait =
        (light && (light.phase !== 'green' || (p.to === (p.from + 3) % 4 && oncoming.get(keyOf(p))?.has((p.from + 2) % 4)))) ||
        (way !== undefined && way !== p.from) ||
        (boxOf(p) && boxOf(p) !== boxOf(car.route[i - 1]) && exitBlocked(car, i, truck, truckBox));
      if (wait && stoppable(car, short)) limit(short - t.stopGap);
      dist += laneLength(p);
    }
    // Looking ahead along the heading; in a turn also from the turn's end, so a queue just round the
    // corner is seen before the car is half way round. `extra` is the lane from the car to that view.
    const views = [[car, 0]];
    if (car.lane.from !== car.lane.to) views.push([pose(car.lane, laneLength(car.lane)), laneLength(car.lane) - car.s]);
    const reach = t.lookAhead + size.length;
    for (const [view, extra] of views) {
      for (const other of cars) {
        if (other === car || Math.hypot(other.x - view.x, other.z - view.z) > reach || !follows(view, other)) continue;
        limit(extra + aheadOf(view, corners(other, size)) - size.length / 2 - t.followGap);
      }
      limit(extra + aheadOf(view, truckBox) - size.length / 2 - t.followGap);
    }
    return speed;
  }

  // Drops cars that left the road or the truck's surroundings, spawns one while fewer than `count`, then
  // drives each car; the ones in `held` (ids) stand still.
  function step(dt, truck, lights, count, held = new Set()) {
    for (let i = cars.length - 1; i >= 0; i--) {
      if (cars[i].gone || hidden(cars[i].x, cars[i].z, truck, t.despawnDistance)) cars.splice(i, 1);
    }
    if (cars.length < count) spawn(truck);

    const truckBox = corners(truck, truckSize);
    const ways = rightOfWay(truck, truckBox);
    const oncoming = oncomingAt(truck);
    const targets = cars.map((car) => targetSpeed(car, truck, truckBox, lights, ways, oncoming));
    cars.forEach((car, i) => {
      car.speed = held.has(car.id) ? 0 : Math.min(targets[i], car.speed + t.accel * dt);
      car.s += car.speed * dt;
      while (car.s >= laneLength(car.lane)) {
        if (car.route.length === 1) {
          car.gone = true; // dead end
          return;
        }
        car.s -= laneLength(car.lane);
        car.prev = car.route.shift(); // its rear may still be in that tile
        extend(car.route);
        car.lane = car.route[0];
      }
      place(car);
    });
  }

  // The cars whose footprint overlaps `box` (corners in order).
  const touching = (box) => cars.filter((c) => boxesOverlap(box, corners(c, size)));

  return { cars, step, touching };
}

// Separating-axis test of two boxes, each given by its four corners in order, at any headings; touching
// isn't overlapping (within a µm, so vehicles exactly side by side in their lanes don't count).
function boxesOverlap(a, b) {
  for (const box of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const [nx, nz] = [box[i + 1].z - box[i].z, box[i].x - box[i + 1].x]; // normal of one side
      const [pa, pb] = [a, b].map((cs) => cs.map((c) => (c.x * nx + c.z * nz) / Math.hypot(nx, nz)));
      if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
    }
  }
  return true;
}
