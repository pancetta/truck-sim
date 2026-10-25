import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIRS } from './sim/map.js';
import { createTruckParts } from './truckLook.js';

// CC0 kit models in public/models/ (see CREDITS.md).
const MODELS = `${import.meta.env.BASE_URL}models/`;
// Road pieces with the sides they open to, as modelled (DIRS order: north/-z, east/+x, south/+z, west/-x).
const ROAD_PIECES = [
  ['roads/road-square.glb', []],
  ['roads/road-end-round.glb', [1]],
  ['roads/road-straight.glb', [1, 3]],
  ['roads/road-bend-square.glb', [2, 3]],
  ['roads/road-intersection.glb', [1, 2, 3]],
  ['roads/road-crossroad.glb', [0, 1, 2, 3]],
];
const BUILDINGS = [...'abcdefghijklmn'].map((l) => `commercial/low-detail-building-${l}.glb`);
const CARS = ['cars/sedan.glb', 'cars/suv.glb', 'cars/van.glb'];
const POLE = 'roads/light-square.glb';
const TRUCK = 'cars/delivery.glb';
const roadHeight = 0.06; // m, kerb top; the kit's road surface sits at half of it

const loader = new GLTFLoader();
const kitMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// Stretches a geometry into the unit box: x and z in [-0.5, 0.5], y in [0, 1].
function unitBox(geometry) {
  const { min, max } = geometry.boundingBox;
  return geometry
    .translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2)
    .scale(1 / (max.x - min.x), 1 / (max.y - min.y), 1 / (max.z - min.z));
}

// RGBA bytes of a colour-map image, read once per image.
const pixelCache = new WeakMap();
function readPixels(image) {
  if (!pixelCache.has(image)) {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [image.width, image.height];
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    pixelCache.set(image, context.getImageData(0, 0, image.width, image.height));
  }
  return pixelCache.get(image);
}

// Draws Sim state; never writes to it. `onProgress` gets the loaded share of the kit models (0..1);
// the returned `ready` resolves once all of them are in the scene.
export function createRenderer(canvas, tables, map, onProgress) {
  const { palette, camera: cam, city } = tables;
  const kitColours = Object.entries(tables.kitColours);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.add(new THREE.HemisphereLight(palette.light, palette.shade, tables.lighting.ambient));
  const sun = new THREE.DirectionalLight(palette.light, tables.lighting.sun);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshLambertMaterial({ color: palette.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // City from the parsed map, built from kit models. Each model is one instanced draw call.
  const ts = map.tileSize;
  const hash = (x, z) => Math.abs(Math.sin(x * 12.9898 + z * 78.233)); // stable pseudo-random per place
  const pick = (list, x, z) => list[Math.floor(hash(x, z) * 9973) % list.length];
  const centre = (b) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
  const placements = new Map(); // model file -> [{ x, z, angle, size: [x, y, z], tint }]
  const place = (file, p) => (placements.get(file) ?? placements.set(file, []).get(file)).push(p);
  const loads = []; // every kit-model load, up to being added to the scene

  for (const { col, row } of map.roads) {
    const open = DIRS.map(([dc, dr]) => map.isRoad(col + dc, row + dr));
    // Turning a piece a quarter turn moves each open side from direction i to i - 1.
    for (const [file, sides] of ROAD_PIECES) {
      const turn = [0, 1, 2, 3].find((k) => open.every((o, i) => o === sides.includes((i + k) % 4)));
      if (turn === undefined) continue;
      place(file, { x: (col + 0.5) * ts, z: (row + 0.5) * ts, angle: (turn * Math.PI) / 2, size: [ts, roadHeight, ts] });
      break;
    }
  }

  // Only buildings that face a drivable tile are drawn; the solid block behind them stays empty.
  const [low, high] = city.buildingHeight;
  const blocks = map.colliders.filter((b) => b.kind === 'building' || b.kind === 'spot');
  const solid = new Set(blocks.map((b) => `${Math.floor(b.minX / ts)},${Math.floor(b.minZ / ts)}`));
  for (const b of blocks) {
    const [col, row] = [Math.floor(b.minX / ts), Math.floor(b.minZ / ts)];
    if (DIRS.every(([dc, dr]) => solid.has(`${col + dc},${row + dr}`))) continue;
    const { x, z } = centre(b);
    place(pick(BUILDINGS, x, z), {
      x,
      z,
      angle: (Math.floor(hash(z, x) * 4) * Math.PI) / 2,
      size: [ts, low + (high - low) * hash(x, z), ts],
      tint: b.kind === 'spot' ? palette.spot : pick(palette.buildings, z, x),
    });
  }

  for (const b of map.colliders.filter((c) => c.kind === 'car')) {
    const { x, z } = centre(b);
    const alongX = b.maxX - b.minX > b.maxZ - b.minZ;
    const [w, l] = alongX ? [b.maxZ - b.minZ, b.maxX - b.minX] : [b.maxX - b.minX, b.maxZ - b.minZ];
    // Kit cars point along +z; parked either way round.
    const angle = (alongX ? Math.PI / 2 : 0) + (hash(x, z) > 0.5 ? Math.PI : 0);
    place(pick(CARS, z, x), { x, z, angle, size: [w, city.obstacles.car.height, l] });
  }

  // The lamp's arm points along its -z; turn it out over the road tile it stands on.
  for (const b of map.colliders.filter((c) => c.kind === 'pole')) {
    const { x, z } = centre(b);
    const angle = Math.atan2(x - (Math.floor(x / ts) + 0.5) * ts, z - (Math.floor(z / ts) + 0.5) * ts);
    place(POLE, { x, z, angle, size: [1, 1, 1] });
  }

  for (const [file, list] of placements) {
    // Building walls are white so their per-building tint shows as is.
    loads.push(loadModel(file, BUILDINGS.includes(file) ? { ...palette, wall: 0xffffff } : palette).then((geometry) => {
      // The pole keeps its proportions (and its own origin, at the post); everything else is stretched to its box.
      if (file === POLE) {
        const { min, max } = geometry.boundingBox;
        const s = city.obstacles.pole.height / (max.y - min.y);
        geometry.translate(0, -min.y, 0).scale(s, s, s);
      } else unitBox(geometry);
      addInstances(geometry, list);
    }));
  }
  addBoxes(palette.zone, map.spots.map((s) => s.zone), 0.04);

  // Traffic lights, our own boxes: per approach, a post on the junction's far right corner with its lamps
  // (red, amber, green from the top) facing the drivers, and a stop line across the right half of the road.
  // The lamps are one-sided planes, so a light seen from the side or behind shows no colour.
  // shortcut: the posts aren't solid (no collider), so cutting a corner over the pavement drives through one;
  // add colliders in parseMap if players notice.
  // Right of travel direction (dc, dr) is (-dr, dc).
  const LAMP_PHASES = ['red', 'amber', 'green'];
  const lampColours = [palette.lampRed, palette.lampAmber, palette.lampGreen];
  const signal = mergeGeometries([
    new THREE.BoxGeometry(0.2, 4.6, 0.2).translate(0, 2.3, 0),
    new THREE.BoxGeometry(0.5, 1.4, 0.35).translate(0, 3.85, 0),
  ]);
  const signals = new THREE.InstancedMesh(signal, new THREE.MeshLambertMaterial({ color: palette.signal }), map.lights.length);
  const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial(), map.lights.length * 3);
  const stopLines = [];
  const inset = 0.3; // m from the tile edges to the post; closer in, right turns from the kerb lane clip it
  const m = new THREE.Matrix4();
  map.lights.forEach((l, i) => {
    const [dc, dr] = DIRS[l.dir];
    const reach = ts / 2 - inset;
    const [px, pz] = [l.x + dc * (ts - inset) - dr * reach, l.z + dr * (ts - inset) + dc * reach];
    m.makeRotationY(Math.atan2(-dc, -dr)).setPosition(px, 0, pz);
    signals.setMatrixAt(i, m);
    for (let k = 0; k < 3; k++) {
      lamps.setMatrixAt(i * 3 + k, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 4.3 - k * 0.45, 0.19)));
    }
    const lane = ts / 2 - 1.4; // the pavement is the outer 1.4 m
    const [ax, az] = [l.x - dr * 0.3, l.z + dc * 0.3];
    const [bx, bz] = [l.x - dc * 0.5 - dr * lane, l.z - dr * 0.5 + dc * lane];
    stopLines.push({ minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) });
  });
  scene.add(signals, lamps);
  addBoxes(palette.stopLine, stopLines, 0.045);
  let shownPhases = null;

  function addInstances(geometry, list) {
    const mesh = new THREE.InstancedMesh(geometry, kitMaterial, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    list.forEach((p, i) => {
      m.compose(new THREE.Vector3(p.x, 0, p.z), q.setFromAxisAngle(up, p.angle), new THREE.Vector3(...p.size));
      mesh.setMatrixAt(i, m);
      if (p.tint !== undefined) mesh.setColorAt(i, tint.setHex(p.tint));
    });
    scene.add(mesh);
  }

  // One instanced draw call per colour; boxes stand on the ground, `height` tall unless they carry their own.
  function addBoxes(color, boxes, height) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color }), boxes.length);
    const m = new THREE.Matrix4();
    boxes.forEach((b, i) => {
      const h = b.height ?? height;
      m.makeScale(b.maxX - b.minX, h, b.maxZ - b.minZ).setPosition((b.minX + b.maxX) / 2, h / 2, (b.minZ + b.maxZ) / 2);
      mesh.setMatrixAt(i, m);
    });
    scene.add(mesh);
  }

  // Active order's zone: a see-through column, one colour for the pickup and one for the drop-off,
  // tall enough to show over the roofs.
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(ts, city.markerHeight, ts),
    new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
  );
  marker.position.y = city.markerHeight / 2;
  scene.add(marker);

  // A kit model as one flat-coloured geometry: each face takes the palette colour named by the
  // kit colour nearest to its colour-map sample (tables.kitColours). `colours` overrides palette entries.
  async function loadModel(file, colours = palette) {
    const gltf = await loader.loadAsync(MODELS + file);
    gltf.scene.updateMatrixWorld();
    const parts = [];
    const c = new THREE.Color();
    gltf.scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const source = mesh.geometry.toNonIndexed();
      const uv = source.getAttribute('uv');
      const { data, width, height } = readPixels(mesh.material.map.image);
      const colour = new Float32Array(uv.count * 3);
      for (let i = 0; i < uv.count; i += 3) {
        const u = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3;
        const v = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3;
        const p = 4 * (Math.min(height - 1, Math.floor(v * height)) * width + Math.min(width - 1, Math.floor(u * width)));
        c.setHex(colours[nearestKitColour(data[p], data[p + 1], data[p + 2])]);
        for (let k = 0; k < 3; k++) c.toArray(colour, (i + k) * 3);
      }
      const part = new THREE.BufferGeometry();
      part.setAttribute('position', source.getAttribute('position'));
      part.setAttribute('color', new THREE.BufferAttribute(colour, 3));
      parts.push(part.applyMatrix4(mesh.matrixWorld));
    });
    // Free the decoded colour maps now; they are never drawn.
    gltf.scene.traverse((mesh) => mesh.material?.map?.image.close?.());
    const geometry = mergeGeometries(parts);
    geometry.computeBoundingBox();
    return geometry;
  }

  function nearestKitColour(r, g, b) {
    let best;
    let bestDistance = Infinity;
    for (const [name, hex] of kitColours) {
      const d = (r - (hex >> 16)) ** 2 + (g - ((hex >> 8) & 255)) ** 2 + (b - (hex & 255)) ** 2;
      if (d < bestDistance) [best, bestDistance] = [name, d];
    }
    return best;
  }

  // Truck from the kit, stretched to the collision footprint; the cab is at the front (+z). Its body and cab
  // faces load in marker colours, so a paint item can recolour them later (see paint()).
  const truck = new THREE.Group();
  const exterior = new THREE.Mesh(new THREE.BufferGeometry(), kitMaterial);
  const MARKS = { body: 0xff00ff, cab: 0x00ffff }; // in no palette
  const painted = { body: [], cab: [] }; // vertex indices
  loads.push(loadModel(TRUCK, { ...palette, green: MARKS.body, wall: MARKS.cab }).then((geometry) => {
    const { min, max } = geometry.boundingBox;
    const s = tables.vehicle.width / (max.x - min.x);
    exterior.geometry = unitBox(geometry);
    exterior.scale.set(tables.vehicle.width, (max.y - min.y) * s, tables.vehicle.length);
    const colour = geometry.getAttribute('color');
    const c = new THREE.Color();
    for (const [part, hex] of Object.entries(MARKS)) {
      c.setHex(hex);
      for (let i = 0; i < colour.count; i++) {
        if (colour.getX(i) === Math.fround(c.r) && colour.getY(i) === Math.fround(c.g) && colour.getZ(i) === Math.fround(c.b)) painted[part].push(i);
      }
    }
    shownLook = null; // paint the loaded truck
  }));
  truck.add(exterior);
  const parts = createTruckParts(tables);
  truck.add(parts.exterior);

  let shownLook = null;

  function paint({ body, cab }) {
    const colour = exterior.geometry.getAttribute('color');
    if (!colour) return; // not loaded yet
    const c = new THREE.Color();
    for (const [part, key] of [['body', body], ['cab', cab]]) {
      c.setHex(palette[key]);
      for (const i of painted[part]) colour.setXYZ(i, c.r, c.g, c.b);
    }
    colour.needsUpdate = true;
  }

  function showLook(look) {
    const ids = Object.values(look);
    const key = ids.join();
    if (key === shownLook) return;
    shownLook = key;
    paint(tables.visuals[look.paint]);
    parts.show(ids);
  }

  // Cab interior, our own design: a dashboard and a steering wheel, shown only in the cab view.
  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.6), new THREE.MeshLambertMaterial({ color: palette.dashboard }));
  dashboard.position.set(0, 1.85, 3.65);
  const wheelMaterial = new THREE.MeshLambertMaterial({ color: palette.steeringWheel });
  // The column tilts the wheel towards the driver; the wheel spins about the column's axis (local +z).
  const column = new THREE.Group();
  column.position.set(cam.cabEye[0], 2.08, 3.32);
  column.rotation.x = 0.9;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5), wheelMaterial);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.25;
  const wheel = new THREE.Group();
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.03), wheelMaterial);
  spoke.position.y = -0.11;
  wheel.add(
    new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), wheelMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.03), wheelMaterial),
    spoke,
  );
  column.add(shaft, wheel);
  const interior = new THREE.Group();
  interior.add(dashboard, column, parts.cab);
  truck.add(interior);
  scene.add(truck);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const eye = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let lastFrame = performance.now();
  let cabView = true;
  let orbit = 0; // rad, showroom camera angle round the truck
  let shifted = false; // whether the picture is moved aside for the Werkstatt panel

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    shifted = false; // shift() sets the offset again for the new size
    camera.clearViewOffset();
  }

  function shift(on) {
    if (on === shifted) return;
    shifted = on;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (on) camera.setViewOffset(w, h, w * tables.showroom.shift, 0, w, h);
    else camera.clearViewOffset();
  }
  window.addEventListener('resize', resize);
  resize();

  // `look` is slot → visual item id for every slot (the equipped items plus any Werkstatt previews). `showroom` is null
  // while driving, 'orbit' for the Werkstatt's circling camera, or 'cab' to show the gimmick from the seat.
  function render(state, input, look, showroom) {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    const { x, z, heading, roll } = state.truck;
    truck.position.set(x, 0, z);
    truck.rotation.set(0, heading, roll); // XYZ order: roll about the truck's own forward axis
    // Same angle as the on-screen wheel; positive is clockwise from the driver's seat.
    wheel.rotation.z = THREE.MathUtils.degToRad(input.steer * tables.controls.wheelLock);
    showLook(look);
    parts.sway(roll, dt);

    const phases = state.lights.map((l) => l.phase).join();
    if (phases !== shownPhases && state.lights.length) {
      shownPhases = phases;
      const c = new THREE.Color();
      state.lights.forEach((l, i) =>
        LAMP_PHASES.forEach((p, k) => lamps.setColorAt(i * 3 + k, c.setHex(l.phase === p ? lampColours[k] : palette.lampOff))),
      );
      lamps.instanceColor.needsUpdate = true;
    }

    const { order } = state;
    marker.visible = !!order;
    if (order) {
      const { zone } = map.spots.find((s) => s.id === (order.phase === 'pickup' ? order.pickup : order.dropoff));
      marker.position.x = (zone.minX + zone.maxX) / 2;
      marker.position.z = (zone.minZ + zone.maxZ) / 2;
      marker.material.color.setHex(order.phase === 'pickup' ? palette.pickup : palette.dropoff);
    }

    // Each view shows one side of the cab: the kit's cab is lower than our interior.
    const inCab = showroom ? showroom === 'cab' : cabView;
    exterior.visible = parts.exterior.visible = !inCab;
    interior.visible = inCab;
    shift(!!showroom);
    if (!showroom) orbit = 0;
    if (showroom === 'orbit') {
      const { radius, height, lookHeight, speed } = tables.showroom;
      orbit += speed * dt;
      const a = heading + Math.PI + 0.7 + orbit; // starts behind the truck, off to one side
      camera.position.set(x + Math.sin(a) * radius, height, z + Math.cos(a) * radius);
      camera.lookAt(x, lookHeight, z);
    } else if (inCab) {
      // Truck-space points, so the camera follows anything that moves the truck.
      camera.position.copy(truck.localToWorld(eye.fromArray(cam.cabEye)));
      camera.lookAt(truck.localToWorld(lookAt.fromArray(showroom ? cam.gimmickLook : cam.cabLook)));
    } else {
      // Basic chase camera: fixed offset behind and above the truck.
      camera.position.set(
        x - Math.sin(heading) * cam.chaseDistance,
        cam.chaseHeight,
        z - Math.cos(heading) * cam.chaseDistance,
      );
      camera.lookAt(x, cam.lookHeight, z);
    }
    renderer.render(scene, camera);
  }

  function toggleCamera() {
    cabView = !cabView;
  }

  // A model that fails to load is logged and left out, as before; it doesn't hold up the game.
  let loaded = 0;
  const ready = Promise.all(loads.map((load) => load.catch(console.error).then(() => onProgress(++loaded / loads.length))));

  return { render, toggleCamera, ready };
}
