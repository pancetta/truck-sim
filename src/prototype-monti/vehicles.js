// PROTOTYPE (throwaway): generic parked vehicles built from code, so they're our own shapes (no real makes).
// A car body is lofted along its length: each cross-section is a rounded superellipse sized from the side profile,
// pinched in plan at the ends, narrowing above the beltline, and lifted over the wheels into arches. A painted "skin"
// draws the windows (crisp at any mesh resolution), panel gaps, handles, sills and arch lips; bumpers, lights,
// plates, mirrors, tyres and hubs are separate small parts. Scooters and bikes are boxes and rods. Everything comes
// back with length along +x, width along z, standing on y = 0, centred on x = z = 0.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Side profile [x, y] from the rear (x = 0) to the front, window outline, axles, wheel radius, width, B-pillar and
// door spans (rear edge, front edge) for the painted panel gaps.
const CARS = {
  city: {
    body: [[0, 0.25], [0, 0.85], [0.15, 0.95], [0.35, 1.45], [1.0, 1.49], [2.1, 1.45], [2.75, 0.95], [3.45, 0.8], [3.55, 0.55], [3.5, 0.25]],
    glass: [[0.36, 0.98], [0.5, 1.39], [1.0, 1.42], [2.05, 1.39], [2.62, 0.98]],
    axles: [0.62, 2.9], wheel: 0.28, width: 1.62, pillar: 1.15, doors: [[1.15, 2.55]],
  },
  hatch: {
    body: [[0, 0.3], [0, 0.9], [0.1, 1.0], [0.45, 1.42], [1.2, 1.47], [2.4, 1.44], [3.0, 1.0], [3.85, 0.85], [4.0, 0.6], [3.95, 0.3]],
    glass: [[0.45, 1.02], [0.58, 1.37], [1.2, 1.41], [2.36, 1.39], [2.9, 1.02]],
    axles: [0.7, 3.25], wheel: 0.3, width: 1.75, pillar: 1.85, doors: [[0.95, 1.85], [1.85, 2.85]],
  },
  sedan: {
    body: [[0, 0.35], [0, 0.85], [0.05, 0.95], [0.75, 1.0], [1.25, 1.4], [2.75, 1.44], [3.4, 1.0], [4.45, 0.85], [4.6, 0.6], [4.55, 0.33]],
    glass: [[1.24, 1.03], [1.45, 1.36], [2.72, 1.39], [3.32, 1.03]],
    axles: [0.85, 3.6], wheel: 0.31, width: 1.8, pillar: 2.3, doors: [[1.3, 2.3], [2.3, 3.3]],
  },
  micro: {
    body: [[0, 0.25], [0, 1.0], [0.1, 1.5], [1.0, 1.55], [1.55, 1.48], [2.2, 1.0], [2.65, 0.85], [2.7, 0.3]],
    glass: [[0.1, 1.05], [0.18, 1.45], [1.0, 1.5], [1.52, 1.44], [2.1, 1.03]],
    axles: [0.45, 2.2], wheel: 0.27, width: 1.6, pillar: 0.75, doors: [[0.75, 2.05]],
  },
  van: {
    body: [[0, 0.35], [0, 2.1], [0.1, 2.2], [3.9, 2.2], [4.35, 1.4], [4.95, 1.05], [5.0, 0.4]],
    glass: [[3.5, 1.4], [3.5, 1.95], [4.06, 1.95], [4.39, 1.4]],
    axles: [0.85, 4.1], wheel: 0.34, width: 2.0, pillar: null, doors: [[2.2, 3.4], [3.45, 4.3]],
  },
};
const SILL = 0.42; // m, top of the dark rocker band
const SQUARE = 1 / 3; // superellipse exponent of the cross-section: lower is boxier

// Where a vertical (axis 0) or horizontal (axis 1) line at `at` crosses the polygon: [min, max] of the other axis.
function cross(poly, at, axis) {
  const hits = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const [a, b] = [p[axis], q[axis]];
    if ((a <= at && at <= b) || (b <= at && at <= a)) {
      const t = a === b ? 0 : (at - a) / (b - a);
      hits.push(p[1 - axis] + t * (q[1 - axis] - p[1 - axis]));
      if (a === b) hits.push(q[1 - axis]);
    }
  });
  return [Math.min(...hits), Math.max(...hits)];
}
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// The body (with mirrors) as one indexed geometry: `nx` sections along the length (denser at the ends), `nr`
// points around each.
function loftBody(c, length, nx, nr, mirrors) {
  const height = Math.max(...c.body.map(([, y]) => y));
  const belt = Math.min(...c.glass.map(([, y]) => y));
  const pos = [];
  const halfWidth = (x) => (c.width / 2) * Math.pow(1 - Math.pow(Math.abs((2 * x) / length - 1), 6), 1 / 6);
  for (let i = 0; i < nx; i++) {
    const x = Math.min(length - 0.002, Math.max(0.002, (length * (1 - Math.cos((Math.PI * i) / (nx - 1)))) / 2));
    let [yb, yt] = cross(c.body, x, 0);
    for (const ax of c.axles) {
      const R = c.wheel + 0.07;
      if (Math.abs(x - ax) < R) yb = Math.max(yb, c.wheel + Math.sqrt(R * R - (x - ax) ** 2));
    }
    yb = Math.min(yb, yt - 0.05);
    const [ym, b, a] = [(yt + yb) / 2, (yt - yb) / 2, halfWidth(x)];
    for (let k = 0; k < nr; k++) {
      const phi = (2 * Math.PI * k) / nr;
      const [cz, cy] = [Math.sign(Math.cos(phi)) * Math.abs(Math.cos(phi)) ** SQUARE, Math.sign(Math.sin(phi)) * Math.abs(Math.sin(phi)) ** SQUARE];
      const y = ym + b * cy;
      pos.push(x, y, a * cz * (1 - 0.16 * smooth((y - belt) / (height - belt))));
    }
  }
  const paint = [];
  for (let i = 0; i < nx - 1; i++) {
    for (let k = 0; k < nr; k++) {
      const [p, q, r, s] = [i * nr + k, i * nr + ((k + 1) % nr), (i + 1) * nr + k, (i + 1) * nr + ((k + 1) % nr)];
      paint.push(p, r, q, q, r, s); // outward: k runs up the side, i forwards
    }
  }
  // Mirrors: a cap on a short arm at each A-pillar foot.
  const aFoot = Math.max(...c.glass.filter(([, y]) => y < belt + 0.05).map(([x]) => x));
  for (const side of mirrors ? [-1, 1] : []) {
    for (const g of [
      new THREE.BoxGeometry(0.1, 0.09, 0.17).translate(aFoot - 0.12, belt + 0.08, side * (halfWidth(aFoot) + 0.1)),
      new THREE.BoxGeometry(0.05, 0.03, 0.1).translate(aFoot - 0.1, belt + 0.05, side * (halfWidth(aFoot) + 0.02)),
    ]) {
      const flatBox = g.toNonIndexed().attributes.position.array;
      const start = pos.length / 3;
      pos.push(...flatBox);
      for (let j = 0; j < flatBox.length / 3; j++) paint.push(start + j);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(paint);
  geometry.computeVertexNormals();
  // Skin UVs: side projection; on faces turned away from the side, the same column at the skin's blank top row.
  const normal = geometry.attributes.normal;
  const uv = [];
  for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] / length, Math.abs(normal.getZ(i)) > 0.45 ? pos[i * 3 + 1] / height : 0.995);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry.translate(-length / 2, 0, 0);
}

// The painted skin in side projection (u = x / length, v = y / height): plain paint, darker panel gaps, door
// handles, a dark sill and arch lips. Paint colour multiplies it per car.
function skinTexture(c, length) {
  const height = Math.max(...c.body.map(([, y]) => y));
  const belt = Math.min(...c.glass.map(([, y]) => y));
  const [w, h] = [1024, 256];
  const X = (x) => (x / length) * w;
  const Y = (y) => (1 - y / height) * h;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [w, h];
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a2a2a';
  g.fillRect(0, Y(SILL), w, h - Y(SILL)); // rocker panel and lower body
  // Side windows, the B-pillar left in black; windscreen and rear window on the top row, which the faces turned
  // away from the side sample.
  const glass = g.createLinearGradient(0, Y(height), 0, Y(belt));
  glass.addColorStop(0, '#2b333d');
  glass.addColorStop(1, '#0c0f13');
  g.fillStyle = glass;
  g.beginPath();
  c.glass.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
  g.closePath();
  g.fill();
  if (c.pillar) {
    g.fillStyle = '#141414';
    g.fillRect(X(c.pillar - 0.05), 0, X(0.1), Y(belt));
  }
  const xs = c.glass.map(([x]) => x);
  const top = Math.max(...c.glass.map(([, y]) => y));
  const near = (y) => c.glass.filter(([, gy]) => Math.abs(gy - y) < 0.06).map(([x]) => x);
  g.fillStyle = '#10141a';
  g.fillRect(X(Math.max(...near(top)) + 0.04), 0, X(Math.max(...xs)) - X(Math.max(...near(top)) + 0.04), 6); // windscreen
  g.fillRect(X(Math.min(...xs)), 0, X(Math.min(...near(top)) - 0.04) - X(Math.min(...xs)), 6); // rear window
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  g.lineWidth = 2;
  for (const [x0, x1] of c.doors) {
    g.strokeRect(X(x0), Y(belt - 0.02), X(x1) - X(x0), Y(SILL) - Y(belt - 0.02));
    g.fillStyle = 'rgba(0, 0, 0, 0.45)';
    g.fillRect(X(x0 + 0.12), Y(belt - 0.12), X(0.16), 4); // handle, near the door's rear edge
  }
  g.strokeStyle = '#1e1e1e';
  g.lineWidth = 5;
  for (const ax of c.axles) {
    g.beginPath();
    g.ellipse(X(ax), Y(c.wheel), X(c.wheel + 0.09), Y(0) - Y(c.wheel + 0.09), 0, Math.PI, 2 * Math.PI);
    g.stroke();
  }
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.beginPath();
  g.arc(X(c.axles[0] + c.wheel + 0.25), Y(belt - 0.15), 5, 0, Math.PI * 2); // fuel flap
  g.fill();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Number plate in the left half of the detail atlas, plain white in the right half (for vertex-coloured parts).
export function detailAtlas() {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [256, 64];
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#1f3c8c';
  g.fillRect(0, 0, 12, 64);
  g.fillRect(116, 0, 12, 64);
  g.fillStyle = '#1a1a1a';
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.fillText('XR 207 LM', 64, 44); // made-up registration
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A small part for the vertex-coloured details mesh; `plate` maps its faces onto the plate half of the atlas.
function detail(geometry, color, plate = false) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
  const uv = g.attributes.uv;
  for (let i = 0; i < n; i++) uv.setXY(i, plate ? uv.getX(i) * 0.5 : 0.75, plate ? uv.getY(i) : 0.5);
  return g;
}

function carDetails(c, length, rich) {
  const front = (y) => cross(c.body, y, 1)[1];
  const rear = (y) => cross(c.body, y, 1)[0];
  const W = c.width;
  const segs = rich ? 20 : 8;
  const parts = [
    detail(new THREE.BoxGeometry(0.16, 0.22, W * 0.92).translate(front(0.42) - 0.04, 0.42, 0), '#262626'),
    detail(new THREE.BoxGeometry(0.16, 0.22, W * 0.92).translate(rear(0.45) + 0.04, 0.45, 0), '#262626'),
  ];
  for (const ax of c.axles) {
    for (const side of [-1, 1]) {
      parts.push(detail(new THREE.CylinderGeometry(c.wheel, c.wheel, 0.21, segs).rotateX(Math.PI / 2).translate(ax, c.wheel, side * (W / 2 - 0.13)), '#1b1b1b'));
      if (rich) parts.push(detail(new THREE.CylinderGeometry(c.wheel * 0.55, c.wheel * 0.55, 0.22, segs).rotateX(Math.PI / 2).translate(ax, c.wheel, side * (W / 2 - 0.13)), '#7d8186'));
    }
  }
  if (rich) {
    const [head, tail] = [0.72, 0.85];
    for (const side of [-1, 1]) {
      parts.push(detail(new THREE.BoxGeometry(0.08, 0.13, 0.3).translate(front(head) - 0.03, head, side * (W / 2 - 0.3)), '#f2efe6'));
      parts.push(detail(new THREE.BoxGeometry(0.08, 0.16, 0.24).translate(rear(tail) + 0.03, tail, side * (W / 2 - 0.27)), '#9a1414'));
    }
    parts.push(detail(new THREE.BoxGeometry(0.02, 0.11, 0.52).translate(front(0.42) + 0.045, 0.42, 0), '#ffffff', true));
    parts.push(detail(new THREE.BoxGeometry(0.02, 0.11, 0.52).rotateY(Math.PI).translate(rear(0.45) - 0.045, 0.45, 0), '#ffffff', true));
    parts.push(detail(new THREE.BoxGeometry(0.03, 0.12, W * 0.42).translate(front(0.6) - 0.01, 0.6, 0), '#1c1c1c')); // grille
  }
  return mergeGeometries(parts);
}

const centre = (g, length) => g.translate(-length / 2, 0, 0);

// Per kind: { length, width, skin, near: { body, details }, far: { body, details } }.
export function carGeometries() {
  return Object.fromEntries(
    Object.entries(CARS).map(([kind, c]) => {
      const length = Math.max(...c.body.map(([x]) => x));
      const lod = (nx, nr, rich) => ({ body: loftBody(c, length, nx, nr, rich), details: centre(carDetails(c, length, rich), length) });
      const near = lod(40, 32, true);
      const far = lod(14, 12, false);
      return [kind, { length, width: c.width, skin: skinTexture(c, length), near, far }];
    }),
  );
}

// ---- two-wheelers -------------------------------------------------------------------------------------------------
const wheelAt = (x, y, z, r, w) => new THREE.CylinderGeometry(r, r, w, 18).rotateX(Math.PI / 2).translate(x, y, z).toNonIndexed();
const block = ([sx, sy, sz], [x, y, z], pitch = 0) => new THREE.BoxGeometry(sx, sy, sz).rotateZ(pitch).translate(x, y, z).toNonIndexed();
function rod(a, b, r) {
  const [A, B] = [new THREE.Vector3(...a), new THREE.Vector3(...b)];
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return g.translate(...A.add(B).multiplyScalar(0.5).toArray()).toNonIndexed();
}
function profileExtrude(points, width) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = width - 0.12;
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 4 }).translate(0, 0, -depth / 2);
}
const merged = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
const centred = (parts, length) => Object.fromEntries(Object.entries(parts).map(([k, g]) => [k, centre(g, length)]));

// A generic step-through scooter, 1.8 m long.
export function scooterGeometry() {
  const body = merged([
    profileExtrude([[0.05, 0.32], [0, 0.55], [0.15, 0.78], [0.72, 0.82], [0.88, 0.45], [0.85, 0.32]], 0.5),
    block([0.62, 0.08, 0.38], [1.15, 0.32, 0]), // floorboard
    block([0.08, 0.72, 0.5], [1.48, 0.68, 0], -0.25), // leg shield
    block([0.16, 0.12, 0.62], [1.56, 1.1, 0]), // headset and handlebar
    block([0.36, 0.1, 0.16], [1.58, 0.42, 0], 0.4), // front mudguard
  ]);
  const dark = merged([
    block([0.66, 0.1, 0.3], [0.5, 0.88, 0]), // seat
    wheelAt(0.25, 0.2, 0, 0.2, 0.11),
    wheelAt(1.58, 0.2, 0, 0.2, 0.11),
    rod([1.5, 0.2, 0], [1.6, 1.05, 0], 0.03),
  ]);
  const metal = merged([wheelAt(0.25, 0.2, 0, 0.11, 0.12), wheelAt(1.58, 0.2, 0, 0.11, 0.12), block([0.3, 0.04, 0.2], [-0.05, 0.6, 0])]);
  return { length: 1.8, width: 0.65, ...centred({ body, dark, metal }, 1.8) };
}

// A city bicycle, 1.7 m long.
export function bikeGeometry() {
  const [rear, bracket, seat, head, front] = [[0.33, 0.33, 0], [0.8, 0.3, 0], [0.7, 0.85, 0], [1.25, 0.88, 0], [1.38, 0.33, 0]];
  const body = merged([
    rod(rear, bracket, 0.018), rod(bracket, seat, 0.02), rod(seat, rear, 0.016), rod(bracket, head, 0.022),
    rod(seat, head, 0.02), rod(head, front, 0.02), rod([1.22, 1.0, -0.28], [1.22, 1.0, 0.28], 0.014),
    rod(head, [1.22, 1.0, 0], 0.016), rod(seat, [0.66, 0.97, 0], 0.014),
  ]);
  const dark = merged([
    new THREE.TorusGeometry(0.33, 0.02, 6, 28).translate(...rear).toNonIndexed(),
    new THREE.TorusGeometry(0.33, 0.02, 6, 28).translate(...front).toNonIndexed(),
    block([0.24, 0.05, 0.1], [0.64, 0.99, 0]), // saddle
  ]);
  return { length: 1.7, width: 0.6, ...centred({ body, dark }, 1.7) };
}
