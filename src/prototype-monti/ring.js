// PROTOTYPE (throwaway): the background ring, OSM buildings and building parts up to ~1.3 km around Monti
// (ring.json, made by the scratch script in the round-4 commit message). Plain extrusions with a painted-window
// facade, flat roofs and hemispherical domes: nothing to drive into, only a skyline; haze hides where it ends.
import { newData, toGeometry, flat, area2, wallsAround } from './geometry.js';

// Painted facade repeats, metres: a window bay by a floor for houses, an arch by an arcade storey for monuments.
const HOUSE = [3.2, 3.5];
const MONUMENT = [4.5, 10];

// items: [{ r: outer ring, h?: hole rings, top, base, dome?: true | height, stone? }].
// Returns house and monument wall geometries, roofs, and the domes as { x, z, y, r, h }.
export function buildRing(items, tintFor) {
  const walls = newData();
  const monuments = newData();
  const roofs = newData();
  const domes = [];
  items.forEach((b, k) => {
    const color = tintFor(b, k);
    const outer = area2(b.r) > 0 ? [...b.r].reverse() : b.r; // walls face outwards
    const holes = (b.h ?? []).map((h) => (area2(h) < 0 ? [...h].reverse() : h)); // and into courtyards
    const [d, [uTile, vTile]] = b.stone ? [monuments, MONUMENT] : [walls, HOUSE];
    for (const ring of [outer, ...holes]) wallsAround(d, ring, b.base, b.top, uTile, vTile, color);
    flat(roofs, outer, b.top, 3, null, holes);
    if (b.dome) {
      const r = Math.sqrt(Math.abs(area2(b.r)) / 2 / Math.PI);
      const [x, z] = b.r.reduce(([sx, sz], [px, pz]) => [sx + px / b.r.length, sz + pz / b.r.length], [0, 0]);
      domes.push({ x, z, y: b.top, r, h: b.dome === true ? r : b.dome });
    }
  });
  return { walls: toGeometry(walls), monuments: toGeometry(monuments), roofs: toGeometry(roofs), domes };
}
