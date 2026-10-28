// Headless game simulation. Must not import Three.js or touch the DOM.
// Heading 0 faces +z; forward is (sin heading, cos heading) in the x/z plane.

import { createCells } from './cells.js';
import { createTraffic } from './traffic.js';
import { clock as dayClock, fuel } from '../tables.js';

const G = 9.81; // m/s²

// The persistent part of the game (spec #12, "Profile"). Bump `version` when the shape changes and teach save.js to
// migrate the old one; v3 came with the Monti map (#67), and the grid city's v1 and v2 start fresh.
// distance: m driven in total; upgrades: id → level; equipped: slot → visual id; fuel: litres in the tank;
// energy: the driver's, 0..1; timeOfDay: game minutes since midnight; timePlayed: s of play in total.
// The tank and start time come from the game's own tables: a test's tables don't change a fresh profile.
export function freshProfile() {
  return {
    version: 4,
    money: 0,
    rankPoints: 0,
    distance: 0,
    upgrades: {},
    owned: [],
    equipped: {},
    fuel: fuel.tank,
    energy: 1,
    timeOfDay: dayClock.start,
    timePlayed: 0,
  };
}

// `map` comes from buildOsmMap() (osm.js); without one the truck drives on an open plane with nothing to hit
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
  // `route` is the shortest road route to that zone's place on the road graph, as points ({ x, z }) from the next one
  // ahead of the truck on its edge, or off the road from where it joins the road (see routeFrom()).
  // `lastPayment` ({ amount, lines: [{ label, amount }] }, label a key of strings.payLines) is replaced by a
  // new object on every payment, so the UI can tell each one apart;
  // `lastFine` ({ reason, amount }, reason a key of tables.fines) likewise on every fine.
  // `lights` are map.lights, one per junction approach, each with its `phase` ('green', 'amber', 'red' or 'redAmber');
  // `lightsVersion` goes up whenever any phase changes, so a view can skip unchanged lights.
  // `traffic` are the AI cars: { id, x, z, heading, speed, lane, police } and more (see traffic.js).
  // `policeSees` is whether a police car sees the truck, so a rule fine would be taken (see policeSees()).
  // `junctionRule` is the rule of the next junction ahead within tables.signs.hint (see junctionAhead()):
  // 'light', 'giveWay', 'stop', 'priority', 'rightBeforeLeft' or null; `speedLimit` the km/h limit of the edge the truck was last on the road of, and
  // `street` that edge's name ('' for none).
  // `rank` is { tier, title, progress 0..1 to the next tier }; `garageAvailable` is whether the Werkstatt may sell.
  // `timeOfDay` is the game clock, profile.timeOfDay (game minutes since midnight); `fuel` profile.fuel (litres);
  // `energy` profile.energy (0..1), `tired` and `exhausted` whether it is below tables.energy's thresholds.
  // `serviceOffer` is what the service spot the truck stands still in the zone of sells, [{ id, price }] with id 'fuel'
  // or 'snack' at a petrol station and 'meal' at the restaurant, each only while it would add something (empty
  // elsewhere and while a stop runs), replaced only when it changes; `service` the running stop bought with
  // buyService(), { id, price, progress 0..1 }, or null. `lastTow` ({ station (spot id), fee }) is replaced on
  // every tow.
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
    junctionRule: null,
    speedLimit: tables.speedLimit,
    street: '',
    serviceOffer: [],
    service: null,
    lastTow: null,
    get garageAvailable() {
      return truck.speed === 0 && !state.order;
    },
    get timeOfDay() {
      return state.profile.timeOfDay;
    },
    get fuel() {
      return state.profile.fuel;
    },
    get energy() {
      return state.profile.energy;
    },
    get tired() {
      return state.profile.energy < tables.energy.tired;
    },
    get exhausted() {
      return state.profile.energy < tables.energy.exhausted;
    },
  };
  let v = upgradedVehicle();
  updateRank();
  let clock = 0; // s of Sim time, drives the light cycles
  let nextOfferId = 1;
  let reversing = false;
  let brakeHold = 0; // s the brake has been held at a standstill
  const felt = { gas: 0, steer: 0, brake: 0 }; // the input as the driver applies it (see feel())
  let redLine = null; // the light whose stop line the front last crossed forwards, if it was red then (see checkRedLight)
  const lineBack = lt.stopLine - tables.city.obstacles.signal.inset; // m from a stop line on to its junction (see osm.js)
  let routeKey = ''; // edge segment, on or off the road, and target the current route was found for
  let offersEdge = null; // edge the current offers were made on; their expected times count from there
  let limitEdge = null; // edge whose limit and name state.speedLimit and state.street show (see updateLimit)
  let speedingFined = -Infinity; // clock at the last speeding fine
  const traffic = map ? createTraffic(tables, map, random) : null;
  let contacts = new Map(); // id of each AI car the truck is in contact with → who made it: 'car' or 'truck'
  if (traffic) state.traffic = traffic.cars;
  // map.colliders in a spatial cell index by their bounds, so fits() and inSight() test only those near.
  const solids = createCells(tables.city.cell);
  for (const b of map?.colliders ?? []) solids.add(b, b.minX, b.minZ, b.maxX, b.maxZ);
  // Where Reset to road may put the truck: every tables.city.resetSpacing m along each edge, the headings the road
  // leaves that point by (on a one-way, only its own), its lane's offset from the centre line, and whether the point
  // lies in a junction (a truck there would reach into the box of a node with three or more arms), where AI cars would
  // wait for it.
  const roadPoints = [];
  for (const e of map?.graph.edges ?? []) {
    const { resetSpacing: spacing } = tables.city;
    const junction = (n, along) => along < map.graph.nodes[n].radius + base.length / 2 && map.graph.nodes[n].arms.length >= 3;
    const toward = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
    for (let i = 0; i <= Math.ceil(e.length / spacing - 1e-9); i++) {
      const s = Math.min(i * spacing, e.length);
      const k = e.at.findLastIndex((a) => a <= s + 1e-6); // the edge's point at or before s
      const onPoint = s - e.at[k] < 1e-6;
      const headings = [];
      if (k < e.points.length - 1) headings.push(toward(e.points[k], e.points[k + 1]));
      else if (e.oneWay) headings.push(toward(e.points[k - 1], e.points[k])); // a one-way's end, the way it came in
      if (!e.oneWay && (!onPoint || k > 0)) headings.push(toward(e.points[onPoint ? k : k + 1], e.points[onPoint ? k - 1 : k]));
      const lane = e.oneWay ? 0 : e.laneOffset;
      roadPoints.push({ ...map.graph.pointAt(e, s), headings, lane, junction: junction(e.from, s) || junction(e.to, e.length - s) });
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

  function step(dt, controls) {
    clock += dt;
    const p = state.profile;
    p.timeOfDay = (p.timeOfDay + dt * tables.clock.minutesPerSecond) % (24 * 60);
    p.timePlayed += dt;
    const speedBefore = Math.abs(truck.speed);
    updateLights();
    const stopped = Math.abs(truck.speed) < v.stopSpeed;
    if (!stopped) p.energy = Math.max(0, p.energy - dt / tables.energy.drive);
    const input = feel(controls, dt);

    // Reverse: a brake hold at a standstill engages it; a stop with the brake released ends it. Both read the pedal
    // itself, so an exhausted driver's lagging brake never engages it after a stop.
    if (reversing) {
      if (stopped && controls.brake === 0) reversing = false;
    } else {
      brakeHold = stopped && controls.brake > 0 && controls.gas === 0 ? brakeHold + dt : 0;
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
    if (p.fuel <= 0) drive = 0; // out of fuel: it coasts
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
    const frontBefore = front();
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
    checkRedLight(frontBefore, front()); // before touchCars, which may stop the truck
    if (traffic) touchCars(met, before, pushed);
    damageCargo(shed > o.hardBrake * dt ? shed : 0, hit);
    const moved = Math.hypot(truck.x - x, truck.z - z);
    p.distance += moved;
    burn(moved, reversing ? input.brake : input.gas);
    updateTraffic(dt);
    state.policeSees = policeSees(); // checkRedLight reads it a step later: the same car poses, the truck a step back
    if (map) state.junctionRule = junctionAhead();
    if (map) checkGiveWay(dt);
    if (map) checkStop();

    // The body leans out of the turn with lateral acceleration, more when heavier.
    const lean = yawRate * truck.speed * v.rollPerAccel * (truck.mass / 1000);
    truck.roll = Math.max(-v.maxRoll, Math.min(v.maxRoll, lean));

    if (state.order) {
      state.order.elapsed += dt;
      loadOrUnload(dt);
    }
    const here = map ? map.graph.nearest(truck.x, truck.z) : null;
    if (here) updateLimit(here);
    if (map) checkSpeeding();
    if (!state.order && state.offers.length && here.edge !== offersEdge) state.offers = []; // the panel asks again
    serve(dt);
    // Loading and unloading need no fuel, so a dry truck in its order's zone finishes them first.
    const canFill = state.service || state.serviceOffer.some((s) => s.id === 'fuel' && s.price <= p.money);
    if (map && p.fuel <= 0 && Math.abs(truck.speed) < v.stopSpeed && !canFill && state.progress === 0) tow();

    updateRoute(here);
  }

  // The controls as the driver applies them: as they are, but exhausted the steering and brake move towards them at a
  // limited rate, slower the lower the energy (tables.energy.lag).
  function feel(controls, dt) {
    const { exhausted, lag } = tables.energy;
    felt.gas = controls.gas;
    if (!state.exhausted) {
      felt.steer = controls.steer;
      felt.brake = controls.brake;
      return felt;
    }
    const most = (lag[0] + ((lag[1] - lag[0]) * state.profile.energy) / exhausted) * dt;
    const toward = (from, to) => from + Math.max(-most, Math.min(most, to - from));
    felt.steer = toward(felt.steer, controls.steer);
    felt.brake = toward(felt.brake, controls.brake);
    return felt;
  }

  // Burns the fuel for `metres` driven with the driving pedal at `pedal` (see tables.fuel).
  function burn(metres, pedal) {
    const f = tables.fuel;
    const cargo = (truck.mass - v.emptyMass) / 1000;
    const litres = (metres / 1000) * f.perKm * (1 + f.perTonne * cargo) * (1 + f.perPedal * pedal);
    state.profile.fuel = Math.max(0, state.profile.fuel - litres);
  }

  // At a service spot: standing still in its zone offers its services, a petrol station a fill-up for the missing
  // litres and a snack, the restaurant a meal; a bought stop fills `progress` while the truck stands there, and charges
  // the price and gives what it sells when done. Moving ends it unpaid.
  const stations = map?.spots.filter((s) => s.station) ?? [];
  const servicePlaces = map?.spots.filter((s) => s.station || s.restaurant) ?? [];
  const { snack, meal } = tables.energy;
  const stopTime = { fuel: tables.fuel.fillTime, snack: snack.time, meal: meal.time };
  function serve(dt) {
    const p = state.profile;
    const still = Math.abs(truck.speed) < v.stopSpeed;
    const at = still ? servicePlaces.find((s) => inZone(s.zone)) : undefined;
    const service = state.service;
    if (service && !at) state.service = null;
    else if (service) service.progress = Math.min(1, service.progress + dt / stopTime[service.id]);
    if (service?.progress === 1) {
      p.money = Math.max(0, p.money - service.price);
      if (service.id === 'fuel') p.fuel = tables.fuel.tank;
      else p.energy = service.id === 'meal' ? 1 : Math.min(1, p.energy + snack.restore);
      state.service = null;
    }
    const offer = [];
    if (at && !state.service) {
      if (at.station && tables.fuel.tank - p.fuel >= 1) offer.push({ id: 'fuel', price: Math.ceil((tables.fuel.tank - p.fuel) * tables.fuel.price) });
      if (at.station && p.energy < 1) offer.push({ id: 'snack', price: snack.price });
      if (at.restaurant && p.energy < 1) offer.push({ id: 'meal', price: meal.price });
    }
    const same = offer.length === state.serviceOffer.length && offer.every((s, i) => s.id === state.serviceOffer[i].id && s.price === state.serviceOffer[i].price);
    if (!same) state.serviceOffer = offer;
  }

  // Out of fuel and standing: a tow takes the truck to the petrol station nearest by road (the nearest in a straight line,
  // where none leads to one: the Colle Oppio streets aren't joined to the rest), in its kerb lane, for tables.fuel.towFee (money never drops below 0), and puts the clock on by
  // tables.fuel.towTime and tables.fuel.emergency litres in the tank. Not while it could fill up where it stands.
  function tow() {
    const p = state.profile;
    const f = tables.fuel;
    const here = map.graph.nearest(truck.x, truck.z);
    const onRoad = here.d <= here.edge.width / 2;
    const straight = (s) => 1e9 + Math.hypot(s.lane.x - truck.x, s.lane.z - truck.z); // after any reachable one
    const by = stations.map((s) => ({ s, length: routeFrom(here, onRoad, s.pose)?.length ?? straight(s) }));
    const to = by.sort((a, b) => a.length - b.length)[0]?.s;
    const fee = Math.min(p.money, f.towFee);
    p.money -= fee;
    p.timeOfDay = (p.timeOfDay + f.towTime) % (24 * 60);
    p.fuel = f.emergency;
    if (to) place(to.lane);
    state.lastTow = { station: to?.id ?? null, fee };
  }

  // Loaded fragile cargo takes damage from speed shed by hard braking (m/s) and from each new hit faster than a touch;
  // the Fahrwerk slows both.
  function damageCargo(braked, hit) {
    const order = state.order;
    if (!order?.cargo.fragile || order.phase !== 'dropoff') return;
    const harm = o.brakeDamage * braked + (hit ? o.hitDamage : 0);
    order.damage = Math.min(1, order.damage + harm * (levelOf('suspension')?.factor ?? 1));
  }

  // Junction n runs `junctionOffset` s ahead of junction n - 1; a light's `axis` 1 (the second street's) runs half
  // a cycle behind axis 0.
  const cycleTime = (l) => (clock + l.junction * lt.junctionOffset + (l.axis * cycle) / 2) % cycle;
  function updateLights() {
    for (const l of state.lights) {
      const t = cycleTime(l);
      const phase = t < lt.green ? 'green' : t < lt.green + lt.amber ? 'amber' : t < cycle - lt.redAmber ? 'red' : 'redAmber';
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

  // Middle of the truck's front bumper.
  function front() {
    const half = v.length / 2;
    return { x: truck.x + Math.sin(truck.heading) * half, z: truck.z + Math.cos(truck.heading) * half };
  }

  // The front entering a light junction, driving forwards, on red past its first tables.lights.redGrace s, having
  // crossed that light's stop line on red too, costs a fine if the police see it; red and amber, before green, never.
  // Over the line and stopped before the junction is free, and so is clearing the junction after crossing the line on
  // green or amber. Reversing over a line is manoeuvring (backing out of a box or into a bay), and its front bumper is
  // the last part to cross anyway.
  function checkRedLight(from, to) {
    if (truck.speed <= 0) return;
    for (const l of state.lights) {
      if (Math.abs((to.x - l.x) * l.dz - (to.z - l.z) * l.dx) >= l.half) continue; // not on its road
      const along = (p) => (p.x - l.x) * l.dx + (p.z - l.z) * l.dz; // ahead of the line
      const crosses = (at) => along(from) < at && along(to) >= at;
      if (crosses(0)) redLine = l.phase === 'red' ? l : null;
      if (!crosses(lineBack)) continue;
      const graced = cycleTime(l) < lt.green + lt.amber + lt.redGrace;
      if (redLine === l && l.phase === 'red' && !graced && state.policeSees) fine('redLight');
      redLine = null;
    }
  }

  // Whether a police car is within tables.police.radius of the truck with no building on the line from it to the
  // truck's centre or to the middle of its front bumper (a car on the cross street sees the cab come out at a junction).
  // shortcut: the lines are sampled every 0.5 m, so one clipping a building's corner by under 0.5 m is clear, and the
  // truck's rear corners don't count; upgrade to the footprint if players notice.
  function policeSees() {
    for (const c of state.traffic) {
      if (!c.police || (truck.x - c.x) ** 2 + (truck.z - c.z) ** 2 > tables.police.radius ** 2) continue;
      const front = { x: truck.x + (Math.sin(truck.heading) * v.length) / 2, z: truck.z + (Math.cos(truck.heading) * v.length) / 2 };
      if (inSight(c, truck) || inSight(c, front)) return true;
    }
    return false;
  }

  // Whether no building (a spot's included) stands on the line from a to b, sampled every 0.5 m.
  let [px, pz] = [0, 0]; // the sample blocks() tests, kept here so the test allocates nothing
  const blocks = (c) =>
    (c.kind === 'building' || c.kind === 'spot') && px > c.minX && px < c.maxX && pz > c.minZ && pz < c.maxZ && inside(px, pz, c.points);
  function inSight(a, b) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5);
    for (let i = 1; i < n; i++) {
      [px, pz] = [a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n];
      if (solids.some(px, pz, px, pz, blocks)) return false;
    }
    return true;
  }

  // The rule at junction n (a node of three or more arms; null for any other) for the truck coming in by `edge`:
  // 'light'; 'giveWay' when another arm cars come in by ranks higher (tables.traffic.priority, as the AI cars go), 'stop'
  // if the truck's arm is a stop approach too (osm.js);
  // 'priority' when none does, one ranks lower and none of the same rank comes in from the right (45°–135° round, as
  // traffic.js has it); else 'rightBeforeLeft'.
  const lit = new Set(map?.lights.map((l) => l.node));
  const rank = (e) => tables.traffic.priority[e.class] ?? 0;
  const fromRight = (a, b) => {
    const turn = Math.atan2(Math.sin(a.angle - b.angle), Math.cos(a.angle - b.angle));
    return turn > Math.PI / 4 && turn < (3 * Math.PI) / 4;
  };
  function ruleOf(n, edge) {
    const { slots } = map.graph.nodes[n];
    if (slots.length < 3) return null;
    if (lit.has(n)) return 'light';
    const own = slots.find((s) => s.edge === edge);
    let lower = false;
    let right = false;
    for (const s of slots) {
      if (s === own) continue;
      if (rank(s.edge) < rank(edge)) lower = true;
      else if (s.in && rank(s.edge) > rank(edge)) return own?.stop ? 'stop' : 'giveWay';
      else if (s.in && own) right ||= fromRight(own, s);
    }
    return lower && !right ? 'priority' : 'rightBeforeLeft';
  }

  // The rule of the next junction along the edge the truck's leading bumper is on (backwards when reversing), its bumper
  // in it or within tables.signs.hint m of its box (see ruleOf); null if the edge ends otherwise or the truck isn't on
  // the road or along it within 45°. Sets `boxNode`.
  let approachNode = -1; // the junction the leading bumper last drove towards along an edge, and that edge
  let approachEdge = null;
  let approachShort = Infinity; // m from the leading bumper to approachNode's box
  let boxNode = -1; // the junction whose box the leading bumper is in, -1 for none
  function junctionAhead() {
    const back = truck.speed < -v.stopSpeed ? -1 : 1;
    const fx = Math.sin(truck.heading) * back;
    const fz = Math.cos(truck.heading) * back;
    const [x, z] = [truck.x + (fx * v.length) / 2, truck.z + (fz * v.length) / 2];
    const { nodes } = map.graph;
    boxNode = -1;
    // In a junction's box, that junction's whatever the heading, for the edge the truck came in by: near its middle the
    // nearest edge is the cross street.
    const { edge } = map.graph.nearest(x, z, true);
    for (const n of edge ? [edge.from, edge.to] : []) {
      if (nodes[n].arms.length < 3 || Math.hypot(nodes[n].x - x, nodes[n].z - z) >= nodes[n].radius) continue;
      boxNode = n;
      return ruleOf(n, n === approachNode ? approachEdge : edge);
    }
    const on = map.graph.along(x, z, fx, fz);
    if (!on) return null;
    approachNode = on.next;
    approachEdge = on.edge;
    approachShort = on.ahead - nodes[on.next].radius;
    return approachShort <= tables.signs.hint ? ruleOf(on.next, on.edge) : null;
  }

  // Driving towards a junction on an approach that gives way, the cars with priority there are `owed`: those coming in by
  // an arm of higher rank, or in the junction from one, each with its speed a step ago. Once the truck drives forwards
  // within tables.giveWay.near m of the junction's box or in it, and for tables.giveWay.within s after, one of them
  // shedding more than tables.giveWay.hardBrake m/s² costs a fine if the police see it, once per junction (the cars
  // brake as the truck's footprint meets the box, a little before its front bumper does).
  // shortcut: only cars at that one node count, not ones coming in by another node of a crossing of several; upgrade if a
  // forced brake there goes unfined in play.
  let owed = [];
  let owedUntil = -Infinity; // clock at which the owed cars stop counting
  let settled = false; // whether one of them has braked hard since the truck came near
  let owedNode = -1; // the junction they are owed at
  function checkGiveWay(dt) {
    const { hardBrake, near, within } = tables.giveWay;
    const giving = truck.speed > -v.stopSpeed && (state.junctionRule === 'giveWay' || state.junctionRule === 'stop'); // junctionAhead() looked ahead
    // Only while driving in: a truck waiting at the line has given way.
    if (giving && truck.speed > v.stopSpeed && (boxNode >= 0 || approachShort <= near)) owedUntil = clock + within;
    for (const o of owed) {
      if (!settled && clock <= owedUntil && dt > 0 && o.speed - o.car.speed > hardBrake * dt) {
        if (state.policeSees) fine('giveWay');
        settled = true;
      }
      o.speed = o.car.speed;
    }
    if (giving && boxNode < 0) {
      if (approachNode !== owedNode) [owedNode, owedUntil, settled] = [approachNode, -Infinity, false];
      const higher = (e) => rank(e) > rank(approachEdge);
      const comes = ({ lane: p }) => (p.kind === 'run' ? p.to === approachNode && higher(p.edge) : p.node === approachNode && higher(p.in.edge));
      owed = state.traffic.filter(comes).map((car) => ({ car, speed: car.speed }));
    } else if (clock > owedUntil) {
      owed = [];
      settled = false;
    }
  }

  // At a stop approach the truck must stand still with its front bumper within tables.stopSign.reach m of the junction's
  // box before it drives in; driving in forwards without costs a fine if the police see it, once per pass.
  let stoppedAt = -1; // the stop junction the truck has stood at, or been fined at, on this pass
  function checkStop() {
    if (state.junctionRule !== 'stop') return void (stoppedAt = -1);
    if (boxNode < 0) {
      if (approachNode !== stoppedAt) stoppedAt = -1;
      if (Math.abs(truck.speed) <= v.stopSpeed && approachShort <= tables.stopSign.reach) stoppedAt = approachNode;
    } else if (boxNode !== stoppedAt && truck.speed > v.stopSpeed) {
      if (state.policeSees) fine('stopSign');
      stoppedAt = boxNode;
    }
  }

  // The limit and name of the edge the truck is on: it keeps the one it has while it stays within that edge's width (its end
  // included), so a side street's centre line, nearer inside a junction, doesn't take over; past it, the nearest road's.
  function updateLimit(here) {
    if (limitEdge && map.graph.project(limitEdge, truck.x, truck.z).d <= limitEdge.width / 2) return;
    if (here.d > here.edge.width / 2) return;
    limitEdge = here.edge;
    state.speedLimit = limitEdge.limit;
    state.street = limitEdge.name;
  }

  // Driving faster than the limit by more than tables.speeding.tolerance costs a fine if the police see it, then none
  // for tables.speeding.cooldown s.
  function checkSpeeding() {
    const { tolerance, cooldown } = tables.speeding;
    if (Math.abs(truck.speed) * 3.6 <= state.speedLimit + tolerance || !state.policeSees || clock - speedingFined < cooldown) return;
    fine('speeding');
    speedingFined = clock;
  }

  // Takes a fine (tables.fines) from the money, never below 0; the unpaid rest is dropped, so `lastFine` holds
  // the amount actually taken.
  function fine(reason) {
    const amount = Math.min(state.profile.money, tables.fines[reason]);
    state.profile.money -= amount;
    state.lastFine = { reason, amount };
  }

  // Finds the route again only when the target changes or the truck moves: on the road onto another segment of an
  // edge, off it into another index cell (tables.city.cell), as the best join changes with every move there.
  // `here` is the truck's nearest graph pose, if the step already has it.
  function updateRoute(here) {
    const order = state.order;
    if (!order) {
      state.route = [];
      routeKey = '';
      return;
    }
    const target = targetOf(order);
    here ??= map.graph.nearest(truck.x, truck.z);
    const onRoad = here.d <= here.edge.width / 2;
    const { cell } = tables.city;
    const key = onRoad ? `${here.edge.id},${here.k},${target.id}` : `off,${Math.floor(truck.x / cell)},${Math.floor(truck.z / cell)},${target.id}`;
    if (key === routeKey) return;
    routeKey = key;
    state.route = routeFrom(here, onRoad, target.pose)?.points ?? [];
  }

  // The truck's shortest legal road route ({ length (m), points }) to the graph pose `to`, from `here`, its nearest graph
  // pose; where none leads there (the truck may drive against one-ways, into streets that only lead out of the map), the
  // shortest against them; null where no road leads there at all. On the road it runs from `here`, its first point (the
  // truck's own) left out. Off it, it joins the road where straight across plus on by road is shortest, along a line
  // clear of buildings, and starts at that join.
  function routeFrom(here, onRoad, to) {
    return wayFrom(here, onRoad, map.graph.towards(to)) ?? wayFrom(here, onRoad, map.graph.towards(to, false));
  }
  function wayFrom(here, onRoad, way) {
    if (onRoad) {
      const r = way(here);
      return r && { length: r.length, points: r.points.slice(1) };
    }
    const joins = map.graph.edges
      .map((e) => map.graph.project(e, truck.x, truck.z))
      .map((p) => ({ p, r: way(p) }))
      .filter(({ r }) => r)
      .sort((a, b) => a.p.d + a.r.length - (b.p.d + b.r.length));
    const join = joins.find(({ p }) => inSight(truck, p));
    return join ? { length: join.p.d + join.r.length, points: join.r.points } : null;
  }

  const inZone = (zone) => truck.x > zone.minX && truck.x < zone.maxX && truck.z > zone.minZ && truck.z < zone.maxZ;

  // Standing still in the active phase's zone fills `progress`; anything else resets it.
  function loadOrUnload(dt) {
    const order = state.order;
    state.progress = inZone(targetOf(order).zone) && Math.abs(truck.speed) < v.stopSpeed ? state.progress + dt / o.loadTime : 0;
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
      const docked = to.dock && reversedInto(to.bay);
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

  // Whether the truck stands reversed into a dock's bay (spot.bay: the middle of its dock edge and the heading a docked
  // truck faces): facing out of it, on its centre line, and with the middle of its rear at the dock edge.
  function reversedInto({ x, z, heading }) {
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const turn = truck.heading - heading;
    const [dx, dz] = [truck.x - x, truck.z - z];
    const rear = (dx - (Math.sin(truck.heading) * v.length) / 2) * fx + (dz - (Math.cos(truck.heading) * v.length) / 2) * fz;
    return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) <= o.dockHeading && Math.abs(dx * fz - dz * fx) <= o.dockCentre && Math.abs(rear) <= o.dockDepth;
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

  // Starts a stop for one of state.serviceOffer's services (see serve()); paid when it completes. Returns { ok, reason };
  // a refusal changes nothing.
  function buyService(id) {
    if (Math.abs(truck.speed) >= v.stopSpeed) return refuse('moving');
    const offer = state.serviceOffer.find((s) => s.id === id);
    if (!offer) return refuse(state.service ? 'busy' : 'unknown');
    if (state.profile.money < offer.price) return refuse('noMoney');
    state.service = { id, price: offer.price, progress: 0 };
    state.serviceOffer = [];
    return OK;
  }

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

  // New offers between distinct spots, paid by the road route length; none while an order is active. Service spots
  // are never a pickup or a drop-off.
  // Cargo is only what the Ladefläche carries, and cargo and drop-off make an offer type the rank tier allows.
  // The expected time is the truck's route to the pickup plus the paid route, at reference speed, plus loading,
  // unloading and slack.
  function requestOffers() {
    state.offers = [];
    const places = map.spots.filter((s) => !s.station && !s.restaurant);
    if (state.order || places.length < 2) return state.offers;
    const here = map.graph.nearest(truck.x, truck.z);
    offersEdge = here.edge;
    const maxCargo = levelOf('cargoBed')?.maxCargo ?? o.maxCargo;
    const cargoes = o.cargo.filter((c) => c.weight <= maxCargo && o.types[typeOf(c)] <= state.rank.tier);
    for (let i = 0; i < o.offerCount; i++) {
      const cargo = pick(cargoes);
      const from = pick(places);
      const to = pick(places.filter((s) => s !== from && o.types[typeOf(cargo, s)] <= state.rank.tier));
      const path = to && map.graph.route(from.pose, to.pose);
      if (!path) continue; // a spot cut off from the road network gets no orders, nor one with no drop-off allowed
      const distance = path.length;
      const pay = Math.round(o.basePay + (o.payPerKm * distance) / 1000);
      const toPickup = routeFrom(here, here.d <= here.edge.width / 2, from.pose)?.length ?? 0;
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

  // Puts the truck on the nearest free lane pose of the road points, facing along the road, at a standstill in first
  // gear. In a junction, where AI cars would wait for it, only when no other pose is free.
  function resetToRoad() {
    const poses = roadPoints.map((p) => ({ pose: lanePose(p), junction: p.junction }));
    const away = ({ pose: p }) => (p.x - truck.x) ** 2 + (p.z - truck.z) ** 2;
    poses.sort((a, b) => a.junction - b.junction || away(a) - away(b));
    const free = ({ pose: p }) => fits(p) && !traffic?.touching(corners(p)).length;
    place((poses.find(free) ?? poses[0]).pose);
  }

  // Puts the truck at `pose`, at a standstill in first gear.
  function place(pose) {
    Object.assign(truck, pose, { speed: 0, gear: 1, rpm: v.idleRpm, roll: 0 });
    reversing = false;
    brakeHold = 0;
    redLine = null;
    owed = [];
    settled = false;
    stoppedAt = -1;
    updateRoute();
  }

  // At a road point, in the right-hand lane, where the AI cars drive (`lane` m right of the centre line), heading the
  // way the road leaves the point that needs the smallest turn.
  function lanePose({ x, z, headings, lane }) {
    const pose = { x, z, heading: truck.heading };
    let smallest = Infinity;
    for (const heading of headings) {
      const turn = Math.abs(Math.atan2(Math.sin(heading - truck.heading), Math.cos(heading - truck.heading)));
      if (turn < smallest) [pose.heading, smallest] = [heading, turn];
    }
    pose.x -= Math.cos(pose.heading) * lane; // right is (-cos heading, sin heading)
    pose.z += Math.sin(pose.heading) * lane;
    return pose;
  }

  // Whether the truck's footprint at `pose` stays inside the map and clear of every collider. Runs every step,
  // so it tests only the colliders indexed in the cells under the footprint's bounding box.
  function fits(pose) {
    if (!map) return true;
    const cs = corners(pose);
    const minX = Math.min(cs[0].x, cs[1].x, cs[2].x, cs[3].x);
    const maxX = Math.max(cs[0].x, cs[1].x, cs[2].x, cs[3].x);
    const minZ = Math.min(cs[0].z, cs[1].z, cs[2].z, cs[3].z);
    const maxZ = Math.max(cs[0].z, cs[1].z, cs[2].z, cs[3].z);
    const { bounds } = map;
    if (minX < bounds.minX || minZ < bounds.minZ || maxX > bounds.maxX || maxZ > bounds.maxZ) return false;
    // Bounding boxes apart (touching included) can't overlap; this skips most candidates cheaply.
    return !solids.some(minX, minZ, maxX, maxZ, (b) => !(b.minX >= maxX || b.maxX <= minX || b.minZ >= maxZ || b.maxZ <= minZ) && overlaps(pose, b));
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

  // Whether the truck's box at `pose` overlaps collider b's outline (`points`, any simple polygon, turned any way):
  // a side of the outline reaches into the box, or the box lies wholly inside it. Touching isn't overlapping.
  function overlaps({ x, z, heading }, b) {
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const [l, w] = [v.length / 2, v.width / 2];
    const p = b.points;
    for (let i = 0; i < p.length; i++) {
      // The side's ends in the truck's frame: m ahead of its centre and right of it.
      const [a, c] = [p[i], p[(i + 1) % p.length]];
      const [a1, r1] = [(a.x - x) * fx + (a.z - z) * fz, -(a.x - x) * fz + (a.z - z) * fx];
      const [a2, r2] = [(c.x - x) * fx + (c.z - z) * fz, -(c.x - x) * fz + (c.z - z) * fx];
      if (Math.min(a1, a2) >= l || Math.max(a1, a2) <= -l || Math.min(r1, r2) >= w || Math.max(r1, r2) <= -w) continue;
      // Separating-axis test on the side's normal, the one axis the box's own two leave.
      const [na, nr] = [r1 - r2, a2 - a1];
      if (Math.abs(na * a1 + nr * r1) < l * Math.abs(na) + w * Math.abs(nr)) return true;
    }
    return inside(x, z, p);
  }

  updateLights();
  if (map) {
    // A new game starts at the map's start pose (its start spot's), else on the road nearest the middle of the city.
    Object.assign(truck, map.start ?? { x: (map.bounds.minX + map.bounds.maxX) / 2, z: (map.bounds.minZ + map.bounds.maxZ) / 2 });
    if (!map.start || !fits(truck)) resetToRoad();
    updateTraffic(0);
    state.policeSees = policeSees();
    state.junctionRule = junctionAhead();
    updateLimit(map.graph.nearest(truck.x, truck.z));
  }

  return { state, step, resetToRoad, requestOffers, acceptOrder, buyUpgrade, buyVisual, equipVisual, owns, buyService };
}

// Whether (x, z) lies inside the polygon `points` (even–odd rule).
export function inside(x, z, points) {
  let odd = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = [points[i], points[j]];
    if (a.z > z !== b.z > z && x < a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z)) odd = !odd;
  }
  return odd;
}
