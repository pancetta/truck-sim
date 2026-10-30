// Lays flat-built geometry onto the map's terrain (#106): each vertex goes up by the ground's height under it, and
// triangles are split only where the ground bends under them, so a straight street on an even slope stays as it was.
import * as THREE from 'three/webgpu';

const STEP = 2.5; // m between the heights an edge is checked at: a quarter of the height grid's 10 m cell

// `geometry` (world coordinates, y over the ground) on `ground` ({ heightAt, slopeAt }, a map), `offset` m higher:
// a non-indexed copy whose triangles are halved along their longest edge that is more than `tolerance` m off the
// ground, and split at their middle where only their inside is, until none is. Neighbours split a shared edge alike, as
// that only depends on its two ends. Every attribute is carried along; normals facing up turn to the ground's, upright
// ones stay.
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
  const middle = (...corners) => {
    const m = corners[0].map((_, k) => corners.reduce((sum, c) => sum + c[k], 0) / corners.length);
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
  // Whether the ground inside a, b, c is more than `tolerance` off their plane, checked on a lattice that runs `STEP` m
  // along the longest of their edges, `longest` m, and takes in their middle.
  const bulges = (a, b, c, longest) => {
    const n = Math.max(3, Math.ceil(longest / STEP));
    for (let i = 1; i < n; i++) {
      for (let j = 1; i + j < n; j++) {
        const [u, v, w] = [i / n, j / n, 1 - (i + j) / n];
        const h = at(a[P] * u + b[P] * v + c[P] * w, a[P + 2] * u + b[P + 2] * v + c[P + 2] * w);
        if (Math.abs(h - (a[H] * u + b[H] * v + c[H] * w)) > tolerance) return true;
      }
    }
    return false;
  };
  const out = [];
  const split = (a, b, c, depth) => {
    const edges = [[a, b, c], [b, c, a], [c, a, b]].map(([p, q, r]) => ({ p, q, r, l: across(p, q), bends: bends(p, q) }));
    const bent = edges.filter((e) => e.bends);
    if (depth > 40) return out.push(a, b, c); // a guard only: 2000 m halves to 5 m in about 20
    if (bent.length) {
      const { p, q, r } = bent.reduce((x, y) => (y.l > x.l ? y : x));
      const m = middle(p, q);
      split(p, m, r, depth + 1);
      split(m, q, r, depth + 1);
    } else if (bulges(a, b, c, Math.max(...edges.map((e) => e.l)))) {
      // At the middle, which leaves every edge as it was, so no neighbour has to follow.
      const m = middle(a, b, c);
      split(a, b, m, depth + 1);
      split(b, c, m, depth + 1);
      split(c, a, m, depth + 1);
    } else out.push(a, b, c);
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
