// PROTOTYPE (throwaway): generic parked vehicles built from code, so they're our own shapes (no real makes).
// Cars are a side profile extruded across the width, with a dark glass band, tyres and hubs; scooters and bikes are
// assembled from boxes and rods. Each kind comes back as one merged geometry per material, length along +x,
// width along z, standing on y = 0, centred on x = z = 0.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Side profile [x, y] from the rear (x = 0), window band, axles, width.
const CARS = {
  city: {
    body: [[0, 0.25], [0, 0.85], [0.15, 0.95], [0.35, 1.45], [1.0, 1.49], [2.1, 1.45], [2.75, 0.95], [3.45, 0.8], [3.55, 0.55], [3.5, 0.25]],
    glass: [[0.36, 0.98], [0.5, 1.39], [1.0, 1.42], [2.05, 1.39], [2.62, 0.98]],
    axles: [0.62, 2.9], wheel: 0.28, width: 1.62,
  },
  hatch: {
    body: [[0, 0.3], [0, 0.9], [0.1, 1.0], [0.45, 1.42], [1.2, 1.47], [2.4, 1.44], [3.0, 1.0], [3.85, 0.85], [4.0, 0.6], [3.95, 0.3]],
    glass: [[0.45, 1.02], [0.58, 1.37], [1.2, 1.41], [2.36, 1.39], [2.9, 1.02]],
    axles: [0.7, 3.25], wheel: 0.3, width: 1.75,
  },
  sedan: {
    body: [[0, 0.35], [0, 0.85], [0.05, 0.95], [0.75, 1.0], [1.25, 1.4], [2.75, 1.44], [3.4, 1.0], [4.45, 0.85], [4.6, 0.6], [4.55, 0.33]],
    glass: [[1.24, 1.03], [1.45, 1.36], [2.72, 1.39], [3.32, 1.03]],
    axles: [0.85, 3.6], wheel: 0.31, width: 1.8,
  },
  micro: {
    body: [[0, 0.25], [0, 1.0], [0.1, 1.5], [1.0, 1.55], [1.55, 1.48], [2.2, 1.0], [2.65, 0.85], [2.7, 0.3]],
    glass: [[0.1, 1.05], [0.18, 1.45], [1.0, 1.5], [1.52, 1.44], [2.1, 1.03]],
    axles: [0.45, 2.2], wheel: 0.27, width: 1.6,
  },
  van: {
    body: [[0, 0.35], [0, 2.1], [0.1, 2.2], [3.9, 2.2], [4.35, 1.4], [4.95, 1.05], [5.0, 0.4]],
    glass: [[3.5, 1.4], [3.5, 1.95], [4.06, 1.95], [4.39, 1.4]],
    axles: [0.85, 4.1], wheel: 0.34, width: 2.0,
  },
};

const BEVEL = 0.06;
function extrude(points, width) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = width - 2 * BEVEL;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 2, curveSegments: 4 });
  return g.translate(0, 0, -depth / 2);
}
// A cylinder as a wheel: axis along z.
const wheelAt = (x, y, z, r, w) => new THREE.CylinderGeometry(r, r, w, 18).rotateX(Math.PI / 2).translate(x, y, z).toNonIndexed();
// A box of size [sx, sy, sz] centred at [x, y, z], optionally pitched about z.
const block = ([sx, sy, sz], [x, y, z], pitch = 0) => new THREE.BoxGeometry(sx, sy, sz).rotateZ(pitch).translate(x, y, z).toNonIndexed();
// A thin rod between two points.
function rod(a, b, r) {
  const [A, B] = [new THREE.Vector3(...a), new THREE.Vector3(...b)];
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  return g.translate(...A.add(B).multiplyScalar(0.5).toArray()).toNonIndexed();
}
const merged = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
const centred = (parts, length) => Object.fromEntries(Object.entries(parts).map(([k, g]) => [k, g.translate(-length / 2, 0, 0)]));

export function carGeometries() {
  return Object.fromEntries(
    Object.entries(CARS).map(([kind, c]) => {
      const length = Math.max(...c.body.map(([x]) => x));
      // The glass band sticks out 1 cm past the body on each side and 2 cm along the windscreens.
      const mid = (c.glass[0][0] + c.glass.at(-1)[0]) / 2;
      const glass = extrude(c.glass.map(([x, y]) => [x + Math.sign(x - mid) * 0.02, y]), c.width + 0.02);
      const tyres = [];
      const hubs = [];
      for (const x of c.axles) {
        for (const side of [-1, 1]) {
          tyres.push(wheelAt(x, c.wheel, side * (c.width / 2 - 0.12), c.wheel, 0.22));
          hubs.push(wheelAt(x, c.wheel, side * (c.width / 2 - 0.1), c.wheel * 0.6, 0.23));
        }
      }
      return [kind, { length, width: c.width, ...centred({ body: merged([extrude(c.body, c.width)]), glass: merged([glass]), dark: merged(tyres), metal: merged(hubs) }, length) }];
    }),
  );
}

// A generic step-through scooter, 1.8 m long.
export function scooterGeometry() {
  const body = merged([
    extrude([[0.05, 0.32], [0, 0.55], [0.15, 0.78], [0.72, 0.82], [0.88, 0.45], [0.85, 0.32]], 0.5),
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
