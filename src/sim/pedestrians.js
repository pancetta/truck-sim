// Pedestrians (#78), part of the headless Sim: people walking the map's pavement lines (pavements.js), round the
// corners with them, and turning back round a small half circle where an open line ends. Each keeps
// tables.pedestrians.keepRight m right of its line, so people meeting pass, and all walk at one pace, so none walks
// through another going the same way. Like the AI cars they appear and leave out of the truck's view, keeping the
// count the Sim asks for.
// They set foot on the road only at a zebra crossing (#79, map.zebras, tables.zebras): one walking past a kerb may
// cross. It waits there until no vehicle, the truck included, is on the strip or can't stop before it, then walks
// straight over to a walk passing the other kerb. One on the strip as the truck comes near steps
// back quickly, away from the truck. On the strip they are solid to the truck (sim.js); nothing else collides with them.
// A pedestrian is { id, x, z, heading, walk, s (m along it), zebra (index, -1 for none), waiting, onRoad (off the
// kerb, crossing) } and its crossing's state. Walks are closed polylines { points, at, length } walked forwards: a
// ring line's two (along it and against it, each keeping right), an open line's one (along its right side, round its
// end, back along the other side and round its start).
// The step allocates nothing but a new pedestrian.

import { offset } from './graph.js';
import { measure } from './pavements.js';
import { boxesOverlap, outOfView } from './traffic.js';

const PLACES = 5; // m between the places along the walks where a pedestrian may appear
const SPAWN_TRIES = 16; // random places tried per step while pedestrians are missing
const ROOM = 2; // m from any other pedestrian for a new one
const CAP = 4; // segments of the half circle round an open line's end

export function createPedestrians(tables, map, random) {
  const p = tables.pedestrians;
  const k = p.keepRight;
  const viewCos = Math.cos(tables.traffic.spawnView);
  // The inner points of the half circle of radius k round `end`, from the right of `u` (the way out of the end) by
  // ahead to its left.
  const cap = (end, u) => Array.from({ length: CAP - 1 }, (_, i) => {
    const a = (Math.PI * (i + 1)) / CAP;
    return { x: end.x + k * (Math.cos(a) * -u[1] + Math.sin(a) * u[0]), z: end.z + k * (Math.cos(a) * u[0] + Math.sin(a) * u[1]) };
  });
  const unit = (a, b) => [(b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z), (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z)];
  const walkOf = (points) => ({ points, ...measure(points) });
  const walks = map.pavements.flatMap(({ points, closed }) => {
    const [right, left] = [offset(points, k), offset(points, -k).toReversed()];
    // A ring's offset ends a rounding error off its start, a jump for whoever walks round it: closed exactly.
    if (closed) return [walkOf([...right.slice(0, -1), right[0]]), walkOf([...left.slice(0, -1), left[0]])];
    const [first, last] = [unit(points[1], points[0]), unit(points.at(-2), points.at(-1))]; // out of each end
    return [walkOf([...right, ...cap(points.at(-1), last), ...left, ...cap(points[0], first), right[0]])];
  });
  const people = [];
  let nextId = 1;

  // Sets `out`'s x, z and heading to `s` m along `walk`.
  function pose(walk, s, out) {
    const { at, points } = walk;
    let i = 0;
    while (i < at.length - 2 && at[i + 1] <= s) i++;
    const t = at[i + 1] > at[i] ? (s - at[i]) / (at[i + 1] - at[i]) : 0;
    const a = points[i];
    const b = points[i + 1];
    out.x = a.x + t * (b.x - a.x);
    out.z = a.z + t * (b.z - a.z);
    out.heading = Math.atan2(b.x - a.x, b.z - a.z);
  }

  // Each walk's `stops`, where it passes a zebra's kerb ({ s, zebra (its index), side (of its kerbs) }, by s), and
  // each zebra's `ends` per side, where a pedestrian crossing to that side joins a walk ({ walk, s }). A zebra needs
  // both.
  const zt = tables.zebras;
  const ends = (map.zebras ?? []).map(({ kerbs }) => kerbs.map((kerb) => walks.flatMap((walk) => {
    const near = nearest(walk, kerb);
    return near.d < k + 0.5 ? [{ walk, s: near.s }] : [];
  })));
  for (const walk of walks) walk.stops = [];
  ends.forEach((sides, zebra) => {
    if (sides.some((list) => !list.length)) return;
    sides.forEach((list, side) => list.forEach(({ walk, s }) => walk.stops.push({ s, zebra, side })));
  });
  for (const walk of walks) walk.stops.sort((a, b) => a.s - b.s);

  const places = []; // { walk, s (m along it) }
  for (const walk of walks) for (let s = 0; s < walk.length; s += PLACES) places.push({ walk, s });

  // Drops the pedestrians out of view past `despawnDistance`, adds one while fewer than `count`, and walks them.
  // `zebras` are the Sim's, map.zebras with `passing` (a vehicle on it or that can't stop before it, set by traffic.js
  // and sim.js) and `people` (waiting at it or on it, which this sets); `near` is the truck's footprint grown as far as
  // the truck should keep pedestrians off a strip (corners in order).
  function step(dt, truck, count, zebras = [], near = null) {
    for (let i = people.length - 1; i >= 0; i--) {
      if (!outOfView(people[i], truck, p.despawnDistance, viewCos)) continue;
      people[i] = people[people.length - 1]; // order doesn't matter, and splice would allocate
      people.pop();
    }
    if (people.length < count) spawn(truck);
    for (let i = 0; i < zebras.length; i++) zebras[i].people = 0;
    const d = p.speed * dt;
    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      if (person.zebra < 0) walkOn(person, d);
      else if (person.waiting) wait(person, dt, zebras[person.zebra]);
      else cross(person, dt, truck, zebras[person.zebra], near);
      if (person.zebra >= 0) zebras[person.zebra].people++;
    }
  }

  // Along its walk; passing a zebra's kerb it stops there to cross, with chance tables.zebras.use.
  function walkOn(person, d) {
    const { walk } = person;
    const from = person.s;
    person.s += d;
    for (let j = 0; j < walk.stops.length; j++) {
      const stop = walk.stops[j];
      const s = stop.s < from ? stop.s + walk.length : stop.s; // passed round the end of the walk
      if (s <= from || s > person.s || random() >= zt.use) continue;
      person.s = stop.s;
      person.zebra = stop.zebra;
      person.side = stop.side;
      person.waiting = true;
      person.waited = 0;
      break;
    }
    person.s %= walk.length;
    pose(walk, person.s, person);
  }

  // At the kerb until no vehicle is on the strip or can't stop before it (`passing`), then out over the strip to a
  // walk past the other kerb; after tables.zebras.patience s, on along its walk.
  function wait(person, dt, zebra) {
    person.waited += dt;
    if (person.waited > zt.patience) return void (person.zebra = -1);
    if (zebra.passing) return;
    const list = ends[person.zebra][1 - person.side];
    person.end = list[Math.floor(random() * list.length)];
    pose(person.end.walk, person.end.s, to);
    person.fromX = person.x;
    person.fromZ = person.z;
    person.toX = to.x;
    person.toZ = to.z;
    person.span = Math.hypot(to.x - person.x, to.z - person.z);
    person.heading = Math.atan2(to.x - person.x, to.z - person.z);
    person.waiting = false;
    person.t = 0;
    person.dir = 1;
    person.hurry = false;
  }
  const to = { x: 0, z: 0, heading: 0 }; // where a pedestrian setting out walks to

  // Over the strip. As the truck comes near, quickly back to the kerb it set out from or on to the other, whichever
  // is away from the truck.
  function cross(person, dt, truck, zebra, near) {
    if (!person.hurry && near && boxesOverlap(near, zebra.strip)) {
      // the truck's centre and the pedestrian along the crossing, both times its span
      const ahead = (truck.x - person.fromX) * (person.toX - person.fromX) + (truck.z - person.fromZ) * (person.toZ - person.fromZ);
      person.dir = ahead > person.t * person.span ? -1 : 1;
      person.hurry = true;
    }
    person.t += person.dir * (person.hurry ? zt.stepBack : p.speed) * dt;
    person.onRoad = false;
    if (person.t <= 0) {
      person.waiting = true;
      person.waited = 0;
      person.hurry = false;
      return pose(person.walk, person.s, person);
    }
    if (person.t >= person.span) {
      person.hurry = false;
      person.walk = person.end.walk;
      person.s = person.end.s;
      person.zebra = -1;
      return pose(person.walk, person.s, person);
    }
    const f = person.t / person.span;
    person.x = person.fromX + f * (person.toX - person.fromX);
    person.z = person.fromZ + f * (person.toZ - person.fromZ);
    person.onRoad = Math.abs((person.x - zebra.x) * zebra.dz - (person.z - zebra.z) * zebra.dx) < zebra.half;
    person.heading = Math.atan2(person.dir * (person.toX - person.fromX), person.dir * (person.toZ - person.fromZ));
  }

  // One new pedestrian at a random place out of view in the spawn ring with no one else within ROOM m; with none found
  // in SPAWN_TRIES draws, the next step tries again. Each draw is tried on `probe`, so only the one that fits allocates.
  const probe = { id: 0, x: 0, z: 0, heading: 0, walk: null, s: 0, zebra: -1, waiting: false, onRoad: false, side: 0, waited: 0, end: null, fromX: 0, fromZ: 0, toX: 0, toZ: 0, span: 0, t: 0, dir: 1, hurry: false };
  const crowded = () => {
    for (let i = 0; i < people.length; i++) if ((people[i].x - probe.x) ** 2 + (people[i].z - probe.z) ** 2 < ROOM ** 2) return true;
    return false;
  };
  function spawn(truck) {
    const [near, far] = p.spawnDistance;
    for (let i = 0; i < SPAWN_TRIES && places.length; i++) {
      const place = places[Math.floor(random() * places.length)];
      probe.walk = place.walk;
      probe.s = place.s;
      pose(probe.walk, probe.s, probe);
      if (!outOfView(probe, truck, near, viewCos) || (probe.x - truck.x) ** 2 + (probe.z - truck.z) ** 2 > far ** 2 || crowded()) continue;
      people.push({ ...probe, id: nextId++ });
      return;
    }
  }

  return { people, step };
}

// The point of `walk` nearest `q`: { s (m along the walk), d (m from q) }.
function nearest({ points, at }, q) {
  const best = { s: 0, d: Infinity };
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.z - a.z) * (b.z - a.z)) / l2)) : 0;
    const d = Math.hypot(a.x + t * (b.x - a.x) - q.x, a.z + t * (b.z - a.z) - q.z);
    if (d < best.d) [best.s, best.d] = [at[i - 1] + t * (at[i] - at[i - 1]), d];
  }
  return best;
}
