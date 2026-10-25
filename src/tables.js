// All tunables live here (see spec #1: "Tables").

export const vehicle = {
  engineAccel: 2.0, // m/s² at full gas from standstill
  topSpeed: 22, // m/s (~80 km/h)
  brakeDecel: 6.0, // m/s² at full brake
  rollingDecel: 0.3, // m/s² when coasting
  wheelbase: 5.0, // m
  maxSteerAngle: 0.6, // rad, front wheels at full lock
};

export const controls = {
  wheelLock: 180, // degrees of on-screen wheel turn for full steering
  wheelCentreTime: 0.5, // s for the released wheel to return from full lock to centre
};

export const loop = {
  step: 1 / 60, // s, fixed Sim timestep
  maxFrame: 0.25, // s; longer frames (e.g. after a stall) are cut so the Sim doesn't fast-forward
};

export const camera = {
  chaseDistance: 14, // m behind the truck
  chaseHeight: 6, // m above the ground
  lookHeight: 2, // m above the truck's position the camera aims at
};

export const palette = {
  light: 0xffffff,
  sky: 0x9fd3e6,
  ground: 0x7fb069,
  grid: 0x5e8c4a,
  truckBody: 0xe8c547,
  truckCab: 0xd1495b,
};
