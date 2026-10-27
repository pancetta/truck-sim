import { describe, expect, test } from 'vitest';
import { freshProfile } from './sim.js';
import * as tables from '../tables.js';
import { poseAt } from './lanes.js';
import { way, building, build, createSim, mapOf, drive, timeUntil, seeded, GAS, BRAKE, IDLE } from './fixtures.js';

// Tables without AI cars or police cars of their own: a test adds the police cars it needs.
const quiet = {
  ...tables,
  police: { ...tables.police, count: 0 },
  rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic: 0 })) },
};

// Adds a standing AI car (a police car if `police`) on the lane run nearest points[0] ([x, z]) that faces towards
// points[1], then through each junction it reaches along the turn whose way out points most towards the next point,
// one point per junction. Then places it with a step that takes no time.
function addCar(sim, id, points, police = false) {
  const { graph } = mapOf(sim);
  const [[x, z], [tx, tz]] = points;
  const [fx, fz] = [(tx - x) / Math.hypot(tx - x, tz - z), (tz - z) / Math.hypot(tx - x, tz - z)];
  const at = { x: 0, z: 0, heading: 0 };
  let best = { d: Infinity };
  for (const run of graph.paths.filter((p) => p.kind === 'run')) {
    for (let s = 0; s <= run.length; s += 0.1) {
      poseAt(run, s, at);
      const d = Math.hypot(at.x - x, at.z - z);
      if (d < best.d && Math.sin(at.heading) * fx + Math.cos(at.heading) * fz > 0.9) best = { d, run, s };
    }
  }
  const route = [best.run];
  for (const [px, pz] of points.slice(2)) {
    const node = graph.nodes[route.at(-1).to];
    const towards = (turn) => (turn.out.startDir.x * (px - node.x) + turn.out.startDir.z * (pz - node.z)) / Math.hypot(px - node.x, pz - node.z);
    const turn = route.at(-1).next.reduce((a, b) => (towards(b) > towards(a) ? b : a), route.at(-1).next[0]);
    if (!turn) break; // a dead end
    route.push(turn, turn.out);
  }
  const car = { id, x: 0, z: 0, heading: 0, speed: 0, lane: route[0], route, s: best.s, police };
  sim.state.traffic.push(car);
  sim.step(0, IDLE);
  return car;
}

describe('Sim: traffic lights', () => {
  const { secondary } = tables.osm.classes;
  const LANE = secondary.lane; // m right of the centre line, the truck's lane
  const EAST = Math.PI / 2;
  const SOUTH = 0;
  const WEST = -Math.PI / 2;
  const NORTH = Math.PI;
  const money = 500;
  const profile = { ...freshProfile(), money };

  // Via B (north–south) crossing Via A (east–west) at (0, 0), both secondary, 90 m each way. Via B is drawn first, so
  // its approaches are axis 0, green at the start, and Via A's red. Without names the crossing has no lights.
  const crossing = (named = true) => [
    way('secondary', [[0, -90], [0, 0], [0, 90]], named ? { name: 'Via B' } : {}),
    way('secondary', [[-90, 0], [0, 0], [90, 0]], named ? { name: 'Via A' } : {}),
  ];

  function crossingSim(ways = crossing(), money = profile.money) {
    return createSim(quiet, build(ways, quiet), seeded(1), { ...profile, money });
  }

  // The light the truck meets driving the way (dx, dz).
  const lightFor = (sim, dx, dz) => sim.state.lights.find((l) => Math.round(l.dx) === dx && Math.round(l.dz) === dz);
  const eastbound = (sim) => lightFor(sim, 1, 0);

  // A police car following the eastbound truck from the west end of Via A, where it sees it.
  const witness = (sim) => addCar(sim, 99, [[-60, LANE], [0, LANE], [80, LANE]], true);

  function placeAt(sim, x, z, heading) {
    Object.assign(sim.state.truck, { x, z, heading, speed: 0 });
  }

  // Steps with `input` until done() (or 20 s); returns how many fines were taken.
  function finesUntil(sim, input, done) {
    let fines = 0;
    let last = sim.state.lastFine;
    timeUntil(sim, input, () => {
      if (sim.state.lastFine !== last) [fines, last] = [fines + 1, sim.state.lastFine];
      return done();
    }, 20);
    return fines;
  }

  // Drives with full gas until done(), e.g. the truck's rear past the crossing; returns how many fines were taken.
  const driveThrough = (sim, done) => finesUntil(sim, GAS, done);
  // The eastbound truck's rear is out of the junction's box.
  const across = (sim) => sim.state.truck.x > 14;

  // The eastbound truck's front bumper, and Via B's near kerb, where the junction it drives into begins.
  const frontX = (sim) => sim.state.truck.x + tables.vehicle.length / 2;
  const EDGE = -secondary.width / 2;

  // Eastbound in its lane at 5 m/s from 0.5 m short of the stop line, over it with gas, then braked to a standstill
  // before the junction and the brake let go (held, it would engage reverse); returns the fines taken.
  function overTheLine(sim) {
    Object.assign(sim.state.truck, { x: eastbound(sim).x - 0.5 - tables.vehicle.length / 2, z: LANE, heading: EAST, speed: 5 });
    const fines = driveThrough(sim, () => frontX(sim) > eastbound(sim).x + 0.5) + finesUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
    expect(frontX(sim)).toBeLessThan(EDGE);
    return fines;
  }

  test("the state has the rule of the next junction ahead within the hint distance", () => {
    // Via B with the light junction at (0, 0) and an unsignalled crossing with a residential street at (0, 100).
    const ways = [
      way('secondary', [[0, -90], [0, 0], [0, 100], [0, 190]], { name: 'Via B' }),
      way('secondary', [[-90, 0], [0, 0], [90, 0]], { name: 'Via A' }),
      way('residential', [[-90, 100], [0, 100], [90, 100]]),
    ];
    const map = build(ways, quiet, undefined, { minX: -100, minZ: -100, maxX: 100, maxZ: 200 });
    const sim = createSim(quiet, map, seeded(1));
    const { hint } = tables.signs;
    const front = tables.vehicle.length / 2;
    const [light, cross] = [[0, 0], [0, 100]].map(([x, z]) => map.graph.nodes.find((n) => n.x === x && n.z === z).radius);
    // The rule the truck sees standing in its lane at z, facing south or north.
    const ruleAt = (z, heading) => {
      Object.assign(sim.state.truck, { x: (heading === SOUTH ? -1 : 1) * LANE, z, heading, speed: 0 });
      sim.step(0, IDLE);
      return sim.state.junctionRule;
    };

    // Southbound from the light junction to the crossing, whose box begins `cross` m before it.
    expect(ruleAt(100 - cross - hint - front - 1, SOUTH)).toBe(null);
    expect(ruleAt(100 - cross - hint - front + 1, SOUTH)).toBe('priority'); // Via B outranks the residential street
    expect(ruleAt(100 - cross + 2 - front, SOUTH)).toBe('priority'); // its front in the crossing
    expect(ruleAt(100 - front, SOUTH)).toBe('priority'); // its front in the middle, nearest the cross street
    // Northbound from the crossing: the light junction.
    expect(ruleAt(light + hint + front - 1, NORTH)).toBe('light');
    expect(ruleAt(light + hint + front + 1, NORTH)).toBe(null);
    // Northbound past the light junction, towards the street's dead end.
    expect(ruleAt(-30, NORTH)).toBe(null);
    // Facing north between them: the light junction ahead, but reversing, the crossing behind.
    expect(ruleAt(50, NORTH)).toBe('light');
    sim.state.truck.speed = -2;
    sim.step(0, IDLE);
    expect(sim.state.junctionRule).toBe('priority');
  });

  test('each axis cycles green, amber, red, red and amber with the table timings, never green together, offset per junction', () => {
    // Via A crossed by Via B at x = -40 (junction 0) and Via C at x = 40 (junction 1); the north–south streets are axis 0.
    const map = build([
      way('secondary', [[-40, -90], [-40, 0], [-40, 90]], { name: 'Via B' }),
      way('secondary', [[40, -90], [40, 0], [40, 90]], { name: 'Via C' }),
      way('secondary', [[-90, 0], [-40, 0], [40, 0], [90, 0]], { name: 'Via A' }),
    ], quiet);
    const sim = createSim(quiet, map, seeded(1));
    const { green, amber, redAmber, junctionOffset } = tables.lights;
    const ns = (j) => sim.state.lights.find((l) => l.junction === j && Math.round(l.dz) === 1);
    const ew = (j) => sim.state.lights.find((l) => l.junction === j && Math.round(l.dx) === 1);
    expect(ns(0).x).toBeCloseTo(-40); // junction 0 is Via B's
    const changes = [[], []]; // per junction: [time, phase] of its southbound light
    let t = 0;
    let before = [ns(0).phase, ns(1).phase];
    for (; t < 100; t += 1 / 60) {
      sim.step(1 / 60, IDLE);
      for (const j of [0, 1]) {
        expect(ns(j).phase === 'green' && ew(j).phase === 'green').toBe(false);
        if (ns(j).phase !== before[j]) changes[j].push([t, (before[j] = ns(j).phase)]);
      }
    }

    const phases = changes[0].map(([, p]) => p);
    expect(phases.slice(0, 5)).toEqual(['amber', 'red', 'redAmber', 'green', 'amber']);
    expect(changes[0][1][0] - changes[0][0][0]).toBeCloseTo(amber, 1);
    expect(changes[0][3][0] - changes[0][2][0]).toBeCloseTo(redAmber, 1);
    expect(changes[0][4][0] - changes[0][3][0]).toBeCloseTo(green, 1);
    // Junction 1 runs ahead by the offset: it turns amber that much earlier.
    expect(changes[0][0][0] - changes[1][0][0]).toBeCloseTo(junctionOffset, 1);
  });

  test('lightsVersion goes up exactly on the steps where some phase changes', () => {
    const sim = crossingSim();
    const phases = () => sim.state.lights.map((l) => l.phase).join();
    let [version, shown, changes] = [sim.state.lightsVersion, phases(), 0];
    for (let t = 0; t < 60; t += 1 / 60) {
      sim.step(1 / 60, IDLE);
      expect(sim.state.lightsVersion !== version).toBe(phases() !== shown);
      if (phases() !== shown) changes++;
      [version, shown] = [sim.state.lightsVersion, phases()];
    }
    expect(changes).toBeGreaterThan(2);
  });

  test('over the stop line and into the junction on red fines once, seen by a police car', () => {
    const sim = crossingSim();
    placeAt(sim, -28, LANE, EAST);
    witness(sim);
    expect(eastbound(sim).phase).toBe('red');
    expect(sim.state.policeSees).toBe(true);

    const fines = driveThrough(sim, () => across(sim));

    expect(eastbound(sim).phase).toBe('red');
    expect(fines).toBe(1);
    expect(sim.state.lastFine).toEqual({ reason: 'redLight', amount: tables.fines.redLight });
    expect(sim.state.profile.money).toBe(money - tables.fines.redLight);
  });

  test('crossing on green does not fine', () => {
    const sim = crossingSim();
    placeAt(sim, -LANE, -28, SOUTH);
    expect(lightFor(sim, 0, 1).phase).toBe('green');

    const fines = driveThrough(sim, () => sim.state.truck.z > 14);

    expect(fines).toBe(0);
    expect(sim.state.lastFine).toBe(null);
    expect(sim.state.profile.money).toBe(money);
  });

  test('over the stop line on red and stopped before the junction does not fine; driving on into it does', () => {
    const sim = crossingSim();
    witness(sim);
    expect(eastbound(sim).phase).toBe('red');

    expect(overTheLine(sim)).toBe(0);
    expect(sim.state.policeSees).toBe(true);
    expect(sim.state.profile.money).toBe(money);

    expect(driveThrough(sim, () => across(sim))).toBe(1);
    expect(sim.state.lastFine.reason).toBe('redLight');
  });

  test('over the stop line on amber, into the junction on red, does not fine: it is clearing the junction', () => {
    const sim = crossingSim();
    timeUntil(sim, IDLE, () => eastbound(sim).phase === 'amber', 60);
    expect(overTheLine(sim)).toBe(0);
    // Waiting well past the start of red, a police car behind.
    timeUntil(sim, IDLE, () => eastbound(sim).phase === 'red', 10);
    timeUntil(sim, IDLE, () => false, tables.lights.redGrace + 1);
    expect(eastbound(sim).phase).toBe('red');
    witness(sim);

    expect(driveThrough(sim, () => across(sim))).toBe(0);
    expect(sim.state.policeSees).toBe(true);
    expect(sim.state.profile.money).toBe(money);
  });

  test('over the stop line and into the junction in the first tables.lights.redGrace s of red does not fine; just after, it does', () => {
    // At 12 m/s from 0.2 m short of the line, `wait` s into red: line and junction edge inside 1 s.
    const run = (wait) => {
      const sim = crossingSim();
      timeUntil(sim, IDLE, () => eastbound(sim).phase === 'amber', 60);
      timeUntil(sim, IDLE, () => eastbound(sim).phase === 'red', 10);
      timeUntil(sim, IDLE, () => false, wait);
      Object.assign(sim.state.truck, { x: eastbound(sim).x - 0.2 - tables.vehicle.length / 2, z: LANE, heading: EAST, speed: 12 });
      witness(sim);
      expect(sim.state.policeSees).toBe(true);
      let entered = null;
      const fines = driveThrough(sim, () => ((entered ??= frontX(sim) >= EDGE ? sim.state.truck : null), across(sim)));
      expect(entered).not.toBe(null);
      expect(eastbound(sim).phase).toBe('red');
      return fines;
    };
    expect(run(0)).toBe(0);
    expect(run(tables.lights.redGrace + 0.1)).toBe(1);

    // Over the line inside the grace, stopped, then into the junction after it: fined.
    const sim = crossingSim();
    timeUntil(sim, IDLE, () => eastbound(sim).phase === 'amber', 60);
    timeUntil(sim, IDLE, () => eastbound(sim).phase === 'red', 10);
    expect(overTheLine(sim)).toBe(0);
    timeUntil(sim, IDLE, () => false, tables.lights.redGrace);
    witness(sim);
    expect(driveThrough(sim, () => across(sim))).toBe(1);
  });

  test('over the stop line on red, into the junction on red and amber, does not fine', () => {
    const sim = crossingSim();
    expect(eastbound(sim).phase).toBe('red');
    expect(overTheLine(sim)).toBe(0);
    // Edged up to 0.2 m short of the junction, then rolling in at 3 m/s once red and amber shows.
    sim.state.truck.x = EDGE - 0.2 - tables.vehicle.length / 2;
    timeUntil(sim, IDLE, () => eastbound(sim).phase === 'redAmber', 30);
    witness(sim);
    sim.state.truck.speed = 3;
    let phase = null;
    const fines = driveThrough(sim, () => ((phase ??= frontX(sim) >= EDGE ? eastbound(sim).phase : null), across(sim)));
    expect(phase).toBe('redAmber');
    expect(fines).toBe(0);
    expect(sim.state.profile.money).toBe(money);
  });

  test('an unsignalled crossing never fines', () => {
    const sim = crossingSim(crossing(false));
    placeAt(sim, -28, LANE, EAST);
    witness(sim);

    const fines = driveThrough(sim, () => across(sim));

    expect(sim.state.lights).toEqual([]);
    expect(fines).toBe(0);
    expect(sim.state.profile.money).toBe(money);
  });

  test('a fine larger than the money leaves 0 and shows the amount taken', () => {
    const sim = crossingSim(crossing(), 30);
    placeAt(sim, -28, LANE, EAST);
    witness(sim);

    driveThrough(sim, () => across(sim));

    expect(sim.state.lastFine).toEqual({ reason: 'redLight', amount: 30 });
    expect(sim.state.profile.money).toBe(0);
  });

  test('the fine comes at the junction edge, not at the stop line before it', () => {
    // Eastbound on red at 5 m/s, a police car behind, from just short of the line: none to just short of the edge,
    // one at the edge.
    const sim = crossingSim();
    Object.assign(sim.state.truck, { x: eastbound(sim).x - 0.5 - tables.vehicle.length / 2, z: LANE, heading: EAST, speed: 5 });
    witness(sim);
    expect(eastbound(sim).phase).toBe('red');
    expect(driveThrough(sim, () => frontX(sim) > EDGE - 0.5)).toBe(0);
    expect(driveThrough(sim, () => frontX(sim) > EDGE + 0.5)).toBe(1);
  });

  test('reversing over a stop line on red does not fine; driving forwards back over it does', () => {
    const sim = crossingSim();
    // Facing west in the westbound lane of the west arm, then backing east through the crossing, front last.
    placeAt(sim, -28, -LANE, WEST);
    expect(eastbound(sim).phase).toBe('red');
    let fines = 0;
    let last = null;
    const count = () => {
      if (sim.state.lastFine !== last) [fines, last] = [fines + 1, sim.state.lastFine];
    };
    drive(sim, 1, BRAKE); // reverse engages
    // Past the east arm's stop line.
    timeUntil(sim, BRAKE, () => (count(), sim.state.truck.x > 28), 30);
    expect(sim.state.truck.x).toBeGreaterThan(28);
    expect(eastbound(sim).phase).toBe('red');
    expect(fines).toBe(0);

    // Now forwards, westbound into the crossing from the east arm while that approach is red, a police car behind.
    const westbound = lightFor(sim, -1, 0);
    timeUntil(sim, IDLE, () => sim.state.truck.speed === 0, 5);
    timeUntil(sim, IDLE, () => westbound.phase === 'amber', 60); // then a whole red to drive up to the line
    timeUntil(sim, IDLE, () => westbound.phase === 'red', 60);
    addCar(sim, 99, [[80, -LANE], [0, -LANE], [-80, -LANE]], true);
    timeUntil(sim, GAS, () => (count(), sim.state.truck.x < -14), 20);
    expect(fines).toBe(1);
    expect(sim.state.lastFine.reason).toBe('redLight');
  });

  describe('police witnesses (#68)', () => {
    // The light junction of Via A and Via B at (0, 0), Via A running on 140 m east, and a parallel street 35 m south
    // behind a row of buildings; a building on each corner north of Via A. The eastbound truck runs the junction's red
    // light at 5 m/s from just short of the stop line, so the police cars, standing when added, hardly move before it.
    const kerb = secondary.width / 2 + tables.osm.pavement; // m from a secondary's centre line to the buildings
    const STREETS = [
      way('secondary', [[0, -90], [0, 0], [0, 90]], { name: 'Via B' }),
      way('secondary', [[-90, 0], [0, 0], [140, 0]], { name: 'Via A' }),
      way('residential', [[-90, 35], [0, 35], [140, 35]]),
      building([[-90, -90], [-kerb, -90], [-kerb, -kerb], [-90, -kerb]]),
      building([[kerb, -90], [140, -90], [140, -kerb], [kerb, -kerb]]),
      building([[-90, kerb], [-kerb, kerb], [-kerb, 30], [-90, 30]]),
      building([[kerb, kerb], [140, kerb], [140, 30], [kerb, 30]]),
    ];
    const area = { minX: -100, minZ: -100, maxX: 150, maxZ: 100 };

    // `police`: the police car's points, as addCar takes them.
    function runRed(police, radius = tables.police.radius) {
      const t = { ...quiet, police: { ...quiet.police, radius } };
      const sim = createSim(t, build(STREETS, t, undefined, area), seeded(1), profile);
      Object.assign(sim.state.truck, { x: eastbound(sim).x - tables.vehicle.length / 2 - 0.5, z: LANE, heading: EAST, speed: 5 });
      addCar(sim, 99, police, true);
      expect(eastbound(sim).phase).toBe('red');
      const sees = sim.state.policeSees;
      return { sees, fines: driveThrough(sim, () => across(sim)), money: sim.state.profile.money };
    }


    test('in range and in sight: fined', () => {
      // Behind the truck in its lane, about 37 m back.
      expect(runRed([[-61, LANE], [0, LANE], [80, LANE]])).toEqual({ sees: true, fines: 1, money: money - tables.fines.redLight });
    });

    test('out of range: not fined, though it would be with a longer radius', () => {
      // Coming the other way from Via A's east end, 116 m off.
      const far = [[92, -LANE], [0, -LANE], [-80, -LANE]];
      expect(runRed(far)).toEqual({ sees: false, fines: 0, money });
      expect(runRed(far, 150)).toMatchObject({ sees: true, fines: 1 });
    });

    test('on the cross street, seeing the cab come out though the corner hides the rest: fined', () => {
      // Southbound on Via B's north arm, 32 m up, turning west. The corner building hides the truck at the stop line, and
      // still hides its centre as it enters the junction, but not its front bumper (from 4 m nearer it sees the centre).
      expect(runRed([[-LANE, -32], [-LANE, 0], [-80, 0]])).toEqual({ sees: false, fines: 1, money: money - tables.fines.redLight });
    });

    test('behind a building: not fined', () => {
      // On the parallel street, about 34 m off, with the buildings between.
      const lane = 35 + tables.osm.classes.residential.lane;
      expect(runRed([[-24, lane], [0, lane], [80, lane]])).toEqual({ sees: false, fines: 0, money });
    });
  });

  test('a signal post is solid: driving onto the pavement corner stops the truck', () => {
    const map = build(crossing(), quiet);
    // The post of the eastbound approach stands on the crossing's south-west corner.
    const post = map.lights.find((l) => Math.round(l.dx) === 1).post;
    const sim = createSim(quiet, map, seeded(1), profile);
    // Driving east along the kerb, its right side just over the post's line.
    placeAt(sim, -30, post.z - tables.vehicle.width / 2 + 0.05, EAST);

    timeUntil(sim, GAS, () => sim.state.collision, 10);

    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.x + tables.vehicle.length / 2).toBeLessThanOrEqual(post.x - 0.1 + 0.5);
  });
});
