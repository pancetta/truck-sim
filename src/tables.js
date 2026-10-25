// All tunables live here (see spec #1: "Tables").
import { strings } from './strings.js';

export const vehicle = {
  emptyMass: 8000, // kg
  // Engine torque (Nm) by RPM, linear in between; zero past the last point (rev limiter,
  // also the top of the dashboard RPM gauge).
  torqueCurve: [
    [600, 350],
    [1100, 600],
    [1700, 600],
    [2300, 350],
    [2500, 0],
  ],
  idleRpm: 600,
  gearRatios: [22, 15, 10.5, 7.5, 5.5, 4.2], // overall ratio (gearbox × axle) for gears 1..n
  reverseRatio: 22,
  upshiftRpm: 2000,
  downshiftRpm: 1000,
  wheelRadius: 0.5, // m
  brakeForce: 50000, // N at full brake
  rollingResistance: 0.02, // fraction of the truck's weight
  drag: 4.2, // N per (m/s)²
  stopSpeed: 0.1, // m/s; slower than this counts as standing still
  reverseDelay: 0.5, // s of brake hold at a standstill before reverse engages
  reverseSpeed: 4, // m/s (~14 km/h) reverse cap
  wheelbase: 5.0, // m
  maxSteerAngle: 0.6, // rad, front wheels at full lock when standing
  steerFadeSpeed: 8, // m/s at which the steering lock is halved
  rollPerAccel: 0.0025, // rad of body roll per m/s² of lateral acceleration, per tonne of mass
  maxRoll: 0.12, // rad
  length: 8, // m, footprint for collisions, centred on the truck's position
  width: 2.5, // m
};

export const orders = {
  offerCount: 3, // offers per request
  loadTime: 2, // s standing still in a zone to load or unload
  basePay: 200, // € per delivery
  payPerKm: 150, // € per km of road route from pickup to drop-off
  paidNoticeTime: 4, // s the payment confirmation stays on screen
  // Time bonus: a share of the pay (base + distance) that shrinks from timeBonus at once to 0 at the expected time.
  timeBonus: 0.5,
  referenceSpeed: 7, // m/s along the road route, for an offer's expected time
  slack: 20, // s added to the expected time, for lights and parking
  // Fragile cargo, once loaded, takes damage (0..1) from braking harder than hardBrake and from each new hit,
  // both scaled by the Fahrwerk factor. The premium is a share of the pay, lost in proportion to the damage.
  // The brake pedal is on or off, so a loaded truck's brake is always hard: damage goes by the speed braked away.
  fragilePremium: 0.4,
  hardBrake: 2.5, // m/s² of deceleration; coasting stays well below
  brakeDamage: 0.005, // per m/s of speed shed while braking hard: ~0.07 for a full stop from 50 km/h
  hitDamage: 0.2, // per new collision at hitSpeed or faster
  hitSpeed: 1.5, // m/s; slower touches, e.g. while manoeuvring, do no damage
  maxCargo: 10, // t, heaviest cargo offered without a Ladefläche upgrade; heavier is a 'heavy' offer
  // Dock bonus: a share of the pay when unloading at a dock (city.docks) ends with the truck reversed into the
  // bay, facing out of it within dockHeading and centred on it within dockCentre.
  dockBonus: 0.25,
  dockHeading: 0.2, // rad (~11°)
  dockCentre: 1, // m either side of the bay's centre line; the painted bay lines show it
  // Offer types by the lowest rank tier that offers them (names in strings.offerTypes). The type comes from
  // the drop-off and the cargo: dock or fragileDock to a dock, else fragile if marked so, heavy above maxCargo, or normal.
  types: { normal: 0, heavy: 0, fragile: 1, dock: 2, fragileDock: 3 },
  cargo: [
    { name: 'Paletten', weight: 6 }, // t
    { name: 'Getränke', weight: 10 },
    { name: 'Möbel', weight: 4 },
    { name: 'Glas', weight: 5, fragile: true },
    { name: 'Elektronik', weight: 3, fragile: true },
    { name: 'Stahl', weight: 14 },
    { name: 'Baumaschine', weight: 18 },
    { name: 'Betonteile', weight: 24 },
  ],
};

// Rank points per delivery; a tier is reached at its points and brings `traffic` AI cars into the city.
// Titles are in strings.rankTitles, same order.
export const rank = {
  pointsPerDelivery: 10,
  timeBonusPoints: 10, // extra points for the full time bonus, in proportion to the share earned
  fragilePoints: 10, // extra points for an undamaged fragile delivery, less in proportion to the damage
  dockPoints: 10, // extra points for a delivery reversed into a dock bay
  tiers: [
    { points: 0, traffic: 8 },
    { points: 30, traffic: 9 },
    { points: 80, traffic: 10 },
    { points: 160, traffic: 11 },
    { points: 300, traffic: 12 },
  ].map((tier, i) => ({ ...tier, title: strings.rankTitles[i] })),
};

// Werkstatt upgrades by id (names in strings.upgrades), bought one level at a time. `rank` is the lowest
// rank tier that may buy a level. `factor` scales a base vehicle constant: motor the torque curve, brakes
// brakeForce, tyres steerFadeSpeed, suspension rollPerAccel and fragile damage. cargoBed's `maxCargo` replaces orders.maxCargo.
// The save module drops ids not listed here.
export const upgrades = {
  motor: { levels: [{ price: 1200, rank: 0, factor: 1.15 }, { price: 3000, rank: 1, factor: 1.3 }, { price: 6000, rank: 3, factor: 1.45 }] },
  brakes: { levels: [{ price: 800, rank: 0, factor: 1.2 }, { price: 2000, rank: 1, factor: 1.4 }, { price: 4500, rank: 3, factor: 1.6 }] },
  tyres: { levels: [{ price: 800, rank: 0, factor: 1.25 }, { price: 2000, rank: 1, factor: 1.5 }, { price: 4500, rank: 3, factor: 1.8 }] },
  suspension: { levels: [{ price: 700, rank: 0, factor: 0.8 }, { price: 1800, rank: 1, factor: 0.6 }, { price: 4000, rank: 3, factor: 0.45 }] },
  cargoBed: { levels: [{ price: 1500, rank: 0, maxCargo: 14 }, { price: 3500, rank: 2, maxCargo: 18 }, { price: 7000, rank: 4, maxCargo: 24 }] },
};
// Werkstatt visual items by id (names in strings.visuals, slot names in strings.visualSlots), bought with
// money and no rank. Each slot's one free item is the stock look, which everyone owns. Colours name palette
// entries. The renderer (truckLook.js) draws them; the save module drops ids not listed here.
export const visuals = {
  paintStock: { slot: 'paint', price: 0, body: 'truckBody', cab: 'truckCab' },
  paintBlue: { slot: 'paint', price: 500, body: 'blue', cab: 'wall' },
  paintGreen: { slot: 'paint', price: 500, body: 'green', cab: 'yellow' },
  paintRed: { slot: 'paint', price: 600, body: 'red', cab: 'dark' },
  paintNight: { slot: 'paint', price: 800, body: 'dark', cab: 'orange' },
  liveryNone: { slot: 'livery', price: 0 },
  liveryStripes: { slot: 'livery', price: 700, design: 'stripes', colours: ['wall', 'dark'] },
  liveryChevrons: { slot: 'livery', price: 900, design: 'chevrons', colours: ['blue'] },
  liveryChecker: { slot: 'livery', price: 1100, design: 'checker', colours: ['dark', 'wall'] },
  liveryZigzag: { slot: 'livery', price: 1000, design: 'zigzag', colours: ['orange'] },
  lightBarNone: { slot: 'lightBar', price: 0 },
  lightBarBeacons: { slot: 'lightBar', price: 900, lamp: 'lampAmber' },
  lightBarSpots: { slot: 'lightBar', price: 1200, lamp: 'wall' },
  gimmickNone: { slot: 'gimmick', price: 0 },
  gimmickDice: { slot: 'gimmick', price: 250, kind: 'dice', colour: 'red' },
  gimmickFigure: { slot: 'gimmick', price: 400, kind: 'figure', colour: 'blue' },
  rimsStock: { slot: 'rims', price: 0 },
  rimsChrome: { slot: 'rims', price: 800, colour: 'chrome' },
  rimsRed: { slot: 'rims', price: 600, colour: 'red' },
  rimsStar: { slot: 'rims', price: 1000, colour: 'wall', spokes: 5 },
  chromeNone: { slot: 'chrome', price: 0 },
  chromeBumpers: { slot: 'chrome', price: 1200 },
  chromeBullBar: { slot: 'chrome', price: 1800, bullBar: true },
};

// Each light junction runs green → amber → red for one axis while the other is red, then swaps, with a
// short all-red gap between. Junction n starts its cycle n × junctionOffset seconds ahead of junction 0.
export const lights = {
  green: 14, // s
  amber: 3, // s
  allRed: 2, // s, both axes red
  junctionOffset: 7, // s
};

// € per offence; money never drops below 0, the unpaid rest is dropped.
export const fines = {
  redLight: 100,
  collision: 150, // the truck touching an AI car, once per contact
};

// AI cars (sizes from city.obstacles.car). The lane runs `laneOffset` right of the road's centre line, so a
// car keeps clear of the parked ones (3.6 m out) and of oncoming traffic.
export const traffic = {
  laneOffset: 2.2, // m
  speed: 10, // m/s (36 km/h) cruising
  turnSpeed: 4.5, // m/s round corners
  accel: 2, // m/s²
  brake: 4, // m/s², planned braking for stop lines, corners and the car or truck ahead
  maxBrake: 8, // m/s²; a light that would need harder braking (it turned amber too late) is driven through
  followGap: 2.5, // m between bumpers when stopped behind a car or the truck
  stopGap: 1.5, // m from the front bumper to the stop line
  sideGap: 0.3, // m each side of a car's path that must stay clear of the car or truck ahead
  lookAhead: 25, // m; also the room a new car needs from the others
  // m from an unsignalled crossing within which a car or the truck counts as arriving there, for right of way
  // (and from a light junction, for a car turning left there); cars and the truck look two tiles ahead, so
  // more than ~25 m has no effect
  giveWay: 20,
  boxSpeed: 2, // m/s; a car or the truck slower than this just past a crossing is queued, and nobody drives in after it
  contactGap: 0.5, // m the truck must back off from a car it touched before touching it again is a new contact
  spawnDistance: [45, 150], // m from the truck, nearest and farthest, for new cars (never on the truck's street)
  despawnDistance: 180, // m from the truck past which a car out of view leaves
};

export const city = {
  tileSize: 14, // m per ASCII map tile; road width
  docks: ['C', 'F', 'H'], // spots with a loading dock; its bay opens onto the spot's zone
  // m; kerbGap is the space between the obstacle and the tile edge. The road models' pavement
  // is the outer 1.4 m of a road tile: poles stand on it, cars park just past it.
  obstacles: {
    car: { length: 4.5, width: 1.9, height: 1.5, kerbGap: 1.5 },
    pole: { length: 0.3, width: 0.3, height: 4, kerbGap: 0.3 },
    // A traffic light's post, `inset` from both tile edges at a light junction's corner; closer in, right
    // turns from the kerb lane clip it.
    signal: { width: 0.2, inset: 0.3 },
  },
  buildingHeight: [6, 24], // m, lowest and highest; the renderer picks per tile
  markerHeight: 32, // m, active zone column; above the tallest building so it shows over the roofs
};

export const minimap = {
  tile: 3, // CSS px per map tile at full size; the minimap shrinks on short screens
  truckSize: 2, // map tiles from the truck marker's centre to its tip
  outline: 0.4, // map tiles, truck marker outline
  routeWidth: 1, // map tiles
  spotRadius: 2, // map tiles
  labelSize: 4, // map tiles, spot letter height
  rate: 15, // Hz, redraws of the truck marker and route; roads, spots and letters are drawn once
};

export const controls = {
  wheelLock: 180, // degrees of on-screen wheel turn for full steering
  wheelCentreTime: 0.5, // s for the released wheel to return from full lock to centre
  hubRadius: 0.25, // fraction of the wheel radius where drags don't steer
};

export const loop = {
  step: 1 / 60, // s, fixed Sim timestep
  maxFrame: 0.25, // s; longer frames (e.g. after a stall) are cut for the controls
  maxSteps: 4, // Sim steps per frame at most; time beyond them (after a stall) is dropped, not simulated
};

// The dev-only ?perf harness (perf.js). ?perf&auto drives the truck round a fixed loop of streets with an order
// accepted, from a fresh profile and a seeded Sim, so runs are comparable (see docs/perf/2026-10-baseline.md).
export const perf = {
  window: 1200, // frames the overlay's medians and p95s cover (20 s at 60 Hz)
  refresh: 1, // s between overlay updates
  seed: 1, // Sim random seed under ?auto
  route: [
    // corner tiles of the loop, driven in this order
    { col: 1, row: 8 },
    { col: 57, row: 8 },
    { col: 57, row: 36 },
    { col: 1, row: 36 },
  ],
  lane: 2, // m right of the road's centre line
  cruiseSpeed: 12, // m/s on straights
  turnSpeed: 4.5, // m/s near corners and while off line
  steerGain: 2.5, // steering input per rad of heading error
  stuckTime: 2, // s at a standstill before the autopilot resets the truck to the road
};

export const camera = {
  chaseDistance: 14, // m behind the truck
  chaseHeight: 6, // m above the ground
  lookHeight: 2, // m above the truck's position the camera aims at
  cabEye: [0.55, 2.05, 1.55], // driver's eye in truck space (x left, y up, z forward), m; under the cab roof (2.33 m)
  cabLook: [0.55, 0, 20], // point in truck space the cab camera aims at: the road ahead
  gimmickLook: [0.2, 1.9, 2.35], // where it aims in the Werkstatt to show the cab gimmick
  // Reversing camera on the roof's back edge, inside the footprint so it never ends up in the wall it backs up to,
  // aimed steeply enough to show the bay right behind the rear doors.
  rearEye: [0, 3.6, -3.6],
  rearLook: [0, 0, -10],
};

// The Werkstatt's view: the camera circles the standing truck, aimed so the truck shows beside the panel.
export const showroom = {
  radius: 12, // m from the truck, pulled in before a building in the way
  wallGap: 0.5, // m the pulled-in camera keeps from the building
  armSpeed: 3, // m/s the camera eases back out once past the building
  height: 4.5, // m above the ground
  lookHeight: 1.4, // m, the point on the truck the camera aims at
  speed: 0.25, // rad/s
  shift: 0.18, // share of the screen width the picture moves left, clear of the panel
};

// The cab gimmick hangs like a damped pendulum that leans `perRoll` times the body roll.
export const gimmickSway = {
  perRoll: 5,
  frequency: 1.4, // Hz
  damping: 0.12, // share of critical damping
};

export const lighting = {
  ambient: 1.2, // hemisphere light intensity
  sun: 1.5, // directional light intensity
};

export const palette = {
  light: 0xffffff,
  sky: 0x9fd3e6,
  ground: 0x7fb069,
  shade: 0x9a948a, // light from below, on faces turned away from the sky
  spot: 0x4f86c6, // tint of the pickup and drop-off buildings
  zone: 0x8fc1f0,
  pickup: 0x6cc551, // active order's zone marker
  dropoff: 0xf08a4b,
  // Colours the kit models are recoloured to; see kitColours.
  trim: 0x2b2d33,
  dark: 0x3b4252,
  road: 0x5a5f66,
  pavement: 0xc4bcae,
  wall: 0xf4ecdc,
  glass: 0x9cc9de,
  green: 0x5e9e6e,
  red: 0xd1495b,
  orange: 0xe07a3f,
  yellow: 0xe8c547,
  blue: 0x3d6b8c,
  buildings: [0xd9cbb4, 0xe3b29a, 0xbfcfb4, 0xc9c3d6, 0xe8d9a8, 0xb8c8d4], // per-building wall tints
  truckBody: 0xe8c547,
  truckCab: 0xd1495b,
  dashboard: 0x3b4252,
  steeringWheel: 0x1f232b,
  signal: 0x2b2d33, // traffic light pole and housing
  lampOff: 0x1f232b,
  lampRed: 0xff4a3d,
  lampAmber: 0xffb02e,
  lampGreen: 0x4ce07a,
  stopLine: 0xf4f1ea,
  chrome: 0xdfe4ea, // chrome bumpers and rims
};

// The kit models (CREDITS.md) are recoloured face by face: each face takes the palette colour
// whose kit colour here is nearest to the face's colour in the kit's own colour map.
export const kitColours = {
  trim: 0x36363a,
  dark: 0x515566,
  road: 0x686d83,
  pavement: 0xa8b0d3,
  wall: 0xe2e2ed,
  glass: 0xe4f3ff,
  green: 0x45af7e,
  red: 0xe76047,
  orange: 0xd5805a,
  yellow: 0xffd02b,
  blue: 0x5f73ca,
};
