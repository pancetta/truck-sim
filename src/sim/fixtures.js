// Test helpers, not a test file: inline OSM fixtures (spec #59: "a tiny helper writes ways as class, points and
// tags"), the real Monti extract, and the drive loop the Sim tests share. Only tests import it.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import * as tables from '../tables.js';
import { buildOsmMap } from './osm.js';
import { createSim as newSim } from './sim.js';

export { seeded } from './sim.js';

// A way is its highway class, points [[x, z]] in metres and extra tags. Node ids come from the points, so ways sharing a
// point share a node, as in OSM.
let ids = 0;
export const way = (highway, points, tags = {}) => ({ id: ++ids, tags: { highway, ...tags }, nodes: points.map(([x, z]) => `${x},${z}`), points });
export const building = (points, tags = {}) => ({ id: ++ids, tags: { building: 'yes', ...tags }, points: [...points, points[0]] });
export const bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
// The map of `ways` within `area`, built with `t`.
export const build = (ways, t = tables, furniture = { nodes: [] }, area = bounds) => buildOsmMap({ bounds: area, ways }, t, furniture);
// Tables with `spots` (and their docks, start, petrol stations, restaurant and home) in place of the extract's.
export const withSpots = (spots, docks = [], start = null, t = tables, stations = [], restaurant = null, home = null) => ({ ...t, osm: { ...t.osm, spots, docks, start, stations, restaurant, home } });
// `t` with the fuel and energy drains off (fuel.perKm 0, energy.drive Infinity), so the tank never empties and the
// driver never tires: for tests that drive far with the real tables.
export const undrained = (t = tables) => ({ ...t, fuel: { ...t.fuel, perKm: 0 }, energy: { ...t.energy, drive: Infinity } });
// A building over the box from (x0, z0) to (x1, z1).
export const box = (x0, z0, x1, z1) => building([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);

// The lane: Vicolo, a north–south dead end 2·`half` m long, closed at each end by a building just clear of the road and
// its pavements (`wall` m from the middle). A's zone is at the north end, B's at the south end, each where a truck stands
// against that end's wall; a spot in `docks` has its bay in that wall on the right-hand lane's line, facing out along
// the street. The truck starts in the middle (the road nearest the map's centre), in the right-hand lane facing south
// (+z) towards B. Vicolo is of `road` class. Returns the tables with the spots (`t`, from `base`), the map and `wall`.
export function lane(base = tables, docks = [], half = 28, road = 'residential') {
  const { width, lane: offset } = tables.osm.classes[road];
  const vicolo = way(road, [[0, -half], [0, half]], { name: 'Vicolo' });
  const wall = half + width / 2 + tables.osm.pavement;
  const bay = (id, z, heading) => (docks.includes(id) ? { bay: [-offset, z, heading] } : {});
  const t = withSpots(
    [
      { id: 'A', name: 'Magazzino Nord', street: 'Vicolo', way: vicolo.id, at: 0, side: 'right', ...bay('A', -wall, 0) },
      { id: 'B', name: 'Bottega Sud', street: 'Vicolo', way: vicolo.id, at: 2 * half, side: 'right', ...bay('B', wall, 180) },
    ],
    docks,
    null,
    base,
  );
  return { t, map: build([vicolo, box(-10, -wall - 10, 10, -wall), box(-10, wall, 10, wall + 10)], t), wall };
}

// The real Monti extract with its street furniture and height grid, built with `t`.
const read = (file) => JSON.parse(readFileSync(`public/${file}`, 'utf8'));
export const monti = (t = tables) => buildOsmMap(read(t.osm.file), t, read(t.osm.furniture), read(t.osm.terrain));

// Each Sim's map, so a test can find its lane paths (mapOf).
const maps = new WeakMap();
export function createSim(t, map, ...rest) {
  const sim = newSim(t, map, ...rest);
  maps.set(sim, map);
  return sim;
}
export const mapOf = (sim) => maps.get(sim);

export const DT = 1 / 60;
export const GAS = { steer: 0, gas: 1, brake: 0 };
export const BRAKE = { steer: 0, gas: 0, brake: 1 };
export const IDLE = { steer: 0, gas: 0, brake: 0 };

export function drive(sim, seconds, input) {
  for (let t = 0; t < seconds; t += DT) sim.step(DT, input);
}

// Steps until `done()` holds or `limit` seconds pass; returns the time taken.
export function timeUntil(sim, input, done, limit = 120) {
  let t = 0;
  while (!done() && t < limit) {
    sim.step(DT, input);
    t += DT;
  }
  return t;
}

// Whether two vehicles' footprints ({ x, z, heading } and { length, width }) overlap, by separating axes; touching
// within a µm doesn't count, as in the Sim.
export function vehiclesOverlap(a, aSize, b, bSize) {
  const box = ({ x, z, heading }, { length, width }) =>
    [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([f, r]) => [
      x + (Math.sin(heading) * f * length - Math.cos(heading) * r * width) / 2,
      z + (Math.cos(heading) * f * length + Math.sin(heading) * r * width) / 2,
    ]);
  const [p, q] = [box(a, aSize), box(b, bSize)];
  const separated = (axisOf) =>
    [0, 1].some((i) => {
      const [nx, nz] = [axisOf[i + 1][1] - axisOf[i][1], axisOf[i][0] - axisOf[i + 1][0]];
      const len = Math.hypot(nx, nz);
      const [ps, qs] = [p, q].map((corners) => corners.map(([x, z]) => (x * nx + z * nz) / len));
      return Math.max(...ps) <= Math.min(...qs) + 1e-6 || Math.max(...qs) <= Math.min(...ps) + 1e-6;
    });
  return !separated(p) && !separated(q);
}

// The nearest point to (x, z) at least 14 m off every road of `map`, searched in rings round it: where a parked truck
// meets no car.
export function offRoad(map, x, z) {
  for (let r = 0; ; r += 5) {
    for (let a = 0; a < 2 * Math.PI; a += 0.3) {
      const p = { x: x + r * Math.cos(a), z: z + r * Math.sin(a) };
      if (map.graph.nearest(p.x, p.z).d > 14) return p;
    }
  }
}

// Asks for offers until one picks up at `pickup` (AI cars draw from the same seeded random), and accepts it.
export function acceptFrom(sim, pickup) {
  let offer;
  for (let i = 0; i < 20 && !offer; i++) offer = sim.requestOffers().find((o) => o.pickup === pickup);
  expect(offer, `an offer from ${pickup}`).toBeTruthy();
  sim.acceptOrder(offer.id);
  return offer;
}

// On the lane: drives into B's dead end, or reverses into A's; either way the truck stops in that spot's zone.
export function parkAt(sim, id) {
  timeUntil(sim, id === 'B' ? GAS : BRAKE, () => sim.state.collision, 30);
}

// Takes an order from A to B on the lane and delivers it; returns the offer. A late delivery idles out the
// expected time first, so it earns no time bonus.
export function deliver(sim, late = false) {
  const offer = acceptFrom(sim, 'A');
  if (late) drive(sim, offer.expectedTime, IDLE);
  parkAt(sim, 'A');
  drive(sim, tables.orders.loadTime + 0.1, IDLE);
  parkAt(sim, 'B');
  drive(sim, tables.orders.loadTime + 0.1, IDLE);
  return offer;
}
