// Headless game simulation. Must not import Three.js or touch the DOM.
// Heading 0 faces +z; forward is (sin heading, cos heading) in the x/z plane.

const G = 9.81; // m/s²

export function createSim(tables) {
  const v = tables.vehicle;
  // speed is signed (negative is reverse); gear is 'R', 'N' or 1..n; roll > 0 leans the body right.
  const truck = { x: 0, z: 0, heading: 0, speed: 0, mass: v.emptyMass, gear: 'N', rpm: v.idleRpm, roll: 0 };
  const state = { truck }; // read-only for callers: only step() and Sim commands change it
  let reversing = false;
  let brakeHold = 0; // s the brake has been held at a standstill

  // Engine RPM in a gear at the current speed, never below idle.
  function rpmIn(gear) {
    const ratio = gear === 'R' ? v.reverseRatio : v.gearRatios[gear - 1];
    return Math.max(v.idleRpm, (Math.abs(truck.speed) * ratio * 60) / (2 * Math.PI * v.wheelRadius));
  }

  // Force at the wheels with the throttle fully open, from the torque curve (zero past its end).
  function wheelForce(gear, rpm) {
    const ratio = gear === 'R' ? v.reverseRatio : v.gearRatios[gear - 1];
    const curve = v.torqueCurve;
    let torque = rpm <= curve[0][0] ? curve[0][1] : 0;
    for (let i = 1; i < curve.length; i++) {
      const [r0, t0] = curve[i - 1];
      const [r1, t1] = curve[i];
      if (rpm > r0 && rpm <= r1) torque = t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
    return (torque * ratio) / v.wheelRadius;
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

    // Bicycle model; positive steer turns right, which lowers the heading. Lock fades with speed.
    const angle = (input.steer * v.maxSteerAngle) / (1 + Math.abs(truck.speed) / v.steerFadeSpeed);
    const yawRate = -(truck.speed / v.wheelbase) * Math.tan(angle);
    truck.heading += yawRate * dt;
    truck.x += Math.sin(truck.heading) * truck.speed * dt;
    truck.z += Math.cos(truck.heading) * truck.speed * dt;

    // The body leans out of the turn with lateral acceleration, more when heavier.
    const lean = yawRate * truck.speed * v.rollPerAccel * (truck.mass / 1000);
    truck.roll = Math.max(-v.maxRoll, Math.min(v.maxRoll, lean));
  }

  return { state, step };
}
