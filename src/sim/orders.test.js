import { describe, expect, test } from 'vitest';
import { freshProfile } from './sim.js';
import * as tables from '../tables.js';
import { BRAKE, DT, GAS, IDLE, acceptFrom, box, build, createSim, deliver, drive, lane, mapOf, monti, parkAt, seeded, timeUntil, way, withSpots } from './fixtures.js';

const { classes } = tables.osm;
const { lane: laneOffset, width } = classes.residential;

// The nook: a 12 m dead end in a map 14 m deep, A and B both in its middle, where the truck starts facing south: the order
// loads and unloads where the truck stands, with no route. The map's south edge is 3 m ahead of the front bumper.
function nook(base) {
  const vicolo = way('residential', [[0, -6], [0, 6]], { name: 'Vicolo' });
  const spot = (id) => ({ id, name: `Bottega ${id}`, street: 'Vicolo', way: vicolo.id, at: 6, side: 'right' });
  const t = withSpots([spot('A'), spot('B')], [], 'A', base);
  return { t, map: build([vicolo], t, undefined, { minX: -20, minZ: -7, maxX: 20, maxZ: 7 }) };
}

const simOn = ({ t, map }, seed = 1, profile) => createSim(t, map, seeded(seed), profile);
const laneSim = (seed, profile) => simOn(lane(), seed, profile);

// A delivery's Stars as state.lastPayment reports them: each name with its missed reasons (none when earned).
const starsOf = (sim) => Object.fromEntries(sim.state.lastPayment.stars.map(({ star, reasons }) => [star, reasons]));

function typesOffered(sim) {
  const seen = new Set();
  for (let i = 0; i < 100; i++) for (const o of sim.requestOffers()) seen.add(o.type);
  return seen;
}

// A ring of four streets round a block 80 m east–west by 40 m north–south. A's zone is on the south street 10 m from
// its west end, B's on the east street 10 m from its south end: from A to B is 80 m by the south and east streets,
// 160 m the other way round.
function ring() {
  const corners = [[-40, -20], [40, -20], [40, 20], [-40, 20], [-40, -20]]; // north-west, north-east, south-east, south-west
  const ways = ['Via Nord', 'Via Est', 'Via Sud', 'Via Ovest'].map((name, i) => way('residential', [corners[i], corners[i + 1]], { name }));
  const [, east, south] = ways;
  const t = withSpots([
    { id: 'A', name: 'Magazzino Sud', street: 'Via Sud', way: south.id, at: 70, side: 'right' },
    { id: 'B', name: 'Bottega Est', street: 'Via Est', way: east.id, at: 30, side: 'right' },
  ]);
  return { t, map: build(ways, t) };
}

describe('Sim: orders', () => {
  const { loadTime, basePay, payPerKm } = tables.orders;
  const { emptyMass } = tables.fleet.truck;

  test('requestOffers() gives about three offers between distinct spots, the same for the same seed', () => {
    const map = monti();
    const offers = createSim(tables, map, seeded(7)).requestOffers();

    expect(offers.length).toBeGreaterThanOrEqual(2);
    expect(offers.length).toBeLessThanOrEqual(4);
    expect(createSim(tables, map, seeded(7)).requestOffers()).toEqual(offers);
    const sim = createSim(tables, map, seeded(1));
    for (let i = 0; i < 50; i++) {
      for (const o of sim.requestOffers()) {
        expect(o.pickup).not.toBe(o.dropoff);
        expect(o.distance).toBeGreaterThan(0);
      }
    }
  });

  test('an offer pays base + per-km × the shortest road route between the zones', () => {
    const sim = simOn(ring());

    const offers = sim.requestOffers();

    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      expect(o.distance).toBeCloseTo(80);
      expect(o.pay).toBe(Math.round(basePay + (payPerKm * 80) / 1000));
    }
  });

  test('accepting an offer makes it the active order; no new offers while it runs', () => {
    const sim = laneSim();
    const [first, second] = sim.requestOffers();

    sim.acceptOrder(first.id);

    expect(sim.state.order).toMatchObject({ ...first, phase: 'pickup' });
    expect(sim.requestOffers()).toEqual([]);
    sim.acceptOrder(second.id);
    expect(sim.state.order.id).toBe(first.id);
  });

  test('standing in the pickup zone for the load time loads the cargo and heads for the drop-off', () => {
    const sim = laneSim();
    const offer = acceptFrom(sim, 'B');
    parkAt(sim, 'B');

    drive(sim, loadTime - 0.1, IDLE);
    expect(sim.state.order.phase).toBe('pickup');
    expect(sim.state.progress).toBeGreaterThan(0.9);
    expect(sim.state.truck.mass).toBe(emptyMass);

    drive(sim, 0.2, IDLE);
    expect(sim.state.order.phase).toBe('dropoff');
    expect(sim.state.progress).toBe(0);
    expect(sim.state.truck.mass).toBe(emptyMass + offer.cargo.weight * 1000);
  });

  test('moving before loading is done resets the progress', () => {
    const sim = laneSim();
    acceptFrom(sim, 'B');
    parkAt(sim, 'B');
    drive(sim, loadTime / 2, IDLE);
    expect(sim.state.progress).toBeGreaterThan(0.4);

    // Held past the reverse delay, the brake rolls the truck back.
    drive(sim, tables.fleet.truck.reverseDelay + 0.5, BRAKE);

    expect(sim.state.truck.speed).toBeLessThan(0);
    expect(sim.state.progress).toBe(0);
    expect(sim.state.order.phase).toBe('pickup');
  });

  test('short brake taps (under the reverse delay) in the zone still complete loading', () => {
    const sim = laneSim();
    acceptFrom(sim, 'B');
    parkAt(sim, 'B');

    for (let t = 0; t < loadTime + 0.5; t += 0.5) {
      drive(sim, tables.fleet.truck.reverseDelay * 0.8, BRAKE);
      drive(sim, 0.1, IDLE);
    }

    expect(sim.state.order.phase).toBe('dropoff');
  });

  test('a late unloading pays exactly the offer (base + distance), restores empty mass and clears the order', () => {
    const sim = laneSim();
    const offer = acceptFrom(sim, 'A');
    drive(sim, offer.expectedTime, IDLE);
    parkAt(sim, 'A');
    drive(sim, loadTime + 0.1, IDLE);
    expect(sim.state.order.phase).toBe('dropoff');

    parkAt(sim, 'B');
    drive(sim, loadTime + 0.1, IDLE);

    expect(sim.state.profile.money).toBe(offer.pay);
    expect(sim.state.lastPayment).toEqual({
      amount: offer.pay,
      lines: [
        { label: 'base', amount: offer.pay },
        { label: 'time', amount: 0 },
      ],
      stars: [
        { star: 'delivered', reasons: [] },
        { star: 'onTime', reasons: ['late'] },
        { star: 'clean', reasons: [] },
      ],
    });
    expect(sim.state.profile.stars).toBe(2);
    expect(sim.state.truck.mass).toBe(emptyMass);
    expect(sim.state.order).toBe(null);
    expect(sim.state.progress).toBe(0);
    expect(sim.requestOffers().length).toBeGreaterThan(0);
  });

  test('a loaded truck accelerates more slowly than the same truck empty', () => {
    function speedAfterLoadStop(order) {
      const sim = laneSim();
      if (order) acceptFrom(sim, 'A');
      parkAt(sim, 'A');
      drive(sim, loadTime + 0.1, IDLE);
      drive(sim, 1.5, GAS);
      return sim.state.truck.speed;
    }

    expect(speedAfterLoadStop(true)).toBeLessThan(speedAfterLoadStop(false) * 0.8);
  });
});

describe('Sim: time bonus', () => {
  const { loadTime, referenceSpeed, slack } = tables.orders;
  // Spec #12's worked example: base + distance 100 and an expected time of 120 s. On the nook the order has no route;
  // loading and unloading take 30 s each, and the slack makes up the other 60 s.
  const example = { ...tables, orders: { ...tables.orders, basePay: 100, loadTime: 30, slack: 60 } };
  const nookSim = (t = example) => simOn(nook(t));

  test("an offer expects the routes to the pickup and on to the drop-off at reference speed, plus load, unload and slack", () => {
    // On the lane the truck starts 28 m from A's zone, which is 56 m from B's.
    const offer = laneSim().requestOffers().find((o) => o.pickup === 'A');

    expect(offer.expectedTime).toBeCloseTo((28 + 56) / referenceSpeed + 2 * loadTime + slack);
  });

  test('offers are dropped once the truck moves onto another edge, so their times stay true', () => {
    // The lane with a street crossing it 14 m south of where the truck starts, facing south.
    const vicolo = way('residential', [[0, -28], [0, 14], [0, 28]], { name: 'Vicolo' });
    const t = withSpots([
      { id: 'A', name: 'Magazzino Nord', street: 'Vicolo', way: vicolo.id, at: 0, side: 'right' },
      { id: 'B', name: 'Bottega Sud', street: 'Vicolo', way: vicolo.id, at: 56, side: 'right' },
    ]);
    const map = build([vicolo, way('residential', [[-40, 14], [0, 14], [40, 14]])], t);
    const sim = createSim(t, map, seeded(1));
    const edgeOf = () => map.graph.nearest(sim.state.truck.x, sim.state.truck.z).edge;
    const start = edgeOf();
    sim.requestOffers();
    drive(sim, 1, GAS);
    expect(sim.state.offers.length).toBeGreaterThan(0);
    expect(edgeOf()).toBe(start);

    timeUntil(sim, GAS, () => sim.state.offers.length === 0, 10);

    expect(edgeOf()).not.toBe(start);
    expect(sim.state.truck.z).toBeGreaterThan(14 - width / 2); // it got into the crossing
  });

  test('the active order counts the time since it was accepted', () => {
    const sim = nookSim();
    const offer = sim.requestOffers()[0];
    expect(offer).toMatchObject({ pay: 100, expectedTime: 120 });
    drive(sim, 5, IDLE); // not counted before accepting

    sim.acceptOrder(offer.id);
    drive(sim, 10, IDLE);

    expect(sim.state.order).toMatchObject({ expectedTime: 120 });
    expect(sim.state.order.elapsed).toBeCloseTo(10, 1);
  });

  test('worked example: delivered after 60 of 120 s, the time line is 25 on top of the 100', () => {
    const sim = nookSim();
    sim.acceptOrder(sim.requestOffers()[0].id);

    drive(sim, 61, IDLE); // loaded at 30 s, unloaded at 60 s

    expect(sim.state.order).toBe(null);
    expect(sim.state.lastPayment).toEqual({
      amount: 125,
      lines: [
        { label: 'base', amount: 100 },
        { label: 'time', amount: 25 },
      ],
      stars: [
        { star: 'delivered', reasons: [] },
        { star: 'onTime', reasons: [] },
        { star: 'clean', reasons: [] },
      ],
    });
    expect(sim.state.profile.money).toBe(125);
    expect(sim.state.profile.stars).toBe(3);
  });

  test('the on-time Star needs the delivery within the expected time: one second over misses it', () => {
    const deliveredAt = (seconds) => {
      const sim = nookSim({ ...example, orders: { ...example.orders, slack: seconds - 60 } }); // expected 120 s at slack 60
      sim.acceptOrder(sim.requestOffers()[0].id);
      drive(sim, 61, IDLE); // unloaded at 60 s
      expect(sim.state.order).toBe(null);
      return starsOf(sim).onTime;
    };
    expect(deliveredAt(61)).toEqual([]);
    expect(deliveredAt(59)).toEqual(['late']);
  });
});

describe('Sim: fragile cargo', () => {
  const { loadTime, fragilePremium, types } = tables.orders;
  const { maxCargo } = tables.fleet.truck;
  const fragileTier = { ...freshProfile(), stars: tables.rank.tiers[types.fragile].stars };
  const glass = { name: 'Glas', weight: 4, fragile: true };
  // Every offer is fragile, so runs with the same driving carry the same mass.
  const onlyGlass = { ...tables, orders: { ...tables.orders, cargo: [glass] } };
  // A lane twice as long: room to speed up from A's zone and brake towards B.
  const longSim = (profile = fragileTier) => simOn(lane(onlyGlass, [], 56), 1, profile);
  // Spec #12's worked example on the nook (see 'Sim: time bonus'): base + distance 100, 120 s expected.
  const example = { ...onlyGlass, orders: { ...onlyGlass.orders, basePay: 100, loadTime: 30, slack: 60, hitDamage: 0.25 } };
  const nookSim = (t = example) => simOn(nook(t), 1, fragileTier);

  // Loads a fragile order at A on the long lane; the truck then stands in A's zone facing B.
  function loadAtA(sim) {
    acceptFrom(sim, 'A');
    parkAt(sim, 'A');
    drive(sim, loadTime + 0.1, IDLE);
    expect(sim.state.order).toMatchObject({ type: 'fragile', phase: 'dropoff', damage: 0 });
  }

  test('fragile offers come only from their rank tier, and offers are the same for the same seed', () => {
    const below = { ...freshProfile(), stars: tables.rank.tiers[types.fragile - 1].stars };
    expect(typesOffered(laneSim(1, below))).toEqual(new Set(['normal']));
    expect(typesOffered(laneSim(1, fragileTier))).toEqual(new Set(['normal', 'fragile', 'express'])); // express's tier too

    const offers = laneSim(3, fragileTier).requestOffers();
    expect(laneSim(3, fragileTier).requestOffers()).toEqual(offers);
    for (const o of offers) if (o.type !== 'express') expect(o.type).toBe(o.cargo.fragile ? 'fragile' : 'normal');
  });

  test('cargo heavier than the base Ladefläche carries is a heavy offer', () => {
    const sim = laneSim(1, { ...fragileTier, vehicles: { truck: { cargoBed: 1 } } });
    for (let i = 0; i < 50; i++) {
      for (const o of sim.requestOffers()) if (!o.cargo.fragile && o.type !== 'express') expect(o.type).toBe(o.cargo.weight > maxCargo ? 'heavy' : 'normal');
    }
    expect(typesOffered(sim)).toEqual(new Set(['normal', 'heavy', 'fragile', 'express']));
  });

  test('hard braking with fragile cargo loaded raises the damage; speeding up and coasting do not', () => {
    const sim = longSim();
    loadAtA(sim);

    drive(sim, 4, GAS);
    drive(sim, 2, IDLE);
    expect(sim.state.truck.speed).toBeGreaterThan(5);
    expect(sim.state.order.damage).toBe(0);

    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
    expect(sim.state.collision).toBe(false);
    expect(sim.state.order.damage).toBeGreaterThan(0);
  });

  test('braking before the cargo is loaded does no damage', () => {
    const sim = longSim();
    acceptFrom(sim, 'A');

    drive(sim, 3, GAS);
    timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);

    expect(sim.state.order.damage).toBe(0);
  });

  test('touching a wall at a crawl does no damage', () => {
    const sim = longSim();
    loadAtA(sim); // up against A's end wall

    let touched = false;
    for (let t = 0; t < 2; t += DT) {
      sim.step(DT, BRAKE); // reverse engages and backs into the wall
      touched ||= sim.state.collision;
    }

    expect(touched).toBe(true);
    expect(sim.state.order.damage).toBe(0);
  });

  test('a higher Fahrwerk level means less damage for the same braking', () => {
    function brakingDamage(suspension) {
      const sim = longSim({ ...fragileTier, vehicles: { truck: suspension ? { suspension } : {} } });
      loadAtA(sim);
      drive(sim, 4, GAS);
      timeUntil(sim, BRAKE, () => sim.state.truck.speed === 0);
      return sim.state.order.damage;
    }
    const [none, one, three] = [brakingDamage(0), brakingDamage(1), brakingDamage(3)];

    expect(one).toBeLessThan(none);
    expect(three).toBeLessThan(one);
    expect(three).toBeGreaterThan(0);
  });

  test('worked example: one hit with fragile cargo loaded is damage 0.25, and the fragile line is 30 on the 100', () => {
    const sim = nookSim();
    sim.acceptOrder(sim.requestOffers()[0].id);
    drive(sim, 30.1, IDLE); // loaded at 30 s

    timeUntil(sim, GAS, () => sim.state.collision, 10); // into the map edge, still in the zone
    drive(sim, 1, GAS); // pushing on against it is the same hit
    expect(sim.state.collision).toBe(true);
    drive(sim, 0.1, IDLE);
    expect(sim.state.order.damage).toBe(0.25);
    drive(sim, 31, IDLE);

    expect(sim.state.order).toBe(null);
    expect(sim.state.lastPayment.lines).toContainEqual({ label: 'base', amount: 100 });
    expect(sim.state.lastPayment.lines).toContainEqual({ label: 'fragile', amount: 30 });
    expect(starsOf(sim).clean).toEqual(['damage']);
    expect(sim.state.profile.stars).toBe(fragileTier.stars + 2);
  });

  test('damage within tables.rank.cleanDamage keeps the clean Star', () => {
    const sim = nookSim({ ...example, orders: { ...example.orders, hitDamage: tables.rank.cleanDamage } });
    sim.acceptOrder(sim.requestOffers()[0].id);
    drive(sim, 30.1, IDLE); // loaded at 30 s
    timeUntil(sim, GAS, () => sim.state.collision, 10); // one hit, into the map edge, still in the zone
    drive(sim, 0.1, IDLE);
    expect(sim.state.order.damage).toBe(tables.rank.cleanDamage);
    drive(sim, 31, IDLE);

    expect(sim.state.order).toBe(null);
    expect(starsOf(sim).clean).toEqual([]);
  });

  test('an undamaged fragile delivery gets the full premium and the clean Star', () => {
    const sim = nookSim();
    sim.acceptOrder(sim.requestOffers()[0].id);

    drive(sim, 61, IDLE); // loaded at 30 s, unloaded at 60 s

    expect(sim.state.lastPayment).toEqual({
      amount: 165,
      lines: [
        { label: 'base', amount: 100 },
        { label: 'time', amount: 25 },
        { label: 'fragile', amount: fragilePremium * 100 },
      ],
      stars: [
        { star: 'delivered', reasons: [] },
        { star: 'onTime', reasons: [] },
        { star: 'clean', reasons: [] },
      ],
    });
    expect(sim.state.profile.stars).toBe(fragileTier.stars + 3);
  });
});

describe('Sim: docking', () => {
  const { loadTime, types, dockHeading } = tables.orders;
  const tierOf = (type) => ({ ...freshProfile(), stars: tables.rank.tiers[types[type]].stars });
  // Spec #12's worked example: base + distance 100 (no pay per km), so the dock line is 25.
  const example = (cargo = tables.orders.cargo) => ({ ...tables, orders: { ...tables.orders, basePay: 100, payPerKm: 0, cargo } });
  // The lane with `docks` as loading docks; A's bay faces south, out of its end wall into the lane.
  const dockSim = (docks = ['A'], profile = tierOf('dock'), cargo) => simOn(lane(example(cargo), docks), 1, profile);
  const lineOf = (sim, label) => sim.state.lastPayment.lines.find((l) => l.label === label);

  // How far the middle of the truck's rear is from A's dock edge, the north wall's face, facing south.
  const { wall } = lane();
  const rearGap = (sim) => sim.state.truck.z - tables.fleet.truck.length / 2 + wall;

  // Reverses north until rearGap() is at most `gap`: at full speed while far, then in short bursts at a crawl,
  // braked out of at once (each waits out the reverse delay again), so it never hits the wall, which would harm
  // fragile cargo.
  function backUpToA(sim, gap) {
    timeUntil(sim, BRAKE, () => rearGap(sim) < gap + 4, 30);
    while (rearGap(sim) > gap && !sim.state.collision) {
      timeUntil(sim, IDLE, () => sim.state.truck.speed === 0, 10); // releasing the pedal in reverse brakes
      timeUntil(sim, BRAKE, () => sim.state.truck.speed < -0.5 || rearGap(sim) <= gap, 10);
    }
    timeUntil(sim, IDLE, () => sim.state.truck.speed === 0, 10);
  }

  // Picks up at B, driving into its dead end, then reverses north along the bay's centre line into A's zone to within
  // `gap` of the dock edge and unloads. With `steer`, it swings the rear round on the way, so the truck ends up crooked.
  // Returns the offer.
  function reverseIntoA(sim, steer = 0, gap = 0.5) {
    const offer = acceptFrom(sim, 'B');
    parkAt(sim, 'B');
    drive(sim, loadTime + 0.1, IDLE);
    if (steer) {
      timeUntil(sim, BRAKE, () => rearGap(sim) < 14, 30);
      timeUntil(sim, { ...BRAKE, steer }, () => Math.abs(sim.state.truck.heading) > 1.5 * dockHeading, 10);
    }
    backUpToA(sim, gap);
    expect(sim.state.collision).toBe(false);
    expect(sim.state.order).toMatchObject({ phase: 'dropoff' });
    drive(sim, loadTime + 0.1, IDLE);
    expect(sim.state.order, 'delivered').toBe(null);
    return offer;
  }

  test('dock offers go to dock spots, from their rank tier on; fragile + dock from its own', () => {
    const below = { ...freshProfile(), stars: tables.rank.tiers[types.dock - 1].stars };
    expect(typesOffered(dockSim(['A'], below))).not.toContain('dock');
    expect(typesOffered(dockSim(['A'], tierOf('dock')))).toContain('dock');
    expect(typesOffered(dockSim(['A'], tierOf('fragileDock')))).toContain('fragileDock');
    expect(types.fragileDock).toBeGreaterThan(types.dock);
    expect(typesOffered(dockSim(['A'], { ...freshProfile(), stars: tables.rank.tiers[types.fragileDock - 1].stars }))).not.toContain(
      'fragileDock',
    );

    const sim = dockSim(['A'], tierOf('fragileDock'));
    for (let i = 0; i < 20; i++) {
      for (const o of sim.requestOffers()) expect(['dock', 'fragileDock'].includes(o.type)).toBe(o.dropoff === 'A');
    }
  });

  test('reversing straight into the bay pays the dock line: +25% of base + distance', () => {
    const sim = dockSim();

    const offer = reverseIntoA(sim);

    expect(offer.type).toBe('dock');
    expect(rearGap(sim)).toBeLessThanOrEqual(tables.orders.dockDepth);
    expect(lineOf(sim, 'base').amount).toBe(100);
    expect(lineOf(sim, 'dock').amount).toBe(25);
    expect(sim.state.lastPayment.amount).toBe(125 + lineOf(sim, 'time').amount);
  });

  test('stopping 2–3 m short of the dock edge delivers at normal pay, with no dock line', () => {
    const sim = dockSim();

    reverseIntoA(sim, 0, 3);

    expect(rearGap(sim)).toBeGreaterThan(tables.orders.dockDepth + 1);
    expect(rearGap(sim)).toBeLessThanOrEqual(3);
    expect(lineOf(sim, 'base').amount).toBe(100);
    expect(lineOf(sim, 'dock')).toBeUndefined();
  });

  test('driving into the bay forwards delivers at normal pay, with no dock line', () => {
    const sim = dockSim(['B']);

    const offer = deliver(sim); // A to B, driving into B's dead end

    expect(offer.type).toBe('dock');
    expect(sim.state.order).toBe(null);
    expect(lineOf(sim, 'base').amount).toBe(100);
    expect(lineOf(sim, 'dock')).toBeUndefined();
  });

  test('reversing in crooked delivers at normal pay, with no dock line', () => {
    const sim = dockSim();

    reverseIntoA(sim, -1); // the rear swings towards the lane's middle, clear of its edge wall

    expect(Math.abs(sim.state.truck.heading)).toBeGreaterThan(dockHeading);
    expect(lineOf(sim, 'base').amount).toBe(100);
    expect(lineOf(sim, 'dock')).toBeUndefined();
  });

  test('reversing in straight but off the centre line delivers at normal pay, with no dock line', () => {
    const sim = dockSim();
    acceptFrom(sim, 'B');
    parkAt(sim, 'B');
    drive(sim, loadTime + 0.1, IDLE);
    // An S-bend in reverse shifts the truck sideways, towards the lane's middle, and leaves it straight again.
    timeUntil(sim, { ...BRAKE, steer: -1 }, () => sim.state.truck.heading < -0.6, 10);
    timeUntil(sim, { ...BRAKE, steer: 1 }, () => sim.state.truck.heading >= 0, 10);
    backUpToA(sim, 0.5);
    expect(Math.abs(sim.state.truck.heading)).toBeLessThan(dockHeading);
    expect(Math.abs(sim.state.truck.x + laneOffset)).toBeGreaterThan(tables.orders.dockCentre); // the bay's centre line

    drive(sim, loadTime + 0.1, IDLE);

    expect(sim.state.order).toBe(null);
    expect(lineOf(sim, 'dock')).toBeUndefined();
  });

  test('a fragile + dock order pays both bonus lines', () => {
    const glass = { name: 'Glas', weight: 4, fragile: true };
    const sim = dockSim(['A'], tierOf('fragileDock'), [glass]);

    const offer = reverseIntoA(sim);

    expect(offer.type).toBe('fragileDock');
    expect(lineOf(sim, 'fragile').amount).toBeGreaterThan(30); // a little damage from braking out of reverse
    expect(lineOf(sim, 'dock').amount).toBe(25);
  });

  test('a dock drop-off has the bonus Star: earned reversed into the bay, missed short of it; a plain spot has none', () => {
    // The same drive with A as a plain spot gives the Stars without the dock one.
    const pallets = [{ name: 'Paletten', weight: 6 }];
    const plain = dockSim([], tierOf('dock'), pallets);
    reverseIntoA(plain);
    const docked = dockSim(['A'], tierOf('dock'), pallets);
    reverseIntoA(docked);
    const short = dockSim(['A'], tierOf('dock'), pallets);
    reverseIntoA(short, 0, 3);

    expect(Object.keys(starsOf(plain))).toEqual(['delivered', 'onTime', 'clean']);
    expect(starsOf(docked)).toEqual({ ...starsOf(plain), dock: [] });
    expect(docked.state.profile.stars).toBe(plain.state.profile.stars + 1);
    expect(starsOf(short).dock).toEqual(['notDocked']);
    expect(short.state.profile.stars).toBe(plain.state.profile.stars);
  });
});

describe('Sim: route', () => {
  const zoneOf = (map, id) => map.spots.find((s) => s.id === id).pose;
  const expectAt = (p, q) => {
    expect(p.x).toBeCloseTo(q.x);
    expect(p.z).toBeCloseTo(q.z);
  };
  // The route's length from where the truck is on the road.
  const lengthOf = (map, sim) => {
    const points = [map.graph.nearest(sim.state.truck.x, sim.state.truck.z), ...sim.state.route];
    return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
  };
  // On the ring, the truck placed in the middle of the north street, facing east: A's zone is 90 m away round the
  // west, 150 m round the east; B's 70 m round the east and 170 m round the west.
  const ringSim = (pickup) => {
    const { t, map } = ring();
    const sim = createSim(t, map, seeded(1));
    Object.assign(sim.state.truck, { x: 0, z: -20 + laneOffset, heading: Math.PI / 2 });
    acceptFrom(sim, pickup);
    return { map, sim };
  };

  test('the route is empty with no active order', () => {
    const sim = laneSim();
    sim.requestOffers();
    drive(sim, 0.5, GAS);

    expect(sim.state.route).toEqual([]);
  });

  test('before loading the route ends at the pickup, after loading at the drop-off, and empties on delivery', () => {
    const { t, map } = lane();
    const sim = createSim(t, map, seeded(1));
    acceptFrom(sim, 'B');

    expectAt(sim.state.route.at(-1), zoneOf(map, 'B'));

    parkAt(sim, 'B');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expectAt(sim.state.route.at(-1), zoneOf(map, 'A'));

    parkAt(sim, 'A');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expect(sim.state.route).toEqual([]);
  });

  test.each(['A', 'B'])('on a known ring the route to %s is a shortest road route from where the truck is', (pickup) => {
    const { map, sim } = ringSim(pickup);
    const { route } = sim.state;

    expectAt(route.at(-1), zoneOf(map, pickup));
    expect(lengthOf(map, sim)).toBeCloseTo(pickup === 'A' ? 90 : 70);
    // It leaves the truck's own place on the road out, and starts at the corner on its way.
    expectAt(route[0], pickup === 'A' ? { x: -40, z: -20 } : { x: 40, z: -20 });
  });

  test('off the road the route joins the road where the trip is shortest, not at the nearest road', () => {
    // Via Alta runs east from a dead end, past A, Via Est south from its east end and Via Bassa west from there to
    // another dead end. The truck stands on the open ground between them, 10 m from Via Bassa and 70 m from A straight
    // north, but a row of buildings hides Via Alta from it: the shortest trip joins Via Est, 70 m east.
    const alta = way('residential', [[-40, -40], [40, -40]], { name: 'Via Alta' });
    const bassa = way('residential', [[40, 40], [-40, 40]], { name: 'Via Bassa' });
    const t = withSpots([
      { id: 'A', name: 'Magazzino Alto', street: 'Via Alta', way: alta.id, at: 10, side: 'right' },
      { id: 'B', name: 'Bottega Bassa', street: 'Via Bassa', way: bassa.id, at: 40, side: 'right' },
    ]);
    const map = build([alta, way('residential', [[40, -40], [40, 40]], { name: 'Via Est' }), bassa, box(-40, -30, 30, -10)], t);
    const sim = createSim(t, map, seeded(1));
    Object.assign(sim.state.truck, { x: -30, z: 30, heading: 0 });
    acceptFrom(sim, 'A');
    sim.step(DT, IDLE);

    const { route } = sim.state;
    expectAt(route[0], { x: 40, z: 30 });
    expectAt(route.at(-1), zoneOf(map, 'A'));
  });

  test('as the truck drives on, the route keeps running from where it is on the road', () => {
    const { map, sim } = ringSim('B');

    timeUntil(sim, GAS, () => sim.state.truck.x > 14, 10);
    expect(lengthOf(map, sim)).toBeCloseTo(40 - sim.state.truck.x + 30);

    // Round the corner, on the east street, the corner is behind it.
    Object.assign(sim.state.truck, { x: 40 - laneOffset, z: 0, heading: 0, speed: 0 });
    sim.step(DT, IDLE);
    expect(sim.state.route.length).toBe(1);
    expectAt(sim.state.route[0], zoneOf(map, 'B'));
    expect(lengthOf(map, sim)).toBeCloseTo(10);
  });
});

describe('Sim: the clean Star and Rule fines', () => {
  // On the lane, any speed is speeding, even standing still, and a police car at the north end sees the whole lane.
  const t = { ...tables, police: { ...tables.police, count: 0, radius: 500 }, speeding: { tolerance: -tables.osm.classes.residential.limit - 1, cooldown: 0 } };
  const { t: withLane, map } = lane(t);
  const witnessed = () => {
    const sim = createSim(withLane, map, seeded(1));
    const run = map.graph.paths.find((p) => p.kind === 'run');
    sim.state.traffic.push({ id: 99, x: 0, z: 0, heading: 0, speed: 0, lane: run, route: [run], s: 0, police: true });
    return sim;
  };

  test('a Rule fine during the order costs its clean Star; one before it was accepted does not', () => {
    const sim = witnessed();
    sim.step(DT, IDLE);
    expect(sim.state.lastFine?.reason).toBe('speeding'); // no order yet
    acceptFrom(sim, 'A');
    expect(sim.state.order.faults).toEqual([]);
    sim.step(DT, IDLE);
    expect(sim.state.order.faults).toEqual(['speeding']);
    sim.state.traffic.length = 0; // the police car goes, out of the truck's way

    const before = sim.state.profile.stars;
    parkAt(sim, 'A');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    parkAt(sim, 'B');
    drive(sim, tables.orders.loadTime + 0.1, IDLE);

    expect(sim.state.order).toBe(null);
    expect(starsOf(sim).clean).toEqual(['speeding']);
    expect(sim.state.profile.stars).toBe(before + 2);
  });
});

describe('Sim: express and oversized offers', () => {
  const { types, shares, oversizedWidth } = tables.orders;
  const atTier = (tier) => ({ ...freshProfile(), stars: tables.rank.tiers[tier].stars });
  const only = (type, orders = tables.orders) => ({ ...tables, orders: { ...orders, shares: { express: 0, oversized: 0, [type]: 1 } } });

  test('each type comes from its tier on, at its share, with cargo that is not fragile to a drop-off that is not a dock', () => {
    expect(typesOffered(laneSim(1, atTier(types.express - 1))).has('express')).toBe(false);
    expect(typesOffered(laneSim(1, atTier(types.oversized - 1))).has('oversized')).toBe(false);

    const sim = simOn(lane(tables, ['A']), 1, atTier(types.fragileDock));
    const count = { all: 0, express: 0, oversized: 0 };
    for (let i = 0; i < 400; i++) {
      for (const o of sim.requestOffers()) {
        count.all++;
        if (o.type !== 'express' && o.type !== 'oversized') continue;
        count[o.type]++;
        expect(o.cargo.fragile).toBeFalsy();
        expect(o.dropoff).toBe('B'); // A is the dock
      }
    }
    expect(count.express / count.all).toBeCloseTo(shares.express, 1);
    expect(count.oversized / count.all).toBeCloseTo(shares.oversized, 1);
  });

  test("express pays the table's factor and has its shorter expected time, which the on-time Star uses", () => {
    // The nook at 30 s loading and 10 s slack: 70 s expected, 56 s express; the order is delivered at 60 s.
    const example = only('express', { ...tables.orders, basePay: 100, loadTime: 30, slack: 10, express: { time: 0.8, pay: 1.5 } });
    const sim = simOn(nook(example), 1, atTier(types.express));
    const offer = sim.requestOffers()[0];
    expect(offer).toMatchObject({ type: 'express', pay: 150 });
    expect(offer.expectedTime).toBeCloseTo(56, 6);

    sim.acceptOrder(offer.id);
    drive(sim, 61, IDLE);

    expect(sim.state.order).toBe(null);
    expect(starsOf(sim).onTime).toEqual(['late']); // a normal order would have been on time
  });

  // A ring round a block 80 m east–west by 40 m north–south whose east street is a narrow service lane. A is on the north
  // street and B on the south street, each 10 m from the east end: 60 m apart by the service lane, 180 m by the west.
  function narrowRing() {
    const corners = [[-40, -20], [40, -20], [40, 20], [-40, 20], [-40, -20]]; // north-west, north-east, south-east, south-west
    const ways = ['Via Nord', 'Vicolo Est', 'Via Sud', 'Via Ovest'].map((name, i) => way(i === 1 ? 'service' : 'residential', [corners[i], corners[i + 1]], { name }));
    const [north, , south] = ways;
    const t = withSpots([
      { id: 'A', name: 'Magazzino Nord', street: 'Via Nord', way: north.id, at: 70, side: 'right' },
      { id: 'B', name: 'Bottega Sud', street: 'Via Sud', way: south.id, at: 10, side: 'right' },
    ]);
    return { t, map: build(ways, t) };
  }

  test('an oversized route keeps to edges at least oversizedWidth wide: its pay distance and the arrow go the long way', () => {
    expect(classes.service.width).toBeLessThan(oversizedWidth);
    expect(width).toBeGreaterThanOrEqual(oversizedWidth);
    const { t, map } = narrowRing();
    const plain = simOn({ t, map }, 1).requestOffers()[0];
    expect(plain.distance).toBeCloseTo(60, 0);

    const sim = simOn({ t: { ...t, orders: only('oversized').orders }, map }, 1, atTier(types.oversized));
    const offer = acceptFrom(sim, 'A');
    expect(offer).toMatchObject({ type: 'oversized', dropoff: 'B' });
    expect(offer.distance).toBeCloseTo(180, 0);
    expect(offer.pay).toBe(Math.round(tables.orders.basePay + (tables.orders.payPerKm * offer.distance) / 1000));

    Object.assign(sim.state.truck, map.spots.find((s) => s.id === 'A').lane, { speed: 0 });
    drive(sim, tables.orders.loadTime + 0.1, IDLE);
    expect(sim.state.order.phase).toBe('dropoff');
    expect(sim.state.route.length).toBeGreaterThan(1);
    for (const p of sim.state.route) expect(p.x).toBeLessThan(40 - classes.service.width); // never on the service lane
  });

  test('no oversized offer is made where no wide route leads', () => {
    // The lane as a service lane: both spots on an edge too narrow.
    const vicolo = way('service', [[0, -28], [0, 28]], { name: 'Vicolo' });
    const spot = (id, at) => ({ id, name: `Bottega ${id}`, street: 'Vicolo', way: vicolo.id, at, side: 'right' });
    const t = withSpots([spot('A', 0), spot('B', 56)], [], null, only('oversized'));
    const sim = createSim(t, build([vicolo], t), seeded(1), atTier(types.oversized));
    for (let i = 0; i < 20; i++) expect(sim.requestOffers()).toEqual([]);
  });
});

describe('Sim: rounds', () => {
  const { types, shares, basePay, payPerKm, loadTime } = tables.orders;
  const { emptyMass } = tables.fleet.truck;
  const atTier = (tier) => ({ ...freshProfile(), stars: tables.rank.tiers[tier].stars });
  const rounds = (roundDrops = [3]) => ({ ...tables.orders, shares: { round: 1 }, roundDrops });

  // Vicolo, a 120 m north–south dead end: A at its north end, B, C and D 40 m apart south of it, A a dock. With `island`,
  // E on a street of its own 60 m east, which no road joins.
  function street(t = tables, island = false) {
    const vicolo = way('residential', [[0, -60], [0, 60]], { name: 'Vicolo' });
    const isola = way('residential', [[60, -30], [60, 30]], { name: 'Isola' });
    const spot = (id, w, at, more) => ({ id, name: `Bottega ${id}`, street: w.tags.name, way: w.id, at, side: 'right', ...more });
    const spots = [spot('A', vicolo, 0, { bay: [-laneOffset, -60 - width / 2 - tables.osm.pavement, 0] }), spot('B', vicolo, 40), spot('C', vicolo, 80), spot('D', vicolo, 120)];
    if (island) spots.push(spot('E', isola, 30));
    const withT = withSpots(spots, ['A'], null, t);
    return { t: withT, map: build(island ? [vicolo, isola] : [vicolo], withT) };
  }
  const roundSim = ({ t, map }, profile = atTier(types.round)) => createSim(t, map, seeded(1), profile);
  // Puts the truck at a standstill in spot `id`'s zone.
  const standAt = (sim, id) => Object.assign(sim.state.truck, mapOf(sim).spots.find((s) => s.id === id).lane, { speed: 0 });
  const unload = (sim, id) => {
    standAt(sim, id);
    drive(sim, loadTime + 0.1, IDLE);
  };

  test('a round leads from its pickup through each drop-off in order; each drop pays its leg and lightens the load, the last gives the Stars', () => {
    const sim = roundSim(street({ ...tables, orders: rounds() }));
    const offer = acceptFrom(sim, 'A');
    expect(offer).toMatchObject({ type: 'round', dropoff: 'B' });
    expect(offer.drops.map((d) => d.spot)).toEqual(['B', 'C', 'D']); // nearest by road first
    expect(offer.drops[1].distance).toBeCloseTo(40, 0);
    for (const d of offer.drops) expect(d.pay).toBe(Math.round(basePay + (payPerKm * d.distance) / 1000));
    expect(offer.pay).toBe(offer.drops.reduce((sum, d) => sum + d.pay, 0));
    expect(offer.expectedTime).toBe(offer.drops[2].expectedTime);
    expect(offer.drops[2].expectedTime - offer.drops[1].expectedTime).toBeCloseTo(offer.drops[2].distance / tables.orders.referenceSpeed + loadTime, 6);

    const load = offer.cargo.weight * 1000;
    unload(sim, 'A');
    expect(sim.state.truck.mass).toBe(emptyMass + load);
    const { money, stars } = sim.state.profile;
    let paid = 0;
    for (const [k, id] of ['B', 'C', 'D'].entries()) {
      expect(sim.state.order.dropoff).toBe(id);
      unload(sim, id);
      const payment = sim.state.lastPayment;
      expect(payment.lines[0]).toEqual({ label: 'base', amount: offer.drops[k].pay });
      paid += payment.amount;
      if (k === 2) break;
      expect(sim.state.order.drop).toBe(k + 1);
      expect(sim.state.truck.mass).toBeCloseTo(emptyMass + (load * (2 - k)) / 3, 6);
      expect(payment.stars).toEqual([]);
      expect(sim.state.profile.stars).toBe(stars);
      const next = mapOf(sim).spots.find((s) => s.id === ['C', 'D'][k]).lane;
      expect(Math.hypot(sim.state.route.at(-1).x - next.x, sim.state.route.at(-1).z - next.z)).toBeLessThan(5); // the arrow leads on
    }
    expect(sim.state.order).toBe(null);
    expect(sim.state.truck.mass).toBe(emptyMass);
    expect(sim.state.profile.money).toBe(money + paid);
    expect(starsOf(sim)).toEqual({ delivered: [], onTime: [], clean: [] });
    expect(sim.state.profile.stars).toBe(stars + 3);
  });

  test("the on-time Star counts against the round's whole expected time, and a fault on any leg costs the clean Star", () => {
    // Any speed is speeding, and a police car seen from anywhere fines it.
    const t = { ...tables, orders: rounds(), police: { ...tables.police, count: 0, radius: 500 }, speeding: { tolerance: -classes.residential.limit - 1, cooldown: 0 } };
    const sim = roundSim(street(t));
    const offer = acceptFrom(sim, 'A');
    standAt(sim, 'D'); // out of the pickup's zone, idling past the first drop's expected time
    drive(sim, offer.drops[0].expectedTime + 0.5, IDLE);
    unload(sim, 'A');
    unload(sim, 'B');
    expect(sim.state.lastPayment.lines.find((l) => l.label === 'time').amount).toBe(0); // the first drop is late

    const run = mapOf(sim).graph.paths.find((p) => p.kind === 'run');
    sim.state.traffic.push({ id: 99, x: 0, z: 0, heading: 0, speed: 0, lane: run, route: [run], s: 0, police: true });
    sim.step(DT, IDLE);
    sim.state.traffic.length = 0;
    unload(sim, 'C');
    unload(sim, 'D');
    expect(sim.state.order).toBe(null);
    expect(starsOf(sim)).toEqual({ delivered: [], onTime: [], clean: ['speeding'] });
  });

  test('rounds come from their tier on, at their share, with 2–3 distinct drop-offs that are not docks and cargo that is not fragile', () => {
    expect(typesOffered(roundSim(street(), atTier(types.round - 1))).has('round')).toBe(false);
    const sim = roundSim(street());
    const count = { all: 0, round: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 400; i++) {
      for (const o of sim.requestOffers()) {
        count.all++;
        if (o.type !== 'round') continue;
        count.round++;
        count[o.drops.length]++;
        const spots = o.drops.map((d) => d.spot);
        expect(new Set([o.pickup, ...spots]).size).toBe(spots.length + 1);
        expect(spots).not.toContain('A'); // the dock
        expect(o.cargo.fragile).toBeFalsy();
      }
    }
    expect(count.round / count.all).toBeCloseTo(shares.round, 1);
    expect(count[2] + count[3]).toBe(count.round);
    expect(count[2] && count[3]).toBeTruthy();
  });

  test('a round only visits places joined by road', () => {
    const sim = roundSim(street({ ...tables, orders: rounds([2]) }, true));
    let made = 0;
    for (let i = 0; i < 100; i++) {
      for (const o of sim.requestOffers()) {
        made++;
        expect([o.pickup, ...o.drops.map((d) => d.spot)]).not.toContain('E');
      }
    }
    expect(made).toBeGreaterThan(0);
  });
});
