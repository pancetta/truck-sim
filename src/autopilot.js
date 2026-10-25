// Dev-only (?perf&auto): drives the truck round a fixed loop of streets (tables.perf.route) so every perf run
// sees the same route. Pure pursuit on the right half of the road; resets to the road when stuck.
// Ported unchanged in behaviour from the investigation's scratch autopilot, so its numbers stay comparable.
export function createAutopilot(sim, map, tables) {
  const { route, lane, cruiseSpeed, turnSpeed, steerGain, stuckTime } = tables.perf;
  const ts = map.tileSize;
  const path = [];
  route.forEach((c, i) => path.push(...map.route(c, route[(i + 1) % route.length]).slice(0, -1)));
  let idx = 0;
  let stuck = 0;
  const input = { steer: 0, gas: 0, brake: 0 };
  const at = (i) => path[((i % path.length) + path.length) % path.length];
  // The lane point of path tile i: the tile centre moved `lane` to the right of the way to tile i + 1.
  const point = (i) => {
    const a = at(i);
    const b = at(i + 1);
    const [dc, dr] = [b.col - a.col, b.row - a.row];
    return [(a.col + 0.5) * ts - dr * lane, (a.row + 0.5) * ts + dc * lane];
  };

  // Puts the truck at the start of the loop, facing along it. Dev-only, so it sets the Sim's state directly.
  function place() {
    const [x, z] = point(0);
    const b = at(1);
    Object.assign(sim.state.truck, { x, z, heading: Math.atan2(b.col - path[0].col, b.row - path[0].row), speed: 0 });
    idx = 0;
  }

  function update(dt) {
    const t = sim.state.truck;
    // Advance along the path to the nearest tile ahead.
    let best = Infinity;
    let bi = idx;
    for (let k = 0; k < 6; k++) {
      const [px, pz] = point(idx + k);
      const d = (px - t.x) ** 2 + (pz - t.z) ** 2;
      if (d < best) [best, bi] = [d, idx + k];
    }
    idx = bi;
    if (best > (2 * ts) ** 2) {
      // lost (e.g. after a reset to the road): search the whole loop
      for (let k = 0; k < path.length; k++) {
        const [px, pz] = point(k);
        const d = (px - t.x) ** 2 + (pz - t.z) ** 2;
        if (d < best) [best, idx] = [d, k];
      }
    }
    const [tx, tz] = point(idx + 2);
    const want = Math.atan2(tx - t.x, tz - t.z);
    const err = Math.atan2(Math.sin(want - t.heading), Math.cos(want - t.heading));
    const turning = [1, 2, 3].some((k) => {
      const a = at(idx + k - 1);
      const b = at(idx + k);
      const c = at(idx + k + 1);
      return b.col - a.col !== c.col - b.col || b.row - a.row !== c.row - b.row;
    });
    const target = turning || Math.abs(err) > 0.3 ? turnSpeed : cruiseSpeed;
    input.steer = Math.max(-1, Math.min(1, -err * steerGain));
    input.gas = t.speed < target ? 1 : 0;
    input.brake = t.speed > target + 1 ? 0.6 : 0;
    stuck = Math.abs(t.speed) < 0.3 ? stuck + dt : 0;
    if (stuck > stuckTime) {
      stuck = 0;
      sim.resetToRoad();
    }
    return input;
  }

  return { update, place };
}

// A seeded random (mulberry32) for the Sim under ?auto, so every run meets the same traffic and offers.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
