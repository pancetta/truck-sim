import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { createAutopilot } from '../autopilot.js';
import { poseAt } from './lanes.js';
import { build, way, monti, undrained, createSim, seeded, offRoad, vehiclesOverlap, DT, GAS, BRAKE, IDLE } from './fixtures.js';

// The soaks and the collider broad phase, on the real Monti extract (spec #59).

describe('Sim: collider broad phase', () => {
  const noCars = { ...tables, rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 0 })) } };

  test("the indexed collision check agrees with testing every collider's outline, round corners, at any heading", () => {
    const map = monti(noCars);
    // One collider spanning several index cells, as a longer obstacle would, out on a square.
    const [minX, maxX, minZ, maxZ] = [-30, 12, -20, 18];
    map.colliders.push({ kind: 'wide', minX, maxX, minZ, maxZ, points: [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }] });
    const sim = createSim(noCars, map, seeded(1));
    const { length, width } = tables.fleet.truck;
    const [l, w] = [length / 2, width / 2];
    // Brute force, without the index: out of the map's bounds, or a side of any collider's outline running into the
    // truck's box (clipped to it in the truck's frame, touching isn't overlapping), or the box wholly inside an outline.
    const blocked = ({ x, z, heading }) => {
      const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
      const local = (p) => [(p.x - x) * fx + (p.z - z) * fz, -(p.x - x) * fz + (p.z - z) * fx];
      const cs = [[l, w], [l, -w], [-l, -w], [-l, w]].map(([a, b]) => ({ x: x + fx * a - fz * b, z: z + fz * a + fx * b }));
      const { bounds } = map;
      if (cs.some((c) => c.x < bounds.minX || c.z < bounds.minZ || c.x > bounds.maxX || c.z > bounds.maxZ)) return true;
      const enters = ([a0, r0], [a1, r1]) => {
        // The part of the side inside |along| < l and |right| < w (Liang–Barsky), if any of it is.
        let [t0, t1] = [0, 1];
        for (const [p, q] of [[a0 - a1, a0 + l], [a1 - a0, l - a0], [r0 - r1, r0 + w], [r1 - r0, w - r0]]) {
          if (p === 0) {
            if (q <= 0) return false;
          } else if (p < 0) t0 = Math.max(t0, q / p);
          else t1 = Math.min(t1, q / p);
        }
        return t1 - t0 > 1e-9;
      };
      const inOutline = (pts) => {
        let odd = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [a, b] = [pts[i], pts[j]];
          if (a.z > z !== b.z > z && x < a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z)) odd = !odd;
        }
        return odd;
      };
      return map.colliders.some((b) => {
        if (cs.every((c) => c.x <= b.minX) || cs.every((c) => c.x >= b.maxX) || cs.every((c) => c.z <= b.minZ) || cs.every((c) => c.z >= b.maxZ)) return false;
        const p = b.points.map(local);
        return p.some((q, i) => enters(q, p[(i + 1) % p.length])) || inOutline(b.points);
      });
    };
    // Round the wide box, every light post, the map's corners, and every 7th collider's first corner; at each, a
    // spread of points and headings along, across and between the axes.
    const places = [...map.lights.map((l) => l.post), { x: map.bounds.minX + 2, z: map.bounds.minZ + 2 }, { x: map.bounds.maxX - 2, z: map.bounds.maxZ - 2 }];
    for (let px = -36; px <= 18; px += 6) for (let pz = -26; pz <= 24; pz += 10) places.push({ x: px, z: pz });
    for (let i = 0; i < map.colliders.length; i += 7) places.push(map.colliders[i].points[0]);
    const mismatches = [];
    let hits = 0;
    let poses = 0;
    for (const at of places) {
      for (const [dx, dz] of [[0, 0], [1.3, -0.7], [-2.6, 1.9], [3.1, 3.4]]) {
        for (const heading of [0, 0.3, Math.PI / 4, Math.PI / 2, 2.5]) {
          const pose = { x: at.x + dx, z: at.z + dz, heading };
          Object.assign(sim.state.truck, pose, { speed: 0 });
          sim.step(DT, IDLE);
          const expected = blocked(pose);
          if (sim.state.collision !== expected) mismatches.push({ ...pose, expected });
          hits += expected;
          poses++;
        }
      }
    }

    expect(mismatches).toEqual([]);
    expect(hits).toBeGreaterThan(poses / 10); // both outcomes well represented
    expect(hits).toBeLessThan(poses * 0.95);
  });

  test('a collider turned off the axes stops the truck at its outline, not at its bounding box', () => {
    const map = build([way('residential', [[-90, 60], [90, 60]])], noCars);
    // A diamond 10 m from its centre to each corner, off the road.
    const points = [{ x: 35, z: 11 }, { x: 45, z: 21 }, { x: 35, z: 31 }, { x: 25, z: 21 }];
    map.colliders.push({ kind: 'building', minX: 25, maxX: 45, minZ: 11, maxZ: 31, points });
    const sim = createSim(noCars, map, seeded(1));
    const blockedAt = (x, z) => {
      Object.assign(sim.state.truck, { x, z, heading: 0, speed: 0 });
      sim.step(DT, IDLE);
      return sim.state.collision;
    };

    expect(blockedAt(44, 12)).toBe(false); // inside the bounding box, beside the diamond's corner
    expect(blockedAt(35, 9)).toBe(true); // the front reaches over the top corner
    expect(blockedAt(35, 21)).toBe(true); // wholly inside
  });
});

describe('Sim: traffic soak', () => {
  // Monti with 40 cars near the truck, over several seeds. The truck parks in awkward places, 40 s each so the queues it
  // causes clear, then at random poses anywhere on the road; besides, it drives the ?perf&auto loop and reverses back
  // and forth. A car driving into the truck shows as a car's footprint newly overlapping the truck's after a step: the
  // truck's own move into a car is undone, so it never leaves them overlapping. Cars driving into each other show the
  // same way (#43). Two-wheelers (#77) are among the cars, at the tables' share.
  const busy = {
    ...undrained(),
    rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 40 })) },
    traffic: { ...tables.traffic, spawnDistance: [45, 120], despawnDistance: 140 }, // the cars kept around the truck
  };
  const map = monti(busy);
  const CAR = tables.city.obstacles.car; // the largest kind

  // Steps `seconds` with the truck driven by `drive(sim)` (returns step i → input), or parked at each of `poses`
  // in turn for an equal share of the time. Returns the car-made contacts with the truck and between cars.
  function soak(seed, seconds, drive, poses = []) {
    const sim = createSim(busy, map, seeded(seed));
    const input = drive?.(sim);
    const steps = seconds * 60;
    let touching = new Set(); // ids of the cars touching the truck, and 'id,id' of pairs of cars touching
    let contacts = 0;
    let crashes = 0;
    for (let i = 0; i < steps; i++) {
      const k = Math.floor((i * poses.length) / steps);
      const placed = poses.length > 0 && i === Math.ceil((k * steps) / poses.length);
      if (placed) Object.assign(sim.state.truck, poses[k]);
      sim.step(DT, input ? input(i) : IDLE);
      const { truck, traffic } = sim.state;
      const now = new Set();
      for (const [a, car] of traffic.entries()) {
        if (vehiclesOverlap(car, car.size, truck, tables.fleet.truck)) now.add(car.id);
        for (const other of traffic.slice(a + 1)) {
          const pair = `${Math.min(car.id, other.id)},${Math.max(car.id, other.id)}`;
          if ((car.x - other.x) ** 2 + (car.z - other.z) ** 2 < CAR.length ** 2 && vehiclesOverlap(car, car.size, other, other.size)) now.add(pair);
        }
      }
      for (const id of now) {
        if (touching.has(id)) continue;
        if (typeof id !== 'number') crashes++;
        else if (!placed) contacts++; // a pose can land the truck on a car (#68: a police car, seed 2); no car made that
      }
      touching = now;
    }
    return { contacts, crashes };
  }

  test('AI cars never drive into the truck or into each other', () => {
    const { nodes, edges } = map.graph;
    // The truck parked in junction boxes: Via Cavour's five-arm one, the Largo Visconti Venosta ring, the crossings on
    // Via Urbana and the light junction, each at a slant.
    const box = (x, z, heading) => {
      const n = nodes.reduce((best, nd) => (Math.hypot(nd.x - x, nd.z - z) < Math.hypot(best.x - x, best.z - z) ? nd : best));
      return { x: n.x, z: n.z, heading, speed: 0 };
    };
    const boxes = [box(-103, 127, 0.4), box(85, 64, 2), box(219, -212, -1), box(311, -235, 0.8)];
    // Reversing back and forth in the right-hand lane of Via Cavour's longest two-way stretch.
    const cavour = edges.filter((e) => e.name === 'Via Cavour' && !e.oneWay).reduce((a, b) => (a.length > b.length ? a : b));
    let contacts = 0;
    let crashes = 0;
    const add = (run) => ([contacts, crashes] = [contacts + run.contacts, crashes + run.crashes]);
    for (const seed of [1, 2, 3]) {
      add(soak(seed, 40 * boxes.length, null, boxes));
      // Anywhere across a road, any heading.
      const random = seeded(seed + 100);
      const poses = Array.from({ length: 10 }, () => {
        const e = edges[Math.floor(random() * edges.length)];
        const p = map.graph.pointAt(e, random() * e.length);
        return { x: p.x + (random() - 0.5) * e.width * 0.6, z: p.z + (random() - 0.5) * e.width * 0.6, heading: random() * 2 * Math.PI, speed: 0 };
      });
      add(soak(seed, 20 * poses.length, null, poses));
      const reversing = (sim) => {
        const p = map.graph.pointAt(cavour, cavour.length / 2);
        const q = map.graph.pointAt(cavour, cavour.length / 2 + 1);
        const heading = Math.atan2(q.x - p.x, q.z - p.z);
        Object.assign(sim.state.truck, { x: p.x - Math.cos(heading) * cavour.laneOffset, z: p.z + Math.sin(heading) * cavour.laneOffset, heading, speed: 0 });
        return (i) => (i % 600 < 200 ? GAS : BRAKE);
      };
      add(soak(seed, 120, reversing));
      const autopilot = (sim) => {
        const pilot = createAutopilot(sim, map, busy);
        pilot.place();
        return () => pilot.update(DT);
      };
      add(soak(seed, 120, autopilot));
    }
    expect(contacts).toBe(0);
    expect(crashes).toBe(0);
  }, 120_000);
});

describe('Sim: traffic gridlock soak', () => {
  // #46: over long runs at the top tier's count and at 40, with the truck parked off the road (cars only meet
  // cars) or driving the ?perf&auto loop, no car stands for more than `limit` s, not counting the time it waits
  // at a light that isn't green, near the truck, or queued behind the truck or a car that is moving or itself
  // waiting so. Street events (#80) are on: a garbage truck standing at its work waits too.
  // s; "about 30" in #46, where right before left could hold a car up to ~36 s behind a steady stream from its right,
  // which then let it go; the gridlocks held cars 90–414 s.
  const limit = 40;
  const { stopSpeed } = tables.fleet.truck;

  // shortcut: "queued" is the first vehicle centre within 1.5 m of the car's route, sampled every 0.5 m up to 12 m
  // ahead (#77: a scooter stopped at the end of a turn, still facing round it, missed the car ahead along its heading),
  // and a light is "ahead" within 40 m of route; good enough for queues in lanes, which is all the Sim has. Upgrade if
  // longer vehicles start to fool it.
  function waiting(car, sim, excused) {
    if (excused.has(car)) return excused.get(car);
    excused.set(car, false); // a cycle of cars each queued behind the next is stuck
    const { traffic, truck, lights } = sim.state;
    let ok = car.speed >= stopSpeed || car.halt > 0 || Math.hypot(car.x - truck.x, car.z - truck.z) < 30;
    let dist = -car.s;
    for (const p of car.route) {
      if (ok || dist > 40) break;
      ok = p.kind === 'turn' && lights.some((l) => l.node === p.node && l.slot === p.slot && l.phase !== 'green');
      dist += p.length;
    }
    if (!ok) {
      let ahead = null;
      const pose = { x: 0, z: 0, heading: 0 };
      for (let i = 0, s = car.s + 0.5, d = 0.5; d <= 12 && !ahead; s += 0.5, d += 0.5) {
        while (i < car.route.length && s > car.route[i].length) s -= car.route[i++].length;
        if (i === car.route.length) break;
        poseAt(car.route[i], s, pose);
        ahead = [...traffic, truck].find((o) => o !== car && Math.hypot(o.x - pose.x, o.z - pose.z) < 1.5) ?? null;
      }
      ok = ahead === truck || (ahead !== null && waiting(ahead, sim, excused));
    }
    excused.set(car, ok);
    return ok;
  }

  // The longest any car was stuck, in s, with the truck driven by the autopilot, or else parked off the road near
  // `near` ({ x, z }).
  function longestStuck(cars, seed, near) {
    const counted = { ...undrained(), rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: cars })) } };
    const map = monti(counted);
    const sim = createSim(counted, map, seeded(seed));
    let input = () => IDLE;
    if (near) {
      Object.assign(sim.state.truck, offRoad(map, near.x, near.z), { heading: 0, speed: 0 });
    } else {
      const pilot = createAutopilot(sim, map, counted);
      pilot.place();
      input = () => pilot.update(DT);
    }
    const stuck = new Map(); // car → s
    let longest = 0;
    for (let i = 0; i < 600 * 60; i++) {
      sim.step(DT, input());
      const excused = new Map();
      for (const car of sim.state.traffic) {
        // The count pauses while the car waits and starts over once it moves, so a gridlock at a light still adds up.
        const s = car.speed >= stopSpeed ? 0 : (stuck.get(car) ?? 0) + (waiting(car, sim, excused) ? 0 : DT);
        stuck.set(car, s);
        longest = Math.max(longest, s);
      }
    }
    return longest;
  }

  const top = tables.rank.tiers.at(-1).traffic;
  for (const cars of [top, 40]) {
    // The truck parks in the middle, near the Largo Visconti Venosta ring and Via Cavour's five-arm junction; near the
    // ring of one-way streets off Via del Colosseo, which cars once filled until it locked (#63); and, at the top tier's
    // count, near the light junction and the crossings round it.
    // shortcut: at 40 cars round the light junction, the queues merging onto Via Cavour and Via Panisperna there crawl,
    // and a car merging into one can wait 40–80 s (congestion: it moves on); look at merges if the tiers grow past ~20.
    test(`${cars} cars, the truck parked: no car stuck for over ${limit} s`, () => {
      const places = [{ x: 0, z: 0 }, { x: -350, z: 250 }, ...(cars === top ? [{ x: 260, z: -200 }] : [])];
      const longest = places.flatMap((near) => [1, 2, 3].map((seed) => Math.round(longestStuck(cars, seed, near))));
      expect(longest.filter((s) => s > limit)).toEqual([]);
    }, 120_000);
  }
  // The autopilot's loop passes the light junction, so at 40 cars (one seed of three) a merge there held a car 42 s: the
  // congestion above. At the top tier's count it doesn't come about.
  test(`${top} cars, the truck on the autopilot loop: no car stuck for over ${limit} s`, () => {
    const longest = [1, 2, 3].map((seed) => Math.round(longestStuck(top, seed)));
    expect(longest.filter((s) => s > limit)).toEqual([]);
  }, 120_000);
});
