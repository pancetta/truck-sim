// The pedestrians' look (#78, tables.pedestrians), our own: figures of boxes with a round head, standing on the
// pavement and facing the way they walk. Within `near` m of the truck in full detail (legs, body and arms in the
// outfit, the trousers a darker shade; head and hands in the skin tone; casting shadows), farther a box body and a box
// head without shadows. Each detail level is two instanced meshes, the outfit's and the skin's, coloured per
// instance; a pedestrian's id picks both colours. Only the ones in view are drawn.
// shortcut: they glide without moving their legs; animate them if players notice up close.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured } from './streets.js';

const TROUSERS = 0x555555; // times the outfit's colour

export function createPeople(scene, tables) {
  const p = tables.pedestrians;
  const ground = tables.streets.pavement.height;
  const k = p.height / 1.75; // the sizes below are for a 1.75 m figure
  // A box `w` wide, `h` tall and `d` deep, its middle `x` m to the side, from `y` m up.
  const box = (w, h, d, x, y) => new THREE.BoxGeometry(w * k, h * k, d * k).translate(x * k, (y + h / 2) * k, 0);
  const merged = (parts) => mergeGeometries(parts.map(([g, colour]) => coloured(g, colour)));
  const levels = [
    [
      merged([[box(0.15, 0.85, 0.18, -0.09, 0), TROUSERS], [box(0.15, 0.85, 0.18, 0.09, 0), TROUSERS], [box(0.42, 0.62, 0.24, 0, 0.85), 0xffffff], [box(0.1, 0.58, 0.12, -0.26, 0.88), 0xffffff], [box(0.1, 0.58, 0.12, 0.26, 0.88), 0xffffff]]),
      merged([[new THREE.SphereGeometry(0.11 * k, 10, 8).translate(0, 1.6 * k, 0), 0xffffff], [box(0.09, 0.1, 0.1, -0.26, 0.78), 0xffffff], [box(0.09, 0.1, 0.1, 0.26, 0.78), 0xffffff]]),
    ],
    [merged([[box(0.34, 0.85, 0.2, 0, 0), TROUSERS], [box(0.48, 0.62, 0.24, 0, 0.85), 0xffffff]]), merged([[box(0.2, 0.22, 0.2, 0, 1.49), 0xffffff]])],
  ];
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const [outfits, skins] = [p.outfits, p.skins].map((list) => list.map((c) => new THREE.Color(c)));
  // Per level its { mesh, colour (of a pedestrian's id) }.
  const meshes = levels.map((parts, level) =>
    parts.map((geometry, part) => {
      const mesh = new THREE.InstancedMesh(geometry, material, p.count);
      mesh.frustumCulled = false; // update() puts the ones in view into it
      Object.assign(mesh, { castShadow: level === 0, receiveShadow: true });
      mesh.setColorAt(0, outfits[0]); // allocates the colours
      scene.add(mesh);
      return { mesh, colour: part ? (id) => skins[Math.floor(id / outfits.length) % skins.length] : (id) => outfits[id % outfits.length] };
    }));
  const all = meshes.flat().map(({ mesh }) => mesh);
  // The first update leaves them all visible, so their shaders are set up before the first pedestrian comes into view.
  let warm = true;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const bounds = new THREE.Sphere(new THREE.Vector3(), p.height / 2 + 0.3);

  // Draws the Sim's `pedestrians` that pass `inView` (a test on a bounding sphere), in detail within `near` of `truck`.
  function update(pedestrians, truck, inView) {
    for (const mesh of all) mesh.count = 0;
    for (const q of pedestrians) {
      bounds.center.set(q.x, ground + p.height / 2, q.z);
      if (!inView(bounds)) continue;
      const level = meshes[Math.hypot(q.x - truck.x, q.z - truck.z) < p.near ? 0 : 1];
      matrix.compose(position.set(q.x, ground, q.z), turn.setFromAxisAngle(up, q.heading), one);
      for (let i = 0; i < level.length; i++) {
        const { mesh, colour } = level[i];
        mesh.setMatrixAt(mesh.count, matrix);
        mesh.setColorAt(mesh.count, colour(q.id));
        mesh.count++;
      }
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
