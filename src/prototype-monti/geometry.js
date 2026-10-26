// PROTOTYPE (throwaway): triangle soup helpers shared by the Monti prototype's generated meshes.
import * as THREE from 'three/webgpu';

export const newData = () => ({ pos: [], uv: [], col: [] });

// Pushes one triangle of [x, y, z, u, v] corners; a corner's optional sixth item overrides `color` there.
export function tri(d, a, b, c, color) {
  for (const [x, y, z, u, v, own] of [a, b, c]) {
    d.pos.push(x, y, z);
    d.uv.push(u, v);
    const col = own ?? color;
    if (col) d.col.push(col.r, col.g, col.b);
  }
}

export function toGeometry(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
  if (d.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
  g.computeVertexNormals();
  return g;
}

// Flat polygon (with optional holes) at height y, faces up, UVs in world metres / `tile`.
export function flat(d, ring, y, tile, color, holes = []) {
  const pts = [ring, ...holes].flat();
  const faces = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z))));
  for (let [a, b, c] of faces) {
    const [A, B, C] = [pts[a], pts[b], pts[c]];
    if ((B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) < 0) [b, c] = [c, b];
    tri(d, ...[a, b, c].map((i) => [pts[i][0], y, pts[i][1], pts[i][0] / tile, pts[i][1] / tile]), color);
  }
}

// Twice the signed area of a ring of [x, z] points (positive: counter-clockwise in x/z).
export const area2 = (ring) =>
  ring.reduce((s, [x, z], i) => {
    const [x2, z2] = ring[(i + 1) % ring.length];
    return s + x * z2 - x2 * z;
  }, 0);

// Vertical wall quads around a ring from y0 to y1, facing left of each edge's direction (callers orient the ring).
// UVs: u along the perimeter from `u0`, v = y, both divided by the repeat sizes.
export function wallsAround(d, ring, y0, y1, uTile, vTile, color, u0 = 0) {
  let along = u0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const [ua, ub, va, vb] = [along / uTile, (along + L) / uTile, y0 / vTile, y1 / vTile];
    along += L;
    tri(d, [p[0], y0, p[1], ua, va], [q[0], y0, q[1], ub, va], [q[0], y1, q[1], ub, vb], color);
    tri(d, [p[0], y0, p[1], ua, va], [q[0], y1, q[1], ub, vb], [p[0], y1, p[1], ua, vb], color);
  });
}
