// Pedestrians (#78), part of the headless Sim: people walking the map's pavement lines (pavements.js), round the
// corners with them, and turning back round a small half circle where an open line ends. Each keeps
// tables.pedestrians.keepRight m right of its line, so people meeting pass, and all walk at one pace, so none walks
// through another going the same way. They never set foot on the road and nothing collides with them yet. Like the AI
// cars they appear and leave out of the truck's view, keeping the count the Sim asks for.
// A pedestrian is { id, x, z, heading, walk, s (m along it) }. Walks are closed polylines { points, at, length } walked
// forwards: a ring line's two (along it and against it, each keeping right), an open line's one (along its right side,
// round its end, back along the other side and round its start).
// The step allocates nothing but a new pedestrian.

import { offset } from './graph.js';
import { measure } from './pavements.js';
import { outOfView } from './traffic.js';

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

  const places = []; // { walk, s (m along it) }
  for (const walk of walks) for (let s = 0; s < walk.length; s += PLACES) places.push({ walk, s });

  // Drops the pedestrians out of view past `despawnDistance`, adds one while fewer than `count`, and walks them.
  function step(dt, truck, count) {
    for (let i = people.length - 1; i >= 0; i--) {
      if (!outOfView(people[i], truck, p.despawnDistance, viewCos)) continue;
      people[i] = people[people.length - 1]; // order doesn't matter, and splice would allocate
      people.pop();
    }
    if (people.length < count) spawn(truck);
    const d = p.speed * dt;
    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      person.s = (person.s + d) % person.walk.length;
      pose(person.walk, person.s, person);
    }
  }

  // One new pedestrian at a random place out of view in the spawn ring with no one else within ROOM m; with none found
  // in SPAWN_TRIES draws, the next step tries again. Each draw is tried on `probe`, so only the one that fits allocates.
  const probe = { id: 0, x: 0, z: 0, heading: 0, walk: null, s: 0 };
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
