// Headless game simulation. Must not import Three.js or touch the DOM.
// Heading 0 faces +z; forward is (sin heading, cos heading) in the x/z plane.

export function createSim(tables) {
  const v = tables.vehicle;
  const truck = { x: 0, z: 0, heading: 0, speed: 0 };
  const state = { truck }; // read-only for callers: only step() and Sim commands change it

  function step(dt, input) {
    // Engine pull fades to zero at top speed.
    truck.speed += input.gas * v.engineAccel * (1 - truck.speed / v.topSpeed) * dt;
    // shortcut: brake only stops, never reverses; #4 adds reverse after a brake hold.
    truck.speed = Math.max(0, truck.speed - (input.brake * v.brakeDecel + v.rollingDecel) * dt);
    // Bicycle model; positive steer turns right, which lowers the heading.
    truck.heading -= (truck.speed / v.wheelbase) * Math.tan(input.steer * v.maxSteerAngle) * dt;
    truck.x += Math.sin(truck.heading) * truck.speed * dt;
    truck.z += Math.cos(truck.heading) * truck.speed * dt;
  }

  return { state, step };
}
