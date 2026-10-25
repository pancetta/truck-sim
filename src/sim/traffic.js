// AI cars (spec #12, "Traffic"), part of the headless Sim. They drive the road graph in the right-hand lane,
// turn at random at junctions, keep their distance to the car or truck ahead and stop at lights that aren't
// green. They appear and vanish out of the truck's view, keeping the count the Sim asks for.
// A car's `route` is its lane ahead, one piece per road tile: { col, row, from, to }, where `from` is the DIRS
// index it travels into the tile and `to` the one it leaves by; `lane` is the piece it is on and `s` the m
// driven along it. A piece runs `laneOffset` right of the centre line: straight across the tile, or a quarter
// circle round the tile corner between its entry and exit edges.
// shortcut: cars ignore crossing traffic, so at crossings they may pass through each other; right of way is #21.

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

  // Turning right is to = from + 1 (DIRS run clockwise seen from above).
  const laneLength = (p) => (p.from === p.to ? ts : (Math.PI / 2) * (p.to === (p.from + 1) % 4 ? half - t.laneOffset : half + t.laneOffset));

  // Sets the car's x, z and heading from its lane piece and `s`. Right of travel (dc, dr) is (-dr, dc).
  function place(car) {
    const p = car.lane;
    const [a, b] = [DIRS[p.from], DIRS[p.to]];
    const [cx, cz] = [(p.col + 0.5) * ts, (p.row + 0.5) * ts];
    const o = t.laneOffset;
    const [ex, ez] = [cx - a[0] * half - a[1] * o, cz - a[1] * half + a[0] * o]; // entry
    const [xx, xz] = [cx + b[0] * half - b[1] * o, cz + b[1] * half + b[0] * o]; // exit
    const f = car.s / laneLength(p);
    if (p.from === p.to) {
      Object.assign(car, { x: ex + (xx - ex) * f, z: ez + (xz - ez) * f, heading: Math.atan2(a[0], a[1]) });
      return;
    }
    // Round the corner k: (u, w) are the equal, perpendicular radii to the entry and the exit.
    const [kx, kz] = [cx + (b[0] - a[0]) * half, cz + (b[1] - a[1]) * half];
    const [ux, uz, wx, wz] = [ex - kx, ez - kz, xx - kx, xz - kz];
    const [c, s] = [Math.cos((f * Math.PI) / 2), Math.sin((f * Math.PI) / 2)];
    Object.assign(car, { x: kx + c * ux + s * wx, z: kz + c * uz + s * wz, heading: Math.atan2(c * wx - s * ux, c * wz - s * uz) });
  }

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
  // cameras look along; the blocks hide the rest. Upgrade if the city gets low buildings or long open views.
  function hidden(x, z, truck, distance) {
    const sameStreet = Math.floor(x / ts) === Math.floor(truck.x / ts) || Math.floor(z / ts) === Math.floor(truck.z / ts);
    return !sameStreet && Math.hypot(x - truck.x, z - truck.z) >= distance;
  }

  // One new car at the start of a random hidden road tile in the spawn ring, standing, unless another car is
  // within the look-ahead there.
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
    const car = { id: nextId++, x: 0, z: 0, heading: 0, speed: 0, lane: route[0], route, s: 0 };
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

  // The fastest the car may go now: cruise, slower through turns, and able to stop at `brake` before a stop
  // line that isn't green and behind the car or truck ahead. A light it can't stop for at `maxBrake` (it
  // turned amber too late) is driven through.
  function targetSpeed(car, truckBox, lights) {
    let speed = car.lane.from === car.lane.to ? t.speed : t.turnSpeed;
    const limit = (gap, end = 0) => (speed = Math.min(speed, Math.sqrt(end ** 2 + 2 * t.brake * Math.max(0, gap))));
    let dist = laneLength(car.lane) - car.s; // centre to the start of the next piece
    for (const p of car.route.slice(1)) {
      if (p.from !== p.to) limit(dist, t.turnSpeed);
      const light = lights.find((l) => l.col === p.col && l.row === p.row && l.dir === p.from);
      const short = dist - size.length / 2; // front bumper to the stop line
      if (light && light.phase !== 'green' && short > 0 && car.speed ** 2 <= 2 * t.maxBrake * short) limit(short - t.stopGap);
      dist += laneLength(p);
    }
    const reach = t.lookAhead + size.length;
    for (const other of cars) {
      if (other === car || Math.hypot(other.x - car.x, other.z - car.z) > reach || !follows(car, other)) continue;
      limit(aheadOf(car, corners(other, size)) - size.length / 2 - t.followGap);
    }
    limit(aheadOf(car, truckBox) - size.length / 2 - t.followGap);
    return speed;
  }

  // Drops cars that left the road or the truck's surroundings, spawns one while fewer than `count`, then
  // drives each car.
  function step(dt, truck, lights, count) {
    for (let i = cars.length - 1; i >= 0; i--) {
      if (cars[i].gone || hidden(cars[i].x, cars[i].z, truck, t.despawnDistance)) cars.splice(i, 1);
    }
    if (cars.length < count) spawn(truck);

    const truckBox = corners(truck, truckSize);
    const targets = cars.map((car) => targetSpeed(car, truckBox, lights));
    cars.forEach((car, i) => {
      car.speed = Math.min(targets[i], car.speed + t.accel * dt);
      car.s += car.speed * dt;
      while (car.s >= laneLength(car.lane)) {
        if (car.route.length === 1) {
          car.gone = true; // dead end
          return;
        }
        car.s -= laneLength(car.lane);
        car.route.shift();
        extend(car.route);
        car.lane = car.route[0];
      }
      place(car);
    });
  }

  return { cars, step };
}
