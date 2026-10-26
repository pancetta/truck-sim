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
  // bay, facing out of it within dockHeading, centred on it within dockCentre and its rear within dockDepth.
  dockBonus: 0.25,
  dockHeading: 0.2, // rad (~11°)
  dockCentre: 1, // m either side of the bay's centre line; the painted bay lines show it
  dockDepth: 1, // m from the middle of the truck's rear to the dock edge (the building face)
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
  collision: 150, // the truck driving into an AI car, once per contact; a car driving into the truck costs nothing
};

// km/h in town, everywhere: AI cars cruise at it and the speedometer turns red above it. No fine for speeding.
export const speedLimit = 50;

// Speed limit signs (map.signs, not solid): where a street begins, that is on its first tile out of a
// light junction or out of the road round the city's edge, on the right-hand pavement, facing the traffic.
export const signs = {
  along: 3, // m from the tile edge the street begins at
  inset: 0.7, // m from the kerb-side tile edge, mid-pavement
  height: 2.6, // m, middle of the plate
  radius: 0.45, // m, the plate; the red ring is the outer `ring` of it
  ring: 0.09, // m
  post: 0.08, // m square
};

// AI cars (sizes from city.obstacles.car). The lane runs `laneOffset` right of the road's centre line, so a
// car keeps clear of the parked ones (3.6 m out) and of oncoming traffic.
export const traffic = {
  laneOffset: 2.2, // m
  speed: speedLimit / 3.6, // m/s cruising, at the limit
  turnAccel: 4.5, // m/s² sideways round corners: ~4.6 m/s turning right (4.8 m radius), ~6.4 m/s left (9.2 m)
  accel: 2, // m/s²
  brake: 4, // m/s², planned braking for stop lines, corners and the car or truck ahead
  maxBrake: 8, // m/s²; a light that would need harder braking (it turned amber too late) is driven through
  followGap: 2.5, // m between bumpers when stopped behind a car or the truck
  stopGap: 1.5, // m from the front bumper to the stop line
  sideGap: 0.3, // m each side of a car's path that must stay clear of the car or truck ahead
  lookAhead: 35, // m; stopping from cruise at `brake` takes 24 m, plus the gaps; also the room a new car needs
  // m from an unsignalled crossing within which a car or the truck counts as arriving there, for right of way
  // (and from a light junction, for a car turning left there): more than stopping from cruise at `brake`. The
  // truck looks two tiles ahead, so more than ~28 m has no effect for it.
  giveWay: 28,
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
  markerHeight: 32, // m, active zone column; above the tallest building so it shows over the roofs
};

// Procedural buildings on the building tiles (buildings.js), in the style of the Monti prototype (ADR 0001). Each run
// of building tiles along a street is a row of buildings one tile deep, cut at random widths; a spot's tile is always
// a building of its own. The same `seed` gives the same city.
export const buildings = {
  seed: 39,
  width: [8, 18], // m along the street; the widest must be at least twice the narrowest
  floors: [2, 6], // storeys, ground floor included
  groundFloor: 4.5, // m
  floor: 3.5, // m, each upper floor
  parapet: 1, // m of wall above the top floor, with the cornice
  bay: 3.2, // m per window bay, at least
  grime: 2.5, // m of darkening at the foot of each wall, from `grimeShade` of the wall's colour at the ground
  grimeShade: 0.62,
  closedShutters: 0.3, // share of windows with their shutters closed
  chunk: 196, // m square, the pieces the city's building meshes are cut into and culled by
  detailDistance: 120, // m from the camera within which facades show their window surrounds, sills and open shutters
  // Wall materials: CC0 textures from `npm run assets` (CREDITS.md), each for a `share` of the buildings, `repeat` m
  // per copy; a `tinted` one takes a colour from `tints`.
  walls: [
    { texture: 'painted_plaster_wall', share: 0.45, tinted: true, repeat: 3 },
    { texture: 'worn_plaster_wall', share: 0.45, tinted: true, repeat: 3 },
    { texture: 'red_brick_03', share: 0.1, tinted: false, repeat: 2 },
  ],
  roof: { texture: 'clay_roof_tiles_02', repeat: 3 },
  brightness: [0.85, 1.05], // each building's walls, times its tint
  spotTint: 0.15, // a spot's building is plastered in palette.spot, this share of the way to white
  tints: [0xd9a35b, 0xc8744a, 0xe3c58f, 0xe8d9b8, 0xb8573a, 0xd8a48c, 0xcf9a6a],
  stone: 0xe6dcc6, // window surrounds, sills, cornices
  plinth: 0xa39a8a,
  shutters: [0x3f5b3a, 0x4d6b45, 0x6b4a2e, 0x55603c, 0x7a5a3a],
  doors: [0x6b4a2e, 0x4f3a26, 0x3f5b3a, 0x5a2a26, 0x7a5a3a],
  rollers: [0x9a9a96, 0xb4b2ac, 0x7d7f80, 0x5f6b5a],
  signs: [0x24442f, 0x5a1f24, 0x1f2f4a, 0x2b2b2b, 0x7a5a2a], // shop signs; spots' signs and awnings are palette.spot
  // A dock's opening in its building's face, as wide as the bay (dockHalf in buildings.js): `height` m tall, `depth` m
  // deep, its floor the dock edge (`edge` m high), its back a roller door.
  dock: { height: 3.8, depth: 0.5, edge: 1.1, door: 0x8a8d8f },
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

// Adaptive pixel ratio (resolution.js), judged from the frame intervals; the ?perf overlay shows the current ratio.
export const resolution = {
  touchStart: 1.5, // ratio on touch screens (pointer: coarse); elsewhere the screen's own ratio, capped at max
  min: 1.25, // min and max are capped at the screen's own ratio
  max: 2,
  step: 0.25,
  interval: 3, // s per window of frames judged together by their mean interval
  // ms; the 60 Hz budget is 16.7. Unloaded, Safari in the iPad simulator averages 16.7–16.9 at any ratio.
  downMean: 18, // a window with a longer mean steps down
  upMean: 17.2, // a window with at most this mean counts towards a step up
  upWindows: 2, // such windows in a row before a step up; doubled when that step up has to be taken back
  maxUpWindows: 32,
  maxFrame: 50, // ms; longer intervals (a stall, a pause, a hidden tab) count as this long
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
  waitTime: 40, // s, the same while waiting behind an AI car (a light cycle is 38 s)
};

export const camera = {
  chaseDistance: 14, // m behind the truck
  chaseHeight: 6, // m above the ground
  chaseRise: 0.5, // m the chase camera rises per m it is pulled in before a building (see renderer.js)
  lookHeight: 2, // m above the truck's position the camera aims at
  cabEye: [0.55, 2.05, 1.55], // driver's eye in truck space (x left, y up, z forward), m; under the cab roof (2.33 m)
  cabLook: [0.55, 0, 20], // point in truck space the cab camera aims at: the road ahead
  gimmickLook: [0.2, 1.9, 2.35], // where it aims in the Werkstatt to show the cab gimmick
  // Reversing camera on the roof's back edge, inside the footprint so it never ends up in the wall it backs up to.
  // It shows in an inset (renderer.js) while the gear is R and `rearHold` s after, so stops while reversing don't
  // make it flicker. Aimed down so the bottom of the picture is straight down: at the dock the bay edge shows.
  rearEye: [0, 3.6, -3.95],
  rearLook: [0, 0, -6],
  rearFov: 70, // degrees, vertical; wide, as reversing cameras are
  rearFar: 60, // m it draws to: it looks down, and the short far plane leaves most of the city out of its draw
  rearHold: 1.5, // s
  // m: on top of the haze (lighting.haze), the view fades to the sky from the first to the second, where the
  // camera stops drawing, so the far city fades out instead of popping
  fog: [150, 350],
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

// Sun and sky (renderer.js). The sky is a CC0 HDRI in public/textures/ from `npm run assets` (CREDITS.md): the
// background, and the light from all around. The sun stands where the HDRI's sun is, so shadows fall away from it.
export const lighting = {
  sky: 'kloofendal_48d_partly_cloudy_puresky_2k.ktx2',
  skyFirst: 'kloofendal_48d_partly_cloudy_puresky_1k.ktx2', // smaller, so the first frame waits less; stays the light
  skyLight: 0.35, // intensity of the sky's light
  exposure: 1, // ACES filmic tone mapping
  sun: 3.2, // directional light intensity
  sunColour: 0xfff3e0,
  sunDirection: [0.555, 0.742, 0.377], // towards the sun: 48° up, as in the HDRI
  lampGlow: 1.5, // traffic light lamps and light bars shine this many times their palette colour
  // Sky-coloured haze, exponential squared, per m; camera.fog fades the rest to the sky at the far plane.
  haze: 0.0022,
  shadow: {
    mapSize: 2048, // texels square
    extent: 60, // m from the shadow area's centre to its sides, across the sun's view
    ahead: 30, // m ahead of the camera, along its view on the ground, where the shadow area is centred
    bias: -0.0004,
    normalBias: 0.05, // m
  },
};

// Ground materials: CC0 PBR textures in public/textures/ from `npm run assets` (CREDITS.md), <texture>_Diffuse,
// _nor_gl and _arm.ktx2, laid out in world space, `repeat` m per copy of the texture.
export const ground = {
  road: { texture: 'asphalt_02', repeat: 4 }, // road tiles
  open: { texture: 'cobblestone_square', repeat: 1.4 }, // everything else at ground level: open tiles and round the city
};

export const palette = {
  light: 0xffffff, // minimap
  ground: 0x7fb069, // minimap
  spot: 0x4f86c6, // the spots' signs and awnings, and their dots on the minimap
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
