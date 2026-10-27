// Headless game simulation. Must not import Three.js or touch the DOM.
// Heading 0 faces +z; forward is (sin heading, cos heading) in the x/z plane.

import { DIRS } from './map.js';
import { createTraffic } from './traffic.js';

const G = 9.81; // m/s²

// The persistent part of the game (spec #12, "Profile"). Bump `version` when the shape changes and
// teach save.js to migrate the old one. distance: m driven in total; upgrades: id → level; equipped: slot → visual id.
export function freshProfile() {
  return { version: 2, money: 0, rankPoints: 0, distance: 0, upgrades: {}, owned: [], equipped: {} };
}

// `map` comes from parseMap(); without one the truck drives on an open plane with nothing to hit
// (and resetToRoad() and requestOffers() have nowhere to go). `random` returns floats in [0, 1);
// pass a seeded one for repeatable offers. `profile` must already be valid (see save.js); it is copied.
export function createSim(tables, map, random = Math.random, profile = freshProfile()) {
  const o = tables.orders;
  const lt = tables.lights;
  const cycle = 2 * (lt.green + lt.amber + lt.allRed);
  // speed is signed (negative is reverse); gear is 'R', 'N' or 1..n; roll > 0 leans the body right.
  const base = tables.vehicle;
  const truck = { x: 0, z: 0, heading: 0, speed: 0, mass: base.emptyMass, gear: 'N', rpm: base.idleRpm, roll: 0 };
  // read-only for callers: only step() and Sim commands change it. An offer's `type` is 'normal', 'heavy',
  // 'fragile', 'dock' or 'fragileDock'. `order` is the active offer plus its phase ('pickup' or 'dropoff'),
  // `elapsed` (s since it was accepted) and `damage` (0..1, grows only on fragile cargo once loaded);
  // `progress` runs 0..1 while the truck stands in that phase's zone.
  // `route` is the shortest road path ({col, row} tiles) to that zone from the truck's road tile (see map.routeFrom).
  // `lastPayment` ({ amount, lines: [{ label, amount }] }, label a key of strings.payLines) is replaced by a
  // new object on every payment, so the UI can tell each one apart;
  // `lastFine` ({ reason, amount }, reason a key of tables.fines) likewise on every fine.
  // `lights` are map.lights, one per junction approach, each with its `phase` ('green', 'amber' or 'red');
  // `lightsVersion` goes up whenever any phase changes, so a view can skip unchanged lights.
  // `traffic` are the AI cars: { id, x, z, heading, speed, lane, police } and more (see traffic.js).
  // `policeSees` is whether a police car sees the truck, so a rule fine would be taken (see policeSees()).
  // `rank` is { tier, title, progress 0..1 to the next tier }; `garageAvailable` is whether the Werkstatt may sell.
  const state = {
    truck,
    collision: false,
    profile: structuredClone(profile),
    rank: null,
    offers: [],
    order: null,
    progress: 0,
    route: [],
    lastPayment: null,
    lastFine: null,
    lights: (map?.lights ?? []).map((l) => ({ ...l, phase: 'red' })),
    lightsVersion: 0,
    traffic: [],
    policeSees: false,
    get garageAvailable() {
      return truck.speed === 0 && !state.order;
    },
  };
  let v = upgradedVehicle();
  updateRank();
  let clock = 0; // s of Sim time, drives the light cycles
  let nextOfferId = 1;
  let reversing = false;
  let brakeHold = 0; // s the brake has been held at a standstill
  let routeKey = ''; // start tile and target the current route was found for
  let offersTile = ''; // tile the current offers were made on; their expected times count from there
  const tileKey = () => `${Math.floor(truck.x / map.tileSize)},${Math.floor(truck.z / map.tileSize)}`;
  const traffic = map && createTraffic(tables, map, random);
  let contacts = new Map(); // id of each AI car the truck is in contact with → who made it: 'car' or 'truck'
  if (traffic) state.traffic = traffic.cars;
  // The map tile (clamped to the map) holding coordinate v along an axis of n tiles.
  const tileOf = (v, n) => Math.min(n - 1, Math.max(0, Math.floor(v / map.tileSize)));
  // map.colliders by every tile their box spans (`row * cols + col`), so fits() tests only those near the truck. An
  // edge on a tile border counts the tile beyond too, so boxes that overlap always share a tile.
  const collidersAt = map ? Array.from({ length: map.cols * map.rows }, () => []) : [];
  for (const b of map?.colliders ?? []) {
    for (let row = tileOf(b.minZ, map.rows); row <= tileOf(b.maxZ, map.rows); row++) {
      for (let col = tileOf(b.minX, map.cols); col <= tileOf(b.maxX, map.cols); col++) collidersAt[row * map.cols + col].push(b);
    }
  }

  const ratioOf = (gear) => (gear === 'R' ? v.reverseRatio : v.gearRatios[gear - 1]);

  // Engine RPM in a gear at the current speed, never below idle.
  function rpmIn(gear) {
    const ratio = ratioOf(gear);
    return Math.max(v.idleRpm, (Math.abs(truck.speed) * ratio * 60) / (2 * Math.PI * v.wheelRadius));
  }

  // Force at the wheels with the throttle fully open, from the torque curve (zero past its end).
  function wheelForce(gear, rpm) {
    const curve = v.torqueCurve;
    let torque = rpm <= curve[0][0] ? curve[0][1] : 0;
    for (let i = 1; i < curve.length; i++) {
      const [r0, t0] = curve[i - 1];
      const [r1, t1] = curve[i];
      if (rpm > r0 && rpm <= r1) torque = t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
    return (torque * ratioOf(gear)) / v.wheelRadius;
  }

  function step(dt, input) {
    clock += dt;
    const speedBefore = Math.abs(truck.speed);
    updateLights();
    const stopped = Math.abs(truck.speed) < v.stopSpeed;

    // Reverse: a brake hold at a standstill engages it; a stop with the brake released ends it.
    if (reversing) {
      if (stopped && input.brake === 0) reversing = false;
    } else {
      brakeHold = stopped && input.brake > 0 && input.gas === 0 ? brakeHold + dt : 0;
      if (brakeHold >= v.reverseDelay) reversing = true;
    }

    // Automatic gearbox: neutral at rest, otherwise shift one gear at a time at the RPM thresholds.
    if (reversing) truck.gear = 'R';
    else if (stopped && input.gas === 0) truck.gear = 'N';
    else {
      if (truck.gear === 'N' || truck.gear === 'R') truck.gear = 1;
      const rpm = rpmIn(truck.gear);
      if (rpm > v.upshiftRpm && truck.gear < v.gearRatios.length) truck.gear++;
      else if (rpm < v.downshiftRpm && truck.gear > 1) truck.gear--;
    }
    truck.rpm = truck.gear === 'N' ? v.idleRpm : rpmIn(truck.gear);

    // In reverse the brake pedal drives backwards and releasing it brakes; otherwise the pedals do what they say.
    let drive = 0;
    let brake = input.brake;
    if (reversing) {
      drive = -input.brake * wheelForce('R', truck.rpm);
      brake = input.brake > 0 ? 0 : 1;
    } else if (truck.gear !== 'N') {
      drive = input.gas * wheelForce(truck.gear, truck.rpm);
    }
    const resist = brake * v.brakeForce + v.rollingResistance * truck.mass * G + v.drag * truck.speed ** 2;
    truck.speed += (drive / truck.mass) * dt;
    // Resistance slows the truck towards zero but never pushes it the other way.
    const slow = (resist / truck.mass) * dt;
    truck.speed = Math.abs(truck.speed) <= slow ? 0 : truck.speed - Math.sign(truck.speed) * slow;
    truck.speed = Math.max(-v.reverseSpeed, truck.speed);

    // Bicycle model; positive steer turns right, which lowers the heading. Lock fades with speed².
    const angle = (input.steer * v.maxSteerAngle) / (1 + (truck.speed / v.steerFadeSpeed) ** 2);
    const yawRate = -(truck.speed / v.wheelbase) * Math.tan(angle);
    const { x, z, heading } = truck;
    const frontBefore = frontTile();
    truck.heading += yawRate * dt;
    truck.x += Math.sin(truck.heading) * truck.speed * dt;
    truck.z += Math.cos(truck.heading) * truck.speed * dt;

    // Solid stop, no damage to the truck: undo the move that hit something, a wall or a car it wasn't
    // already touching, or that pushed into a car it was (one that drove into it): the move brought the car's
    // centre closer to the truck's footprint (sliding along it isn't pushing). Reverse backs a stuck truck off.
    const shed = speedBefore - Math.abs(truck.speed);
    const met = traffic ? traffic.touching(corners(truck)) : [];
    const before = met.length ? traffic.touching(corners({ x, z, heading })) : [];
    const closer = (c) => outside(c, truck) < outside(c, { x, z, heading }) - 1e-6;
    const pushed = before.filter((c) => met.includes(c) && closer(c));
    const blocked = !fits(truck) || met.some((c) => !before.includes(c)) || pushed.length > 0;
    const hit = blocked && !state.collision && speedBefore >= o.hitSpeed;
    state.collision = blocked;
    if (state.collision) Object.assign(truck, { x, z, heading, speed: 0 });
    checkRedLight(frontBefore, frontTile()); // before touchCars, which may stop the truck
    if (traffic) touchCars(met, before, pushed);
    damageCargo(shed > o.hardBrake * dt ? shed : 0, hit);
    state.profile.distance += Math.hypot(truck.x - x, truck.z - z);
    updateTraffic(dt);
    state.policeSees = policeSees(); // checkRedLight reads it a step later: the same car poses, the truck a step back

    // The body leans out of the turn with lateral acceleration, more when heavier.
    const lean = yawRate * truck.speed * v.rollPerAccel * (truck.mass / 1000);
    truck.roll = Math.max(-v.maxRoll, Math.min(v.maxRoll, lean));

    if (state.order) {
      state.order.elapsed += dt;
      loadOrUnload(dt);
    } else if (state.offers.length && tileKey() !== offersTile) state.offers = []; // the panel asks again

    updateRoute();
  }

  // Loaded fragile cargo takes damage from speed shed by hard braking (m/s) and from each new hit faster than a touch;
  // the Fahrwerk slows both.
  function damageCargo(braked, hit) {
    const order = state.order;
    if (!order?.cargo.fragile || order.phase !== 'dropoff') return;
    const harm = o.brakeDamage * braked + (hit ? o.hitDamage : 0);
    order.damage = Math.min(1, order.damage + harm * (levelOf('suspension')?.factor ?? 1));
  }

  // Junction n runs `junctionOffset` s ahead of junction n - 1; the east–west axis runs half a cycle
  // behind the north–south one.
  function updateLights() {
    for (const l of state.lights) {
      const t = (clock + l.junction * lt.junctionOffset + ((l.dir % 2) * cycle) / 2) % cycle;
      const phase = t < lt.green ? 'green' : t < lt.green + lt.amber ? 'amber' : 'red';
      if (phase !== l.phase) {
        l.phase = phase;
        state.lightsVersion++;
      }
    }
  }

  // AI cars as many as the rank tier brings, reacting to the truck where it now stands; the ones it is in
  // contact with stand still.
  function updateTraffic(dt) {
    traffic?.step(dt, truck, state.lights, tables.rank.tiers[state.rank.tier].traffic, contacts);
  }

  // A new contact with an AI car (`met`: the cars the truck touches after its move) costs a fine when the
  // truck's move made it; a car that drove into the truck (`before`: touching before the move) costs nothing
  // and stops the truck, until the truck pushes into it (`pushed`), which is the truck's move too. A contact
  // lasts until the truck is `contactGap` clear of the car, so pushing on or nudging it again isn't a new one.
  function touchCars(met, before, pushed) {
    const near = contacts.size ? traffic.touching(corners(truck, tables.traffic.contactGap)) : [];
    const now = state.traffic.filter((c) => met.includes(c) || (contacts.has(c.id) && near.includes(c)));
    const next = new Map();
    for (const c of now) {
      let by = contacts.get(c.id);
      if (!by && before.includes(c)) {
        truck.speed = 0;
        by = 'car';
      } else if (!by || (by === 'car' && pushed.includes(c))) {
        fine('collision');
        by = 'truck';
      }
      next.set(c.id, by);
    }
    contacts = next;
  }

  // Tile under the middle of the truck's front bumper.
  function frontTile() {
    if (!map) return null;
    const half = v.length / 2;
    const col = Math.floor((truck.x + Math.sin(truck.heading) * half) / map.tileSize);
    const row = Math.floor((truck.z + Math.cos(truck.heading) * half) / map.tileSize);
    return { col, row };
  }

  // The front crossing a stop line into a light junction, driving forwards, while that approach is red costs a
  // fine if the police see it. Reversing over a line is manoeuvring (backing out of a box or into a bay), and its
  // front bumper is the last part to cross anyway.
  function checkRedLight(from, to) {
    if (!state.policeSees || !from || truck.speed <= 0 || (from.col === to.col && from.row === to.row)) return;
    const light = state.lights.find(
      (l) => l.col === to.col && l.row === to.row && DIRS[l.dir][0] === to.col - from.col && DIRS[l.dir][1] === to.row - from.row,
    );
    if (light?.phase === 'red') fine('redLight');
  }

  // Whether a police car is within tables.police.radius of the truck with no building tile on the line between them.
  // shortcut: the line runs centre to centre, sampled every 0.5 m, so the truck's front peeking out of a side street
  // is unseen and a line clipping a building's corner by under 0.5 m is clear; upgrade to the footprint if players notice.
  function policeSees() {
    const r2 = tables.police.radius ** 2;
    for (const c of state.traffic) {
      const [dx, dz] = [truck.x - c.x, truck.z - c.z];
      if (!c.police || dx * dx + dz * dz > r2) continue;
      const n = Math.ceil(Math.hypot(dx, dz) / 0.5);
      let clear = true;
      for (let i = 1; i < n && clear; i++) clear = !map.isBuilding(Math.floor((c.x + (dx * i) / n) / map.tileSize), Math.floor((c.z + (dz * i) / n) / map.tileSize));
      if (clear) return true;
    }
    return false;
  }

  // Takes a fine (tables.fines) from the money, never below 0; the unpaid rest is dropped, so `lastFine` holds
  // the amount actually taken.
  function fine(reason) {
    const amount = Math.min(state.profile.money, tables.fines[reason]);
    state.profile.money -= amount;
    state.lastFine = { reason, amount };
  }

  // Finds the route again only when the truck's tile or the target changes.
  function updateRoute() {
    const order = state.order;
    if (!order) {
      state.route = [];
      routeKey = '';
      return;
    }
    const target = targetOf(order);
    const key = `${tileKey()},${target.id}`;
    if (key === routeKey) return;
    routeKey = key;
    state.route = map.routeFrom(truck.x, truck.z, target.zoneTile) ?? [];
  }

  // Standing still in the active phase's zone fills `progress`; anything else resets it.
  function loadOrUnload(dt) {
    const order = state.order;
    const { zone } = targetOf(order);
    const inZone = truck.x > zone.minX && truck.x < zone.maxX && truck.z > zone.minZ && truck.z < zone.maxZ;
    state.progress = inZone && Math.abs(truck.speed) < v.stopSpeed ? state.progress + dt / o.loadTime : 0;
    if (state.progress < 1) return;
    state.progress = 0;
    if (order.phase === 'pickup') {
      truck.mass += order.cargo.weight * 1000;
      order.phase = 'dropoff';
    } else {
      truck.mass = v.emptyMass;
      // The time bonus shrinks from its full share at once to 0 at the expected time; late pays the base.
      const timeShare = Math.max(0, order.expectedTime - order.elapsed) / order.expectedTime;
      const lines = [
        { label: 'base', amount: order.pay },
        { label: 'time', amount: Math.round(o.timeBonus * timeShare * order.pay) },
      ];
      // Damage takes its share of the fragile premium and never more, so the pay never drops below the base.
      let care = 0;
      if (order.cargo.fragile) {
        care = 1 - order.damage;
        lines.push({ label: 'fragile', amount: Math.round(o.fragilePremium * care * order.pay) });
      }
      const to = targetOf(order);
      const docked = to.dock && reversedInto(to);
      if (docked) lines.push({ label: 'dock', amount: Math.round(o.dockBonus * order.pay) });
      const amount = lines.reduce((sum, l) => sum + l.amount, 0);
      state.profile.money += amount;
      const { pointsPerDelivery, timeBonusPoints, fragilePoints, dockPoints } = tables.rank;
      state.profile.rankPoints +=
        pointsPerDelivery + Math.round(timeBonusPoints * timeShare) + Math.round(fragilePoints * care) + (docked ? dockPoints : 0);
      state.lastPayment = { amount, lines };
      state.order = null;
      updateRank();
    }
  }

  // Whether the truck stands reversed into a dock's bay: facing out of it, along the zone side, on its centre line,
  // and with the middle of its rear at the dock edge (the building face, half a tile back from the zone's centre).
  function reversedInto({ dir, zone }) {
    const [dc, dr] = DIRS[dir];
    const turn = truck.heading - Math.atan2(dc, dr);
    const [dx, dz] = [truck.x - (zone.minX + zone.maxX) / 2, truck.z - (zone.minZ + zone.maxZ) / 2];
    const rear = (dx - (Math.sin(truck.heading) * v.length) / 2) * dc + (dz - (Math.cos(truck.heading) * v.length) / 2) * dr;
    return (
      Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) <= o.dockHeading &&
      Math.abs(dx * dr - dz * dc) <= o.dockCentre &&
      rear + map.tileSize / 2 <= o.dockDepth
    );
  }

  function updateRank() {
    const { tiers } = tables.rank;
    const points = state.profile.rankPoints;
    const tier = tiers.findLastIndex((t) => points >= t.points);
    const next = tiers[tier + 1];
    const progress = next ? (points - tiers[tier].points) / (next.points - tiers[tier].points) : 1;
    state.rank = { tier, title: tiers[tier].title, progress };
  }

  // The profile's bought level of an upgrade (undefined while it has none).
  function levelOf(id) {
    return tables.upgrades[id].levels[(state.profile.upgrades[id] ?? 0) - 1];
  }

  // Effective vehicle constants: the base table with the bought upgrades applied.
  function upgradedVehicle() {
    return {
      ...base,
      torqueCurve: base.torqueCurve.map(([rpm, torque]) => [rpm, torque * (levelOf('motor')?.factor ?? 1)]),
      brakeForce: base.brakeForce * (levelOf('brakes')?.factor ?? 1),
      steerFadeSpeed: base.steerFadeSpeed * (levelOf('tyres')?.factor ?? 1),
      rollPerAccel: base.rollPerAccel * (levelOf('suspension')?.factor ?? 1),
    };
  }

  const refuse = (reason) => ({ ok: false, reason });
  const OK = { ok: true, reason: null };

  // Raises one upgrade by a level. Returns { ok, reason }; a refusal changes nothing.
  function buyUpgrade(id) {
    if (!Object.hasOwn(tables.upgrades, id)) return refuse('unknown');
    if (!state.garageAvailable) return refuse('notIdle');
    const level = state.profile.upgrades[id] ?? 0;
    const next = tables.upgrades[id].levels[level];
    if (!next) return refuse('maxLevel');
    if (state.rank.tier < next.rank) return refuse('rankTooLow');
    if (state.profile.money < next.price) return refuse('noMoney');
    state.profile.money -= next.price;
    state.profile.upgrades[id] = level + 1;
    v = upgradedVehicle();
    state.offers = []; // the orders panel then asks again, with what the new Ladefläche carries
    return OK;
  }

  // Whether the profile owns a visual item; a slot's free stock item is everyone's.
  const owns = (id) => tables.visuals[id].price === 0 || state.profile.owned.includes(id);

  // Buys a visual item and wears it; no rank needed. Returns { ok, reason }; a refusal changes nothing.
  function buyVisual(id) {
    if (!Object.hasOwn(tables.visuals, id)) return refuse('unknown');
    if (!state.garageAvailable) return refuse('notIdle');
    if (owns(id)) return refuse('owned');
    const { price } = tables.visuals[id];
    if (state.profile.money < price) return refuse('noMoney');
    state.profile.money -= price;
    state.profile.owned.push(id);
    return equipVisual(id);
  }

  // Wears an owned visual item in its slot, free of charge. The stock item empties the slot, so `equipped`
  // only ever holds bought items (as save.js expects).
  function equipVisual(id) {
    if (!Object.hasOwn(tables.visuals, id)) return refuse('unknown');
    if (!state.garageAvailable) return refuse('notIdle');
    if (!owns(id)) return refuse('notOwned');
    const { slot, price } = tables.visuals[id];
    if (price === 0) delete state.profile.equipped[slot];
    else state.profile.equipped[slot] = id;
    return OK;
  }

  const spot = (id) => map.spots.find((s) => s.id === id);
  const targetOf = (order) => spot(order.phase === 'pickup' ? order.pickup : order.dropoff);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const typeOf = (cargo, to) =>
    to?.dock ? (cargo.fragile ? 'fragileDock' : 'dock') : cargo.fragile ? 'fragile' : cargo.weight > o.maxCargo ? 'heavy' : 'normal';

  // New offers between distinct spots, paid by the road route length; none while an order is active.
  // Cargo is only what the Ladefläche carries, and cargo and drop-off make an offer type the rank tier allows.
  // The expected time is the truck's route to the pickup plus the paid route, at reference speed, plus loading,
  // unloading and slack.
  function requestOffers() {
    state.offers = [];
    if (state.order) return state.offers;
    offersTile = tileKey();
    const maxCargo = levelOf('cargoBed')?.maxCargo ?? o.maxCargo;
    const cargoes = o.cargo.filter((c) => c.weight <= maxCargo && o.types[typeOf(c)] <= state.rank.tier);
    for (let i = 0; i < o.offerCount; i++) {
      const cargo = pick(cargoes);
      const from = pick(map.spots);
      const to = pick(map.spots.filter((s) => s !== from && o.types[typeOf(cargo, s)] <= state.rank.tier));
      const path = to && map.route(from.zoneTile, to.zoneTile);
      if (!path) continue; // a spot cut off from the road network gets no orders, nor one with no drop-off allowed
      const distance = (path.length - 1) * map.tileSize;
      const pay = Math.round(o.basePay + (o.payPerKm * distance) / 1000);
      const toPickup = ((map.routeFrom(truck.x, truck.z, from.zoneTile)?.length ?? 1) - 1) * map.tileSize;
      const expectedTime = (toPickup + distance) / o.referenceSpeed + 2 * o.loadTime + o.slack;
      state.offers.push({ id: nextOfferId++, type: typeOf(cargo, to), cargo, pickup: from.id, dropoff: to.id, distance, pay, expectedTime });
    }
    return state.offers;
  }

  // Makes one of the current offers the active order; ignored while one is active or for an unknown id.
  function acceptOrder(id) {
    const offer = state.offers.find((x) => x.id === id);
    if (state.order || !offer) return;
    state.order = { ...offer, phase: 'pickup', elapsed: 0, damage: 0 };
    state.offers = [];
    updateRoute();
  }

  // Puts the truck in the right-hand lane of the nearest free road tile, facing along it, at a standstill in first
  // gear. A crossing (three or more road sides), where AI cars would wait for it, only when no other tile is free.
  function resetToRoad() {
    const crossing = ({ col, row }) => DIRS.filter(([dc, dr]) => map.isRoad(col + dc, row + dr)).length >= 3;
    const poses = map.roads.map((tile) => ({ pose: roadPose(tile), crossing: crossing(tile) }));
    const away = ({ pose: p }) => (p.x - truck.x) ** 2 + (p.z - truck.z) ** 2;
    poses.sort((a, b) => a.crossing - b.crossing || away(a) - away(b));
    const free = ({ pose: p }) => fits(p) && !traffic.touching(corners(p)).length;
    Object.assign(truck, (poses.find(free) ?? poses[0]).pose, { speed: 0, gear: 1, rpm: v.idleRpm, roll: 0 });
    reversing = false;
    brakeHold = 0;
    updateRoute();
  }

  // In the tile's right-hand lane, where the AI cars drive (`laneOffset` right of the centre line), heading
  // towards the road neighbour that needs the smallest turn.
  function roadPose({ col, row }) {
    const pose = { x: (col + 0.5) * map.tileSize, z: (row + 0.5) * map.tileSize, heading: truck.heading };
    let smallest = Infinity;
    for (const [dc, dr] of DIRS) {
      if (!map.isRoad(col + dc, row + dr)) continue;
      const heading = Math.atan2(dc, dr);
      const turn = Math.abs(Math.atan2(Math.sin(heading - truck.heading), Math.cos(heading - truck.heading)));
      if (turn < smallest) [pose.heading, smallest] = [heading, turn];
    }
    pose.x -= Math.cos(pose.heading) * tables.traffic.laneOffset; // right is (-cos heading, sin heading)
    pose.z += Math.sin(pose.heading) * tables.traffic.laneOffset;
    return pose;
  }

  // Whether the truck's footprint at `pose` stays inside the map and clear of every collider. Runs every step,
  // so it tests only the colliders indexed on the tiles under the footprint's bounding box.
  function fits(pose) {
    if (!map) return true;
    const cs = corners(pose);
    const minX = Math.min(cs[0].x, cs[1].x, cs[2].x, cs[3].x);
    const maxX = Math.max(cs[0].x, cs[1].x, cs[2].x, cs[3].x);
    const minZ = Math.min(cs[0].z, cs[1].z, cs[2].z, cs[3].z);
    const maxZ = Math.max(cs[0].z, cs[1].z, cs[2].z, cs[3].z);
    if (minX < 0 || minZ < 0 || maxX > map.cols * map.tileSize || maxZ > map.rows * map.tileSize) return false;
    for (let row = tileOf(minZ, map.rows); row <= tileOf(maxZ, map.rows); row++) {
      for (let col = tileOf(minX, map.cols); col <= tileOf(maxX, map.cols); col++) {
        for (const b of collidersAt[row * map.cols + col]) {
          // Bounding boxes apart (touching included) can't overlap; this skips most candidates cheaply.
          if (b.minX >= maxX || b.maxX <= minX || b.minZ >= maxZ || b.maxZ <= minZ) continue;
          if (overlaps(pose, b)) return false;
        }
      }
    }
    return true;
  }

  // How far point `p` lies outside the truck's footprint at `pose`; negative inside, by how far it is in.
  function outside(p, { x, z, heading }) {
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const along = Math.abs((p.x - x) * fx + (p.z - z) * fz) - v.length / 2;
    const right = Math.abs(-(p.x - x) * fz + (p.z - z) * fx) - v.width / 2;
    return along > 0 || right > 0 ? Math.hypot(Math.max(0, along), Math.max(0, right)) : Math.max(along, right);
  }

  // Footprint corners, `grow` m larger all round; right is (-cos heading, sin heading).
  function corners({ x, z, heading }, grow = 0) {
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const [l, w] = [v.length / 2 + grow, v.width / 2 + grow];
    return [[l, w], [l, -w], [-l, -w], [-l, w]].map(([a, b]) => ({ x: x + fx * a - fz * b, z: z + fz * a + fx * b }));
  }

  // Separating-axis test of the truck's box against an axis-aligned box whose bounding box overlaps the truck's
  // (fits() checks the world axes); touching isn't overlapping.
  function overlaps({ x, z, heading }, b) {
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const [l, w] = [v.length / 2, v.width / 2];
    const bc = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]];
    const along = bc.map(([px, pz]) => (px - x) * fx + (pz - z) * fz);
    const right = bc.map(([px, pz]) => -(px - x) * fz + (pz - z) * fx);
    if (along.every((a) => a >= l) || along.every((a) => a <= -l)) return false;
    return !(right.every((r) => r >= w) || right.every((r) => r <= -w));
  }

  updateLights();
  if (map) {
    // Start parked on the road nearest the middle of the city.
    Object.assign(truck, { x: (map.cols * map.tileSize) / 2, z: (map.rows * map.tileSize) / 2 });
    resetToRoad();
    updateTraffic(0);
    state.policeSees = policeSees();
  }

  return { state, step, resetToRoad, requestOffers, acceptOrder, buyUpgrade, buyVisual, equipVisual, owns };
}
