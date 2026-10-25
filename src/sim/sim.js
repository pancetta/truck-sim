// Headless game simulation. Must not import Three.js or touch the DOM.
// Heading 0 faces +z; forward is (sin heading, cos heading) in the x/z plane.

import { DIRS } from './map.js';

const G = 9.81; // m/s²

// `map` comes from parseMap(); without one the truck drives on an open plane with nothing to hit
// (and resetToRoad() has nowhere to go).
export function createSim(tables, map) {
  const v = tables.vehicle;
  // speed is signed (negative is reverse); gear is 'R', 'N' or 1..n; roll > 0 leans the body right.
  const truck = { x: 0, z: 0, heading: 0, speed: 0, mass: v.emptyMass, gear: 'N', rpm: v.idleRpm, roll: 0 };
  const state = { truck, collision: false }; // read-only for callers: only step() and Sim commands change it
  let reversing = false;
  let brakeHold = 0; // s the brake has been held at a standstill

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
    truck.heading += yawRate * dt;
    truck.x += Math.sin(truck.heading) * truck.speed * dt;
    truck.z += Math.cos(truck.heading) * truck.speed * dt;

    // Solid stop, no damage: undo the move that hit something. Reverse backs a stuck truck off.
    state.collision = !fits(truck);
    if (state.collision) Object.assign(truck, { x, z, heading, speed: 0 });

    // The body leans out of the turn with lateral acceleration, more when heavier.
    const lean = yawRate * truck.speed * v.rollPerAccel * (truck.mass / 1000);
    truck.roll = Math.max(-v.maxRoll, Math.min(v.maxRoll, lean));
  }

  // Puts the truck on the nearest free road tile, facing along the road, at a standstill in first gear.
  function resetToRoad() {
    const poses = map.roads.map(roadPose);
    const away = (p) => (p.x - truck.x) ** 2 + (p.z - truck.z) ** 2;
    poses.sort((a, b) => away(a) - away(b));
    Object.assign(truck, poses.find(fits) ?? poses[0], { speed: 0, gear: 1, rpm: v.idleRpm, roll: 0 });
    reversing = false;
    brakeHold = 0;
  }

  // Tile centre, heading towards the road neighbour that needs the smallest turn.
  function roadPose({ col, row }) {
    const pose = { x: (col + 0.5) * map.tileSize, z: (row + 0.5) * map.tileSize, heading: truck.heading };
    let smallest = Infinity;
    for (const [dc, dr] of DIRS) {
      if (!map.isRoad(col + dc, row + dr)) continue;
      const heading = Math.atan2(dc, dr);
      const turn = Math.abs(Math.atan2(Math.sin(heading - truck.heading), Math.cos(heading - truck.heading)));
      if (turn < smallest) [pose.heading, smallest] = [heading, turn];
    }
    return pose;
  }

  // Whether the truck's footprint at `pose` stays inside the map and clear of every collider.
  function fits(pose) {
    if (!map) return true;
    const cs = corners(pose);
    const [w, h] = [map.cols * map.tileSize, map.rows * map.tileSize];
    if (!cs.every((c) => c.x >= 0 && c.x <= w && c.z >= 0 && c.z <= h)) return false;
    return !map.colliders.some((b) => overlaps(pose, cs, b));
  }

  // Footprint corners; right is (-cos heading, sin heading).
  function corners({ x, z, heading }) {
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const [l, w] = [v.length / 2, v.width / 2];
    return [[l, w], [l, -w], [-l, -w], [-l, w]].map(([a, b]) => ({ x: x + fx * a - fz * b, z: z + fz * a + fx * b }));
  }

  // Separating-axis test of the truck's box against an axis-aligned box; touching isn't overlapping.
  function overlaps({ x, z, heading }, cs, b) {
    if (cs.every((c) => c.x <= b.minX) || cs.every((c) => c.x >= b.maxX)) return false;
    if (cs.every((c) => c.z <= b.minZ) || cs.every((c) => c.z >= b.maxZ)) return false;
    const [fx, fz] = [Math.sin(heading), Math.cos(heading)];
    const [l, w] = [v.length / 2, v.width / 2];
    const bc = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.maxX, b.maxZ], [b.minX, b.maxZ]];
    const along = bc.map(([px, pz]) => (px - x) * fx + (pz - z) * fz);
    const right = bc.map(([px, pz]) => -(px - x) * fz + (pz - z) * fx);
    if (along.every((a) => a >= l) || along.every((a) => a <= -l)) return false;
    return !(right.every((r) => r >= w) || right.every((r) => r <= -w));
  }

  if (map) {
    // Start parked on the road nearest the middle of the city.
    Object.assign(truck, { x: (map.cols * map.tileSize) / 2, z: (map.rows * map.tileSize) / 2 });
    resetToRoad();
  }

  return { state, step, resetToRoad };
}
