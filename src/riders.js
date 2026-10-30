// The two-wheelers' look (#77, tables.traffic.twoWheelers), our own: a scooter with its rider seated upright, and a
// bicycle with its rider leaning over the bars, built from boxes, cylinders and rings with the front towards +z, standing
// on y = 0. A scooter is drawn in one of the cars' paints, a bicycle and its rider's shirt in one of the pedestrians'
// outfits; an AI car's id picks it, as for the cars. That instance colour tints the whole model, so the parts that
// should keep their own colour are dark (tyres, seat, jacket, trousers), where it hardly shows. The rider's helmet
// (#102) is a mesh of its own in one of tables.traffic.helmets, a shell over a dark face, bigger than a head so it
// shows far off too. Per kind, a near level within vehicles.near of the truck (casting shadows) and a far one of a few
// boxes; each level one instanced mesh, and one for the helmets, coloured per instance. Only the ones in view are
// drawn. Street events' garbage trucks (#80) are drawn here too: a white cab and a compactor body on a car's
// footprint, with an orange band and a beacon.
// shortcut: the wheels and the riders' legs don't turn; animate them if players notice up close.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured } from './streets.js';

const PAINTED = 0xffffff; // times the instance's colour
const TYRE = 0x1c1c1c;
const METAL = 0x6a6d72;
const SEAT = 0x2b2522;
const JACKET = 0x3a3d45; // the scooter rider's
const TROUSERS = 0x555555; // times the cyclist's shirt colour

// A box `w` wide, `h` tall and `d` deep, its bottom middle at (x, y, z), tilted forward by `tilt` rad about its bottom.
const box = (w, h, d, x, y, z, tilt = 0) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateX(tilt).translate(x, y, z);
// A wheel of radius r on the axle across at (y, z): a ring (near) or a thin disc of a box (far).
const ring = (r, tube, y, z) => new THREE.TorusGeometry(r, tube, 6, 20).rotateY(Math.PI / 2).translate(0, y, z);
const tyre = (r, w, y, z) => new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2).translate(0, y, z);
const ball = (r, y, z) => new THREE.SphereGeometry(r, 10, 8).translate(0, y, z);
const merged = (parts) => mergeGeometries(parts.map(([g, colour]) => coloured(g, colour)));

// Per kind, [near, far] geometries.
const MODELS = {
  scooter: () => [
    merged([
      [tyre(0.2, 0.1, 0.2, -0.62), TYRE], [tyre(0.2, 0.1, 0.2, 0.62), TYRE],
      [box(0.42, 0.4, 0.8, 0, 0.24, -0.32), PAINTED], // the rounded rear shell, as a box
      [box(0.3, 0.07, 0.5, 0, 0.22, 0.12), PAINTED], // the floorboard
      [box(0.42, 0.66, 0.07, 0, 0.28, 0.42, -0.2), PAINTED], // the leg shield
      [box(0.16, 0.1, 0.32, 0, 0.4, 0.62), PAINTED], // the front mudguard
      [box(0.05, 0.3, 0.05, 0, 0.92, 0.5, -0.2), METAL], [box(0.68, 0.04, 0.05, 0, 1.18, 0.44), METAL], // column, bars
      [box(0.13, 0.1, 0.05, 0, 1.04, 0.55), 0xfff2c8], // the headlight
      [box(0.3, 0.09, 0.55, 0, 0.64, -0.3), SEAT],
      // The rider: thighs along the seat, shins down to the floorboard, torso, arms to the bars.
      [box(0.14, 0.14, 0.45, -0.1, 0.72, -0.05), TROUSERS], [box(0.14, 0.14, 0.45, 0.1, 0.72, -0.05), TROUSERS],
      [box(0.12, 0.45, 0.12, -0.1, 0.29, 0.15), TROUSERS], [box(0.12, 0.45, 0.12, 0.1, 0.29, 0.15), TROUSERS],
      [box(0.4, 0.58, 0.24, 0, 0.74, -0.3, 0.12), JACKET],
      [box(0.09, 0.09, 0.62, -0.24, 1.2, 0.12, 0.25), JACKET], [box(0.09, 0.09, 0.62, 0.24, 1.2, 0.12, 0.25), JACKET],
    ]),
    merged([
      [box(0.1, 0.4, 1.6, 0, 0, 0), TYRE],
      [box(0.42, 0.42, 0.8, 0, 0.24, -0.32), PAINTED], [box(0.42, 0.7, 0.1, 0, 0.28, 0.42), PAINTED],
      [box(0.4, 0.75, 0.3, 0, 0.72, -0.25), JACKET],
    ]),
  ],
  bicycle: () => [
    merged([
      [ring(0.33, 0.025, 0.35, -0.53), TYRE], [ring(0.33, 0.025, 0.35, 0.53), TYRE],
      [box(0.04, 0.04, 0.62, 0, 0.78, 0.02), PAINTED], // top tube
      [box(0.04, 0.04, 0.7, 0, 0.36, 0.12, -0.6), PAINTED], // down tube, from the bottom bracket up to the head
      [box(0.04, 0.48, 0.04, 0, 0.35, -0.2, -0.2), PAINTED], // seat tube
      [box(0.03, 0.04, 0.55, 0, 0.35, -0.38), PAINTED], // chain stays
      [box(0.04, 0.52, 0.04, 0, 0.35, 0.5, -0.25), METAL], // fork
      [box(0.5, 0.03, 0.04, 0, 0.95, 0.42), METAL], [box(0.12, 0.05, 0.24, 0, 0.88, -0.3), SEAT],
      // The rider: legs down to the pedals, torso leaning forward, arms to the bars.
      [box(0.13, 0.62, 0.13, -0.1, 0.3, -0.05, -0.35), TROUSERS], [box(0.13, 0.62, 0.13, 0.1, 0.3, -0.05, -0.1), TROUSERS],
      [box(0.38, 0.6, 0.22, 0, 0.9, -0.3, 0.75), PAINTED],
      [box(0.08, 0.55, 0.08, -0.22, 0.95, 0.4, -0.55), PAINTED], [box(0.08, 0.55, 0.08, 0.22, 0.95, 0.4, -0.55), PAINTED], // sleeves
    ]),
    merged([
      [box(0.05, 0.7, 1.4, 0, 0, 0), TYRE],
      [box(0.36, 0.55, 0.3, 0, 0.85, -0.15, 0.7), PAINTED],
    ]),
  ],
  garbage: () => [
    merged([
      ...[-0.78, 0.78].flatMap((x) => [1.4, -1.2].map((z) => [tyre(0.38, 0.28, 0.38, z).translate(x, 0, 0), TYRE])),
      [box(1.6, 0.35, 4.3, 0, 0.3, 0), TYRE], // chassis
      [box(1.85, 1.55, 1.35, 0, 0.55, 1.5), PAINTED], // cab
      [box(1.7, 0.6, 0.05, 0, 1.35, 2.18), 0x22303a], // windscreen
      [box(1.9, 1.75, 2.9, 0, 0.6, -0.75), PAINTED], // compactor body
      [box(1.92, 0.15, 2.92, 0, 1.15, -0.75), 0xe8731c], // band
      [box(1.8, 1.3, 0.4, 0, 0.55, -2.05), METAL], // rear loader
      [box(1.82, 0.15, 0.42, 0, 1.15, -2.05), 0xe8731c], [box(1.82, 0.12, 0.42, 0, 0.62, -2.05), 0xe8731c], // its bands
      [box(0.25, 0.15, 0.25, 0, 2.1, 1.6), 0xffa21f], // beacon
    ]),
    merged([
      [box(1.6, 0.75, 4.3, 0, 0, 0), TYRE],
      [box(1.85, 1.55, 1.35, 0, 0.55, 1.5), PAINTED], [box(1.9, 1.75, 2.9, 0, 0.6, -0.75), PAINTED],
    ]),
  ],
};
// Per two-wheeler kind, [near, far] helmets on the rider's head, its middle at (y, z): near, a dark face under a shell
// cut off above the ears, longer than wide, with a peak (a cyclist's) or a visor (a scooter rider's, rounder); far, a
// box of the shell's size.
const FACE = 0x2a2624; // times the helmet's colour
const SHELL = 0xffffff;
const shell = (r, cut, y, z, sx, sz) => new THREE.SphereGeometry(r, 14, 8, 0, 2 * Math.PI, 0, cut * Math.PI).scale(sx, 1, sz).translate(0, y, z);
const HELMETS = {
  scooter: () => [
    merged([[ball(0.13, 1.5, -0.2), FACE], [shell(0.19, 0.62, 1.5, -0.22, 1, 1.08), SHELL], [box(0.26, 0.1, 0.05, 0, 1.47, -0.03), FACE]]),
    merged([[box(0.38, 0.34, 0.42, 0, 1.36, -0.24), SHELL]]),
  ],
  bicycle: () => [
    merged([[ball(0.11, 1.36, 0.18), FACE], [shell(0.17, 0.5, 1.38, 0.17, 0.95, 1.3), SHELL], [box(0.2, 0.03, 0.08, 0, 1.4, 0.38, -0.3), SHELL]]),
    merged([[box(0.34, 0.22, 0.44, 0, 1.3, 0.16), SHELL]]),
  ],
};
const RADIUS = { garbage: 2.6 }; // m, the bounding sphere's; 1.2 for a two-wheeler

export function createRiders(scene, tables, ground) {
  const room = Math.max(...tables.rank.tiers.map((t) => t.traffic)); // more than the tier's two-wheelers
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
  const colours = {
    scooter: tables.vehicles.paints.map((hex) => new THREE.Color(hex)),
    bicycle: tables.pedestrians.outfits.map((hex) => new THREE.Color(hex)),
    garbage: [new THREE.Color(0xf2f2ee)],
  };
  const helmets = tables.traffic.helmets.map((hex) => new THREE.Color(hex));
  const all = [];
  const instanced = (geometry, level) => {
    const mesh = new THREE.InstancedMesh(geometry, material, room);
    mesh.frustumCulled = false; // update() puts the ones in view into it
    Object.assign(mesh, { castShadow: level === 0, receiveShadow: true });
    mesh.setColorAt(0, helmets[0]); // allocates the colours
    scene.add(mesh);
    all.push(mesh);
    return mesh;
  };
  // Per kind, [near, far] instanced meshes, and a two-wheeler's [near, far] helmets.
  const meshes = {};
  const heads = {};
  for (const [kind, model] of Object.entries(MODELS)) {
    meshes[kind] = model().map(instanced);
    if (HELMETS[kind]) heads[kind] = HELMETS[kind]().map(instanced);
  }
  // The first update leaves them all visible, so their shaders are set up before the first one comes into view.
  let warm = true;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const bounds = new THREE.Sphere(new THREE.Vector3(), 1.2); // its radius set per kind

  // Draws the two-wheelers and garbage trucks among the Sim's AI `cars` that pass `inView` (a test on a bounding sphere), in detail within
  // vehicles.near of `truck`.
  function update(cars, truck, inView) {
    for (const mesh of all) mesh.count = 0;
    for (const car of cars) {
      const pair = meshes[car.kind];
      if (!pair) continue;
      const y = ground.heightAt(car.x, car.z);
      bounds.center.set(car.x, y + 0.8, car.z);
      bounds.radius = RADIUS[car.kind] ?? 1.2;
      if (!inView(bounds)) continue;
      const level = Math.hypot(car.x - truck.x, car.z - truck.z) < tables.vehicles.near ? 0 : 1;
      const mesh = pair[level];
      if (mesh.count === room) continue; // cars leaving through a gate don't count against the tier
      const list = colours[car.kind];
      // Pitched with the ground over its length (#109), as renderer.js's drawCar pitches the cars.
      const pitch = Math.atan(ground.slopeAt(car.x, car.z, Math.sin(car.heading), Math.cos(car.heading), car.size.length / 2));
      matrix.compose(position.set(car.x, y, car.z), turn.setFromEuler(euler.set(-pitch, car.heading, 0, 'YXZ')), one);
      mesh.setMatrixAt(mesh.count, matrix);
      mesh.setColorAt(mesh.count, list[(car.id * 7) % list.length]);
      mesh.count++;
      const head = heads[car.kind]?.[level];
      if (!head) continue;
      head.setMatrixAt(head.count, matrix);
      head.setColorAt(head.count, helmets[(car.id * 5) % helmets.length]);
      head.count++;
    }
    for (const mesh of all) {
      mesh.visible = warm || mesh.count > 0;
      // Only the instances in use go up to the GPU.
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
      mesh.instanceColor.needsUpdate = true;
    }
    warm = false;
  }

  return { update };
}
