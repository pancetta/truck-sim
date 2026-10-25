// All tunables live here (see spec #1: "Tables").

export const vehicle = {
  engineAccel: 2.0, // m/s² at full gas from standstill
  topSpeed: 22, // m/s (~80 km/h)
  brakeDecel: 6.0, // m/s² at full brake
  rollingDecel: 0.3, // m/s² when coasting
  wheelbase: 5.0, // m
  maxSteerAngle: 0.6, // rad, front wheels at full lock
};
