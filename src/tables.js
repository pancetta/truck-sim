// All tunables live here (see spec #1: "Tables").

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
  paidNoticeTime: 3, // s the payment confirmation stays on screen
  cargo: [
    { name: 'Paletten', weight: 6 }, // t
    { name: 'Getränke', weight: 10 },
    { name: 'Möbel', weight: 4 },
    { name: 'Stahl', weight: 14 },
  ],
};

export const city = {
  tileSize: 14, // m per ASCII map tile; road width
  kerbGap: 0.3, // m between a parked car or pole and the kerb
  obstacles: {
    car: { length: 4.5, width: 1.9, height: 1.5 }, // m
    pole: { length: 0.3, width: 0.3, height: 4 }, // m
  },
  buildingHeight: [6, 24], // m, lowest and highest; the renderer picks per tile
};

export const controls = {
  wheelLock: 180, // degrees of on-screen wheel turn for full steering
  wheelCentreTime: 0.5, // s for the released wheel to return from full lock to centre
  hubRadius: 0.25, // fraction of the wheel radius where drags don't steer
};

export const loop = {
  step: 1 / 60, // s, fixed Sim timestep
  maxFrame: 0.25, // s; longer frames (e.g. after a stall) are cut so the Sim doesn't fast-forward
};

export const camera = {
  chaseDistance: 14, // m behind the truck
  chaseHeight: 6, // m above the ground
  lookHeight: 2, // m above the truck's position the camera aims at
  cabEye: [0.55, 2.45, 2.75], // driver's eye in truck space (x left, y up, z forward), m
  cabLook: [0.55, 0, 20], // point in truck space the cab camera aims at: the road ahead
};

export const lighting = {
  ambient: 1.2, // hemisphere light intensity
  sun: 1.5, // directional light intensity
};

export const palette = {
  light: 0xffffff,
  sky: 0x9fd3e6,
  ground: 0x7fb069,
  road: 0x5a5f66,
  building: 0xd9cbb4,
  spot: 0x4f86c6,
  zone: 0x8fc1f0,
  pickup: 0x6cc551, // active order's zone marker
  dropoff: 0xf08a4b,
  car: 0x3d6b8c,
  pole: 0x2e2e2e,
  truckBody: 0xe8c547,
  truckCab: 0xd1495b,
  dashboard: 0x3b4252,
  steeringWheel: 0x1f232b,
};
