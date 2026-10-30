// All tunables live here (see spec #1: "Tables").
import { strings } from './strings.js';

// The Vehicles (#88) the player can own, by id (names in strings.fleet). The truck is the starter, which every profile
// owns; the others are bought in the Werkstatt from Rank tier `rank` for `price` €. Each drives by its own constants;
// `maxCargo` (t) is the heaviest cargo offered to it without a Ladefläche upgrade (heavier is a 'heavy' offer), `tank`
// the litres it holds and `thirst` scales tables.fuel.perKm. The renderer draws the truck from the kit and the others
// from code (vehicles.js `body`, painted `paint`); `cab` (m, x left, y up, z forward) moves the cab interior
// (cab.js) and camera.cabEye from where they sit in the truck, and `rearEye` is the reversing camera's place (see
// camera.rearEye). `looks`: the Werkstatt's visual items fit it (only the truck's, spec #76).
const truck = {
  rank: 0,
  price: 0,
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
  // Up to this many times first gear's (or reverse's) force pulling away uphill, so the heaviest loads start on a
  // 12 % street (#105); never more than the slope pulls back, so the flat is unchanged.
  hillStart: 3.5,
  hillHold: 2, // s a standstill holds after the brake is let go, before it rolls on a slope
  // rad; the most the ground across a street rolls a Vehicle (or its trailer): over Monti's steepest street, 22 %
  // across, as the streets are drawn on the ground (#106) and the wheels must stay on them
  maxBank: 0.22,
  wheelbase: 5.0, // m
  maxSteerAngle: 0.6, // rad, front wheels at full lock when standing
  steerFadeSpeed: 8, // m/s at which the steering lock is halved
  rollPerAccel: 0.0025, // rad of body roll per m/s² of lateral acceleration, per tonne of mass
  maxRoll: 0.12, // rad
  length: 8, // m, footprint for collisions, centred on the truck's position
  width: 2.5, // m
  maxCargo: 10, // t
  tank: 400, // l
  thirst: 1,
  cab: [0, 0, 0],
  rearEye: [0, 3.6, -3.95],
  looks: true,
};
export const fleet = {
  truck,
  // Quicker, lighter, smaller loads: a high-roof panel van with a car-like engine and gearbox.
  van: {
    ...truck,
    rank: 1,
    price: 5000,
    emptyMass: 2800,
    torqueCurve: [
      [800, 160],
      [1500, 330],
      [2800, 330],
      [3800, 220],
      [4200, 0],
    ],
    idleRpm: 800,
    gearRatios: [17, 10, 6.6, 4.8, 3.7, 3],
    reverseRatio: 17,
    upshiftRpm: 3300,
    downshiftRpm: 1500,
    wheelRadius: 0.34,
    brakeForce: 21000,
    drag: 1.6,
    wheelbase: 3.7,
    steerFadeSpeed: 10,
    rollPerAccel: 0.006,
    maxRoll: 0.1,
    length: 5.6,
    width: 2.05,
    maxCargo: 5,
    tank: 150,
    thirst: 0.35,
    cab: [0, -0.3, -1.1],
    rearEye: [0, 2.45, -2.75],
    looks: false,
    // Side profile from the rear (x, y in m), as tables.vehicles.types: tall box, short bonnet, sliding door.
    body: {
      body: [[0, 0.4], [0, 2.45], [0.08, 2.55], [4.2, 2.55], [4.55, 2.3], [5.0, 1.35], [5.5, 1.05], [5.6, 0.45]],
      glass: [[4.0, 1.4], [4.0, 2.2], [4.5, 2.2], [4.95, 1.4]],
      axles: [1.0, 4.65], wheel: 0.34, pillar: null, doors: [[2.6, 3.9], [3.95, 4.85]],
    },
    paint: 0xe9e6dc,
  },
  // The Dreirad (#89): a small three-wheeler with a cab up front and a box behind, the only Vehicle narrow enough for
  // the pedestrian edges' bollard gates (osm.gate). Light, slow, nimble; light loads only.
  dreirad: {
    ...truck,
    rank: 2,
    price: 3500,
    emptyMass: 450,
    torqueCurve: [
      [1000, 18],
      [2000, 28],
      [3000, 28],
      [3800, 18],
      [4200, 0],
    ],
    idleRpm: 1000,
    gearRatios: [22, 13, 8.5, 5.8],
    reverseRatio: 22,
    upshiftRpm: 3300,
    downshiftRpm: 1500,
    wheelRadius: 0.24,
    brakeForce: 4000,
    rollingResistance: 0.015,
    drag: 0.6,
    wheelbase: 1.95,
    steerFadeSpeed: 9,
    rollPerAccel: 0.03,
    maxRoll: 0.1,
    length: 3.2,
    width: 1.4,
    maxCargo: 0.7,
    tank: 25,
    thirst: 0.12,
    cab: [-0.55, -0.65, -0.8], // the driver sits in the middle
    rearEye: [0, 1.7, -1.5],
    looks: false,
    // Side profile from the rear, as the van's; `trike`: one front wheel, in the middle.
    body: {
      body: [[0, 0.4], [0, 1.6], [0.05, 1.65], [1.85, 1.65], [1.95, 1.75], [2.7, 1.75], [2.95, 1.5], [3.15, 0.9], [3.2, 0.38]],
      glass: [[2.45, 1.05], [2.45, 1.6], [2.75, 1.6], [3.0, 1.05]],
      axles: [0.6, 2.85], wheel: 0.24, pillar: null, doors: [[2.0, 2.6]], trike: true,
    },
    paint: 0x5f8fae,
  },
  // The Schwerlaster (#90): a four-axle box lorry, heavy, wide and slow to turn, for big loads; the only Vehicle that
  // carries a Schwertransport (orders.schwertransport). Longer than a map's dock bays (osm.bayLength), it gets no dock
  // offers there.
  lorry: {
    ...truck,
    rank: 3,
    price: 15000,
    emptyMass: 14000,
    torqueCurve: [
      [600, 600],
      [1000, 1100],
      [1600, 1100],
      [2100, 700],
      [2300, 0],
    ],
    gearRatios: [24, 16, 11, 7.8, 5.6, 4.2],
    reverseRatio: 24,
    upshiftRpm: 1800,
    downshiftRpm: 950,
    wheelRadius: 0.52,
    brakeForce: 90000,
    drag: 6,
    wheelbase: 6.2,
    maxSteerAngle: 0.62,
    steerFadeSpeed: 6,
    length: 12,
    width: 2.55,
    maxCargo: 26, // the lightest Schwertransport; the Ladefläche takes it to the heavier ones
    tank: 600,
    thirst: 1.6,
    cab: [0, 0.15, 2],
    rearEye: [0, 3.9, -5.95],
    looks: false,
    // Side profile from the rear, as the van's: a tall box, a gap, and a flat-fronted cab over two front axles.
    body: {
      body: [[0, 0.4], [0, 3.95], [0.08, 4.0], [8.6, 4.0], [8.75, 3.45], [11.2, 3.45], [11.75, 3.1], [12, 1.7], [12, 0.4]],
      glass: [[10.4, 2.05], [10.4, 3.2], [11.25, 3.2], [11.75, 2.2]],
      axles: [1.7, 3.05, 8.9, 10.3], wheel: 0.52, pillar: null, doors: [[9.9, 11.1]],
    },
    paint: 0xb8452f,
  },
};

export const orders = {
  offerCount: 3, // offers per request
  loadTime: 2, // s standing still in a zone to load or unload
  basePay: 200, // € per delivery
  payPerKm: 150, // € per km of road route from pickup to drop-off
  paidNoticeTime: 4, // s the payment confirmation stays on screen
  storyNoticeTime: 10, // s a Story chain's notice stays, long enough to read its Client's line
  // Time bonus: a share of the pay (base + distance) that shrinks from timeBonus at once to 0 at the expected time.
  timeBonus: 0.5,
  referenceSpeed: 7, // m/s along the road route, for an offer's expected time
  slack: 20, // s added to the expected time, for lights and parking
  // Routes start the way the truck faces and come round the block (#99), unless that is more than `extra` m or `factor`
  // times longer than turning; to a target behind it on its own one-way, turning is backing up, at most `backUp` m.
  turn: { extra: 300, factor: 2, backUp: 30 },
  // Cargo kinds (a cargo's `kind`; names, meters and twist lines in strings.cargoKinds). Once loaded, cargo of a kind
  // takes damage (0..1): `spoil` per the drop's expected time (see requestOffers()) loaded, and, scaled by the Fahrwerk
  // factor, `brake` per m/s of speed shed braking harder than hardBrake, `speedUp` per m/s gained speeding up harder than
  // hardAccel, `turn` per m/s of sideways speed turned away cornering harder than hardTurn, and `hit` per new hit. Its `premium`, a share of the pay, is lost in
  // proportion. Spoiling isn't rough driving, so only the others' damage costs the clean Star (rank.cleanDamage).
  // A kind's cargo is offered from rank tier `tier` on. The pedals are on or off, so a loaded truck's brake is always
  // hard, and so is its gas in first gear: damage goes by the speed braked away or gained, so every start costs a little
  // and a careful drive of live cargo, with a start at the pickup and two stops on the way, stays under cleanDamage.
  kinds: {
    fragile: { tier: 1, premium: 0.4, spoil: 0, brake: 0.005, speedUp: 0, turn: 0, hit: 0.2 }, // tier as types.fragile
    perishable: { tier: 1, premium: 0.5, spoil: 0.5, brake: 0, speedUp: 0, turn: 0, hit: 0 }, // gone at twice the expected time
    delicate: { tier: 2, premium: 0.5, spoil: 0, brake: 0.005, speedUp: 0, turn: 0.005, hit: 0.2 },
    live: { tier: 2, premium: 0.4, spoil: 0, brake: 0.005, speedUp: 0.003, turn: 0, hit: 0 }, // a truck's start ~0.008, a van's ~0.015
  },
  hardBrake: 2.5, // m/s² of deceleration; coasting stays well below. A full stop from 50 km/h sheds 14 m/s
  hardAccel: 2, // m/s²; the loaded truck in first gear, a van in its first two
  hardTurn: 2.5, // m/s² sideways; a 15 m radius corner at 25 km/h is 3.2
  hitSpeed: 1.5, // m/s; slower touches, e.g. while manoeuvring, do no damage
  // Dock bonus: a share of the pay when unloading at a dock (osm.docks) ends with the truck reversed into the
  // bay, facing out of it within dockHeading, centred on it within dockCentre and its rear within dockDepth.
  dockBonus: 0.25,
  dockHeading: 0.2, // rad (~11°)
  dockCentre: 1, // m either side of the bay's centre line; the painted bay lines show it
  dockDepth: 1, // m from the middle of the truck's rear to the dock edge (the building face)
  nightBonus: 0.15, // share of the pay for a delivery completed at night (clock.night)
  rainBonus: 0.2, // share of the pay for a delivery completed in rain (weather): rarer than night, and harder
  // Offer types by the lowest rank tier that offers them (names and tag lines in strings.offerTypes and offerTags). From
  // its tier on, an offer is express, oversized or a round at its `shares` (drawn first, each with cargo that isn't
  // fragile, an oversized one with cargo of no kind, to drop-offs that aren't docks); otherwise the type comes from the drop-off and the cargo: dock or
  // fragileDock to a dock, else fragile if its kind is (no other kind changes the type), heavy above maxCargo, or normal.
  // An offer to or from a spot on a pedestrian edge, made only to a Vehicle narrow enough for the bollard gates, is a
  // pedestrian one (#89), never express, oversized or a round. A schwertransport (#90) is an oversized one with cargo
  // heavier than `schwertransport`, drawn at its share only where the Vehicle carries such cargo (the Schwerlaster);
  // no other offer carries it.
  types: { normal: 0, heavy: 0, fragile: 1, express: 1, dock: 2, oversized: 2, fragileDock: 3, round: 3, schwertransport: 3 },
  shares: { express: 0.2, oversized: 0.15, round: 0.15, schwertransport: 0.3 },
  schwertransport: 25, // t; over the most the truck's biggest Ladefläche carries (24 t), so only the Schwerlaster does
  roundDrops: [2, 3], // a round's number of drop-offs, one drawn per round offer
  // Factors on the expected time and the pay (base and distance). At 0.8 a 1.2 km express needs about 7.9 m/s on average,
  // a dash at the 30 km/h (8.3 m/s) limit of most streets; 0.7 would need 9.1 m/s, over it.
  express: { time: 0.8, pay: 1.5 },
  oversizedWidth: 7, // m; an oversized load's route keeps to edges this wide or wider: on Monti, off the 4 m service lanes
  cargo: [
    { name: 'Paletten', weight: 6 }, // t
    { name: 'Getränke', weight: 10 },
    { name: 'Möbel', weight: 4 },
    { name: 'Glas', weight: 5, kind: 'fragile' },
    { name: 'Elektronik', weight: 3, kind: 'fragile' },
    { name: 'Speiseeis', weight: 3, kind: 'perishable' },
    { name: 'Frischer Fisch', weight: 4, kind: 'perishable' },
    { name: 'Hochzeitstorte', weight: 1, kind: 'delicate' },
    { name: 'Glasskulptur', weight: 2, kind: 'delicate' },
    { name: 'Hühner', weight: 2, kind: 'live' },
    { name: 'Hund zum Tierarzt', weight: 1, kind: 'live' },
    { name: 'Stahl', weight: 14 },
    { name: 'Baumaschine', weight: 18 },
    { name: 'Betonteile', weight: 24 },
    // Light loads, which the Dreirad carries too (#89).
    { name: 'Pakete', weight: 0.4 },
    { name: 'Blumen', weight: 0.2 },
    { name: 'Wein', weight: 0.6, kind: 'fragile' },
    // Schwertransport loads, which only the Schwerlaster carries (#90).
    { name: 'Kranteile', weight: 26 },
    { name: 'Brückenträger', weight: 28 },
    { name: 'Transformator', weight: 30 },
  ],
};

// Stars (#81): each delivery earns ★ delivered, ★ on time (within the expected time) and ★ clean: no Rule fine and no
// Contact the truck made during the order, cargo damage at most `cleanDamage`, no zebra crossing driven through (see
// sim.js checkZebras); a dock drop-off adds a bonus ★ for reversing into the bay. Rank is the total of Stars: a tier is
// reached at its `stars` and brings `traffic` AI cars into the city. Titles are in strings.rankTitles, same order. The
// first five are #58's rank points / 10, so a v4 save keeps its tier. The economy run (scripts/economy.js) earns about
// 25 Stars an hour, more than its 15 rank points / 10 did, so the tiers come at about 0.2, 0.9, 2 and 4 h of play, and
// the ones after, which keep the busiest traffic, at about 8, 14 and 21 h.
export const rank = {
  cleanDamage: 0.1, // a hard stop from 50 km/h is about 0.07 (orders.kinds), a Hit 0.2
  tiers: [
    { stars: 0, traffic: 8 },
    { stars: 6, traffic: 9 },
    { stars: 20, traffic: 10 },
    { stars: 50, traffic: 11 },
    { stars: 100, traffic: 12 },
    { stars: 200, traffic: 12 },
    { stars: 350, traffic: 12 },
    { stars: 550, traffic: 12 },
  ].map((tier, i) => ({ ...tier, title: strings.rankTitles[i] })),
};

// Reputation (#86): what a Client, the business an order is picked up at, thinks of the driver: the Stars earned on its
// orders, per map and spot. A level is reached at its `stars` (names in strings.reputationLevels) and makes the Client's
// offers pay `pay` times as much; each request for offers adds one more from a Client of level 1 or more, an express
// one, whatever the Tier, from a level with `express`. A delivery earns 2–4 Stars, so the first clean one on time brings
// level 1, and the top one, about eight deliveries for the Client, opens its Story chain (#87).
export const reputation = {
  levels: [
    { stars: 0, pay: 1 },
    { stars: 3, pay: 1.1 },
    { stars: 8, pay: 1.2, express: true },
    { stars: 15, pay: 1.3, express: true },
    { stars: 24, pay: 1.5, express: true },
  ],
};

// Story chains (#87; texts in strings.stories by id): a Client reaching the top Reputation level, on a delivery that
// isn't a step of a chain, starts the first chain of its Kind (`client`) it hasn't started on this map. Each step is an
// Order from that Client, unlocked by delivering the one before, offered at the top of every request for offers: its
// `cargo` (as orders.cargo, whatever the Tier) to a place of Kind `to` (any place that takes orders where the map has
// none left of it), of `type` 'express' or 'round' (as many drops of that Kind as there are, up to the round's count)
// or, without one, the type its cargo and drop-off make. The last step pays the `reward`: `money` € as a pay line,
// `stars` more Stars and, optionally, a `visual` item (tables.visuals) to own. Cargo is at most 0.7 t, so the Dreirad
// takes every step too.
export const stories = [
  {
    id: 'geburtstag',
    client: 'bakery',
    steps: [
      { cargo: { name: 'Einladungskarten', weight: 0.1 }, to: 'shop', type: 'round' },
      { cargo: { name: 'Probetorte', weight: 0.5, kind: 'delicate' }, to: 'cafe' },
      { cargo: { name: 'Hundert Kerzen', weight: 0.1 }, to: 'florist', type: 'express' },
      { cargo: { name: 'Geburtstagstorte', weight: 0.6, kind: 'delicate' }, to: 'cafe' },
    ],
    reward: { money: 1500, stars: 5 },
  },
  {
    id: 'giesskanne',
    client: 'florist',
    steps: [
      { cargo: { name: 'Sonnenblumen', weight: 0.3 }, to: 'cafe' },
      { cargo: { name: 'Blumenkästen', weight: 0.6 }, to: 'shop', type: 'round' },
      { cargo: { name: 'Riesenorchidee', weight: 0.4, kind: 'delicate' }, to: 'workshop' },
      { cargo: { name: 'Siegergesteck', weight: 0.5 }, to: 'bakery', type: 'express' },
    ],
    reward: { money: 1500, stars: 5 },
  },
  {
    id: 'espressomat',
    client: 'workshop',
    steps: [
      { cargo: { name: 'Bauplan', weight: 0.1 }, to: 'cafe' },
      { cargo: { name: 'Prototyp', weight: 0.4, kind: 'fragile' }, to: 'bakery' },
      { cargo: { name: 'Espressotassen', weight: 0.3 }, to: 'shop', type: 'round' },
      { cargo: { name: 'Espressomat 3000', weight: 0.7, kind: 'delicate' }, to: 'cafe', type: 'express' },
    ],
    reward: { money: 2000, stars: 6, visual: 'chromeBumpers' },
  },
];

// Werkstatt upgrades by id (names in strings.upgrades), bought one level at a time. `rank` is the lowest
// rank tier that may buy a level. `factor` scales a constant of the current Vehicle (tables.fleet), whose own levels
// they are: motor the torque curve, brakes brakeForce, tyres steerFadeSpeed, suspension rollPerAccel and cargo damage,
// tank its tank, cargoBed its maxCargo.
// The save module drops ids not listed here.
export const upgrades = {
  motor: { levels: [{ price: 1200, rank: 0, factor: 1.15 }, { price: 3000, rank: 1, factor: 1.3 }, { price: 6000, rank: 3, factor: 1.45 }] },
  brakes: { levels: [{ price: 800, rank: 0, factor: 1.2 }, { price: 2000, rank: 1, factor: 1.4 }, { price: 4500, rank: 3, factor: 1.6 }] },
  tyres: { levels: [{ price: 800, rank: 0, factor: 1.25 }, { price: 2000, rank: 1, factor: 1.5 }, { price: 4500, rank: 3, factor: 1.8 }] },
  suspension: { levels: [{ price: 700, rank: 0, factor: 0.8 }, { price: 1800, rank: 1, factor: 0.6 }, { price: 4000, rank: 3, factor: 0.45 }] },
  cargoBed: { levels: [{ price: 1500, rank: 0, factor: 1.4 }, { price: 3500, rank: 2, factor: 1.8 }, { price: 7000, rank: 4, factor: 2.4 }] },
  tank: { levels: [{ price: 1000, rank: 0, factor: 1.25 }, { price: 2500, rank: 1, factor: 1.5 }, { price: 5000, rank: 3, factor: 1.75 }] },
};
// The trailer (Anhänger, #96): the truck's alone, bought in the Werkstatt (its first level) and upgraded level by level,
// each from Rank tier `rank` for `price` €. Hitched, the truck's cargo limit rises by the level's `capacity` t, though
// never to a Schwertransport's loads, an offer whose cargo only the trailer makes possible pays `pay` times as much, it
// gets no dock offers (the bays are too short), and it uses `thirst` times the fuel. Hitched and unhitched at Home.
// It drives kinematically (sim.js follow()): the hitch is `hitch` m behind the truck's middle (its rear bumper is at
// length / 2), the axles' middle `axle` m behind the hitch trails it, and the body (`length` × `width` m) starts `drawbar`
// m behind the hitch. Past a hitch angle of `jackknife` rad the combination stops until it is straightened; a forward
// turn at full lock settles at about 1.2. The renderer draws it `height` m tall (trailerModel.js), its reversing camera
// at `rearEye` (m from the body's middle: x left, y up, z forward; see camera.rearEye).
export const trailer = {
  levels: [{ price: 6000, rank: 2, capacity: 6 }, { price: 3500, rank: 3, capacity: 10 }, { price: 7000, rank: 4, capacity: 14 }],
  pay: 1.3,
  thirst: 1.3,
  emptyMass: 3000, // kg
  hitch: 4.3,
  drawbar: 1.4,
  axle: 5,
  length: 7,
  width: 2.5,
  jackknife: 1.4, // rad (~80°)
  height: 3.7,
  rearEye: [0, 3.55, -3.45],
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

// Each light junction runs green → amber → red → red and amber (German) for one axis while the other is red,
// then swaps, with a short all-red gap between. Junction n starts its cycle n × junctionOffset seconds ahead of junction 0.
export const lights = {
  green: 14, // s
  amber: 3, // s
  allRed: 2, // s, both axes red
  redAmber: 1, // s, red and amber lit together before green; within allRed, so the other axis is red by then
  junctionOffset: 7, // s
  redGrace: 1, // s at the start of red in which entering the junction isn't a red-light fine (see sim.js checkRedLight)
  // m from an approach's stop line back from its signal post (on the junction's near right corner), German style,
  // so the first vehicle in the queue still sees the lamps. Germany paints ~3 m, but from the cab the post would
  // then stand ~44° right, out of the view and under the minimap; at 9 m its lamps show beside the minimap at
  // tablet size (1180×820) and wider (#70).
  stopLine: 9,
};

// € per offence; money never drops below 0, the unpaid rest is dropped.
export const fines = {
  redLight: 150, // only while a police car sees the truck (see police)
  speeding: 50, // only while a police car sees the truck, at most once per `speeding.cooldown`
  collision: 150, // the truck driving into an AI car, once per contact; a car driving into the truck costs nothing
  giveWay: 150, // only while a police car sees the truck (see giveWay)
  stopSign: 150, // only while a police car sees the truck (see stopSign)
  zebra: 150, // the truck entering a zebra crossing a pedestrian is on (see zebras.brake), only while a police car sees it
  pedestrian: 200, // the truck driving onto the pavement at a pedestrian (see pedestrians.danger), only while a police car sees it
};

// The game clock (profile.timeOfDay, game minutes since midnight): a full day takes 24 real minutes. A new profile
// starts at `start`; sleeping at home wakes the driver at `wake`. Night runs from night[0] over midnight to night[1]
// (the wake time, so sleeping skips it): the headlights and street lights are on, the city has traffic.night of its AI
// cars, and a delivery pays orders.nightBonus.
export const clock = { minutesPerSecond: 1, start: 8 * 60, wake: 6 * 60, night: [20 * 60, 6 * 60] };

// The weather (state.weather, #53), not saved: clear spells `clear` s long (drawn between the two) and rain or fog spells
// `spell` s long by turns, a `fog` share of them fog, timed on profile.timePlayed from the `seed`. A spell's intensity
// ramps from 0 to 1 over `ramp` s, and back down before the next. At full rain the truck's brake force and steer fade
// speed (its grip) are `rain.grip` times theirs, and the AI cars drive at `rain.traffic` of their cruise and turn
// speeds; a delivery completed with the rain at least `rain.bonus` strong pays orders.rainBonus.
// `look` is each kind's at full intensity, blended in from clear's (renderer.js): camera.fog's range (the far plane
// too), lighting.haze, the sun's and the sky's share of their light, how far the sky turns an even grey (its horizon's
// brightness), and how wet the roads and pavements look (their colour times 1 − wet · `darken`, roughness times
// 1 − wet · `gloss`).
// Rain streaks fall in a `box` m round the camera (x, y, z), `drops` of them, `size` m wide and long, at `fall` m/s,
// `opacity` at full rain, fading out within `near` m of the camera (so none fall in the cab) and from a third of the
// box's width out to its side (so none pop in or out where they wrap round); `colour` times the sky's
// time-of-day tint (daylight()), plus `floor` so they still show at night.
export const weather = {
  seed: 53,
  clear: [6 * 60, 15 * 60],
  spell: [3 * 60, 6 * 60],
  fog: 0.35,
  ramp: 30,
  rain: { grip: 0.7, traffic: 0.8, bonus: 0.5 },
  look: {
    rain: { fog: [40, 200], haze: 0.007, sun: 0.2, sky: 0.6, grey: 0.9, wet: 1 },
    fog: { fog: [8, 110], haze: 0.018, sun: 0.25, sky: 0.9, grey: 1, wet: 0.3 },
  },
  wet: { darken: 0.4, gloss: 0.7 },
  streaks: { box: [30, 14, 30], drops: 1500, size: [0.02, 0.8], fall: 11, opacity: 0.5, near: [1.5, 4], colour: 0xc8d0d8, floor: 0.12 },
};

// The fuel tank (profile.fuel, litres) holds the Vehicle's `tank` (tables.fleet) before the Werkstatt's tank upgrade; a
// new profile starts full. The truck's full tank lasts about 4–5 average deliveries: the economy run (#58, scripts/economy.js) burns about 87 L a delivery.
export const fuel = {
  // Litres per km driven (times the Vehicle's thirst), times (1 + perTonne × tonnes of cargo) and (1 + perPedal × the driving pedal, 0..1),
  // plus perClimb uphill; a test that drives far with the real tables sets perKm and perClimb to 0, so the tank never empties.
  perKm: 40,
  perTonne: 0.02,
  perPedal: 0.5,
  perClimb: 0.05, // litres per m climbed per tonne of the Vehicle (with its trailer and cargo); downhill costs none
  low: 0.15, // share of the tank below which the HUD warns
  price: 1, // € per litre at a petrol station
  fillTime: 6, // s standing still in a petrol station's zone to fill up
  // Out of fuel, a tow takes the truck to the petrol station nearest by road: `towFee` € (money never drops below 0),
  // the clock on by `towTime` game minutes, and `emergency` litres in the tank, about one delivery's worth.
  towFee: 250,
  towTime: 60,
  emergency: 100,
};

// The driver's energy (profile.energy, 0..1); a new profile starts rested at 1. It drains only while the truck moves,
// from 1 to 0 in `drive` s; a test that drives far with the real tables sets it to Infinity, so the driver never tires.
// Below `tired` the HUD warns; below `exhausted` it warns harder and the driver's steering and brake lag the input,
// moving towards it at lag[1] per s at the exhausted threshold down to lag[0] per s at 0 (steer runs -1..1, brake 0..1).
// A petrol station's snack restores `snack.restore` of it, the restaurant's meal all of it; each is a stop of `time` s
// standing in the zone, for `price` €.
export const energy = {
  drive: 20 * 60,
  tired: 0.3,
  exhausted: 0.12,
  lag: [0.8, 3],
  snack: { restore: 0.3, price: 20, time: 4 },
  meal: { price: 60, time: 10 },
};

// A petrol station's look (renderer.js), our own: a pump island on the pavement beside its zone, as long as `island`
// [length, width, height] m, with `pumps` pumps [width, depth, height] on it, and a flat canopy on two posts over the
// pavement, `canopy` m up, reaching `reach` m out over the road's edge.
export const station = {
  island: [8, 0.9, 0.25],
  pumps: 2,
  pump: [0.7, 0.45, 1.7],
  canopy: 4.6,
  reach: 1.1,
  roof: 0.4, // m thick, the canopy's coloured fascia
};

// The restaurant's look (renderer.js), our own: an outdoor terrace on the pavement beside its zone, `terrace`
// [length, width] m (solid), with `tables` café tables [side, height] m, each under a parasol `parasol` [side, height]
// m on its pole.
export const restaurant = {
  terrace: [7, 1],
  tables: 3,
  table: [0.7, 0.75],
  parasol: [1.6, 2.3],
};

// Home's look (renderer.js), our own: on the facade at the back of the pavement beside its zone, a garage door
// [width, height] m, and a front door [width, height] m with its middle `doorAt` m on along the road from the garage's.
export const home = {
  garage: [3.6, 3],
  door: [1.1, 2.3],
  doorAt: 3.2,
};

// km/h before the truck is on a road edge (each edge has its road class's limit, tables.osm): the speedometer turns red
// above it.
export const speedLimit = 50;

// The speeding rule fine (fines.speeding): over the limit of the edge the truck is on by more than `tolerance`
// km/h while a police car sees it; at most one fine per `cooldown` s, however long the speeding lasts.
export const speeding = { tolerance: 10, cooldown: 30 };

// The give-way rule fine (fines.giveWay): the truck drives into a junction from an approach that gives way (another arm
// cars come in by ranks higher, traffic.priority), and from `near` m before the junction to `within` s after, an AI car
// that was coming in by such an arm, or was in the junction from one, sheds more than `hardBrake` m/s² of speed in a
// step while a police car sees the truck. Once per approach, seen or not.
export const giveWay = { hardBrake: 7, near: 2, within: 5 };

// Stop signs: a give-way approach becomes a stop approach where the highest arm cars come in by ranks `gap` or more
// above it (traffic.priority) and its sign stands (osm.js). AI cars come to a full stop at the line, within `line` m of
// the junction, before they give way. The truck must stand still with its front bumper within `reach` m of the
// junction before it drives in, queued behind a car there too (#111); driving in without costs fines.stopSign while a
// police car sees it, once per pass.
export const stopSign = { gap: 2, reach: 15, line: 6 };

// Road signs (map.signs, not solid), on the right-hand pavement facing the traffic (osm.js): speed limit signs where the
// limit changes and on the way in from an edge exit, give-way or stop signs on the approaches that give way (see giveWay,
// stopSign).
export const signs = {
  along: 3, // m into the street from the junction it begins at, for a speed limit sign or before it, for a give-way or stop sign
  height: 2.6, // m, middle of the plate
  radius: 0.45, // m, the plate; the red ring is the outer `ring` of it
  ring: 0.09, // m
  post: 0.08, // m square
  side: 1, // m, the give-way sign's triangle; its red border is `border` of it, measured square to each side
  border: 0.12, // m
  rim: 0.03, // m, the stop sign's white rim round its red octagon (`radius` to a corner)
  hint: 50, // m from the truck's front bumper to the next junction ahead within which the HUD shows its rule
};

// AI cars (sizes from city.obstacles.car). The lane runs `laneOffset` right of the road's centre line, so a
// car keeps clear of the parked ones (3.6 m out) and of oncoming traffic.
export const traffic = {
  laneOffset: 2.2, // m; cars cruise at the limit of the edge they are on and slow down before a slower one
  turnAccel: 4.5, // m/s² sideways round corners: a turn of radius r is taken at up to sqrt(turnAccel · r)
  accel: 2, // m/s²
  brake: 4, // m/s², planned braking for stop lines, corners and the car or truck ahead
  maxBrake: 8, // m/s²; a light that would need harder braking (it turned amber too late) is driven through
  followGap: 2.5, // m between bumpers when stopped behind a car
  // m between bumpers when stopped behind the truck or its trailer while it is slower than `truckSlow` m/s (#110): room
  // for it to back up a little and turn. Faster, the cars keep `followGap` from it, as from a car; one following it close
  // as it slows past `truckSlow` stops nearer, and backs off should it reverse
  truckGap: 6,
  truckSlow: 3,
  // A car stopped within `truckGap` of the truck backs off along its lane while the truck reverses towards it, and one
  // stopped within `followGap` of a car backing off does too, while the lane behind it is free for `gap` m: at `ease`
  // m/s for each m it is short of its gap, `speed` m/s at most
  backOff: { speed: 1.5, ease: 2, gap: 1 },
  // The safety net (#110): the truck kept from moving `time` s by AI cars (the player driving it, slower than `speed` m/s,
  // with cars within `reach` m) clears them: they back off, drive on and leave once out of the truck's view, which
  // takes in the chase camera's, `cone` rad either side of its heading
  trap: { time: 3, speed: 0.5, reach: 2, cone: 1.1 },
  stopGap: 1.5, // m from the front bumper to the stop line
  sideGap: 0.3, // m each side of a car's path that must stay clear of the car or truck ahead
  lookAhead: 35, // m; stopping from cruise at `brake` takes 24 m, plus the gaps; also the room a new car needs
  // m from an unsignalled crossing within which a car or the truck counts as arriving there, for right of way
  // (and from a light junction, for a car turning left there): more than stopping from cruise at `brake`. The
  // truck counts only for the next junction along the edge it is on.
  giveWay: 28,
  // s a truck standing at the line of an unsignalled crossing (its front bumper within `truckLine` m of it) keeps its
  // right of way, so the cars on its left wait for it to drive in or back off; after that it lets them go, so a parked
  // truck doesn't hold up the city
  truckHold: 10,
  truckLine: 6, // m
  // s a car waits at an unsignalled crossing, giving way, before the others let it go first: no one else
  // drives in, and it goes once the crossing is clear
  patience: 20,
  boxSpeed: 2, // m/s; a car or the truck slower than this just past a crossing is queued, and nobody drives in after it
  contactGap: 0.5, // m the truck must back off from a car it touched before touching it again is a new contact
  spawnDistance: [45, 150], // m from the truck, nearest and farthest, for new cars
  // rad either side of the truck's heading, ahead and behind, and of the line across it, in which no car appears or
  // leaves: the street the cameras look along and the cross street at a junction (17° holds the 7 m either side of
  // such a line from 23 m out on)
  spawnView: 0.3,
  despawnDistance: 180, // m from the truck past which a car out of view leaves
  night: 0.6, // share of the rank tier's AI cars at night (clock.night), rounded
  exitSpawn: 0.25, // share of new cars that come in by an edge exit within the spawn ring (where the map has any)
  // Priority at junctions without lights by road class, higher first; right before left between equal ones
  priority: { secondary: 3, tertiary: 2, residential: 1, unclassified: 1, service: 0 },
  // Two-wheelers (#77): AI cars of these kinds (never police cars), each a `share` of the new ones, with their own
  // footprint (`length`, `width` in m) and `accel` (m/s²); one slower than the roads' limits rides at most `top` km/h.
  // Cars behind follow them (no AI car overtakes), so the slow kinds stay few. Their look: riders.js.
  twoWheelers: {
    scooter: { share: 0.15, length: 1.9, width: 0.75, accel: 2.5 },
    bicycle: { share: 0.05, length: 1.8, width: 0.6, accel: 1, top: 18 },
  },
  // The riders' helmets (#102), bright so they show near and far; a rider's id picks one
  helmets: [0xffc61a, 0xff6a13, 0xe8202a, 0xf4f4f0, 0x7ed321, 0x22a6e8],
};

// Police cars (#68): AI cars on top of the rank tier's, which patrol the whole city and never leave it. A rule
// fine (fines.redLight) is taken only while one sees the truck: within `radius` m, with no building on the line
// between them. Their livery is our own: a generated `body` type in `paint`, a lettered `band` along each side
// and an unlit roof `lightBar` (the lettering is strings.policeLettering).
export const police = {
  count: 2,
  radius: 60, // m
  body: 'sedan', // a vehicles.types key
  paint: 0xf2f2f0,
  band: 0x1d4f91,
  lettering: 0xffffff,
  lightBar: 0x2f6fe0,
};

// Pedestrians (#78, sim/pedestrians.js): `count` of them walk the pavement lines (sim/pavements.js) at `speed` m/s,
// `keepRight` m right of the line so people meeting pass; a line keeps them `clear` m more off the road. They appear
// `spawnDistance` m from the truck (nearest, farthest) and leave past `despawnDistance`, out of its view as the AI cars
// do (traffic.spawnView). `seed` seeds their own random, so they don't change the traffic's or the offers' draws.
// Their look (people.js, #101), our own: `height` m tall for a build of scale 1, in full detail within `near` m of the
// truck. A pedestrian's id picks one of the `figures` builds by its share, scaled (kids), leaning forward by `lean` rad
// (older people) and swinging its legs and arms `stride` times as far; then one of its `wear` outfits, each a list of
// people.js PIECES ('' is bald and plain), a top in one of `outfits`, trousers (or the skirt's hem, a hat) in one of
// `trousers`, one of `skins` and hair in one of its `hairs` or the common ones. They take a step every `step` m.
export const pedestrians = {
  count: 60,
  speed: 1.3,
  keepRight: 0.3,
  clear: 0.2,
  radius: 0.3, // m round each, where they are solid to the truck
  // On the pavement (#100) one jumps aside at `jump` m/s to `room` m clear of the truck's or trailer's side, once it is
  // where the truck would be within that, or within zebras.reach plus zebras.warn s of its speed ahead of it. One the
  // moving truck comes within `danger` m of (no more than `room`, so they jump), with its nearest point over `kerb` m past
  // the road's edge or over their place, was endangered (fines.pedestrian). A truck in its lane on a 4 m service lane is
  // 0.25 m over the kerb, so `kerb` leaves it be.
  room: 0.4,
  jump: 4,
  danger: 0.4,
  kerb: 0.4,
  spawnDistance: [30, 120],
  despawnDistance: 140,
  seed: 78,
  height: 1.75,
  near: 25,
  outfits: [0x2f4f7f, 0x8a2f2f, 0x3d5a3a, 0xd8cfb8, 0x2b2d31, 0x9a7a4a, 0x6b4f7a, 0xc9ccce, 0xb8602e, 0x406a8a],
  trousers: [0x2e3a52, 0x23252a, 0x5b5e63, 0xb9a988, 0x4a3b2e, 0x39465c],
  skins: [0xf1c9a5, 0xd9a47e, 0xb07a52, 0x7d5236, 0x4f3324],
  hairs: [0x1d1a17, 0x3b2a1e, 0x5e3f25, 0x8b6a3e, 0xc8a46a, 0x7a2e1a],
  step: 0.7,
  figures: {
    man: { share: 0.36, scale: 1, lean: 0, stride: 1, wear: ['crop', 'crop jacket', 'crop jacket bag', 'crop tee', 'crop tee bare', 'crop backpack', 'hat jacket', ''] },
    woman: { share: 0.36, scale: 0.94, lean: 0, stride: 0.9, wear: ['long skirt', 'bun skirt bag', 'long bag', 'bun jacket', 'long tee bare', 'crop skirt tee bare', 'long tee backpack'] },
    kid: { share: 0.1, scale: 0.62, lean: 0, stride: 1.1, wear: ['crop tee bare backpack', 'long skirt bare', 'crop backpack', 'bun tee bare'] },
    older: { share: 0.18, scale: 0.97, lean: 0.16, stride: 0.6, hairs: [0xd8d6d0, 0xa8a49c, 0x6f6c66], wear: ['crop skirt', 'hat skirt', 'bun skirt bag', '', 'crop jacket bag'] },
  },
};

// Zebra crossings (#79). The map builder (osm.js) puts one across each arm of a light junction, and across the arm of
// a lower road class where it meets a higher one, of the `classes` here (none on one-lane service edges): `back` m out
// from the junction's mouth to the strip's middle, `depth` m deep along the road, where the arm is long enough and a
// pavement line passes both kerbs. A pedestrian walking past a kerb crosses with chance `use`, waits there until no
// vehicle is on the strip or can't stop before it (the truck at full brake, with `reach` and `warn` to spare); after
// `patience` s it walks on. The truck entering the strip while someone is on it, who set out over it while the truck
// could still have stopped at `brake` m/s² (normal braking, as hard as cargo takes, see cargo's hardBrake 2.5), is a
// break (sim.js checkZebras, #111). One on the strip as the truck comes within `reach` m of it, plus `warn` s of its
// speed, steps back, away from the truck, at `stepBack` m/s; on the strip they are solid to the truck. Its stripes
// (renderer.js) are `stripe` m wide with as much gap.
export const zebras = {
  classes: ['secondary', 'tertiary', 'residential', 'unclassified'],
  back: 3,
  depth: 4,
  use: 0.5,
  patience: 20,
  reach: 2,
  warn: 1.5,
  brake: 2.5,
  stepBack: 3,
  stripe: 0.5,
};

// Street events (#80, sim/events.js), from their own seeded schedule (`seed`): every `every` s (least, most) one more
// opens while fewer than `count` are open, its kind drawn by `weight`, lasting `duration` s (least, most). A market or
// roadworks closes an edge between two junctions whose stretch between the barriers is `minLength` m or more, has no
// spot or zebra crossing, and leaves a way round; it opens `hidden` m or more from the truck, out of its view (as the AI
// cars appear, traffic.spawnView). Its barriers go up once no car or truck is on the edge, `back` m out from each
// junction's box, `depth` m deep, across the road and its pavements. A garbage truck is an AI car of its own kind that
// appears standing in a lane, out of view, and stands there `duration` s before it drives on: car-sized (the small
// trucks of narrow old streets), at most `top` km/h, accelerating at `accel` m/s². Their look: streetEvents.js and
// riders.js.
export const events = {
  seed: 80,
  count: 2,
  every: [30, 90],
  hidden: 60,
  kinds: {
    market: { weight: 1, duration: [240, 480] },
    roadworks: { weight: 1, duration: [240, 480] },
    garbage: { weight: 2, duration: [45, 75] },
  },
  minLength: 16,
  back: 1,
  depth: 0.4,
  garbage: { top: 30, accel: 1.2 },
};

// Surprises (#85, sim.js): at most one per order, drawn from their own random (`seed`, plus the time played) when it is accepted: a
// street on the route ahead closes (a market or roadworks, see events) at `closed`, or the Client changes the drop-off at
// `dropoff`. It comes `after` s (least, most) into the drive to the last drop-off; where none fits then, it tries again
// every `retry` s until the truck is there. The closed street starts `ahead` m or more from the truck by straight line.
// On Monti only about one route in three has a street that can close (with a way round it past the one-ways), so
// `closed` is drawn three times as often as it comes: about one order in ten each.
// The new drop-off is a place like the old one (a dock for a dock, one a wide route leads to for an oversized load) at
// most `detour` m farther by road; the extra distance is paid at orders.payPerKm (the "Umweg" pay line) and added to the
// expected times at orders.referenceSpeed (an express order's shortened by orders.express.time).
export const surprises = {
  seed: 85,
  closed: 0.3,
  dropoff: 0.1,
  after: [10, 40],
  retry: 1,
  ahead: 40,
  detour: 800,
};

export const city = {
  cell: 14, // m, side of the spatial index cells the colliders and road edges are filed under
  resetSpacing: 14, // m between the road points along each edge that Reset to road picks from
  // Footprints in m.
  obstacles: {
    car: { length: 4.5, width: 1.9, height: 1.5 },
    // A traffic light's post, `inset` back from a light junction's mouth and out from the road's edge, on its near
    // right corner; closer in, right turns from the kerb lane clip it.
    signal: { width: 0.2, inset: 0.3 },
  },
  // The trees and small props (osm.js; their look is tables.streets), all solid: footprints are squares this many m
  // across.
  props: { tree: 0.5, bin: 0.6, bollard: 0.25, fountain: 0.45 },
  markerHeight: 32, // m, active zone column; above the tallest building so it shows over the roofs
  barrierHeight: 1.1, // m, across the map's edge exits
  // An edge exit's gate (renderer.js): its boom, `boom` m thick at the barrier's height, lifts while an AI car is within
  // `reach` m of the gate, taking `swing` s to go up or down.
  gate: { boom: 0.12, reach: 12, swing: 0.8 },
  wallHeight: 0.8, // m, the edge walls along the paved area's open edges
};

// The Monti map (spec #59), built from OpenStreetMap by src/sim/osm.js. The files are under public/, made by
// `npm run maps`: the roads and buildings, the street furniture (trees, bollards, fountains, waste baskets), the
// real buildings round the map for its skyline, and the ground's height grid (#104).
export const osm = {
  id: 'monti', // the map's id, which keys the profile's data of this map (Reputation)
  file: 'maps/monti.json',
  furniture: 'maps/monti-furniture.json',
  ring: 'maps/monti-ring.json',
  terrain: 'maps/monti-terrain.json',
  // The drivable network, per OSM highway class: road width (m), lane offset (m) right of the centre line on a two-way
  // edge (a one-way's lane runs on it) and speed limit (km/h); each class's priority is traffic.priority.
  classes: {
    secondary: { width: 12, lane: 3, limit: 50 },
    tertiary: { width: 10, lane: 2.5, limit: 40 },
    residential: { width: 7, lane: 1.75, limit: 30 },
    unclassified: { width: 7, lane: 1.75, limit: 30 },
    service: { width: 4, lane: 1, limit: 30 },
    // Pedestrian edges (#89): AI traffic never takes them, and a bollard gate closes each where it leaves the road. As
    // wide as they are paved (no pavements beside), and buildings are cut back to that.
    pedestrian: { width: 6, lane: 1.5, limit: 10 },
  },
  // A junction gets lights where two different streets (by name) of these classes cross: both go on through it.
  lightClasses: ['secondary', 'tertiary'],
  pavement: 1.5, // m beside each side of a road, which buildings are cut back to leave clear
  bollardSpacing: 1.5, // m between the bollards closing a pedestrian square, under every Vehicle's width
  gate: 1.9, // m clear between the middle two bollards of a pedestrian edge's bollard gate: over the Dreirad's width, under the van's
  barrier: 0.6, // m thick, the truck-only barrier across each edge exit, in from the map's edge by as much
  exitStep: 10, // m at least between the points an exit road takes from its way past the map's edge (osm.js exitRoad)
  // The paved area's open edges (sim/paved.js) get a low edge wall `wall` m thick; none where a building stands within
  // `closed` m beyond the paving, under the truck's width, or along the map's edge behind an edge exit's barrier.
  wall: 0.3,
  closed: 1,
  floors: [3, 5], // storeys of a building with no height or levels in OSM, seeded per building
  minArea: 2, // m²; smaller pieces left of a cut-back building are dropped
  // Parked cars (osm.js parkedCars) along one kerb of these classes where the width leaves room beside the lane: a
  // `density` share of the places, `gap` m apart, `kerb` m off the road's edge, `junction` m clear of junction boxes,
  // `spot` m of spot zones, and their middles `dock` m from the ends of a dock's street
  parked: { classes: ['residential', 'unclassified', 'service'], density: 0.6, gap: 1.2, kerb: 0.2, junction: 8, spot: 6, dock: 20 },
  zone: 10, // m, side of a spot's square zone
  // The spot table (the glossary's), hand-picked on the part of the network every one-way leads back into: per spot its
  // letter (`id`), its `kind` (a key of strings.spotKinds: what sort of place it is, which content refers to instead of
  // the spot, so it carries over to other maps), a made-up business name (never a real one), the real street, the OSM way it stands on with `at` m
  // along it (from the way's first point) and the `side` of the way it is on ('left' or 'right' of the way's own
  // direction). Its zone is on the kerb lane there. A dock's `bay` is [x, z, heading in degrees]: the middle of its
  // dock edge and the way a truck reversed into it faces (as the Sim's heading: 0 faces +z, 90 faces +x); its zone is
  // where that truck stands.
  // The docks are at the ends of dead-end streets, which a truck backs down from the street it passes them on.
  spots: [
    { id: 'A', kind: 'depot', name: 'Spedizioni Gatto Blu', street: 'Via Urbana', way: 189465655, at: 160, side: 'right' },
    { id: 'B', kind: 'bakery', name: 'Forno della Luna', street: 'Via dei Serpenti', way: 232940101, at: 91, side: 'right' },
    { id: 'C', kind: 'warehouse', name: 'Magazzino Ventaglio', street: 'Via San Giuseppe Labre', way: 182930018, at: 36, side: 'right', bay: [-62, -56.3, -8] },
    { id: 'D', kind: 'shop', name: 'Libreria Tre Gufi', street: 'Via in Selci', way: 23569690, at: 144, side: 'right' },
    { id: 'E', kind: 'shop', name: "Ferramenta Chiodo d'Oro", street: 'Via Giovanni Lanza', way: 189558676, at: 260, side: 'right' },
    { id: 'F', kind: 'cellar', name: 'Cantina Volpe Rossa', street: 'Via dei Ciancaleoni', way: 190639862, at: 55, side: 'right', bay: [48.2, -96, 132] },
    { id: 'G', kind: 'workshop', name: 'Tipografia Fulmine', street: 'Via Cavour', way: 189465651, at: 60, side: 'right' },
    { id: 'H', kind: 'grocer', name: 'Drogheria Mezzaluna', street: 'Via delle Vasche', way: 23327917, at: 16, side: 'right', bay: [214.2, -145.6, -124] },
    { id: 'I', kind: 'florist', name: 'Fioraio Pettirosso', street: 'Via Vittorino da Feltre', way: 50602036, at: 87, side: 'right' },
    { id: 'J', kind: 'cafe', name: 'Caffè Lanterna', street: 'Via del Colosseo', way: 42752307, at: 56, side: 'right' },
    { id: 'K', kind: 'workshop', name: 'Bottega del Rame', street: 'Via Cimarra', way: 202737280, at: 159, side: 'right' },
    { id: 'L', kind: 'shop', name: 'Tessuti Arcobaleno', street: 'Via Caprareccia', way: 113687408, at: 66, side: 'right' },
    { id: 'M', kind: 'bakery', name: 'Pasticceria Nuvola', street: 'Via degli Zingari', way: 206908813, at: 57, side: 'right' },
    // On pedestrian edges (#89): only the Dreirad gets through the bollard gates to them.
    { id: 'S', kind: 'cafe', name: 'Gelateria Tre Conchiglie', street: 'Piazza della Madonna dei Monti', way: 29702265, at: 28, side: 'right' },
    { id: 'T', kind: 'shop', name: 'Erboristeria Riccio', street: 'Via dei Quattro Cantoni', way: 23328112, at: 12, side: 'right' },
    { id: 'U', kind: 'shop', name: 'Merceria Ago Felice', street: 'Via Vittorino da Feltre', way: 24492032, at: 60, side: 'right' },
    // Petrol stations (`stations`): service spots on wide two-way streets, never an order's pickup or drop-off.
    { id: 'N', kind: 'station', name: 'Carburanti Colibrì', street: 'Via Cavour', way: 232183086, at: 50, side: 'right' },
    { id: 'O', kind: 'station', name: 'Distributore Girasole', street: 'Via Cavour', way: 232183088, at: 45, side: 'right' },
    { id: 'P', kind: 'station', name: 'Benzina Ponte Verde', street: 'Largo Corrado Ricci', way: 190022892, at: 32, side: 'right' },
    // The restaurant (`restaurant`): a service spot on a main street, never an order's pickup or drop-off.
    { id: 'Q', kind: 'trattoria', name: 'Osteria Due Lucciole', street: 'Via Panisperna', way: 23694979, at: 40, side: 'right' },
    // Home (`home`): the driver's own house and garage on a quiet street, never an order's pickup or drop-off.
    { id: 'R', kind: 'home', name: 'Casa', street: 'Via dei Capocci', way: 95509138, at: 100, side: 'right' },
  ],
  docks: ['C', 'F', 'H'], // spot ids with a loading dock
  bayLength: 10, // m of a dock bay's painted lines out from its dock edge; a longer Vehicle gets no dock offers (#90)
  stations: ['N', 'O', 'P'], // spot ids of the petrol stations
  restaurant: 'Q', // spot id of the restaurant
  home: 'R', // spot id of home, where the driver sleeps and the Werkstatt is
  start: 'R', // spot id where a new game begins, in its kerb lane facing along it
};

// Procedural buildings on the map's building outlines (buildings.js), in the style of the Monti prototype (ADR 0001).
// The same `seed` gives the same city.
export const buildings = {
  seed: 39,
  groundFloor: 4.5, // m
  floor: 3.5, // m, each upper floor
  parapet: 1, // m of wall above the top floor, with the cornice
  bay: 3.2, // m per window bay, at least
  grime: 2.5, // m of darkening at the foot of each wall, from `grimeShade` of the wall's colour at the ground
  grimeShade: 0.62,
  closedShutters: 0.3, // share of windows with their shutters closed
  chunk: 196, // m square, the pieces the city's building meshes are cut into and culled by
  detailDistance: 120, // m from the camera within which facades show their window surrounds, sills and open shutters
  nearChunk: 49, // m square, the pieces that close-up detail is cut into, within a chunk
  // Wall materials: CC0 textures from `npm run assets` (CREDITS.md), each for a `share` of the buildings, `repeat` m
  // per copy; a `tinted` one takes a colour from `tints`.
  walls: [
    { texture: 'painted_plaster_wall', share: 0.45, tinted: true, repeat: 3 },
    { texture: 'worn_plaster_wall', share: 0.45, tinted: true, repeat: 3 },
    { texture: 'red_brick_03', share: 0.1, tinted: false, repeat: 2 },
  ],
  roof: { texture: 'clay_roof_tiles_02', repeat: 3 },
  brightness: [0.85, 1.05], // each building's walls, times its tint
  tints: [0xd9a35b, 0xc8744a, 0xe3c58f, 0xe8d9b8, 0xb8573a, 0xd8a48c, 0xcf9a6a],
  stone: 0xe6dcc6, // window surrounds, sills, cornices
  plinth: 0xa39a8a,
  shutters: [0x3f5b3a, 0x4d6b45, 0x6b4a2e, 0x55603c, 0x7a5a3a],
  doors: [0x6b4a2e, 0x4f3a26, 0x3f5b3a, 0x5a2a26, 0x7a5a3a],
  rollers: [0x9a9a96, 0xb4b2ac, 0x7d7f80, 0x5f6b5a],
  signs: [0x24442f, 0x5a1f24, 0x1f2f4a, 0x2b2b2b, 0x7a5a2a], // shop signs
  // A dock's edge, as wide as the bay (dockHalf in buildings.js): a platform `depth` m deep and `edge` m high.
  dock: { depth: 0.5, edge: 1.1 },
};

// The skyline ring (skyline.js): the real buildings round the map (tables.osm.ring), outside the map's edge, which
// stays the drivable boundary. Only for the view: no colliders, no shadows. The haze (lighting.haze, camera.fog) fades
// it into the sky, and the camera draws nothing past camera.fog[1], so any of the ring further than that from the city
// never shows. Plain extrusions with a painted window picture under flat roofs in the buildings' roof texture. The
// same `seed` gives the same tints.
export const skyline = {
  seed: 42,
  floor: 3.5, // m per storey, a row of painted windows each
  bay: 3.2, // m per painted window, about
  monument: [4.5, 10], // m per painted window across and up on churches and monuments: tall arches
  tints: buildings.tints, // walls, times `brightness`
  brightness: [0.75, 1],
  stone: buildings.stone, // churches and monuments
};

export const minimap = {
  unit: 14, // m; the sizes below are in these units
  px: 3, // CSS px per unit at full size; the minimap shrinks on short screens
  truckSize: 2, // units from the truck marker's centre to its tip
  outline: 0.4, // units, truck marker outline
  routeWidth: 1, // units
  spotRadius: 2, // units
  labelSize: 4, // units, spot letter height
  streetLabel: 2.5, // units, height of a main street's name
  streetLength: 120, // m of main road a street needs to be named (squares and stubs would crowd the map)
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
  spots: ['B', 'J', 'I', 'D', 'L', 'K'], // the loop: spot ids, driven in this order along the shortest legal routes
  // The narrow streets need points close together, corners rounded to what the truck can turn (7.3 m at a crawl) and
  // crawling through them, as the lock fades with speed.
  spacing: 3, // m between the points the autopilot steers by along the loop
  dodge: 1, // m off a one-way's middle, away from its parked cars
  radius: 8.5, // m, the least turn radius its corners are rounded to
  cruiseSpeed: 12, // m/s on straights
  turnSpeed: 2, // m/s near corners and while off line
  steerGain: 2.5, // steering input per rad of heading error
  stuckTime: 2, // s at a standstill before the autopilot resets the truck to the road
  waitTime: 40, // s, the same while waiting behind an AI car (a light cycle is 38 s)
};

export const camera = {
  chaseDistance: 14, // m behind the truck
  chaseHeight: 6, // m above the ground
  // m the chase camera stands farther back and higher with the trailer hitched (#96), which reaches 12.7 m back from the
  // truck's middle and would otherwise fill the view
  trailerChase: [9, 1.5],
  chaseRise: 0.5, // m the chase camera rises per m it is pulled in before a building (see renderer.js)
  // m/s the chase camera moves in at most before a building; when the arm's line swept onto a block corner in a turn,
  // pulling it in at once jumped the view up to 2 m in one frame (#73). In a quick turn the camera can then be a few m
  // inside the building for a moment, which only leaves out that building's near wall.
  chasePullIn: 15,
  lookHeight: 2, // m above the truck's position the camera aims at
  cabEye: [0.55, 1.95, 1.55], // driver's eye in truck space (x left, y up, z forward), m; under the headliner (cab.js)
  cabLook: [0.55, 0, 20], // point in truck space the cab camera aims at: the road ahead
  gimmickLook: [0.2, 1.75, 2.35], // where it aims in the Werkstatt to show the cab gimmick
  // Reversing camera on the roof's back edge (the Vehicle's rearEye, tables.fleet), inside the footprint so it never
  // ends up in the wall it backs up to. It shows in an inset (renderer.js) while the gear is R and `rearHold` s after,
  // so stops while reversing don't make it flicker. Aimed down, at the ground `rearLook` m behind it, so the bottom of
  // the picture is straight down: at the dock the bay edge shows.
  rearLook: 2.05,
  rearFov: 70, // degrees, vertical; wide, as reversing cameras are
  rearFar: 60, // m it draws to: it looks down, and the short far plane leaves most of the city out of its draw
  rearHold: 1.5, // s
  // m: on top of the haze (lighting.haze), the view fades to the sky from the first to the second, where the
  // camera stops drawing, so the far city fades out instead of popping
  fog: [150, 350],
};

// The cab's 3D instruments (cab.js); the RPM dial ends at the rev limiter and is red from vehicle.upshiftRpm.
export const cab = {
  speedMax: 120, // km/h at the end of the speedometer's scale
  sweep: 240, // degrees of needle travel from zero to the end of a scale
  backlight: 1.4, // dial faces, needles and the gear display shine this many times their colours
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
  sunDirection: [0.555, 0.742, 0.377], // towards the noon sun: 48° up, as in the HDRI
  // Over the day (#52, the game clock): the sun turns a full circle about the vertical, rising in the morning and
  // setting in the evening, at least `lowSun` rad up; at night it is the moon, on the other side. At each key's `at`
  // (game hours) its intensity and colour and the sky's tint (background, haze and the sky's light) are as given, and
  // in between they blend linearly. Noon is the look of #37.
  lowSun: 0.18,
  day: [
    { at: 0, sun: 0.6, colour: 0x8ea6ff, sky: 0x2a3450 },
    { at: 5, sun: 0.6, colour: 0x8ea6ff, sky: 0x2a3450 },
    { at: 6.5, sun: 1.3, colour: 0xffb07a, sky: 0xc4b0a8 },
    { at: 8.5, sun: 2.9, colour: 0xffeccf, sky: 0xf2f0ec },
    { at: 12, sun: 3.2, colour: 0xfff3e0, sky: 0xffffff },
    { at: 17, sun: 2.9, colour: 0xffeccf, sky: 0xf2f0ec },
    { at: 19.5, sun: 1.3, colour: 0xff9a5c, sky: 0xc8a494 },
    { at: 21, sun: 0.6, colour: 0x8ea6ff, sky: 0x2a3450 },
  ],
  // The headlights and street lights at night (clock.night, #52) are drawn glows added on top of the scene, not lights:
  // a real light costs every fragment of every frame, all day (switching one on at dusk rebuilt every shader, a stall
  // of up to 7 s), and one headlight and three street lights took the M2's GPU from 8.0 to 11.5 ms a frame (docs/perf).
  // The truck's headlights: a glow `width` × `length` m on the road ahead of the front bumper (renderer.js), `glow` times
  // `colour` in its middle, `height` m up so it also shows on the pavements; the reversing lights' glow, in gear R, is
  // `reversing` m (width, length) behind the rear bumper. The one exception is `lamp` (#98), a spot light so the cars
  // and people ahead are lit too: `intensity` (cd) at night, 0 by day, `height` m up at the front bumper, aimed at the
  // road `aim` m ahead, `reach` its distance (m), cone half-angle (rad), penumbra and decay (three's SpotLight).
  headlights: {
    width: 11, length: 42, height: 0.2, colour: 0xfff1d8, glow: 0.4, reversing: [7, 16],
    lamp: { intensity: 25, height: 1, aim: 20, reach: [45, 0.55, 0.6, 1] },
  },
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

// Street dressing (streets.js, #40): pavements, lanterns, and the look of the trees and props (placed by the Sim,
// city.props). Sizes in m. Textures and models are CC0 from `npm run assets` (CREDITS.md).
export const streets = {
  // Raised, tables.osm.pavement m wide along the roads (roads.js). The kerb is a stone strip `kerb` wide along the
  // pavement's road edge, its face down to the road.
  // `height` is above the ground: the road surface is 3 cm up (renderer.js roadHeight), so the kerb stands 15 cm.
  pavement: { height: 0.18, texture: 'floor_pavement', repeat: 1.5, kerb: 0.15, kerbColour: 0xd8d2c4 },
  // Lanterns (Poly Haven street_lamp_02) on street-facing walls about every `spacing` m, their
  // foot `height` up. Within `near` m of the camera the full model (20k triangles), then its far copy (1.2k) up to
  // `cull`, then none; the iPad simulator only held 60 fps with these short distances (docs/perf).
  // On walls between two windows, `clear` m clear of a speed sign.
  lantern: { model: 'street_lamp_02', spacing: 24, height: 3.3, near: 8, cull: 70, clear: 3 },
  // At night (clock.night) a lantern's glass glows `glass` times `colour`, and two glows show its light (see
  // lighting.headlights): one `wall` m across on the wall, round the glass's middle `up` m above the lantern's foot, and
  // one `ground` m across on the pavement, `out` m from the wall; each `glow` times `colour` in its middle.
  lanternLight: { colour: 0xffc27a, glass: 3, up: 1.1, wall: 7, ground: 10, out: 2.5, glow: 0.6 },
  // Crossed-quad trees from pictures (`npm run assets`): species picked per tree, `size` m across, mirrored at random.
  // The Werkstatt and chase cameras keep `canopy` m from a trunk, so they don't end up inside the leaves.
  canopy: 4,
  trees: [
    { picture: 'jacaranda_tree', size: [8, 11] },
    { picture: 'tree_small_02', size: [6, 8] },
    { picture: 'searsia_lucida', size: [6, 8] },
  ],
  // Our own small props, not drawn past `propCull` m and casting no shadows (both for the iPad's frame budget): cast
  // iron and painted metal on the ground; potted plants in pairs beside a `pots` share of the doors, and
  // flower boxes on the open windows' sills of a `flowers` share of the buildings.
  propCull: 90,
  // m: a wall gets lanterns and plants where a road's edge is at most this far in front of it (most
  // stand at the pavement's back, 1.5 m from it; this takes in walls across a wider real street or a small square).
  roadReach: 8,
  pots: 0.2,
  flowers: 0.15,
  pot: { radius: 0.17, height: 0.38, colour: 0xa8573a, leaves: 0x4f7a3a },
  box: { size: [1.05, 0.16, 0.2], colour: 0x8a4f34, flowers: [0xd1495b, 0xf4ecdc, 0xe8c547, 0xc0507a, 0xd1495b, 0xf4ecdc] },
  bollard: { radius: 0.11, height: 0.9, colour: 0x4a4844 },
  bin: { radius: 0.3, height: 0.95, colour: 0x2f4a3a },
  fountain: { radius: 0.16, height: 1.15, colour: 0x3b443c, grate: 0x2a2a28 },
};

// Ground materials: CC0 PBR textures in public/textures/ from `npm run assets` (CREDITS.md), <texture>_Diffuse,
// _nor_gl and _arm.ktx2, laid out in world space, `repeat` m per copy of the texture.
export const ground = {
  road: { texture: 'asphalt_02', repeat: 4 }, // the roads
  open: { texture: 'cobblestone_square', repeat: 1.4 }, // everything else at ground level, and round the city
};

// On the terrain (drape.js), so many m off the ground where it is checked (every 2.5 m; between, up to about twice
// that): the `road` (the markings stand 1.5 cm over it), the `paving` and kerbs, and the `open` ground, which lies
// `sink` m lower so it never shows through the road. Draped, the road, paving and kerbs have at most `budget` times
// their flat triangles (the prototype's even split had 5 times).
export const drape = { road: 0.01, paving: 0.02, open: 0.05, sink: 0.1, budget: 1.75 };

// Generated cars (src/vehicles.js) for the AI cars and the parked cars, all at city.obstacles.car's footprint. Per
// body type: the side profile [x, y] in m from the rear (x = 0) to the front, the side window outline, the axles,
// the wheel radius, the B-pillar and the door spans (rear edge, front edge) for the painted panel gaps. Lengths
// are stretched so the car with its bumpers fits the footprint; the body is as wide as it less the mirrors.
export const vehicles = {
  types: {
    hatch: {
      body: [[0, 0.3], [0, 0.9], [0.1, 1.0], [0.45, 1.42], [1.2, 1.47], [2.4, 1.44], [3.0, 1.0], [3.85, 0.85], [4.0, 0.6], [3.95, 0.3]],
      glass: [[0.45, 1.02], [0.58, 1.37], [1.2, 1.41], [2.36, 1.39], [2.9, 1.02]],
      axles: [0.7, 3.25], wheel: 0.3, pillar: 1.85, doors: [[0.95, 1.85], [1.85, 2.85]],
    },
    sedan: {
      body: [[0, 0.35], [0, 0.85], [0.05, 0.95], [0.75, 1.0], [1.25, 1.4], [2.75, 1.44], [3.4, 1.0], [4.45, 0.85], [4.6, 0.6], [4.55, 0.33]],
      glass: [[1.24, 1.03], [1.45, 1.36], [2.72, 1.39], [3.32, 1.03]],
      axles: [0.85, 3.6], wheel: 0.31, pillar: 2.3, doors: [[1.3, 2.3], [2.3, 3.3]],
    },
    van: {
      body: [[0, 0.35], [0, 2.1], [0.1, 2.2], [3.9, 2.2], [4.35, 1.4], [4.95, 1.05], [5.0, 0.4]],
      glass: [[3.5, 1.4], [3.5, 1.95], [4.06, 1.95], [4.39, 1.4]],
      axles: [0.85, 4.1], wheel: 0.34, pillar: null, doors: [[2.2, 3.4], [3.45, 4.3]],
    },
  },
  paints: [0xf2f2f0, 0xc9ccce, 0x8d9196, 0x2b2d31, 0x1f2f4a, 0x7a1f24, 0x3f4a3a, 0xd8cfb8, 0xb8402e, 0xe2c547],
  near: 25, // m from the truck within which a car is drawn in full detail; the far geometry beyond
  covered: 0.25, // share of the parked cars under a cover (Poly Haven's covered_car, CREDITS.md)
};

export const palette = {
  light: 0xffffff, // minimap
  spot: 0x4f86c6, // the spots' dots on the minimap
  zone: 0x8fc1f0,
  station: 0x2f8f5b, // petrol stations: their minimap dots, zones, pumps and canopy fascia
  restaurant: 0xb5452f, // the restaurant: its minimap dot, zone and parasols
  home: 0x8a5cb8, // home: its minimap dot, zone and garage door
  pickup: 0x6cc551, // active order's zone marker
  dropoff: 0xf08a4b,
  // Colours the truck's kit model is recoloured to (see kitColours), and more.
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
  headliner: 0x8d8a84, // cab roof lining
  needle: 0xff6a2e, // instrument needles
  signal: 0x2b2d33, // traffic light pole and housing
  lampOff: 0x1f232b,
  lampRed: 0xff4a3d,
  lampAmber: 0xffb02e,
  lampGreen: 0x4ce07a,
  stopLine: 0xf4f1ea,
  chrome: 0xdfe4ea, // chrome bumpers and rims
};

// The truck's kit model (CREDITS.md) is recoloured face by face: each face takes the palette colour
// whose kit colour here is nearest to the face's colour in the kit's own colour map.
export const kitColours = {
  trim: 0x36363a,
  road: 0x686d83,
  pavement: 0xa8b0d3,
  wall: 0xe2e2ed,
  glass: 0xe4f3ff,
  green: 0x45af7e,
  red: 0xe76047,
  yellow: 0xffd02b,
  blue: 0x5f73ca,
};
