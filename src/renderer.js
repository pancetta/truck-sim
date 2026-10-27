import * as THREE from 'three/webgpu';
import { texture, uniform, uv, equirectUV, normalWorldGeometry, positionWorld, cameraPosition, fog, densityFogFactor, rangeFogFactor, float } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIRS } from './sim/map.js';
import { createTruckParts } from './truckLook.js';
import { createCab } from './cab.js';
import { createResolution } from './resolution.js';
import { planBuildings, buildingMeshes, dockHalf } from './buildings.js';
import { atlasCells, paintFacadePictures } from './facadePictures.js';
import { carGeometries, skinTexture, detailAtlas } from './vehicles.js';
import { createStreets } from './streets.js';
import { planSkyline, skylineMeshes, ringMeshes, paintSkylineWindows } from './skyline.js';
import { roadPieces, roadSurface, osmPavements, pavementGeometry } from './roads.js';
import { createCells } from './sim/cells.js';
import { inside } from './sim/sim.js';
import assetInfo from './assetInfo.json';
import { strings } from './strings.js';

// CC0 kit models in public/models/, sky, ground and building textures in public/textures/ (see CREDITS.md); the textures are
// KTX2 from `npm run assets`, transcoded by three's Basis transcoder in public/basis/.
const MODELS = `${import.meta.env.BASE_URL}models/`;
const TEXTURES = `${import.meta.env.BASE_URL}textures/`;
const TRANSCODER = `${import.meta.env.BASE_URL}basis/`;
// Road pieces with the sides they open to, as modelled (DIRS order: north/-z, east/+x, south/+z, west/-x).
const ROAD_PIECES = [
  ['roads/road-square.glb', []],
  ['roads/road-end-round.glb', [1]],
  ['roads/road-straight.glb', [1, 3]],
  ['roads/road-bend-square.glb', [2, 3]],
  ['roads/road-intersection.glb', [1, 2, 3]],
  ['roads/road-crossroad.glb', [0, 1, 2, 3]],
];
const COVERED = ['covered_car.glb', 'covered_car_far.glb']; // near and far, from `npm run assets`
const TRUCK = 'cars/delivery.glb';
const roadHeight = 0.06; // m, kerb top; the kit's road surface sits at half of it

const SUN_DISTANCE = 300; // m from the shadow area's centre to the sun, back along its light
const SHADOW_ONLY = 1; // layer the sun's shadow camera and the reversing camera see, but not the main camera
// One-texel maps sampled like the KTX2 ones (filters, wrapping, colour space), for materials whose maps load later.
const standIn = (rgba, colorSpace = THREE.NoColorSpace) => Object.assign(new THREE.DataTexture(new Uint8Array(rgba), 1, 1), {
  colorSpace, magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, needsUpdate: true,
});
// White colour, a flat normal, and no occlusion with roughness 0.8 (ambient occlusion, roughness, metalness).
const STAND_INS = { map: standIn([255, 255, 255, 255], THREE.SRGBColorSpace), normal: standIn([128, 128, 255, 255]), arm: standIn([255, 204, 0, 255]) };

const loader = new GLTFLoader();
const newKitMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
// One kit material per mesh variant: shared across variants, the renderer re-derives the program on every draw.
const kitMaterials = { mesh: newKitMaterial(), batched: newKitMaterial() };

// Stretches a geometry into the unit box: x and z in [-0.5, 0.5], y in [0, 1].
// The box is read once: translate() recomputes it from the vertices, which may not span the model's own box (loadModel).
function unitBox(geometry) {
  const { min, max } = geometry.boundingBox.clone();
  return geometry
    .translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2)
    .scale(1 / (max.x - min.x), 1 / (max.y - min.y), 1 / (max.z - min.z));
}

// How far along the unit direction (dx, dz) from (x, z) a ray first meets the outline `points` ({ x, z }, any
// polygon); Infinity if it misses.
function rayToOutline(x, z, dx, dz, points) {
  let near = Infinity;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    const [ex, ez] = [b.x - a.x, b.z - a.z];
    const den = dx * ez - dz * ex;
    if (!den) return;
    const t = ((a.x - x) * ez - (a.z - z) * ex) / den; // m along the ray
    const u = ((a.x - x) * dz - (a.z - z) * dx) / den; // share of the way along the side
    if (t >= 0 && u >= 0 && u <= 1) near = Math.min(near, t);
  });
  return near;
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

// The way a parked car on its collider's outline (a box, turned any way) faces, one of the two along its longer side:
// the heading about y that turns the car's +z along that side.
export function parkedHeading([a, b, c]) {
  const [ux, uz] = Math.hypot(b.x - a.x, b.z - a.z) >= Math.hypot(c.x - b.x, c.z - b.z) ? [b.x - a.x, b.z - a.z] : [c.x - b.x, c.z - b.z];
  return Math.atan2(ux, uz);
}

// Where the shadow area is centred for a camera focus: the focus moved to the nearest whole shadow-map texel across
// the sun's view (light.x and light.y; light.z points to the sun), so each texel keeps covering the same ground as
// the area follows the camera. Moving it freely made shadow edges shimmer while driving.
export function shadowCentre(focus, light, texel, out) {
  const snap = (axis) => Math.round(focus.dot(axis) / texel) * texel;
  return out.set(0, 0, 0).addScaledVector(light.x, snap(light.x)).addScaledVector(light.y, snap(light.y)).addScaledVector(light.z, focus.dot(light.z));
}

// UVs from world x and z, `repeat` m per copy of the texture, so a texture runs on across tiles and meshes.
function worldUVs(geometry, repeat) {
  const p = geometry.getAttribute('position');
  const uvs = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) [uvs[2 * i], uvs[2 * i + 1]] = [p.getX(i) / repeat, -p.getZ(i) / repeat];
  return geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
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

// Draws Sim state; never writes to it. `onProgress` gets the loaded share of the models and textures (0..1);
// the returned `ready` resolves once all of them are in the scene.
export function createRenderer(canvas, tables, map, onProgress) {
  const { palette, camera: cam, city, lighting } = tables;
  const kitColours = Object.entries(tables.kitColours);
  // WebGPU where the browser has it, else its WebGL 2 backend; ?webgl forces the fallback for comparison.
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = lighting.exposure;
  renderer.shadowMap.enabled = true;
  const resolution = createResolution(tables.resolution, window.devicePixelRatio, matchMedia('(pointer: coarse)').matches);
  renderer.setPixelRatio(resolution.ratio);
  // sRGB output in the material shaders, as WebGLRenderer did: the default pipeline draws into a half-float MSAA
  // target and adds a full-screen output pass, which doubled the GPU time on the WebGL 2 backend.
  const pipeline = new THREE.DirectRenderPipeline(renderer);
  // A lost GPU device (iPad Safari under memory pressure) can't be rebuilt in place; the save survives a reload.
  renderer.onDeviceLost = () => location.reload();

  const scene = new THREE.Scene();
  const loads = []; // every model and texture load, up to being added to the scene
  // KTX2 textures transcode to what the GPU takes, which the renderer knows once it's initialised.
  const ktx2Loader = new KTX2Loader().setTranscoderPath(TRANSCODER);
  loader.setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder); // the pipeline's models (streets.js)
  const gpu = renderer.init().then(() => ktx2Loader.detectSupport(renderer));
  const loadTexture = (file) => gpu.then(() => ktx2Loader.loadAsync(TEXTURES + file));
  loader.setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder); // for the pipeline's models

  // Sky and sun, all from tables.lighting. The sky is the background and lights the scene from all around. The first
  // frame waits only for the small first sky, which stays the light; the full sky loads after everything the first
  // frame waits for and replaces it as background and haze. The encoder scaled a sky down into half-float range; its
  // `scale` brings it back.
  const loadSky = (file) => loadTexture(file).then((loaded) => {
    // shortcut: three r186's WebGPURenderer can't upload KTX2Loader's uncompressed half-float fallback for GPUs with
    // neither BC6H nor HDR ASTC (iPad), so it's rewrapped as a DataTexture; drop this when three handles it.
    const sky = loaded.isCompressedTexture && loaded.format === THREE.RGBAFormat
      ? Object.assign(new THREE.DataTexture(loaded.mipmaps[0].data, loaded.image.width, loaded.image.height, THREE.RGBAFormat, THREE.HalfFloatType), { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, needsUpdate: true })
      : loaded;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.userData.scale = assetInfo[`textures/${file}`]?.scale ?? 1;
    return sky;
  });
  let showFullSky;
  loads.push(loadSky(lighting.skyFirst).then((sky) => {
    scene.environment = sky;
    scene.environmentIntensity = lighting.skyLight * sky.userData.scale;
    // Background and haze sample the sky alike, so whatever is fully hazed where the camera stops drawing is exactly
    // the sky behind it, and the far city fades out instead of popping.
    const skyScale = uniform(sky.userData.scale);
    const skyMaps = [];
    const skyAt = (direction) => {
      const map = texture(sky, equirectUV(direction.normalize()));
      skyMaps.push(map);
      return map.rgb.mul(skyScale);
    };
    scene.backgroundNode = skyAt(normalWorldGeometry);
    const clear = densityFogFactor(float(lighting.haze)).oneMinus().mul(rangeFogFactor(float(cam.fog[0]), float(cam.fog[1])).oneMinus());
    scene.fogNode = fog(skyAt(positionWorld.sub(cameraPosition)), clear.oneMinus());
    showFullSky = (full) => {
      skyScale.value = full.userData.scale;
      for (const map of skyMaps) map.value = full;
    };
  }));
  const sun = new THREE.DirectionalLight(lighting.sunColour, lighting.sun);
  const { shadow } = lighting;
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadow.mapSize, shadow.mapSize);
  Object.assign(sun.shadow.camera, { left: -shadow.extent, right: shadow.extent, top: shadow.extent, bottom: -shadow.extent, near: 1, far: 2 * SUN_DISTANCE });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.camera.layers.enable(SHADOW_ONLY);
  sun.shadow.autoUpdate = false; // once per frame (see render()), not again for the reversing camera
  Object.assign(sun.shadow, { bias: shadow.bias, normalBias: shadow.normalBias });
  scene.add(sun, sun.target);
  // The shadow camera's own axes: it looks along -z, at the ground from the sun, with the world's up as its up.
  const light = { z: new THREE.Vector3(...lighting.sunDirection).normalize() };
  light.x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), light.z).normalize();
  light.y = new THREE.Vector3().crossVectors(light.z, light.x);
  const shadowTexel = (2 * shadow.extent) / shadow.mapSize; // m
  const focus = new THREE.Vector3();

  // A CC0 PBR material (tables.ground, tables.buildings): its colour, normal, and ambient occlusion / roughness map,
  // set once loaded. The colour map's sRGB comes with the file. The ground's load before the first frame draws; a
  // `later` one's once everything the first frame waits for is in, and until then it draws with one-texel stand-ins
  // sampled alike, so swapping in the real maps builds no new shaders.
  const laterLoads = [];
  function groundMaterial({ texture: name }, options, later) {
    const material = new THREE.MeshStandardMaterial(options);
    if (later) Object.assign(material, { map: STAND_INS.map, normalMap: STAND_INS.normal, aoMap: STAND_INS.arm, roughnessMap: STAND_INS.arm });
    const load = () => Promise.all(['Diffuse', 'nor_gl', 'arm'].map((kind) => loadTexture(`${name}_${kind}.ktx2`))).then((maps) => {
      for (const t of maps) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
      }
      const [map, normalMap, arm] = maps;
      Object.assign(material, { map, normalMap, aoMap: arm, roughnessMap: arm });
    });
    if (later) laterLoads.push(load);
    else loads.push(load());
    return material;
  }

  // Centred on the map, so it reaches under the skyline ring on every side.
  const { bounds } = map;
  const groundPlane = new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2).translate((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  const ground = new THREE.Mesh(worldUVs(groundPlane, tables.ground.open.repeat), groundMaterial(tables.ground.open));
  ground.receiveShadow = true;
  ground.renderOrder = 1; // last of the opaque meshes, so the depth test skips its texturing under roads and buildings
  scene.add(ground);

  // City from the parsed map: on the grid, built from kit models; on an OSM map (?map=monti, no tiles), from the road
  // graph and the building outlines (roads.js, buildings.js).
  const grid = !!map.roads;
  const ts = map.tileSize;
  const hash = (x, z) => Math.abs(Math.sin(x * 12.9898 + z * 78.233)); // stable pseudo-random per place
  const pick = (list, x, z) => list[Math.floor(hash(x, z) * 9973) % list.length];
  const centre = (b) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
  const placements = new Map(); // model file -> [{ x, z, angle, size: [x, y, z], tint }]
  const place = (file, p) => (placements.get(file) ?? placements.set(file, []).get(file)).push(p);

  // Road tiles: asphalt as one mesh, a square per tile at the kit's road level, under the kit pieces' pavements and
  // markings; the pieces' own road surfaces are left out (see loadModel). Pushed back a few depth steps, so the
  // markings at the same height always win; an offset by depth slope sank it under the ground at grazing angles.
  // On an OSM map, the road surface along the graph's edges, with its junctions.
  const pieces = grid ? null : roadPieces(map.graph);
  const roadGeometry = grid
    ? mergeGeometries(map.roads.map(({ col, row }) => new THREE.PlaneGeometry(ts, ts).rotateX(-Math.PI / 2).translate((col + 0.5) * ts, roadHeight / 2, (row + 0.5) * ts)))
    : roadSurface(pieces, roadHeight / 2);
  const asphalt = new THREE.Mesh(
    worldUVs(roadGeometry, tables.ground.road.repeat),
    Object.assign(groundMaterial(tables.ground.road), { polygonOffset: true, polygonOffsetUnits: 4 }),
  );
  asphalt.receiveShadow = true;
  // First of the opaque meshes, and always in view. three renders the sun's shadow map when the first shadow receiver
  // draws, after that mesh has culled itself for the view; if that were the city batch, its cull for the sun would
  // replace the one for the view, and buildings would go missing.
  asphalt.renderOrder = -1;
  scene.add(asphalt);
  for (const { col, row } of map.roads ?? []) {
    const open = DIRS.map(([dc, dr]) => map.isRoad(col + dc, row + dr));
    // Turning a piece a quarter turn moves each open side from direction i to i - 1.
    for (const [file, sides] of ROAD_PIECES) {
      const turn = [0, 1, 2, 3].find((k) => open.every((o, i) => o === sides.includes((i + k) % 4)));
      if (turn === undefined) continue;
      place(file, { x: (col + 0.5) * ts, z: (row + 0.5) * ts, angle: (turn * Math.PI) / 2, size: [ts, roadHeight, ts] });
      break;
    }
  }

  // The buildings, which the cameras keep out of; blockAt(x, z) is the one a point is in: on the grid by its tile, on an
  // OSM map by its outline, through a cell index.
  const blocks = map.colliders.filter((b) => b.kind === 'building' || b.kind === 'spot');
  const tileBlocks = new Map(grid ? blocks.map((b) => [`${Math.floor(b.minX / ts)},${Math.floor(b.minZ / ts)}`, b]) : []);
  const blockCells = createCells(city.cell);
  if (!grid) for (const b of blocks) blockCells.add(b, b.minX, b.minZ, b.maxX, b.maxZ);
  const blockAt = (x, z) => {
    if (grid) return tileBlocks.get(`${Math.floor(x / ts)},${Math.floor(z / ts)}`);
    let found;
    blockCells.some(x, z, x, z, (b) => inside(x, z, b.points) && (found = b));
    return found;
  };
  // Procedural buildings (buildings.js), a few meshes per chunk of the map, each culled whole against the view. Their
  // facade pictures are painted at load; their wall and roof textures load after the first frame.
  const buildingParts = { meshes: [], near: [] };
  const cells = atlasCells(map.spots.map((s) => s.id));
  const buildingMaterials = {
    walls: tables.buildings.walls.map((wall) => groundMaterial(wall, { vertexColors: true, flatShading: true }, true)),
    roof: groundMaterial(tables.buildings.roof, { flatShading: true }, true),
    parts: new THREE.MeshStandardMaterial({ ...paintFacadePictures(cells, palette.spot), vertexColors: true, flatShading: true }),
  };
  // Built once the model and texture requests are out, as building them takes a few hundred ms. What stands on them
  // (lanterns, pots and flower boxes; streets.js) is placed then too.
  loads.push(new Promise((resolve) => setTimeout(resolve)).then(() => {
    const plan = planBuildings(map, tables);
    Object.assign(buildingParts, buildingMeshes(plan, tables, palette.spot, cells, buildingMaterials));
    scene.add(...buildingParts.meshes);
    streets.dress(plan);
  }));
  // The skyline ring outside the map (skyline.js): two meshes, its roofs in the buildings' roof material. On the grid
  // generated; on an OSM map the real buildings round it.
  // Pavement on the grid's road tiles (streets.js) or along an OSM map's roads (below).
  const pavers = groundMaterial(tables.streets.pavement, {}, true);
  const skylineMaterials = { walls: new THREE.MeshStandardMaterial({ map: paintSkylineWindows(), vertexColors: true, flatShading: true, roughness: 0.9 }), roof: buildingMaterials.roof };
  if (grid) {
    loads.push(new Promise((resolve) => setTimeout(resolve)).then(() => scene.add(...skylineMeshes(planSkyline(map, tables), tables, skylineMaterials))));
  } else {
    loads.push(fetch(`${import.meta.env.BASE_URL}${tables.osm.ring}`).then((r) => r.json()).then((items) => scene.add(...ringMeshes(items, tables, skylineMaterials))));
    // Raised pavements with kerbs along the roads, and the pedestrian ways and squares paved level with the road
    // (roads.js), built with the buildings, a few hundred ms too. The paving's texture loads after the first frame.
    const { pavement } = tables.streets;
    const kerbs = new THREE.MeshStandardMaterial({ color: pavement.kerbColour, roughness: 0.8 });
    loads.push(new Promise((resolve) => setTimeout(resolve)).then(() => {
      const { top, stones } = pavementGeometry(osmPavements(map, pieces, tables), pavement, roadHeight / 2);
      for (const mesh of [new THREE.Mesh(top, pavers), new THREE.Mesh(stones, kerbs)]) {
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }));
    // The barriers at the edge exits, plain boxes on their colliders (each a box turned any way).
    const boxes = map.colliders.filter((c) => c.kind === 'barrier');
    const height = city.barrierHeight;
    if (boxes.length) { // WebGPU rejects an instanced mesh without instances
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: palette.red }), boxes.length);
      mesh.castShadow = mesh.receiveShadow = true;
      const m = new THREE.Matrix4();
      boxes.forEach(({ points: [a, b, c] }, i) => {
        const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(b.z - a.z), b.x - a.x)); // local x along a→b
        const size = new THREE.Vector3(Math.hypot(b.x - a.x, b.z - a.z), height, Math.hypot(c.x - b.x, c.z - b.z));
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3((a.x + c.x) / 2, height / 2, (a.z + c.z) / 2), turn, size));
      });
      scene.add(mesh);
    }
  }

  // Parked cars on their colliders, either way round: a generated car in one of the paints, or now and then a
  // covered car. Drawn with the AI cars (drawCars).
  const carTypes = Object.keys(tables.vehicles.types);
  const paints = tables.vehicles.paints.map((hex) => new THREE.Color(hex));
  const parked = map.colliders.filter((c) => c.kind === 'car').map((b) => {
    const { x, z } = centre(b);
    const heading = parkedHeading(b.points) + (hash(x, z) > 0.5 ? Math.PI : 0);
    const covered = hash(z, x) * 7 % 1 < tables.vehicles.covered;
    return { x, z, heading, kind: covered ? carTypes.length : Math.floor(hash(x, z) * 9973) % carTypes.length, paint: pick(paints, z, x) };
  });

  const cityModels = [...placements].map(([file, list]) => {
    // Road pieces leave out their road surface.
    const colours = file.startsWith('roads/road') ? { ...palette, road: null, dark: null } : palette;
    return loadModel(file, colours).then((geometry) => [unitBox(geometry), list]);
  });
  // The road signs, our own geometry, join the city's batch so they are culled and fogged with it; a speed sign per limit.
  const signsOf = (kind, limit) => map.signs.filter((s) => s.kind === kind && s.limit === limit).map(({ x, z, angle }) => ({ x, z, angle, size: [1, 1, 1] }));
  for (const limit of new Set(map.signs.map((s) => s.limit).filter(Boolean))) cityModels.push(Promise.resolve([speedSign(limit), signsOf('speed', limit)]));
  cityModels.push(Promise.resolve([warningSign(), signsOf('rightBeforeLeft')]));
  // A model that fails is logged (through `loads`) and left out; the rest of the city still goes up.
  loads.push(...cityModels, Promise.all(cityModels.map((m) => m.catch(() => null))).then((models) => addCity(models.filter(Boolean))));
  addBoxes(palette.zone, map.spots.map((s) => s.zone), 0.04);

  // Dock bays, our own boxes: a dock edge (a low dark platform) in the floor of the opening in the building face
  // (buildings.js), and painted lines on either side of the bay, as far apart as the docking check allows. They stand
  // a little above the kerb so they show over the pavement too. The edge isn't solid; the building behind it is.
  const bayHalf = tables.vehicle.width / 2 + tables.orders.dockCentre;
  const { dock } = tables.buildings;
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
    dockEdges.push({ ...bay(-dock.depth, 0, -dockHalf(tables), dockHalf(tables)), height: dock.edge });
    for (const side of [-bayHalf, bayHalf]) bayLines.push(bay(0, 10, side - 0.12, side + 0.12));
  }
  addBoxes(palette.dark, dockEdges);
  addBoxes(palette.stopLine, bayLines, 0.07);

  // Cars, for the parked ones and the AI cars alike: per kind, instanced meshes for the near and for the far detail
  // level, with room for every parked car and the busiest rank tier. The generated body types come first, each a
  // painted body (the instance colour is the paint) and a details mesh; then the covered car, its glTF's meshes,
  // which load after the first frame and stay empty until then; then the police cars.
  const carRoom = parked.length + Math.max(...tables.rank.tiers.map((t) => t.traffic));
  const carMeshes = []; // all of them, for drawCars
  // Whether drawCars leaves the empty meshes visible for a frame: three sets up a mesh's shaders and textures, for
  // the view and the shadow, even with no instances to draw. Else the first car of a kind to come into view
  // stalled that frame (by 130–180 ms for the covered car).
  let warmCars = true;
  // Only the near meshes cast shadows: on the iPad simulator with 100 cars, the far ones' shadows took the frame
  // from 16.7 to 20–23 ms.
  const carMesh = (geometry, material, castShadow) => {
    const mesh = new THREE.InstancedMesh(geometry, material, carRoom);
    mesh.frustumCulled = false; // the renderer can't cull them: drawCars puts the cars in view into them each frame
    Object.assign(mesh, { castShadow, receiveShadow: true });
    scene.add(mesh);
    carMeshes.push(mesh);
    return mesh;
  };
  const generated = carGeometries(tables.vehicles.types, city.obstacles.car);
  const { police } = tables;
  const detailMaterial = new THREE.MeshStandardMaterial({ map: detailAtlas({ ...police, text: strings.policeLettering }), vertexColors: true, roughness: 0.45, metalness: 0.1 });
  const carKind = ({ fitted, near, far }) => {
    const paint = new THREE.MeshStandardMaterial({ map: skinTexture(fitted), roughness: 0.35, metalness: 0.5 });
    const lod = ({ body, details }, shadow) => {
      const bodyMesh = carMesh(body, paint, shadow);
      bodyMesh.setColorAt(0, paints[0]); // allocates the paint colours
      return [bodyMesh, carMesh(details, detailMaterial, shadow)];
    };
    return { near: lod(near, true), far: lod(far, false), painted: true };
  };
  const carKinds = carTypes.map((type) => carKind(generated[type]));
  const coveredCar = { near: [], far: [], painted: false };
  carKinds.push(coveredCar);
  // The police cars' kind: their body type with the livery parts, in their own paint.
  const policeKind = carKinds.push(carKind(carGeometries({ police: tables.vehicles.types[police.body] }, city.obstacles.car, police).police)) - 1;
  const policePaint = new THREE.Color(police.paint);
  // The box every car fits, for culling: the footprint, as tall as the tallest body type (the van).
  const carSize = new THREE.Vector3(city.obstacles.car.width, Math.max(...Object.values(generated).map((g) => g.fitted.height)), city.obstacles.car.length);

  // Traffic lights, our own boxes: per approach, a post on the junction's near right corner with its lamps
  // (red, amber, green from the top) facing the drivers, and a stop line across the right half of the road
  // tables.lights.stopLine before it.
  // The lamps are one-sided planes, so a light seen from the side or behind shows no colour.
  // The posts stand where the map put their colliders. Right of travel direction (dc, dr) is (-dr, dc).
  const LAMP_PHASES = ['red', 'amber', 'green'];
  const lampColours = [palette.lampRed, palette.lampAmber, palette.lampGreen];
  const signal = mergeGeometries([
    new THREE.BoxGeometry(city.obstacles.signal.width, 4.6, city.obstacles.signal.width).translate(0, 2.3, 0),
    new THREE.BoxGeometry(0.5, 1.4, 0.35).translate(0, 3.85, 0),
  ]);
  const signals = new THREE.InstancedMesh(signal, new THREE.MeshStandardMaterial({ color: palette.signal }), map.lights.length);
  signals.castShadow = signals.receiveShadow = true;
  // Lamps glow brighter than their palette colours (tables.lighting.lampGlow), so they read as lit after tone mapping.
  const lampMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(lighting.lampGlow) });
  const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.3, 0.3), lampMaterial, map.lights.length * 3);
  const stopLines = [];
  const m = new THREE.Matrix4();
  map.lights.forEach((l, i) => {
    const [dc, dr] = [l.dx, l.dz];
    m.makeRotationY(Math.atan2(-dc, -dr)).setPosition(l.post.x, 0, l.post.z);
    signals.setMatrixAt(i, m);
    for (let k = 0; k < 3; k++) {
      lamps.setMatrixAt(i * 3 + k, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 4.3 - k * 0.45, 0.19)));
    }
    const lane = l.half - (grid ? 1.4 : 0.3); // a grid tile's pavement is its outer 1.4 m; an OSM road's is beside it
    const [ax, az] = [l.x - dr * 0.3, l.z + dc * 0.3];
    const [bx, bz] = [l.x - dc * 0.5 - dr * lane, l.z - dr * 0.5 + dc * lane];
    stopLines.push({ minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) });
  });
  if (map.lights.length) scene.add(signals, lamps); // an OSM map may have no light junction
  addBoxes(palette.stopLine, stopLines, 0.045);
  let shownLights = null;

  // Pavements (on an OSM map drawn above), lanterns (also on the poles), and the trees and props on open ground or,
  // on an OSM map, OSM's street furniture.
  const streets = createStreets(scene, map, tables, { pavers, loadTexture, loader, models: MODELS });
  laterLoads.push(streets.load);

  // The whole kit city as one batched mesh with one shader: three tests each placement against the view, so only
  // what's on screen within the far plane is drawn (and, for the shadow, what's in the sun's view). `models` is
  // [geometry, placements] per model. three warns once that the batch has no normals; flat shading doesn't use them.
  function addCity(models) {
    if (!models.length) return;
    const instances = models.reduce((n, [, list]) => n + list.length, 0);
    const vertices = models.reduce((n, [geometry]) => n + geometry.getAttribute('position').count, 0);
    const batch = new THREE.BatchedMesh(instances, vertices, 0, kitMaterials.batched);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    for (const [geometry, list] of models) {
      const id = batch.addGeometry(geometry);
      for (const p of list) {
        const i = batch.addInstance(id);
        batch.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, 0, p.z), q.setFromAxisAngle(up, p.angle), new THREE.Vector3(...p.size)));
        batch.setColorAt(i, tint.setHex(p.tint ?? 0xffffff));
      }
    }
    batch.sortObjects = false; // depth-sorting the visible placements allocated about 40 KB per frame
    batch.castShadow = batch.receiveShadow = true;
    scene.add(batch);
  }

  // A road sign as one flat-coloured geometry like the kit's, its post at the origin and its face towards +z: the
  // post, and the plate `draw(add, face)` adds (`add(geometry, colour)` per part), its back layer's front `face` m out.
  // Each layer of a plate stands 1.5 cm proud of the one behind, against depth fighting.
  function roadSign(draw) {
    const { height, post } = tables.signs;
    const parts = [];
    const add = (geometry, colour) => {
      const part = geometry.toNonIndexed().deleteAttribute('normal').deleteAttribute('uv');
      const colours = new Float32Array(part.getAttribute('position').count * 3);
      const c = new THREE.Color(colour);
      for (let i = 0; i < colours.length; i += 3) c.toArray(colours, i);
      parts.push(part.setAttribute('color', new THREE.BufferAttribute(colours, 3)));
    };
    add(new THREE.BoxGeometry(post, height, post).translate(0, height / 2, 0), palette.signal);
    draw(add, post / 2 + 0.015);
    const geometry = mergeGeometries(parts);
    geometry.computeBoundingBox();
    return geometry;
  }

  // A layer of a sign's plate: `n` sides, `r` m from its middle to a corner (one pointing up), centred on the sign's
  // height, 1.5 cm deep with its front `front` m out.
  function plate(n, r, front) {
    return new THREE.CylinderGeometry(r, r, 0.015, n).rotateX(-Math.PI / 2).translate(0, tables.signs.height, front - 0.0075);
  }

  // A speed limit sign for `limit` km/h: a round plate, grey at the back, its face a red ring round a white disc with the
  // limit in dark seven-segment bars.
  function speedSign(limit) {
    const { height, radius, ring } = tables.signs;
    return roadSign((add, face) => {
      add(plate(20, radius, face), palette.signal);
      add(plate(20, radius, face + 0.015), palette.red);
      add(plate(20, radius - ring, face + 0.03), palette.stopLine);
      // Segments a–g of a digit w × h, bars t thick: top, upper right, lower right, bottom, lower left, upper left, middle.
      const [w, h, t] = [0.16, 0.32, 0.045];
      const SEGMENTS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
      const bars = { a: [0, h / 2, 1], b: [w / 2, h / 4, 0], c: [w / 2, -h / 4, 0], d: [0, -h / 2, 1], e: [-w / 2, -h / 4, 0], f: [-w / 2, h / 4, 0], g: [0, 0, 1] };
      const digits = String(limit);
      [...digits].forEach((digit, i) => {
        const cx = (i - (digits.length - 1) / 2) * (w + t + 0.08);
        for (const s of SEGMENTS[digit]) {
          const [x, y, across] = bars[s];
          const bar = across ? new THREE.BoxGeometry(w + t, t, 0.015) : new THREE.BoxGeometry(t, h / 2 + t, 0.015);
          add(bar.translate(cx + x, height + y, face + 0.0375), palette.trim);
        }
      });
    });
  }

  // A warning sign for a junction with priority from the right, our own drawing: a triangle, point up and centred on
  // the sign's height, grey at the back, its face a red border round white with a dark upright crossed by a thinner bar.
  function warningSign() {
    const { height, side, border } = tables.signs;
    const r = side / Math.sqrt(3); // middle to corner
    return roadSign((add, face) => {
      add(plate(3, r, face), palette.signal);
      add(plate(3, r, face + 0.015), palette.red);
      add(plate(3, r - 2 * border, face + 0.03), palette.stopLine); // `border` in from each side is 2 × as far from the corners
      add(new THREE.BoxGeometry(0.07, 0.33, 0.015).translate(0, height + 0.035, face + 0.0375), palette.trim);
      add(new THREE.BoxGeometry(0.3, 0.04, 0.015).translate(0, height - 0.02, face + 0.0375), palette.trim);
    });
  }

  // One instanced draw call per colour; boxes stand on the ground, `height` tall unless they carry their own. None for no
  // boxes (an OSM map has no spots yet): WebGPU rejects an instanced mesh without instances.
  function addBoxes(color, boxes, height) {
    if (!boxes.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color }), boxes.length);
    mesh.receiveShadow = true;
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
    new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.35, depthWrite: false, premultipliedAlpha: true }),
  );
  marker.position.y = city.markerHeight / 2;
  scene.add(marker);

  // A kit model as one flat-coloured geometry: each face takes the palette colour named by the
  // kit colour nearest to its colour-map sample (tables.kitColours). `colours` overrides palette entries; a face whose
  // colour is null is left out. The bounding box is the whole model's, left-out faces included.
  async function loadModel(file, colours = palette) {
    const gltf = await loader.loadAsync(MODELS + file);
    gltf.scene.updateMatrixWorld();
    const parts = [];
    const c = new THREE.Color();
    gltf.scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const source = mesh.geometry.toNonIndexed();
      const uv = source.getAttribute('uv');
      const position = source.getAttribute('position');
      const { data, width, height } = readPixels(mesh.material.map.image);
      const positions = [];
      const colour = [];
      for (let i = 0; i < uv.count; i += 3) {
        const u = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3;
        const v = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3;
        const p = 4 * (Math.min(height - 1, Math.floor(v * height)) * width + Math.min(width - 1, Math.floor(u * width)));
        const hex = colours[nearestKitColour(data[p], data[p + 1], data[p + 2])];
        if (hex === null) continue;
        c.setHex(hex);
        for (let k = 0; k < 3; k++) {
          positions.push(position.getX(i + k), position.getY(i + k), position.getZ(i + k));
          colour.push(c.r, c.g, c.b);
        }
      }
      const part = new THREE.BufferGeometry();
      part.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      part.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
      parts.push(part.applyMatrix4(mesh.matrixWorld));
    });
    // Free the decoded colour maps now; they are never drawn.
    gltf.scene.traverse((mesh) => mesh.material?.map?.image.close?.());
    const geometry = mergeGeometries(parts);
    geometry.boundingBox = new THREE.Box3().setFromObject(gltf.scene, true);
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

  // Cab interior (cab.js) with the cab gimmick, shown only in the cab view.
  const cab = createCab(tables, strings);
  const { interior } = cab;
  interior.add(parts.cab);
  truck.add(interior);
  scene.add(truck);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, cam.fog[1]);
  const eye = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let lastFrame = performance.now();
  let cabView = true;
  let inCab = true; // whether the last frame drew the view from the seat
  let orbit = 0; // rad, showroom camera angle round the truck
  let arm = 0; // m, showroom camera distance from the truck
  let chaseArm = cam.chaseDistance; // m, chase camera distance behind the truck
  let chased = false; // whether the last frame drew the chase view
  let shifted = false; // whether the picture is moved aside for the Werkstatt panel

  // Reversing camera as an inset over the view (owner's decision on #43): while the gear is R and `rearHold` s
  // after, the scene from the roof camera goes into a small render target, then onto the inset's rectangle,
  // mirrored like a real one. The rectangle is the inside of the `.rear-inset` frame (style.css), measured when it
  // shows and on resize.
  const rearCamera = new THREE.PerspectiveCamera(cam.rearFov, 1, 0.1, cam.rearFar);
  rearCamera.layers.enable(SHADOW_ONLY);
  const rearTarget = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType }); // keeps light above 1 for the tone mapping
  const insetScene = new THREE.Scene();
  const insetCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // Drawn over the finished view without clearing it, so no depth test against it.
  const insetMaterial = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  // Mirrored left to right; and render targets are sampled from the top, so v is turned too (as QuadMesh does).
  insetMaterial.colorNode = texture(rearTarget.texture, uv().oneMinus());
  insetScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), insetMaterial));
  const frame = document.createElement('div');
  frame.className = 'rear-inset';
  frame.hidden = true;
  canvas.after(frame);
  const inset = { x: 0, y: 0, width: 0, height: 0 }; // CSS px
  let rearTime = 0; // s the inset still shows

  function measureInset() {
    const { left, top } = frame.getBoundingClientRect();
    Object.assign(inset, { x: left + frame.clientLeft, y: top + frame.clientTop, width: frame.clientWidth, height: frame.clientHeight });
    rearCamera.aspect = inset.width / inset.height;
    rearCamera.updateProjectionMatrix();
    const ratio = renderer.getPixelRatio();
    rearTarget.setSize(Math.round(inset.width * ratio), Math.round(inset.height * ratio));
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    shifted = false; // shift() sets the offset again for the new size
    camera.clearViewOffset();
    if (!frame.hidden) measureInset();
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
    // Resized right before this frame draws into it, so no frame shows a cleared or stretched buffer.
    const ratio = resolution.frame(now - lastFrame);
    if (ratio) renderer.setPixelRatio(ratio);
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    if (ratio && !frame.hidden) measureInset();
    lastFrame = now;
    const { x, z, heading, roll } = state.truck;
    truck.position.set(x, 0, z);
    truck.rotation.set(0, heading, roll); // XYZ order: roll about the truck's own forward axis
    // The wheel at the same angle as the on-screen one; positive is clockwise from the driver's seat.
    cab.update(state.truck, input.steer * tables.controls.wheelLock);
    showLook(look);
    parts.sway(roll, dt);

    if (state.lightsVersion !== shownLights && state.lights.length) {
      shownLights = state.lightsVersion;
      const c = new THREE.Color();
      state.lights.forEach((l, i) =>
        LAMP_PHASES.forEach((p, k) => lamps.setColorAt(i * 3 + k, c.setHex(l.phase === p || (l.phase === 'redAmber' && k < 2) ? lampColours[k] : palette.lampOff))),
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

    // Each view shows one side of the cab: the interior from the seat, the kit's cab from outside. In reverse gear the
    // reversing camera shows in an inset over the chosen view.
    rearTime = !showroom && state.truck.gear === 'R' ? cam.rearHold : Math.max(0, rearTime - dt);
    if (frame.hidden !== !rearTime) {
      frame.hidden = !rearTime;
      if (rearTime) measureInset();
    }
    inCab = showroom ? showroom === 'cab' : cabView;
    const wasChased = chased;
    chased = !showroom && !inCab;
    // From the seat the outside of the truck isn't drawn, but it still casts its shadow. Visual items' parts are
    // built on first show, so they are set up here too.
    for (const outside of [exterior, parts.exterior]) {
      outside.traverse((mesh) => {
        mesh.layers.set(inCab ? SHADOW_ONLY : 0);
        mesh.castShadow = mesh.receiveShadow = true;
      });
    }
    interior.visible = inCab;
    shift(!!showroom);
    if (!showroom) [orbit, arm] = [0, tables.showroom.radius];
    if (showroom === 'orbit') {
      const { radius, height, lookHeight, speed, wallGap, armSpeed } = tables.showroom;
      orbit += speed * dt;
      const a = heading + Math.PI + 0.7 + orbit; // starts behind the truck, off to one side
      const [dx, dz] = [Math.sin(a), Math.cos(a)];
      // In front of the first building in the way, so no wall fills the picture; easing back out behind it.
      const room = Math.min(radius, canopyRoom(x, z, dx, dz), ...blocks.map((b) => rayToOutline(x, z, dx, dz, b.points) - wallGap));
      arm = Math.min(room, arm + armSpeed * dt);
      camera.position.set(x + dx * arm, height, z + dz * arm);
      camera.lookAt(x, lookHeight, z);
    } else if (inCab) {
      // Truck-space points, so the camera follows anything that moves the truck.
      camera.position.copy(truck.localToWorld(eye.fromArray(cam.cabEye)));
      camera.lookAt(truck.localToWorld(lookAt.fromArray(showroom ? cam.gimmickLook : cam.cabLook)));
    } else {
      // Chase camera: behind and above the truck, pulled in before a building in the way (as after reversing
      // into a dock) and raised as it does so the truck doesn't fill the view; quickly but not at once, and eases
      // back out, as the Werkstatt's camera does.
      const [dx, dz] = [-Math.sin(heading), -Math.cos(heading)];
      const room = Math.min(chaseRoom(x, z, dx, dz), canopyRoom(x, z, dx, dz));
      // Switched to from another view: straight to the room it has, not through a building.
      if (!wasChased) chaseArm = room;
      else chaseArm = room < chaseArm ? Math.max(room, chaseArm - cam.chasePullIn * dt) : Math.min(room, chaseArm + tables.showroom.armSpeed * dt);
      const height = cam.chaseHeight + (cam.chaseDistance - chaseArm) * cam.chaseRise;
      camera.position.set(x + dx * chaseArm, height, z + dz * chaseArm);
      camera.lookAt(x, cam.lookHeight, z);
    }
    if (rearTime) {
      rearCamera.position.copy(truck.localToWorld(eye.fromArray(cam.rearEye)));
      rearCamera.lookAt(truck.localToWorld(lookAt.fromArray(cam.rearLook)));
    }
    // The sun's shadow covers the ground around a point ahead of the camera.
    camera.getWorldDirection(focus).setY(0).normalize().multiplyScalar(lighting.shadow.ahead).add(camera.position);
    shadowCentre(focus, light, shadowTexel, sun.target.position);
    sun.position.copy(sun.target.position).addScaledVector(light.z, SUN_DISTANCE);
    sun.shadow.needsUpdate = true;
    // Window surrounds, sills and open shutters only near the camera, and only on facades facing it. On an OSM map,
    // whose facades stand at any angle, that test is per DIRS direction within 45° of theirs; a chunk's facades seen
    // from beside it at a grazing angle can lose their detail, where it hardly shows.
    const { x: cx, z: cz } = camera.position;
    for (const { mesh, dir } of buildingParts.near) {
      const { min, max } = mesh.geometry.boundingBox;
      mesh.visible = Math.hypot(Math.max(min.x - cx, 0, cx - max.x), Math.max(min.z - cz, 0, cz - max.z)) < tables.buildings.detailDistance && facing(min, max, dir, cx, cz);
    }
    drawCars(state.traffic, !!rearTime);
    streets.update(camera.position, inView);
    pipeline.render(scene, camera);
    if (rearTime) {
      // Straight into the target, in linear colour; the inset's draw through the pipeline converts it for the screen.
      // The truck from outside (SHADOW_ONLY in the cab), so its back edge shows at the bottom as a guide.
      interior.visible = false;
      renderer.setRenderTarget(rearTarget);
      renderer.render(scene, rearCamera);
      renderer.setRenderTarget(null);
      interior.visible = inCab;
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setViewport(inset.x, inset.y, inset.width, inset.height);
      pipeline.render(insetScene, insetCamera);
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.autoClear = autoClear;
    }
  }

  // Whether (x, z) is in front of some facade within `box`, all facing DIRS[dir]: past the box's back that way.
  function facing(min, max, dir, x, z) {
    const [dc, dr] = DIRS[dir];
    return dc ? dc * (x - (dc > 0 ? min.x : max.x)) > 0 : dr * (z - (dr > 0 ? min.z : max.z)) > 0;
  }

  // Tree canopies (tables.streets.canopy round each trunk), which the Werkstatt and chase cameras keep out of like walls.
  const { canopy } = tables.streets;
  const canopies = map.colliders.filter((c) => c.kind === 'tree').map((b) => ({ minX: b.minX - canopy, maxX: b.maxX + canopy, minZ: b.minZ - canopy, maxZ: b.maxZ + canopy }));
  // m along (dx, dz) from (x, z) to `wallGap` before the first canopy, never below 0; one the truck stands under
  // doesn't count, or the camera would have no room at all.
  const canopyRoom = (x, z, dx, dz) => Math.max(0, Math.min(...canopies.map((b) => rayToBox(x, z, dx, dz, b) || Infinity)) - tables.showroom.wallGap);

  // m along (dx, dz) from (x, z) to `wallGap` before the first building, at most chaseDistance. The ray is
  // walked in 1 m steps through the buildings, so it can miss a corner it only grazes.
  function chaseRoom(x, z, dx, dz) {
    for (let d = 0; d <= cam.chaseDistance + 1; d++) {
      const b = blockAt(x + dx * d, z + dz * d);
      if (b) return Math.min(cam.chaseDistance, rayToOutline(x, z, dx, dz, b.points) - tables.showroom.wallGap);
    }
    return cam.chaseDistance;
  }

  const carMatrix = new THREE.Matrix4();
  const carPosition = new THREE.Vector3();
  const carTurn = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const frustum = new THREE.Frustum();
  const rearFrustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const carBounds = new THREE.Sphere(new THREE.Vector3(), carSize.length() / 2);
  const frustumOf = (c, out) => {
    c.updateMatrixWorld();
    return out.setFromProjectionMatrix(viewProjection.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse), c.coordinateSystem);
  };
  // Whether a bounding sphere is in view, or in the inset's while it shows; drawCars() sets up both views.
  const inView = (sphere) => frustum.intersectsSphere(sphere) || (rearTime > 0 && rearFrustum.intersectsSphere(sphere));
  // Only the cars in view, or in the inset's while it shows, are drawn, in full detail within vehicles.near of the
  // truck: from the chase camera, camera.chaseDistance back, the car just ahead of the truck would lose its lights and plate.
  // An AI car's id picks its body type and paint; a police car is the police kind.
  function drawCars(cars, rear) {
    frustumOf(camera, frustum);
    if (rear) frustumOf(rearCamera, rearFrustum);
    for (const mesh of carMeshes) mesh.count = 0;
    for (const car of parked) drawCar(car.kind, car.x, car.z, car.heading, car.paint, rear);
    for (const car of cars) {
      if (car.police) drawCar(policeKind, car.x, car.z, car.heading, policePaint, rear);
      else drawCar(car.id % carTypes.length, car.x, car.z, car.heading, paints[(car.id * 7) % paints.length], rear);
    }
    for (const mesh of carMeshes) {
      mesh.visible = warmCars || mesh.count > 0;
      // Only the instances in use go up to the GPU.
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
    warmCars = false;
  }

  function drawCar(kind, x, z, heading, paint, rear) {
    carBounds.center.set(x, carSize.y / 2, z);
    if (!frustum.intersectsSphere(carBounds) && !(rear && rearFrustum.intersectsSphere(carBounds))) return;
    const { near, far, painted } = carKinds[kind];
    const meshes = Math.hypot(x - truck.position.x, z - truck.position.z) < tables.vehicles.near ? near : far;
    carMatrix.compose(carPosition.set(x, 0, z), carTurn.setFromAxisAngle(up, heading), one);
    for (const mesh of meshes) mesh.setMatrixAt(mesh.count, carMatrix);
    if (painted) meshes[0].setColorAt(meshes[0].count, paint);
    for (const mesh of meshes) mesh.count++;
  }

  function toggleCamera() {
    cabView = !cabView;
  }

  // A model that fails to load is logged and left out, as before; it doesn't hold up the game. A renderer that can't
  // start does: `ready` rejects and the loading screen stays.
  let loaded = 0;
  const models = Promise.all(loads.map((load) => load.catch(console.error).then(() => onProgress(++loaded / loads.length))));
  const ready = Promise.all([renderer.init(), models]);
  models.then(() => {
    for (const load of laterLoads) load().catch(console.error);
    return showFullSky && loadSky(lighting.sky).then(showFullSky);
  }).catch(console.error);
  laterLoads.push(() => Promise.all(COVERED.map((file) => loader.loadAsync(MODELS + file))).then(([near, far]) => {
    coveredCar.near = coverMeshes(near, true);
    coveredCar.far = coverMeshes(far, false);
    warmCars = true;
  }));

  // The covered car's meshes (cover and wheels, all one material) merged into one car mesh, scaled into the car
  // footprint and set on the ground (it is modelled lengthwise along z).
  function coverMeshes(gltf, shadow) {
    gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const s = Math.min(city.obstacles.car.length / size.z, city.obstacles.car.width / size.x);
    const fit = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-centre.x, -bounds.min.y, -centre.z));
    const parts = [];
    let material;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      material = o.material;
      // The pipeline quantizes the attributes into normalized integers, which can't hold metres: floats first.
      const geometry = new THREE.BufferGeometry().setIndex(o.geometry.index);
      for (const [name, a] of Object.entries(o.geometry.attributes)) {
        const floats = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) floats[i * a.itemSize + k] = a.getComponent(i, k);
        geometry.setAttribute(name, new THREE.BufferAttribute(floats, a.itemSize));
      }
      parts.push(geometry.applyMatrix4(fit.clone().multiply(o.matrixWorld)));
    });
    return [carMesh(mergeGeometries(parts), material, shadow)];
  }

  return {
    render,
    toggleCamera,
    ready,
    renderer,
    camera,
    get inCab() {
      return inCab;
    },
  };
}
