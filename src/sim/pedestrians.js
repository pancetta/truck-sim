// Pedestrians (#78), part of the headless Sim: people walking the map's pavement lines (pavements.js), round the
// corners with them, and turning back where an open line ends. Each keeps tables.pedestrians.keepRight m right of its
// line, so people meeting pass, and all walk at one pace, so none walks through another going the same way. They never
// set foot on the road and nothing collides with them yet. Like the AI cars they appear and leave out of the truck's
// view, keeping the count the Sim asks for.
// A pedestrian is { id, x, z, heading, line, dir (1 the way it runs, -1 against it), s (m along its walk) }.
// The step allocates nothing but a new pedestrian.

import { offset } from './graph.js';
import { outOfView } from './traffic.js';

const PLACES = 5; // m between the places along the lines where a pedestrian may appear
const SPAWN_TRIES = 16; // random places tried per step while pedestrians are missing
const ROOM = 2; // m from any other pedestrian for a new one

export function createPedestrians(tables, map, random) {
  const p = tables.pedestrians;
  const viewCos = Math.cos(tables.traffic.spawnView);
  // Each line with its walks, the ways walked along it and against it ({ points, at, length }, both running the way
  // the line does): `keepRight` right of each, mitred, so they bend smoothly.
  const walkOf = (points) => {
    const at = points.map((q, k) => (k ? Math.hypot(q.x - points[k - 1].x, q.z - points[k - 1].z) : 0));
    for (let k = 1; k < at.length; k++) at[k] += at[k - 1];
    return { points, at, length: at.at(-1) };
  };
  const lines = map.pavements.map((line) => ({ ...line, walks: [walkOf(offset(line.points, p.keepRight)), walkOf(offset(line.points, -p.keepRight))] }));
  const people = [];
  let nextId = 1;
  const walkOn = (person) => person.line.walks[person.dir > 0 ? 0 : 1];

  // Sets `out`'s x, z and heading to `s` m along `walk`, walking `dir`.
  function pose(walk, s, dir, out) {
    const { at, points } = walk;
    let k = 0;
    while (k < at.length - 2 && at[k + 1] <= s) k++;
    const t = at[k + 1] > at[k] ? (s - at[k]) / (at[k + 1] - at[k]) : 0;
    const a = points[k];
    const b = points[k + 1];
    out.x = a.x + t * (b.x - a.x);
    out.z = a.z + t * (b.z - a.z);
    out.heading = Math.atan2(dir * (b.x - a.x), dir * (b.z - a.z));
  }

  const places = []; // { line, s (m along it) }
  for (const line of lines) for (let s = 0; s < line.length; s += PLACES) places.push({ line, s });

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
      let walk = walkOn(person);
      person.s += person.dir * d;
      if (person.line.closed) person.s = ((person.s % walk.length) + walk.length) % walk.length;
      else if (person.s < 0 || person.s > walk.length) {
        // Back along the other walk, from the same end (what's left of this step's walk is lost: under 2 cm).
        person.dir = -person.dir;
        walk = walkOn(person);
        person.s = person.dir > 0 ? 0 : walk.length;
      }
      pose(walk, person.s, person.dir, person);
    }
  }

  // One new pedestrian at a random place, walking either way, out of view in the spawn ring with no one else within
  // ROOM m; with none found in SPAWN_TRIES draws, the next step tries again. Each draw is tried on `probe`, so only
  // the one that fits allocates.
  const probe = { id: 0, x: 0, z: 0, heading: 0, line: null, dir: 1, s: 0 };
  const crowded = () => {
    for (let i = 0; i < people.length; i++) if ((people[i].x - probe.x) ** 2 + (people[i].z - probe.z) ** 2 < ROOM ** 2) return true;
    return false;
  };
  function spawn(truck) {
    const [near, far] = p.spawnDistance;
    for (let i = 0; i < SPAWN_TRIES && places.length; i++) {
      const place = places[Math.floor(random() * places.length)];
      probe.line = place.line;
      probe.dir = random() < 0.5 ? 1 : -1;
      probe.s = (place.s / place.line.length) * walkOn(probe).length;
      pose(walkOn(probe), probe.s, probe.dir, probe);
      if (!outOfView(probe, truck, near, viewCos) || (probe.x - truck.x) ** 2 + (probe.z - truck.z) ** 2 > far ** 2 || crowded()) continue;
      people.push({ ...probe, id: nextId++ });
      return;
    }
  }

  return { people, step };
}
