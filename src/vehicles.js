// Generic cars built from code (tables.vehicles), so they are our own shapes with no real makes. A body is lofted
// along its length: each cross-section is a rounded superellipse sized from the side profile, pinched in plan at
// the ends, narrowing above the beltline, and lifted over the wheels into arches. A painted skin draws the windows,
// panel gaps, handles, sill and arch lips; bumpers, lights, grille, plates, tyres and hubs are a separate details
// mesh, coloured per vertex. Geometries come back with the front towards +z, standing on y = 0, centred on
// x = z = 0, in the footprint's length and width, mirrors included.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SILL = 0.42; // m, top of the dark rocker band
const SQUARE = 1 / 3; // superellipse exponent of the cross-section: lower is boxier
const MIRROR = 0.085; // m the mirrors reach out past the body
const BUMPER = 0.055; // m the bumpers and plates stand out past the body's ends, at most
const DETAIL = { near: { sections: 40, around: 32, rich: true }, far: { sections: 14, around: 12, rich: false } };
const BAND = { length: 2.3, height: 0.18 }; // m, a police car's lettered side band; the rear one is 0.6 of it

// A body type with its profile stretched along x to `length` m, `width` m across the body.
function fit(c, length, width) {
  const s = length / Math.max(...c.body.map(([x]) => x));
  const xs = (points) => points.map(([x, y]) => [x * s, y]);
  return {
    ...c,
    body: xs(c.body),
    glass: xs(c.glass),
    axles: c.axles.map((x) => x * s),
    pillar: c.pillar && c.pillar * s,
    doors: c.doors.map(([a, b]) => [a * s, b * s]),
    length,
    width,
    height: Math.max(...c.body.map(([, y]) => y)),
    belt: Math.min(...c.glass.map(([, y]) => y)),
  };
}

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
const halfWidth = (c, x) => (c.width / 2) * Math.pow(1 - Math.pow(Math.abs((2 * x) / c.length - 1), 6), 1 / 6);

// The body (with mirrors) as one indexed geometry: `nx` sections along the length (denser at the ends), `nr`
// points around each. UVs are the side projection onto the skin; faces turned away from the side sample the same
// column at the skin's top row, where the windscreen and rear window are painted.
function loftBody(c, nx, nr, mirrors) {
  const pos = [];
  for (let i = 0; i < nx; i++) {
    const x = Math.min(c.length - 0.002, Math.max(0.002, (c.length * (1 - Math.cos((Math.PI * i) / (nx - 1)))) / 2));
    let [yb, yt] = cross(c.body, x, 0);
    for (const ax of c.axles) {
      const R = c.wheel + 0.07;
      if (Math.abs(x - ax) < R) yb = Math.max(yb, c.wheel + Math.sqrt(R * R - (x - ax) ** 2));
    }
    yb = Math.min(yb, yt - 0.05);
    const [ym, b, a] = [(yt + yb) / 2, (yt - yb) / 2, halfWidth(c, x)];
    for (let k = 0; k < nr; k++) {
      const phi = (2 * Math.PI * k) / nr;
      const [cz, cy] = [Math.sign(Math.cos(phi)) * Math.abs(Math.cos(phi)) ** SQUARE, Math.sign(Math.sin(phi)) * Math.abs(Math.sin(phi)) ** SQUARE];
      const y = ym + b * cy;
      pos.push(x, y, a * cz * (1 - 0.16 * smooth((y - c.belt) / (c.height - c.belt))));
    }
  }
  const index = [];
  for (let i = 0; i < nx - 1; i++) {
    for (let k = 0; k < nr; k++) {
      const [p, q, r, s] = [i * nr + k, i * nr + ((k + 1) % nr), (i + 1) * nr + k, (i + 1) * nr + ((k + 1) % nr)];
      index.push(p, r, q, q, r, s); // outward: k runs up the side, i forwards
    }
  }
  // Close both ends with a fan about the ring's centre, so the shell has no hole (the plan-view pinch leaves the end
  // sections wide open). The rings run anticlockwise seen from the rear, so the rear fan keeps that order.
  for (const [ring, flip] of [[0, false], [nx - 1, true]]) {
    const [first, centre] = [ring * nr, pos.length / 3];
    pos.push(pos[first * 3], pos[first * 3 + 1], 0); // ring point 0 (phi = 0) is at mid-height
    for (let k = 0; k < nr; k++) {
      const [p, q] = [first + k, first + ((k + 1) % nr)];
      index.push(...(flip ? [centre, q, p] : [centre, p, q]));
    }
  }
  // Mirrors: a cap on a short arm at each A-pillar foot, reaching MIRROR past the body.
  const aFoot = Math.max(...c.glass.filter(([, y]) => y < c.belt + 0.05).map(([x]) => x));
  for (const side of mirrors ? [-1, 1] : []) {
    for (const g of [
      new THREE.BoxGeometry(0.1, 0.09, 0.08).translate(aFoot - 0.12, c.belt + 0.08, side * (halfWidth(c, aFoot) + MIRROR - 0.04)),
      new THREE.BoxGeometry(0.05, 0.03, 0.06).translate(aFoot - 0.1, c.belt + 0.05, side * (halfWidth(c, aFoot) + 0.01)),
    ]) {
      const box = g.toNonIndexed().getAttribute('position').array;
      const start = pos.length / 3;
      pos.push(...box);
      for (let j = 0; j < box.length / 3; j++) index.push(start + j);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const uv = [];
  for (let i = 0; i < pos.length / 3; i++) uv.push(pos[i * 3] / c.length, Math.abs(normal.getZ(i)) > 0.45 ? pos[i * 3 + 1] / c.height : 0.995);
  return geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

// A part of the details mesh in one colour; `plate` maps its faces onto the detail atlas' number plate, `band` onto
// its police band, else they sample its plain white. `headlight` marks the faces a lights-on look can make glow.
function detail(geometry, colour, { plate = false, band = false, headlight = false } = {}) {
  const g = geometry.toNonIndexed();
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(colour);
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colours, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.setAttribute('headlight', new THREE.BufferAttribute(new Float32Array(n).fill(headlight ? 1 : 0), 1));
  const uv = g.getAttribute('uv');
  for (let i = 0; i < n; i++) {
    if (plate) uv.setXY(i, uv.getX(i) * 0.5, 0.53 + uv.getY(i) * 0.47);
    else if (band) uv.setXY(i, uv.getX(i), uv.getY(i) * 0.47); // short of the plate half, so mipmaps don't mix them
    else uv.setXY(i, 0.75, 0.75);
  }
  return g;
}

// `police` ({ lightBar }) adds a police car's parts: an unlit bar across the roof and a lettered band on each side.
function carDetails(c, rich, police) {
  const front = (y) => cross(c.body, y, 1)[1];
  const rear = (y) => cross(c.body, y, 1)[0];
  const W = c.width;
  const segs = rich ? 20 : 8;
  // How far out a part at x may reach: not past the body, whose plan view rounds in at the ends.
  const reach = (x, out) => Math.min(out, halfWidth(c, x) - 0.03);
  const parts = [
    detail(new THREE.BoxGeometry(0.16, 0.22, 2 * reach(front(0.42) - 0.12, W * 0.46)).translate(front(0.42) - 0.04, 0.42, 0), '#262626'),
    detail(new THREE.BoxGeometry(0.16, 0.22, 2 * reach(rear(0.45) + 0.12, W * 0.46)).translate(rear(0.45) + 0.04, 0.45, 0), '#262626'),
  ];
  for (const ax of c.axles) {
    for (const side of [-1, 1]) {
      parts.push(detail(new THREE.CylinderGeometry(c.wheel, c.wheel, 0.21, segs).rotateX(Math.PI / 2).translate(ax, c.wheel, side * (W / 2 - 0.13)), '#1b1b1b'));
      if (rich) parts.push(detail(new THREE.CylinderGeometry(c.wheel * 0.55, c.wheel * 0.55, 0.22, segs).rotateX(Math.PI / 2).translate(ax, c.wheel, side * (W / 2 - 0.13)), '#7d8186'));
    }
  }
  const [head, tail] = [0.72, 0.85];
  for (const side of [-1, 1]) {
    // Headlights at every detail level, so a lights-on look shows from afar too.
    parts.push(detail(new THREE.BoxGeometry(0.08, 0.13, 0.3).translate(front(head) - 0.03, head, side * (reach(front(head) - 0.03, W / 2 - 0.15) - 0.15)), '#f2efe6', { headlight: true }));
    if (rich) parts.push(detail(new THREE.BoxGeometry(0.08, 0.16, 0.24).translate(rear(tail) + 0.03, tail, side * (reach(rear(tail) + 0.03, W / 2 - 0.15) - 0.12)), '#9a1414'));
  }
  if (rich) {
    parts.push(detail(new THREE.BoxGeometry(0.02, 0.11, 0.52).translate(front(0.42) + 0.045, 0.42, 0), '#ffffff', { plate: true }));
    parts.push(detail(new THREE.BoxGeometry(0.02, 0.11, 0.52).rotateY(Math.PI).translate(rear(0.45) - 0.045, 0.45, 0), '#ffffff', { plate: true }));
    parts.push(detail(new THREE.BoxGeometry(0.03, 0.12, W * 0.42).translate(front(0.6) - 0.01, 0.6, 0), '#1c1c1c')); // grille
  }
  if (police) {
    const roofX = c.pillar ?? c.length / 2;
    const roof = cross(c.body, roofX, 0)[1];
    parts.push(detail(new THREE.BoxGeometry(0.3, 0.11, W * 0.75).translate(roofX, roof + 0.05, 0), police.lightBar));
    // Mid-height, where the boxy cross-section is widest, so the flat band lies close along the side.
    const [yb, yt] = cross(c.body, c.length / 2, 0);
    for (const side of [-1, 1]) {
      const band = new THREE.BoxGeometry(BAND.length, BAND.height, 0.02).translate(c.length / 2, (yb + yt) / 2, side * (halfWidth(c, c.length / 2) + 0.01));
      parts.push(detail(band, '#ffffff', { band: true }));
    }
    // And across the rear, so it shows in the chase view; turned like the rear plate to read upright.
    // shortcut: sized at x = 0.06 where the body is wide enough to read; its ends float a few cm off the curved corners.
    const scale = Math.min(0.6, (2 * reach(0.06, W)) / BAND.length);
    const back = new THREE.BoxGeometry(0.02, BAND.height * scale, BAND.length * scale).rotateY(Math.PI).translate(rear(0.65) - 0.01, 0.65, 0);
    parts.push(detail(back, '#ffffff', { band: true }));
  }
  return mergeGeometries(parts);
}

// Per body type: { near: { body, details }, far: { body, details } } in the footprint { length, width }, and the
// fitted type the skin is painted from. `police` ({ lightBar }) gives them a police car's parts.
export function carGeometries(types, footprint, police = null) {
  return Object.fromEntries(
    Object.entries(types).map(([type, raw]) => {
      const c = fit(raw, footprint.length - 2 * BUMPER, footprint.width - 2 * MIRROR);
      // Built with the length along +x from the rear; turned so the front is +z, as the Sim's heading 0 points.
      const place = (g) => g.translate(-c.length / 2, 0, 0).rotateY(-Math.PI / 2);
      const lod = ({ sections, around, rich }) => ({ body: place(loftBody(c, sections, around, rich)), details: place(carDetails(c, rich, police)) });
      return [type, { fitted: c, near: lod(DETAIL.near), far: lod(DETAIL.far) }];
    }),
  );
}

// The painted skin of a fitted body type in side projection (u = x / length, v = y / height): plain white paint,
// darker panel gaps, door handles, a dark sill and arch lips. The paint colour multiplies it per car.
export function skinTexture(c) {
  const [w, h] = [1024, 256];
  const X = (x) => (x / c.length) * w;
  const Y = (y) => (1 - y / c.height) * h;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [w, h];
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a2a2a';
  g.fillRect(0, Y(SILL), w, h - Y(SILL)); // rocker panel and lower body
  // Side windows, the B-pillar left in black; windscreen and rear window on the top row.
  const glass = g.createLinearGradient(0, Y(c.height), 0, Y(c.belt));
  glass.addColorStop(0, '#2b333d');
  glass.addColorStop(1, '#0c0f13');
  g.fillStyle = glass;
  g.beginPath();
  c.glass.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
  g.closePath();
  g.fill();
  if (c.pillar) {
    g.fillStyle = '#141414';
    g.fillRect(X(c.pillar - 0.05), 0, X(0.1), Y(c.belt));
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
    g.strokeRect(X(x0), Y(c.belt - 0.02), X(x1) - X(x0), Y(SILL) - Y(c.belt - 0.02));
    g.fillStyle = 'rgba(0, 0, 0, 0.45)';
    g.fillRect(X(x0 + 0.12), Y(c.belt - 0.12), X(0.16), 4); // handle, near the door's rear edge
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
  g.arc(X(c.axles[0] + c.wheel + 0.25), Y(c.belt - 0.15), 5, 0, Math.PI * 2); // fuel flap
  g.fill();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// The details atlas: a made-up number plate top left, plain white top right, and below them a police car's side
// band (`police`: { text, band, lettering }, colours as numbers), its lettering drawn to read upright on BAND.
export function detailAtlas(police) {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [512, 256];
  const g = canvas.getContext('2d');
  const hex = (colour) => `#${colour.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(police.band);
  g.fillRect(0, 128, 512, 128);
  g.save();
  g.fillStyle = hex(police.lettering);
  g.font = 'bold 100px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.translate(256, 196);
  g.scale(512 / BAND.length / (120 / BAND.height), 1); // the band is far longer than its 512 × 120 strip is wide
  g.fillText(police.text, 0, 0);
  g.restore();
  g.scale(2, 2); // the plate half, drawn at 256 × 64
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
  g.fillText('XR 207 LM', 64, 44);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
