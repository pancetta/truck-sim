// Lays flat-built geometry onto the map's terrain (#106): each vertex goes up by the ground's height under it, and
// triangles are split only where the ground bends under them, so a straight street on an even slope stays as it was.
import * as THREE from 'three/webgpu';

const STEP = 2.5; // m between the heights an edge is checked at: a quarter of the height grid's 10 m cell

// `geometry` (world coordinates, y over the ground) on `ground` ({ heightAt, slopeAt }, a map), `offset` m higher:
// a non-indexed copy whose triangles are halved along their longest edge until no edge nor middle is more than
// `tolerance` m off the ground. Neighbours split a shared edge alike, as that only depends on its two ends. Every
// attribute is carried along; normals facing up turn to the ground's, upright ones stay.
export function drape(geometry, ground, tolerance, offset = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const names = Object.keys(g.attributes);
  const attrs = names.map((n) => g.getAttribute(n));
  const size = attrs.reduce((n, a) => n + a.itemSize, 0);
  const start = (name) => attrs.slice(0, names.indexOf(name)).reduce((n, a) => n + a.itemSize, 0);
  const [P, N] = [start('position'), names.includes('normal') ? start('normal') : -1];
  const H = size; // a vertex is its attributes' components, then the ground's height under it
  const at = (x, z) => ground.heightAt(x, z);
  const read = (i) => {
    const v = [];
    for (const a of attrs) for (let k = 0; k < a.itemSize; k++) v.push(a.getComponent(i, k));
    v.push(at(v[P], v[P + 2]));
    return v;
  };
  const middle = (a, b) => {
    const m = a.map((v, k) => (v + b[k]) / 2);
    m[H] = at(m[P], m[P + 2]);
    return m;
  };
  const across = (a, b) => Math.hypot(b[P] - a[P], b[P + 2] - a[P + 2]);
  // Whether the ground between a and b is more than `tolerance` off the straight line between their heights.
  const bends = (a, b) => {
    const n = Math.max(2, Math.ceil(across(a, b) / STEP));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (Math.abs(at(a[P] + (b[P] - a[P]) * t, a[P + 2] + (b[P + 2] - a[P + 2]) * t) - (a[H] + (b[H] - a[H]) * t)) > tolerance) return true;
    }
    return false;
  };
  const out = [];
  const split = (a, b, c, depth) => {
    const edges = [[a, b, c], [b, c, a], [c, a, b]].map(([p, q, r]) => ({ p, q, r, l: across(p, q), bends: bends(p, q) }));
    const bent = edges.filter((e) => e.bends);
    const cx = (a[P] + b[P] + c[P]) / 3;
    const cz = (a[P + 2] + b[P + 2] + c[P + 2]) / 3;
    const inside = !bent.length && Math.abs(at(cx, cz) - (a[H] + b[H] + c[H]) / 3) > tolerance;
    if (depth > 16 || (!bent.length && !inside)) return out.push(a, b, c);
    // The longest edge that bends, or if only the middle is off, the longest.
    const { p, q, r } = (bent.length ? bent : edges).reduce((x, y) => (y.l > x.l ? y : x));
    const m = middle(p, q);
    split(p, m, r, depth + 1);
    split(m, q, r, depth + 1);
  };
  const count = g.getAttribute('position').count;
  for (let i = 0; i < count; i += 3) split(read(i), read(i + 1), read(i + 2), 0);

  const result = new THREE.BufferGeometry();
  attrs.forEach((a, k) => {
    const s = start(names[k]);
    const data = new a.array.constructor(out.length * a.itemSize);
    out.forEach((v, i) => {
      for (let c = 0; c < a.itemSize; c++) data[i * a.itemSize + c] = v[s + c];
    });
    result.setAttribute(names[k], new THREE.BufferAttribute(data, a.itemSize, a.normalized));
  });
  const position = result.getAttribute('position');
  const normal = N >= 0 && result.getAttribute('normal');
  const n = new THREE.Vector3();
  out.forEach((v, i) => {
    position.setY(i, v[P + 1] + v[H] + offset);
    if (normal && v[N + 1] > 0.9) {
      const [x, z] = [v[P], v[P + 2]];
      normal.setXYZ(i, ...n.set(-ground.slopeAt(x, z, 1, 0), 1, -ground.slopeAt(x, z, 0, 1)).normalize().toArray());
    }
  });
  result.computeBoundingSphere();
  return result;
}

// A matrix that lays what is built on flat ground round (x, z) onto the ground's plane there, its slope measured `span`
// m either way: every height goes up by the ground's, tilted with it, and upright edges stay upright.
export function onGround(ground, x, z, span, out = new THREE.Matrix4()) {
  const [sx, sz] = [ground.slopeAt(x, z, 1, 0, span), ground.slopeAt(x, z, 0, 1, span)];
  return out.set(1, 0, 0, 0, sx, 1, sz, ground.heightAt(x, z) - sx * x - sz * z, 0, 0, 1, 0, 0, 0, 0, 1);
}
