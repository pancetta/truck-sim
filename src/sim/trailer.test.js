import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { freshProfile } from './sim.js';
import { poseAt } from './lanes.js';
import { BRAKE, DT, GAS, IDLE, acceptFrom, build, createSim, drive, lane, monti, seeded, timeUntil, way, withSpots } from './fixtures.js';

// The trailer (#96): bought, upgraded, hitched and unhitched at Home; hitched, it trails the truck kinematically, is
// solid, and brings heavier offers and no dock ones.
const OK = { ok: true, reason: null };
const tr = tables.trailer;
const top = tables.rank.tiers.at(-1).stars;
const rich = (profile = {}) => ({ ...freshProfile(), money: 100000, stars: top, ...profile });
const hitched = (level = 1, profile = {}) => rich({ trailer: { level, hitched: true }, ...profile });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const angleOf = (sim) => wrap(sim.state.truck.heading - sim.state.trailer.heading);
const REVERSE = (steer) => ({ steer, gas: 0, brake: 1 });

// Via Casa, as in home.test.js: a two-way street 200 m north–south with spots A (20 m in), home H (60 m in), the petrol
// station S (100 m in) and B (140 m in). A new game starts in H's kerb lane, facing south.
function casa(profile = freshProfile()) {
  const street = way('residential', [[0, -100], [0, 100]], { name: 'Via Casa' });
  const spot = (id, at) => ({ id, name: `Casa ${id}`, street: 'Via Casa', way: street.id, at, side: 'right' });
  const t = withSpots([spot('A', 20), spot('H', 60), spot('S', 100), spot('B', 140)], [], 'H', tables, ['S'], null, 'H');
  return createSim(t, build([street], t), seeded(1), profile);
}

describe('Sim: the trailer, bought and hitched at Home', () => {
  test('it is bought as its first level and upgraded level by level, in the truck only, with every refusal', () => {
    const [first, second] = tr.levels;
    const tier = (k) => tables.rank.tiers[k].stars;
    const sim = casa(rich({ stars: tier(first.rank), vehicles: { truck: {}, van: {} } }));
    expect(sim.buyTrailer()).toEqual(OK);
    expect(sim.state.profile).toMatchObject({ money: 100000 - first.price, trailer: { level: 1, hitched: false } });
    expect(sim.buyTrailer()).toEqual({ ok: false, reason: 'rankTooLow' }); // the second level's tier is higher

    const refusals = [
      ['rankTooLow', casa(rich({ stars: tier(first.rank) - 1 }))],
      ['noMoney', casa(rich({ money: first.price - 1 }))],
      ['maxLevel', casa(rich({ trailer: { level: tr.levels.length, hitched: false } }))],
      ['notTruck', casa(rich({ vehicle: 'van', vehicles: { truck: {}, van: {} } }))],
      ['notAtHome', casa(rich())],
      ['notIdle', casa(rich())],
    ];
    Object.assign(refusals[4][1].state.truck, { z: 40 }); // in B's zone
    acceptFrom(refusals[5][1], 'A');
    for (const [reason, s] of refusals) {
      const before = structuredClone(s.state.profile);
      expect(s.buyTrailer(), reason).toEqual({ ok: false, reason });
      expect(s.state.profile, reason).toEqual(before);
    }
    const upgraded = casa(rich({ trailer: { level: 1, hitched: false } }));
    expect(upgraded.buyTrailer()).toEqual(OK);
    expect(upgraded.state.profile).toMatchObject({ money: 100000 - second.price, trailer: { level: 2 } });
  });

  test('hitching puts it straight behind the truck, heavier and thirstier; unhitching takes it off; every refusal', () => {
    const sim = casa(rich({ trailer: { level: 1, hitched: false } }));
    expect(sim.state.trailer).toBe(null);
    expect(sim.hitchTrailer(true)).toEqual(OK);
    const { truck, trailer } = sim.state;
    expect(sim.state.profile.trailer.hitched).toBe(true);
    expect(truck.mass).toBe(tables.fleet.truck.emptyMass + tr.emptyMass);
    const back = tr.hitch + tr.drawbar + tr.length / 2; // m from the truck's middle to the trailer's
    expect(trailer.heading).toBeCloseTo(truck.heading);
    expect(trailer.x).toBeCloseTo(truck.x - Math.sin(truck.heading) * back);
    expect(trailer.z).toBeCloseTo(truck.z - Math.cos(truck.heading) * back);
    expect(sim.hitchTrailer(false)).toEqual(OK);
    expect(sim.state.trailer).toBe(null);
    expect(sim.state.truck.mass).toBe(tables.fleet.truck.emptyMass);

    const refusals = [
      ['notOwned', casa(rich())],
      ['notTruck', casa(rich({ vehicle: 'van', vehicles: { truck: {}, van: {} }, trailer: { level: 1, hitched: false } }))],
      ['notAtHome', casa(rich({ trailer: { level: 1, hitched: false } }))],
      ['notIdle', casa(rich({ trailer: { level: 1, hitched: false } }))],
    ];
    Object.assign(refusals[2][1].state.truck, { z: 40 });
    acceptFrom(refusals[3][1], 'A');
    for (const [reason, s] of refusals) {
      const before = structuredClone(s.state.profile);
      expect(s.hitchTrailer(true), reason).toEqual({ ok: false, reason });
      expect(s.state.profile, reason).toEqual(before);
      expect(s.state.trailer, reason).toBe(null);
    }
    // Unhitching refuses the same way away from Home.
    const away = casa(hitched());
    Object.assign(away.state.truck, { z: 40 });
    expect(away.hitchTrailer(false)).toEqual({ ok: false, reason: 'notAtHome' });
    expect(away.state.trailer).not.toBe(null);
  });

  test('hitching, and Reset to road, need the room straight behind, the gap before the trailer included', () => {
    // A post in the gap between the truck's rear and the trailer's front, where neither's own box reaches (#96 QA).
    const street = way('residential', [[0, -100], [0, 100]], { name: 'Via Casa' });
    const spot = (id, at) => ({ id, name: `Casa ${id}`, street: 'Via Casa', way: street.id, at, side: 'right' });
    const t = withSpots([spot('A', 20), spot('H', 60), spot('B', 140)], [], 'H', tables, [], null, 'H');
    const map = build([street], t);
    const probe = createSim(t, map, seeded(1));
    const { x, z, heading } = probe.state.truck;
    const gap = tables.fleet.truck.length / 2 + (tr.hitch + tr.drawbar - tables.fleet.truck.length / 2) / 2; // m behind its middle
    const [px, pz] = [x - Math.sin(heading) * gap, z - Math.cos(heading) * gap];
    const post = { kind: 'bollard', minX: px - 0.1, maxX: px + 0.1, minZ: pz - 0.1, maxZ: pz + 0.1 };
    post.points = [{ x: post.minX, z: post.minZ }, { x: post.maxX, z: post.minZ }, { x: post.maxX, z: post.maxZ }, { x: post.minX, z: post.maxZ }];
    map.colliders.push(post);
    const sim = createSim(t, map, seeded(1), rich({ trailer: { level: 1, hitched: false } }));
    expect(sim.state.truck).toMatchObject({ x, z });
    expect(sim.hitchTrailer(true)).toEqual({ ok: false, reason: 'noRoom' });
    expect(sim.state.trailer).toBe(null);
    // Hitched, a reset finds a pose with the gap clear, so the combination can drive both ways.
    const hitchedSim = createSim(t, map, seeded(1), hitched());
    Object.assign(hitchedSim.state.truck, { x, z, heading });
    hitchedSim.resetToRoad();
    expect(Math.hypot(hitchedSim.state.truck.x - x, hitchedSim.state.truck.z - z)).toBeGreaterThan(0.5);
  });

  test('a hitched truck switched for another Vehicle leaves the trailer at Home', () => {
    const sim = casa(hitched(1, { vehicles: { truck: {}, van: {} } }));
    expect(sim.state.trailer).not.toBe(null);
    expect(sim.chooseVehicle('van')).toEqual(OK);
    expect(sim.state.trailer).toBe(null);
    expect(sim.state.profile.trailer).toEqual({ level: 1, hitched: false });
  });

  test('hitched, it uses `thirst` times the fuel per m', () => {
    const perMetre = (profile) => {
      const sim = createSim(tables, null, seeded(1), profile);
      drive(sim, 10, GAS);
      return (tables.fleet.truck.tank - sim.state.fuel) / sim.state.profile.distance;
    };
    expect(perMetre(hitched()) / perMetre(rich())).toBeCloseTo(tr.thirst, 3);
  });
});

describe('Sim: the trailer trails the hitch', () => {
  // On the open plane, so nothing is in the way.
  const plane = () => createSim(tables, null, seeded(1), hitched());
  // The trailer's axles' middle, the point that trails the hitch.
  const axle = ({ x, z, heading }) => {
    const ahead = tr.drawbar + tr.length / 2 - tr.axle; // m from the body's middle forwards to the axles
    return { x: x + Math.sin(heading) * ahead, z: z + Math.cos(heading) * ahead };
  };

  test('in a turn it cuts the corner: its axles run inside the circle the truck drives', () => {
    const sim = plane();
    // At full lock and about 2 m/s, settled on its circle.
    const circle = (seconds) => {
      for (let t = 0; t < seconds; t += DT) sim.step(DT, { steer: 1, gas: sim.state.truck.speed < 2 ? 0.5 : 0, brake: 0 });
    };
    circle(60);
    const points = [];
    for (let i = 0; i < 3; i++) {
      circle(1);
      points.push({ ...sim.state.truck });
    }
    // The circle through three of the truck's places.
    const [a, b, c] = points;
    const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
    const sq = (p) => p.x ** 2 + p.z ** 2;
    const centre = { x: (sq(a) * (b.z - c.z) + sq(b) * (c.z - a.z) + sq(c) * (a.z - b.z)) / d, z: (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d };
    const radius = Math.hypot(c.x - centre.x, c.z - centre.z);
    const inner = axle(sim.state.trailer);
    expect(Math.hypot(inner.x - centre.x, inner.z - centre.z)).toBeLessThan(radius - 0.3);
    // Forwards it settles, well short of the jackknife.
    expect(Math.abs(angleOf(sim))).toBeLessThan(tr.jackknife - 0.1);
  });

  // Forwards the truck's rear first swings it out the other way (the hitch is 4.3 m behind the truck's pivot, its middle).
  test('forwards it comes round the way the truck turns; reversing, it goes the opposite way', () => {
    for (const [input, same, seconds] of [[{ steer: 1, gas: 0.3, brake: 0 }, true, 10], [REVERSE(1), false, 1.5]]) {
      const sim = plane();
      if (!same) drive(sim, tables.fleet.truck.reverseDelay + DT, BRAKE); // reverse engages
      const [truck, trailer] = [sim.state.truck.heading, sim.state.trailer.heading];
      drive(sim, seconds, input);
      const turned = [wrap(sim.state.truck.heading - truck), wrap(sim.state.trailer.heading - trailer)];
      expect(Math.abs(turned[0]), String(same)).toBeGreaterThan(0.01);
      expect(Math.abs(turned[1]), String(same)).toBeGreaterThan(0.001);
      expect(Math.sign(turned[0]) === Math.sign(turned[1]), String(same)).toBe(same);
    }
  });

  test('reversing, it folds until the jackknife limit, where the combination stops until driven straight', () => {
    const sim = plane();
    drive(sim, tables.fleet.truck.reverseDelay + DT, BRAKE);
    timeUntil(sim, REVERSE(0.4), () => sim.state.jackknifed, 30);
    expect(sim.state.jackknifed).toBe(true);
    expect(Math.abs(angleOf(sim))).toBeLessThanOrEqual(tr.jackknife);
    expect(Math.abs(angleOf(sim))).toBeGreaterThan(tr.jackknife - 0.05);
    expect(sim.state.truck.speed).toBe(0);
    // It may creep on by what each try's step still allows below the limit, but no further.
    const stuck = { ...sim.state.truck };
    drive(sim, 2, REVERSE(0));
    expect(Math.hypot(sim.state.truck.x - stuck.x, sim.state.truck.z - stuck.z)).toBeLessThan(0.05);
    expect(sim.state.truck.speed).toBe(0);
    // Forwards it straightens.
    const folded = Math.abs(angleOf(sim));
    drive(sim, 6, { steer: 0, gas: 0.3, brake: 0 });
    expect(sim.state.jackknifed).toBe(false);
    expect(Math.abs(angleOf(sim))).toBeLessThan(folded - 0.3);
  });

  test('Reset to road straightens it behind the truck', () => {
    const sim = createSim(tables, monti(), seeded(1), hitched());
    drive(sim, tables.fleet.truck.reverseDelay + DT, BRAKE);
    drive(sim, 2, REVERSE(1));
    expect(Math.abs(angleOf(sim))).toBeGreaterThan(0.05);
    sim.resetToRoad();
    expect(angleOf(sim)).toBeCloseTo(0);
  });
});

describe('Sim: the trailer is solid', () => {
  test('a wall behind stops the combination at the trailer, far from the truck', () => {
    const { t, map, wall } = lane();
    const sim = createSim(t, map, seeded(1), hitched());
    drive(sim, tables.fleet.truck.reverseDelay + DT, BRAKE);
    timeUntil(sim, REVERSE(0), () => sim.state.collision, 30);
    expect(sim.state.collision).toBe(true);
    const { trailer, truck } = sim.state;
    // Heading south (+z), backing north to the wall at z = -wall: the trailer's rear reaches it.
    expect(trailer.z - tr.length / 2 + wall).toBeLessThan(0.2);
    expect(truck.z - tables.fleet.truck.length / 2 + wall).toBeGreaterThan(tr.length);
  });

  test("an AI car the trailer backs into is the truck's Contact, with its fine", () => {
    const noCars = { ...tables, rank: { ...tables.rank, tiers: tables.rank.tiers.map((x) => ({ ...x, traffic: 0 })) } };
    const { t, map } = lane(noCars);
    const sim = createSim(t, map, seeded(1), hitched(1, { money: 1000 }));
    // A car standing in the truck's lane 6 m behind the combination, which faces south (+z).
    const run = map.graph.paths.find((p) => p.kind === 'run' && p.startDir.z > 0);
    const behind = sim.state.trailer.z - tr.length / 2 - 6 - tables.city.obstacles.car.length / 2;
    const pose = { x: 0, z: 0, heading: 0 };
    let s = 0;
    while (s < run.length && (poseAt(run, s, pose), pose.z < behind)) s += 0.1;
    sim.state.traffic.push({ id: 99, x: 0, z: 0, heading: 0, speed: 0, lane: run, route: [run], s, police: false, halt: 1e9 });
    sim.step(DT, IDLE);
    expect(Math.abs(sim.state.traffic[0].x - sim.state.trailer.x)).toBeLessThan(0.5);
    drive(sim, tables.fleet.truck.reverseDelay + DT, BRAKE);
    timeUntil(sim, REVERSE(0), () => sim.state.lastFine, 10);
    expect(sim.state.lastFine).toEqual({ reason: 'collision', amount: tables.fines.collision });
  });
});

describe('Sim: offers with the trailer', () => {
  const map = monti();
  const spot = (id) => map.spots.find((s) => s.id === id);
  const docks = (o) => spot(o.pickup).dock || o.drops.some((d) => spot(d.spot).dock);
  // 100 rounds of offers at home with `profile`.
  const offers = (profile) => {
    const sim = createSim(tables, map, seeded(1), profile);
    return Array.from({ length: 100 }, () => sim.requestOffers()).flat();
  };

  test('hitched, heavier cargo up to the trailer level comes, paying more, with no dock or Schwertransport offers', () => {
    const own = tables.fleet.truck.maxCargo;
    const alone = offers(rich());
    expect(Math.max(...alone.map((o) => o.cargo.weight))).toBeLessThanOrEqual(own);
    expect(alone.some(docks)).toBe(true);
    for (let level = 1; level <= tr.levels.length; level++) {
      const most = Math.min(own + tr.levels[level - 1].capacity, tables.orders.schwertransport);
      const theirs = offers(hitched(level));
      expect(theirs.some((o) => o.cargo.weight > own), level).toBe(true);
      expect(Math.max(...theirs.map((o) => o.cargo.weight)), level).toBeLessThanOrEqual(most);
      expect(theirs.filter(docks), level).toEqual([]);
      expect(theirs.filter((o) => o.type === 'schwertransport'), level).toEqual([]);
    }
    // An offer only the trailer makes possible pays `pay` times what it would without: its base and distance pay.
    const heavy = offers(hitched(1)).find((o) => o.cargo.weight > own && o.type === 'heavy' && !o.reputation);
    const { basePay, payPerKm } = tables.orders;
    expect(heavy.pay).toBe(Math.round(tr.pay * (basePay + (payPerKm * heavy.distance) / 1000)));
  });

  test('unhitched, the offers are as without a trailer', () => {
    expect(offers(rich({ trailer: { level: 3, hitched: false } }))).toEqual(offers(rich()));
  });
});
