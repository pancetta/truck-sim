// Dev-only (?perf&auto): drives the truck round a fixed loop, along the road graph's shortest legal routes between its
// stops, so every perf run sees the same route: through `stops`, spot ids (tables.perf.spots unless given). With
// `loop` false it drives from the first stop to the last and no further. Pure pursuit in the right-hand lane (a one-way's middle); when stuck it jumps on along the
// way. Ported from the investigation's scratch autopilot; since #33 it also waits behind an AI car in its path, as it
// ignores right of way and otherwise rammed one car over and over at 50 km/h traffic.
export function createAutopilot(sim, map, tables, stops = tables.perf.spots, loop = true) {
  const { spacing, dodge, radius, cruiseSpeed, turnSpeed, steerGain, stuckTime, waitTime } = tables.perf;
  // Which side of each edge its parked cars stand on: 1 right of the edge's way, -1 left.
  const parkedSide = new Map();
  for (const c of map.colliders.filter((c) => c.kind === 'car')) {
    const p = map.graph.nearest((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
    const [a, b] = [p.edge.points[p.k], p.edge.points[Math.min(p.k + 1, p.edge.points.length - 1)]];
    parkedSide.set(p.edge, Math.sign(-(b.z - a.z) * ((c.minX + c.maxX) / 2 - p.x) + (b.x - a.x) * ((c.minZ + c.maxZ) / 2 - p.z)));
  }
  // m right of the centre line at (x, z): its edge's lane, but the middle where the road is too narrow for two trucks
  // (a one-way or a service lane), on a one-way (driven its own way, along the edge) `dodge` m away from its parked
  // cars, as they leave the truck only centimetres there
  const laneAt = (x, z) => {
    const { edge } = map.graph.nearest(x, z);
    if (edge.oneWay) return -(parkedSide.get(edge) ?? 0) * dodge;
    return edge.width < 2 * tables.vehicle.width ? 0 : edge.laneOffset;
  };
  const corners = stops.map((id) => map.spots.find((s) => s.id === id).pose);
  const legs = corners.slice(0, loop ? corners.length : -1).flatMap((c, i) => map.graph.route(c, corners[(i + 1) % corners.length]).points);
  const path = resample(radius ? rounded(legs, radius, laneAt) : legs, spacing);
  if (loop && Math.hypot(path[0].x - path.at(-1).x, path[0].z - path.at(-1).z) < spacing / 2) path.pop(); // the loop closes
  const lanes = path.map(({ x, z }) => laneAt(x, z));
  let idx = 0;
  let stuck = 0;
  const input = { steer: 0, gas: 0, brake: 0 };
  const index = (i) => (loop ? ((i % path.length) + path.length) % path.length : Math.max(0, Math.min(i, path.length - 1)));
  const at = (i) => path[index(i)];
  // The lane point of path point i: moved its lane to the right of the way to point i + 1 (from the one before at the
  // end of a path that doesn't loop).
  const point = (i) => {
    const k = loop ? i : Math.min(index(i), path.length - 2);
    const a = at(k);
    const b = at(k + 1);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const l = lanes[index(i)];
    return [at(i).x - ((b.z - a.z) / d) * l, at(i).z + ((b.x - a.x) / d) * l];
  };
  // Whether the way turns at b, coming from a and going on to c (by more than 0.1 rad).
  const turns = (a, b, c) => Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) > 0.1 * Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z);

  // Puts the truck on the loop at path point i (the start by default), facing along it. Dev-only, so it sets the
  // Sim's state directly.
  function place(i = 0) {
    const [x, z] = point(i);
    const a = at(i);
    const b = at(i + 1);
    Object.assign(sim.state.truck, { x, z, heading: Math.atan2(b.x - a.x, b.z - a.z), speed: 0 });
    idx = i;
  }

  function update(dt) {
    const t = sim.state.truck;
    // Advance along the path to the nearest point ahead.
    let best = Infinity;
    let bi = idx;
    for (let k = 0; k < 6; k++) {
      const [px, pz] = point(idx + k);
      const d = (px - t.x) ** 2 + (pz - t.z) ** 2;
      if (d < best) [best, bi] = [d, idx + k];
    }
    idx = bi;
    if (best > (2 * spacing) ** 2) {
      // lost (e.g. after a reset to the road): search the whole loop
      for (let k = 0; k < path.length; k++) {
        const [px, pz] = point(k);
        const d = (px - t.x) ** 2 + (pz - t.z) ** 2;
        if (d < best) [best, idx] = [d, k];
      }
    }
    const [tx, tz] = point(idx + 2);
    const want = Math.atan2(tx - t.x, tz - t.z);
    const err = Math.atan2(Math.sin(want - t.heading), Math.cos(want - t.heading));
    const turning = [1, 2, 3].some((k) => turns(at(idx + k - 1), at(idx + k), at(idx + k + 1)));
    const target = Math.min(turning || Math.abs(err) > 0.3 ? turnSpeed : cruiseSpeed, sim.state.speedLimit / 3.6);
    const waiting = carAhead(t);
    input.steer = Math.max(-1, Math.min(1, -err * steerGain));
    input.gas = !waiting && t.speed < target ? 1 : 0;
    // Brakes off once stopped: holding the brake at a standstill engages reverse.
    input.brake = (waiting && t.speed > tables.vehicle.stopSpeed) || t.speed > target + 1 ? 0.6 : 0;
    stuck = Math.abs(t.speed) < 0.3 ? stuck + dt : 0;
    if (stuck > (waiting ? waitTime : stuckTime)) {
      stuck = 0;
      // On along the loop, to the first point no AI car is within its look-ahead of. The Sim's resetToRoad could
      // turn the truck off the loop, where it wedged for good, blocking a lane and the crossing behind (#46).
      const clear = tables.traffic.lookAhead;
      let k = idx + 1;
      while (k < idx + path.length && sim.state.traffic.some((c) => Math.hypot(c.x - point(k)[0], c.z - point(k)[1]) < clear)) k++;
      place(k);
    }
    return input;
  }

  // Whether an AI car going its way (within 60°) has its centre in the truck's path within its braking distance
  // (at 3 m/s²) plus the two half lengths and 3 m. Cars crossing or coming the other way may wait for the truck,
  // so waiting for them could hold both for good.
  function carAhead(t) {
    const [fx, fz] = [Math.sin(t.heading), Math.cos(t.heading)];
    const reach = Math.max(0, t.speed) ** 2 / 6 + (tables.vehicle.length + tables.city.obstacles.car.length) / 2 + 3;
    const side = (tables.vehicle.width + tables.city.obstacles.car.width) / 2 + 0.5;
    return sim.state.traffic.some((c) => {
      const along = (c.x - t.x) * fx + (c.z - t.z) * fz;
      const ways = Math.sin(c.heading) * fx + Math.cos(c.heading) * fz > 0.5;
      return ways && along > 0 && along < reach && Math.abs(-(c.x - t.x) * fz + (c.z - t.z) * fx) < side;
    });
  }

  return { update, place };
}

// The polyline with each corner of over 0.2 rad cut by an arc tangent to both its sides, so that the lane `laneAt` m right
// of it turns on a radius of at least `radius` m: wider by the lane's offset towards the inside of the turn (less where a
// side is too short for it). Straight runs are first simplified to within 0.5 m, so a corner is where the way turns.
function rounded(points, radius, laneAt) {
  const p = simplify(points, 0.5);
  const out = [p[0]];
  const unit = (a, b) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    return [(b.x - a.x) / l, (b.z - a.z) / l, l];
  };
  for (let k = 1; k < p.length - 1; k++) {
    const [ux, uz, lu] = unit(p[k - 1], p[k]);
    const [wx, wz, lw] = unit(p[k], p[k + 1]);
    const turn = Math.atan2(ux * wz - uz * wx, ux * wx + uz * wz); // > 0 to the right
    if (Math.abs(turn) < 0.2) {
      out.push(p[k]);
      continue;
    }
    const side = Math.sign(turn);
    const inLane = laneAt(p[k].x - ux * Math.min(5, lu / 2), p[k].z - uz * Math.min(5, lu / 2));
    const outLane = laneAt(p[k].x + wx * Math.min(5, lw / 2), p[k].z + wz * Math.min(5, lw / 2));
    const half = Math.tan(Math.abs(turn) / 2);
    const t = Math.min((radius + Math.max(0, side * inLane, side * outLane)) * half, lu / 2, lw / 2); // m from the corner to the arc's ends
    const r = t / half;
    const [ax, az] = [p[k].x - ux * t, p[k].z - uz * t];
    const [cx, cz] = [ax - side * uz * r, az + side * ux * r]; // the arc's centre, on the inside; right of u is (-uz, ux)
    const n = Math.ceil(Math.abs(turn) * r);
    for (let i = 0; i <= n; i++) {
      const a = (turn * i) / n;
      const [dx, dz] = [ax - cx, az - cz];
      out.push({ x: cx + dx * Math.cos(a) - dz * Math.sin(a), z: cz + dx * Math.sin(a) + dz * Math.cos(a) });
    }
  }
  out.push(p.at(-1));
  return out;
}

// The polyline without the points that lie within `tolerance` m of the line between their neighbours (Douglas–Peucker).
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points.at(-1)];
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  let [far, at] = [0, 0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = l ? Math.abs((b.x - a.x) * (a.z - p.z) - (a.x - p.x) * (b.z - a.z)) / l : Math.hypot(p.x - a.x, p.z - a.z);
    if (d > far) [far, at] = [d, i];
  }
  if (far <= tolerance) return [a, b];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

// Points every `spacing` m along the polyline, from its start.
function resample(points, spacing) {
  const out = [];
  let next = 0; // m along the polyline of the next point out
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (; next <= walked + len + 1e-6; next += spacing) {
      const t = len ? Math.min(1, (next - walked) / len) : 0;
      out.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
    }
    walked += len;
  }
  return out;
}

export { seeded } from './sim/sim.js';
