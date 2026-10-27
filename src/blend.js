// Draws the Sim between its last two steps (#73). The Sim steps at a fixed rate and the display's frames don't line up
// with it, so a frame can come with 0 or 2 steps; drawing the latest step then moves the view unevenly, worst while
// turning. Drawing the truck and the AI cars `alpha` (the share of a step since the latest one) of the way on from
// their pose before it evens that out, at most one step behind the Sim.
export function createBlend() {
  const before = new WeakMap(); // truck or AI car → its { x, z, heading, roll } before the latest step
  const drawn = new WeakMap(); // truck or AI car → its blended copy, reused from frame to frame

  // Call right before each Sim step, and after anything else that moves the truck at once (a reset to the road),
  // so that move isn't blended.
  function remember(state) {
    keep(state.truck);
    for (const car of state.traffic) keep(car);
  }

  function keep(body) {
    const pose = before.get(body) ?? {};
    pose.x = body.x;
    pose.z = body.z;
    pose.heading = body.heading;
    pose.roll = body.roll;
    before.set(body, pose);
  }

  // The state to draw: `state` with the truck and the AI cars blended; the Sim's own state is left alone.
  function at(state, alpha) {
    return { ...state, truck: blend(state.truck, alpha), traffic: state.traffic.map((car) => blend(car, alpha)) };
  }

  function blend(body, alpha) {
    const from = before.get(body);
    if (!from) return body; // new with the latest step
    const copy = Object.assign(drawn.get(body) ?? {}, body);
    drawn.set(body, copy);
    const turn = body.heading - from.heading;
    copy.x = from.x + (body.x - from.x) * alpha;
    copy.z = from.z + (body.z - from.z) * alpha;
    copy.heading = from.heading + Math.atan2(Math.sin(turn), Math.cos(turn)) * alpha; // the short way round
    if (body.roll !== undefined) copy.roll = from.roll + (body.roll - from.roll) * alpha;
    return copy;
  }

  return { remember, at };
}
