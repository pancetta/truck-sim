import * as THREE from 'three/webgpu';
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
const newKitMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
// One kit material per mesh variant: shared across variants, the renderer re-derives the program on every draw.
const kitMaterials = { mesh: newKitMaterial(), instanced: newKitMaterial(), tinted: newKitMaterial() };

// Stretches a geometry into the unit box: x and z in [-0.5, 0.5], y in [0, 1].
function unitBox(geometry) {
  const { min, max } = geometry.boundingBox;
  return geometry
    .translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2)
    .scale(1 / (max.x - min.x), 1 / (max.y - min.y), 1 / (max.z - min.z));
}

// How far along the unit direction (dx, dz) from (x, z) a ray enters box `b` (0 if it starts inside);
// Infinity if it misses.
function rayToBox(x, z, dx, dz, b) {
  let near = 0;
  let far = Infinity;
  for (const [p, d, lo, hi] of [[x, dx, b.minX, b.maxX], [z, dz, b.minZ, b.maxZ]]) {
    const [t0, t1] = [(lo - p) / d, (hi - p) / d];
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
  }
  return near <= far ? near : Infinity;
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
  // WebGPU where the browser has it, else its WebGL 2 backend; ?webgl forces the fallback for comparison.
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // sRGB output in the material shaders, as WebGLRenderer did: the default pipeline draws into a half-float MSAA
  // target and adds a full-screen output pass, which doubled the GPU time on the WebGL 2 backend.
  const pipeline = new THREE.DirectRenderPipeline(renderer);
  // A lost GPU device (iPad Safari under memory pressure) can't be rebuilt in place; the save survives a reload.
  renderer.onDeviceLost = () => location.reload();

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

  // The kit cars, loaded once for the parked cars and the AI cars.
  const carModels = CARS.map((file) => loadModel(file));
  for (const [file, list] of placements) {
    // Building walls are white so their per-building tint shows as is.
    const model = CARS.includes(file) ? carModels[CARS.indexOf(file)] : loadModel(file, BUILDINGS.includes(file) ? { ...palette, wall: 0xffffff } : palette);
    loads.push(model.then((geometry) => {
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

  // Dock bays, our own boxes: a dock edge (a low dark platform) along the building face, and painted lines on
  // either side of the bay, as far apart as the docking check allows. They stand a little above the kerb so
  // they show over the pavement too. The edge isn't solid; the building behind it is.
  const bayHalf = tables.vehicle.width / 2 + tables.orders.dockCentre;
  const bayLines = [];
  const dockEdges = [];
  for (const { dir, zone } of map.spots.filter((s) => s.dock)) {
    const [dc, dr] = DIRS[dir];
    const { x, z } = centre(zone);
    const [fx, fz] = [x - (dc * ts) / 2, z - (dr * ts) / 2]; // middle of the building face
    // The box from `out0` to `out1` m out from the face and `side0` to `side1` m across the bay's centre line.
    const bay = (out0, out1, side0, side1) => {
      const [x0, x1] = [fx + dc * out0 - dr * side0, fx + dc * out1 - dr * side1];
      const [z0, z1] = [fz + dr * out0 + dc * side0, fz + dr * out1 + dc * side1];
      return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) };
    };
    dockEdges.push({ ...bay(-0.5, 0, -bayHalf - 0.5, bayHalf + 0.5), height: 1.1 });
    for (const side of [-bayHalf, bayHalf]) bayLines.push(bay(0, 10, side - 0.12, side + 0.12));
  }
  addBoxes(palette.dark, dockEdges);
  addBoxes(palette.stopLine, bayLines, 0.07);

  // AI cars: one instanced mesh per kit car with room for the busiest rank tier; a car's id picks its model.
  const maxTraffic = Math.max(...tables.rank.tiers.map((t) => t.traffic));
  const trafficMeshes = carModels.map((model) => {
    const mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), kitMaterials.instanced, maxTraffic);
    mesh.frustumCulled = false; // the cars move, so bounds computed once would go stale
    loads.push(model.then((geometry) => (mesh.geometry = unitBox(geometry))));
    scene.add(mesh);
    return mesh;
  });
  const carSize = new THREE.Vector3(city.obstacles.car.width, city.obstacles.car.height, city.obstacles.car.length);

  // Traffic lights, our own boxes: per approach, a post on the junction's far right corner with its lamps
  // (red, amber, green from the top) facing the drivers, and a stop line across the right half of the road.
  // The lamps are one-sided planes, so a light seen from the side or behind shows no colour.
  // The posts stand where parseMap put their colliders. Right of travel direction (dc, dr) is (-dr, dc).
  const LAMP_PHASES = ['red', 'amber', 'green'];
  const lampColours = [palette.lampRed, palette.lampAmber, palette.lampGreen];
  const signal = mergeGeometries([
    new THREE.BoxGeometry(city.obstacles.signal.width, 4.6, city.obstacles.signal.width).translate(0, 2.3, 0),
    new THREE.BoxGeometry(0.5, 1.4, 0.35).translate(0, 3.85, 0),
  ]);
  const signals = new THREE.InstancedMesh(signal, new THREE.MeshLambertMaterial({ color: palette.signal }), map.lights.length);
  const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial(), map.lights.length * 3);
  const stopLines = [];
  const m = new THREE.Matrix4();
  map.lights.forEach((l, i) => {
    const [dc, dr] = DIRS[l.dir];
    m.makeRotationY(Math.atan2(-dc, -dr)).setPosition(l.post.x, 0, l.post.z);
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
  let shownLights = null;

  function addInstances(geometry, list) {
    const tinted = list.some((p) => p.tint !== undefined);
    const mesh = new THREE.InstancedMesh(geometry, tinted ? kitMaterials.tinted : kitMaterials.instanced, list.length);
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
  // tall enough to show over the roofs. Premultiplied, because DirectRenderPipeline's output step expects premultiplied
  // colour; straight alpha would apply the opacity twice and wash the colour out.
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(ts, city.markerHeight, ts),
    new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.35, depthWrite: false, premultipliedAlpha: true }),
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
  const exterior = new THREE.Mesh(new THREE.BufferGeometry(), kitMaterials.mesh);
  const MARKS = { body: 0xff00ff, cab: 0x00ffff }; // in no palette
  const painted = { body: [], cab: [] }; // vertex indices
  loads.push(loadModel(TRUCK, { ...palette, green: MARKS.body, wall: MARKS.cab }).then((geometry) => {
    const { min, max } = geometry.boundingBox;
    const height = ((max.y - min.y) * tables.vehicle.width) / (max.x - min.x); // as tall as its width makes it; read before unitBox() rescales the box
    exterior.geometry = unitBox(geometry);
    exterior.scale.set(tables.vehicle.width, height, tables.vehicle.length);
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

  // Cab interior, our own design: a dashboard and a steering wheel, shown only in the cab view. The dashboard
  // sits under the windscreen, the wheel in front of the driver's eye (camera.cabEye).
  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.6), new THREE.MeshLambertMaterial({ color: palette.dashboard }));
  dashboard.position.set(0, 1.45, 2.45);
  const wheelMaterial = new THREE.MeshLambertMaterial({ color: palette.steeringWheel });
  // The column tilts the wheel towards the driver; the wheel spins about the column's axis (local +z).
  const column = new THREE.Group();
  column.position.set(cam.cabEye[0], 1.68, 2.12);
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
  let arm = 0; // m, showroom camera distance from the truck
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

    if (state.lightsVersion !== shownLights && state.lights.length) {
      shownLights = state.lightsVersion;
      const c = new THREE.Color();
      state.lights.forEach((l, i) =>
        LAMP_PHASES.forEach((p, k) => lamps.setColorAt(i * 3 + k, c.setHex(l.phase === p ? lampColours[k] : palette.lampOff))),
      );
      lamps.instanceColor.needsUpdate = true;
    }

    drawTraffic(state.traffic);

    const { order } = state;
    marker.visible = !!order;
    if (order) {
      const { zone } = map.spots.find((s) => s.id === (order.phase === 'pickup' ? order.pickup : order.dropoff));
      marker.position.x = (zone.minX + zone.maxX) / 2;
      marker.position.z = (zone.minZ + zone.maxZ) / 2;
      marker.material.color.setHex(order.phase === 'pickup' ? palette.pickup : palette.dropoff);
    }

    // Each view shows one side of the cab: the interior from the seat, the kit's cab from outside. In reverse gear the reversing
    // camera takes over; the chosen view comes back when the gear leaves R.
    const rear = !showroom && state.truck.gear === 'R';
    const inCab = showroom ? showroom === 'cab' : cabView && !rear;
    exterior.visible = parts.exterior.visible = !inCab;
    interior.visible = inCab;
    shift(!!showroom);
    if (!showroom) [orbit, arm] = [0, tables.showroom.radius];
    if (showroom === 'orbit') {
      const { radius, height, lookHeight, speed, wallGap, armSpeed } = tables.showroom;
      orbit += speed * dt;
      const a = heading + Math.PI + 0.7 + orbit; // starts behind the truck, off to one side
      const [dx, dz] = [Math.sin(a), Math.cos(a)];
      // In front of the first building in the way, so no wall fills the picture; easing back out behind it.
      const room = Math.min(radius, ...blocks.map((b) => rayToBox(x, z, dx, dz, b) - wallGap));
      arm = Math.min(room, arm + armSpeed * dt);
      camera.position.set(x + dx * arm, height, z + dz * arm);
      camera.lookAt(x, lookHeight, z);
    } else if (rear) {
      camera.position.copy(truck.localToWorld(eye.fromArray(cam.rearEye)));
      camera.lookAt(truck.localToWorld(lookAt.fromArray(cam.rearLook)));
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
    pipeline.render(scene, camera);
  }

  const carMatrix = new THREE.Matrix4();
  const carPosition = new THREE.Vector3();
  const carTurn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  function drawTraffic(cars) {
    for (const mesh of trafficMeshes) mesh.count = 0;
    for (const car of cars) {
      const mesh = trafficMeshes[car.id % trafficMeshes.length];
      carMatrix.compose(carPosition.set(car.x, 0, car.z), carTurn.setFromAxisAngle(up, car.heading), carSize);
      mesh.setMatrixAt(mesh.count++, carMatrix);
    }
    for (const mesh of trafficMeshes) mesh.instanceMatrix.needsUpdate = true;
  }

  function toggleCamera() {
    cabView = !cabView;
  }

  // A model that fails to load is logged and left out, as before; it doesn't hold up the game. A renderer that can't
  // start does: `ready` rejects and the loading screen stays.
  let loaded = 0;
  const models = Promise.all(loads.map((load) => load.catch(console.error).then(() => onProgress(++loaded / loads.length))));
  const ready = Promise.all([renderer.init(), models]);

  return { render, toggleCamera, ready, renderer };
}
