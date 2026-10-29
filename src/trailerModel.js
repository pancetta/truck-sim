// The trailer's model (#96), our own design from code in the realistic look (ADR 0001): a box body in the truck's paint
// over a dark chassis with side guards, a tandem axle at the Sim's axle point, an A-frame drawbar to the hitch eye, and a
// rear bumper with lights and plate. In the trailer's own space: its body's middle at x = z = 0 on the ground, front
// towards +z, as the Sim's state.trailer places it. Two meshes: the painted box (`body`, coloured by the renderer) and
// everything else (`details`, coloured per vertex).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FLOOR = 1.1; // m, the box's underside
const WHEEL = 0.5; // m, radius
const TANDEM = 1.3; // m between the two axles
const ROOF = 0.08; // m, the roof panel's thickness

export function trailerModel(trailer, palette) {
  const { length, width, height, drawbar, axle } = trailer;
  const half = length / 2;
  const parts = [];
  const add = (geometry, colour, x = 0, y = 0, z = 0) => {
    const g = geometry.translate(x, y, z).toNonIndexed();
    const c = new THREE.Color(colour);
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const box = (w, h, l) => new THREE.BoxGeometry(w, h, l);

  // The box: one piece in paint up to the roof, a slightly wider pale roof panel on it, and corner posts in trim, each
  // ending below the roof so no two faces share a plane (#96 QA: the roof z-fought).
  const wall = height - ROOF - FLOOR; // m, the painted sides' height
  const body = box(width - 0.06, wall, length - 0.06).translate(0, FLOOR + wall / 2, 0);
  add(box(width, ROOF, length), 0xd9dbde, 0, height - ROOF / 2, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) add(box(0.1, wall - 0.02, 0.1), palette.trim, (sx * (width - 0.1)) / 2, FLOOR + wall / 2, (sz * (length - 0.1)) / 2);
    // stakes along the sides, as on a curtain-sider
    for (let k = 1; k < 5; k++) add(box(0.04, wall - 0.1, 0.08), palette.dark, (sx * (width - 0.02)) / 2, FLOOR + wall / 2, -half + (k * length) / 5);
  }
  // The rear doors' seam: a band across only, so nothing stands up before the reversing camera (#96 QA).
  add(box(width - 0.1, 0.05, 0.04), palette.dark, 0, FLOOR + wall / 2, -half - 0.01);

  // Chassis: two rails, side underrun guards, mudguards over the wheels.
  for (const sx of [-1, 1]) {
    add(box(0.16, 0.22, length - 0.2), palette.trim, sx * 0.55, FLOOR - 0.11, 0);
    add(box(0.05, 0.1, length * 0.35), palette.dark, (sx * (width - 0.1)) / 2, 0.75, half * 0.55);
  }
  // The axles at the Sim's point, `axle` m behind the hitch, which is `drawbar` m before the body's front.
  const axleZ = half + drawbar - axle;
  const tyre = new THREE.CylinderGeometry(WHEEL, WHEEL, 0.32, 20).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.22, 0.22, 0.34, 12).rotateZ(Math.PI / 2);
  for (const dz of [-TANDEM / 2, TANDEM / 2]) {
    add(box(width - 0.5, 0.12, 0.12), palette.trim, 0, WHEEL, axleZ + dz);
    for (const sx of [-1, 1]) {
      add(tyre.clone(), 0x1b1c20, (sx * (width - 0.36)) / 2, WHEEL, axleZ + dz);
      add(hub.clone(), 0x9aa0a8, (sx * (width - 0.34)) / 2, WHEEL, axleZ + dz);
    }
  }
  for (const sx of [-1, 1]) add(box(0.4, 0.05, TANDEM + 2 * WHEEL + 0.2), palette.trim, (sx * (width - 0.36)) / 2, 2 * WHEEL + 0.08, axleZ);

  // Drawbar: an A-frame from the front of the chassis to the hitch eye.
  const eye = { y: 0.75, z: half + drawbar };
  for (const sx of [-1, 1]) {
    const from = new THREE.Vector3(sx * 0.55, FLOOR - 0.2, half - 0.3);
    const to = new THREE.Vector3(0, eye.y, eye.z - 0.1);
    const bar = box(0.1, 0.1, from.distanceTo(to));
    bar.lookAt(to.clone().sub(from));
    add(bar, palette.trim, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  }
  add(new THREE.TorusGeometry(0.09, 0.03, 6, 12).rotateX(Math.PI / 2), palette.trim, 0, eye.y, eye.z);

  // Rear: bumper, two lamp clusters and the plate.
  add(box(width - 0.2, 0.12, 0.1), palette.trim, 0, 0.62, -half - 0.05);
  for (const sx of [-1, 1]) add(box(0.36, 0.14, 0.04), palette.lampRed, sx * (width / 2 - 0.35), 0.78, -half - 0.07);
  add(box(0.52, 0.12, 0.02), 0xf2f2ee, 0, 0.78, -half - 0.07);

  return { body, details: mergeGeometries(parts) };
}
