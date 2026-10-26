// PROTOTYPE (throwaway, branch prototype/monti-look). Question: how close to "photoreal" do free CC0 materials plus
// procedural facade detail get on real OSM footprints (Rione Monti, Rome) in three.js, and what does it cost?
// Variants via ?variant= or ←/→: A flat colours (today's look), B CC0 PBR + HDRI sky + sun shadows,
// C = B + screen-space ambient occlusion (GTAO) + haze. Views: Orbit (mouse) and Drive (camera at cab height).
import * as THREE from 'three/webgpu';
import { pass, mrt, normalView, screenUV, builtinAOContext } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const BASE = `${import.meta.env.BASE_URL}prototype-monti/`;
const VARIANTS = [
  ['A', 'Flat colours (today)'],
  ['B', 'CC0 PBR + sky + shadows'],
  ['C', 'PBR + AO + haze'],
];
const LAT0 = 41.89525;
const LON0 = 12.49225;
const M_LAT = 110574;
const M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const toXZ = (p) => [(p.lon - LON0) * M_LON, -(p.lat - LAT0) * M_LAT];
const GROUND_FLOOR = 4.5; // m
const FLOOR = 3.5; // m
const WALL_TINTS = ['#d9a35b', '#c8744a', '#e3c58f', '#e8d9b8', '#b8573a', '#d8a48c', '#cf9a6a'];
const SHUTTERS = ['#3f5b3a', '#4d6b45', '#6b4a2e', '#55603c', '#7a5a3a'];
const STONE = '#e6dcc6';
const ROAD_WIDTH = { secondary: 12, tertiary: 10, residential: 7, unclassified: 7, living_street: 6, pedestrian: 6, service: 4 };
const rnd = (id, k) => {
  const x = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const pick = (list, id, k) => list[Math.floor(rnd(id, k) * list.length)];
const linear = (hex) => new THREE.Color(hex);

const osm = await (await fetch(`${BASE}monti-osm.json`)).json();

// ---- geometry -------------------------------------------------------------------------------------------------
const newData = () => ({ pos: [], uv: [], col: [] });
// Pushes one triangle of [x, y, z, u, v] corners.
function tri(d, a, b, c, color) {
  for (const [x, y, z, u, v] of [a, b, c]) {
    d.pos.push(x, y, z);
    d.uv.push(u, v);
    if (color) d.col.push(color.r, color.g, color.b);
  }
}
function toGeometry(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
  if (d.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
  g.computeVertexNormals();
  return g;
}
// Flat polygon at height y, faces up, UVs in world metres / `tile`.
function flat(d, ring, y, tile, color) {
  const faces = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (let [a, b, c] of faces) {
    const [A, B, C] = [ring[a], ring[b], ring[c]];
    if ((B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) < 0) [b, c] = [c, b];
    tri(d, ...[a, b, c].map((i) => [ring[i][0], y, ring[i][1], ring[i][0] / tile, ring[i][1] / tile]), color);
  }
}

// Edges shared by two buildings are party walls: no windows, no cornice.
const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const edgeUse = new Map();
const buildingEls = osm.elements.filter((e) => e.tags?.building && e.tags.building !== 'roof' && e.nodes[0] === e.nodes.at(-1));
for (const el of buildingEls) {
  for (let i = 0; i < el.nodes.length - 1; i++) {
    const key = edgeKey(el.nodes[i], el.nodes[i + 1]);
    edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
  }
}

const walls = newData();
const roofs = newData();
const parts = { glass: [], frame: [], sill: [], shutter: [], cornice: [], plinth: [] };
let partyEdges = 0;

for (const el of buildingEls) {
  const t = el.tags;
  const ring = el.geometry.slice(0, -1).map(toXZ);
  const nodes = el.nodes.slice(0, -1);
  const area = ring.reduce((s, [x, z], i) => {
    const [x2, z2] = ring[(i + 1) % ring.length];
    return s + x * z2 - x2 * z;
  }, 0);
  if (area > 0) {
    ring.reverse();
    nodes.reverse();
  }
  const church = t.building === 'church' || t.building === 'chapel';
  const levels = church ? 0 : Math.max(1, Math.round(parseFloat(t['building:levels']) || 3 + Math.floor(rnd(el.id, 1) * 3)));
  const height = parseFloat(t.height) || (church ? 20 : GROUND_FLOOR + (levels - 1) * FLOOR + 1);
  const tint = linear(pick(WALL_TINTS, el.id, 2)).multiplyScalar(0.85 + rnd(el.id, 3) * 0.2);
  const shutter = linear(pick(SHUTTERS, el.id, 4));
  const stone = linear(STONE);

  let along0 = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const [dx, dz] = [q[0] - p[0], q[1] - p[1]];
    const L = Math.hypot(dx, dz);
    const [u0, u1, v1] = [along0 / 3, (along0 + L) / 3, height / 3];
    along0 += L;
    tri(walls, [p[0], 0, p[1], u0, 0], [q[0], 0, q[1], u1, 0], [q[0], height, q[1], u1, v1], tint);
    tri(walls, [p[0], 0, p[1], u0, 0], [q[0], height, q[1], u1, v1], [p[0], height, p[1], u0, v1], tint);
    if (edgeUse.get(edgeKey(nodes[i], nodes[(i + 1) % nodes.length])) > 1) return partyEdges++;
    if (L < 1.5) return;

    const [ux, uz] = [dx / L, dz / L];
    const e = { px: p[0], pz: p[1], ux, uz, nx: -uz, nz: ux, rot: Math.atan2(-uz, ux) };
    const put = (part, along, y, out, sx, sy, sz, color) =>
      parts[part].push({ x: e.px + ux * along + e.nx * out, y, z: e.pz + uz * along + e.nz * out, rot: e.rot, sx, sy, sz, color });

    put('cornice', L / 2, height - 0.3, 0.2, L + 0.5, 0.6, 0.6, stone);
    put('plinth', L / 2, 0.35, 0.05, L + 0.1, 0.7, 0.1, linear('#a39a8a'));
    const n = Math.floor((L - 1) / 3.2);
    for (let k = 0; k < n; k++) {
      const along = ((k + 0.5) * L) / n;
      const r = rnd(el.id, i * 37 + k);
      if (levels > 0 && r < 0.55) {
        // Shop front or portone on the ground floor.
        put('glass', along, 1.45, 0.08, 2.0, 2.9, 0.04);
        put('frame', along, 1.55, 0.04, 2.5, 3.1, 0.08, stone);
      }
      for (let f = 1; f < levels; f++) {
        const y = GROUND_FLOOR + (f - 1) * FLOOR + 1.6;
        put('glass', along, y, 0.08, 1.1, 1.9, 0.04);
        put('frame', along, y, 0.04, 1.45, 2.25, 0.08, stone);
        put('sill', along, y - 1.1, 0.14, 1.6, 0.12, 0.28, stone);
        const closed = rnd(el.id, i * 37 + k + f * 101) < 0.3;
        for (const side of [-1, 1]) {
          if (closed) put('shutter', along + side * 0.28, y, 0.13, 0.55, 1.9, 0.05, shutter);
          else put('shutter', along + side * 1.0, y, 0.06, 0.55, 1.9, 0.05, shutter);
        }
      }
    }
  });
  flat(roofs, ring, height, 3, null);
}

// Asphalt where OSM says so (secondary/tertiary default to it); everything else stays sampietrini, which is the
// ground plane. Each segment is a quad, each joint a disc, all with world UVs so overlaps match exactly.
const asphaltData = newData();
const grassData = newData();
const drivable = [];
for (const el of osm.elements) {
  const t = el.tags ?? {};
  if (t.leisure && el.nodes[0] === el.nodes.at(-1)) {
    const ring = el.geometry.slice(0, -1).map(toXZ);
    flat(grassData, ring, 0.015, 3, null);
  }
  if (!t.highway) continue;
  drivable.push(el);
  const isAsphalt = t.surface === 'asphalt' || (!t.surface && (t.highway === 'secondary' || t.highway === 'tertiary'));
  if (!isAsphalt) continue;
  const w = (ROAD_WIDTH[t.highway] ?? 6) / 2;
  const pts = el.geometry.map(toXZ);
  const v = (x, z) => [x, 0.03, z, x / 4, z / 4];
  pts.forEach(([x, z], i) => {
    for (let s = 0; s < 12; s++) {
      const [a, b] = [(s * Math.PI) / 6, ((s + 1) * Math.PI) / 6];
      tri(asphaltData, v(x, z), v(x + Math.cos(b) * w, z + Math.sin(b) * w), v(x + Math.cos(a) * w, z + Math.sin(a) * w));
    }
    if (i === pts.length - 1) return;
    const [x2, z2] = pts[i + 1];
    const L = Math.hypot(x2 - x, z2 - z);
    const [nx, nz] = [(-(z2 - z) / L) * w, ((x2 - x) / L) * w];
    const quad = [v(x + nx, z + nz), v(x2 + nx, z2 + nz), v(x2 - nx, z2 - nz), v(x - nx, z - nz)];
    const up = (a, b, c) => ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) >= 0 ? [a, b, c] : [a, c, b]);
    tri(asphaltData, ...up(quad[0], quad[1], quad[2]));
    tri(asphaltData, ...up(quad[0], quad[2], quad[3]));
  });
}
const groundData = newData();
flat(groundData, [[-600, -600], [600, -600], [600, 600], [-600, 600]], 0, 1.4, null);

// ---- materials ------------------------------------------------------------------------------------------------
const texLoader = new THREE.TextureLoader();
async function pbr(name, extra = {}) {
  const load = async (map, srgb) => {
    const t = await texLoader.loadAsync(`${BASE}${name}_${map}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const [map, normalMap, arm] = await Promise.all([load('Diffuse', true), load('nor_gl'), load('arm')]);
  return new THREE.MeshStandardMaterial({ map, normalMap, aoMap: arm, roughnessMap: arm, ...extra });
}
const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const [skyHdr, wallM, roofM, groundM, asphaltM, grassM] = await Promise.all([
  new HDRLoader().loadAsync(`${BASE}sky_2k.hdr`),
  pbr('painted_plaster_wall', { vertexColors: true }),
  pbr('clay_roof_tiles_02'),
  pbr('cobblestone_square'),
  pbr('asphalt_02'),
  pbr('leafy_grass'),
]);
skyHdr.mapping = THREE.EquirectangularReflectionMapping;

const scene = new THREE.Scene();
const looks = []; // { mesh, A, B }: the flat and the PBR material of each mesh
function add(mesh, A, B) {
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  looks.push({ mesh, A, B });
}
add(new THREE.Mesh(toGeometry(walls), wallM), lambert('#ffffff', { vertexColors: true, flatShading: true }), wallM);
add(new THREE.Mesh(toGeometry(roofs), roofM), lambert('#b5603e'), roofM);
add(new THREE.Mesh(toGeometry(groundData), groundM), lambert('#9a968e'), groundM);
add(new THREE.Mesh(toGeometry(asphaltData), asphaltM), lambert('#4a4d55'), asphaltM);
add(new THREE.Mesh(toGeometry(grassData), grassM), lambert('#6d9b4f'), grassM);

const box = new THREE.BoxGeometry(1, 1, 1);
const partLooks = {
  glass: [lambert('#2c3440'), new THREE.MeshStandardMaterial({ color: '#1b2128', roughness: 0.06, metalness: 0.6 })],
  frame: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.8 })],
  sill: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.8 })],
  shutter: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.55 })],
  cornice: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.85 })],
  plinth: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.9 })],
};
const m4 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);
let instances = 0;
for (const [name, list] of Object.entries(parts)) {
  const [A, B] = partLooks[name];
  const mesh = new THREE.InstancedMesh(box, B, list.length);
  list.forEach((p, i) => {
    m4.compose(new THREE.Vector3(p.x, p.y, p.z), quat.setFromAxisAngle(yAxis, p.rot), new THREE.Vector3(p.sx, p.sy, p.sz));
    mesh.setMatrixAt(i, m4);
    if (p.color) mesh.setColorAt(i, p.color);
  });
  instances += list.length;
  mesh.castShadow = name === 'cornice' || name === 'shutter';
  mesh.receiveShadow = true;
  scene.add(mesh);
  looks.push({ mesh, A, B });
}

// ---- lights, renderer, post -----------------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight('#dbe8ff', '#8a7d6a', 1.2);
const sun = new THREE.DirectionalLight('#fff3e0', 3);
const sunDir = new THREE.Vector3(-0.55, 0.62, 0.55).normalize(); // afternoon sun from the south-west
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 600 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(hemi, sun, sun.target);

const canvas = document.getElementById('scene');
const forceWebGL = new URLSearchParams(location.search).has('webgl');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
await renderer.init();

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 2000);
camera.position.set(-180, 160, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.minDistance = 3;
controls.maxDistance = 900;

const pipeline = new THREE.RenderPipeline(renderer);
const prePass = pass(scene, camera);
prePass.setMRT(mrt({ output: normalView }));
const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
aoPass.resolutionScale = 0.5;
aoPass.radius.value = 1.5;
const scenePass = pass(scene, camera);
scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
pipeline.outputNode = scenePass;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- drive route: Via Panisperna, chained from its OSM ways --------------------------------------------------
function route(name) {
  const ways = drivable.filter((w) => w.tags.name === name).map((w) => ({ nodes: w.nodes, pts: w.geometry.map(toXZ) }));
  if (!ways.length) return null;
  const ends = (w) => [w.nodes[0], w.nodes.at(-1)];
  const count = new Map();
  for (const w of ways) for (const n of ends(w)) count.set(n, (count.get(n) ?? 0) + 1);
  const reversed = (w) => ({ nodes: [...w.nodes].reverse(), pts: [...w.pts].reverse() });
  const start = ways.find((w) => ends(w).some((n) => count.get(n) === 1)) ?? ways[0];
  const used = new Set([start]);
  let cur = count.get(start.nodes[0]) === 1 ? start : reversed(start);
  const pts = [...cur.pts];
  for (;;) {
    const end = cur.nodes.at(-1);
    const next = ways.find((w) => !used.has(w) && ends(w).includes(end));
    if (!next) break;
    used.add(next);
    cur = next.nodes[0] === end ? next : reversed(next);
    pts.push(...cur.pts.slice(1));
  }
  return pts;
}
const drive = route('Via Panisperna') ?? drivable.reduce((a, b) => (a.geometry.length > b.geometry.length ? a : b)).geometry.map(toXZ);
const driveLen = [0];
for (let i = 1; i < drive.length; i++) driveLen.push(driveLen[i - 1] + Math.hypot(drive[i][0] - drive[i - 1][0], drive[i][1] - drive[i - 1][1]));
function along(s) {
  s = Math.max(0, Math.min(driveLen.at(-1), s));
  let i = driveLen.findIndex((l) => l >= s);
  if (i <= 0) i = 1;
  const f = (s - driveLen[i - 1]) / (driveLen[i] - driveLen[i - 1] || 1);
  const [a, b] = [drive[i - 1], drive[i]];
  return new THREE.Vector3(a[0] + (b[0] - a[0]) * f, 0, a[1] + (b[1] - a[1]) * f);
}

// ---- variants, views, stats -----------------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
let variant = VARIANTS.some(([k]) => k === params.get('variant')) ? params.get('variant') : 'B';
let view = params.get('view') === 'drive' ? 'drive' : 'orbit';
const fog = new THREE.FogExp2('#c4cfd8', 0.0022);

function applyVariant() {
  const pbrLook = variant !== 'A';
  for (const l of looks) l.mesh.material = pbrLook ? l.B : l.A;
  scene.background = pbrLook ? skyHdr : new THREE.Color('#9ec9e8');
  scene.environment = pbrLook ? skyHdr : null;
  scene.environmentIntensity = 0.7;
  scene.fog = variant === 'C' ? fog : null;
  hemi.intensity = pbrLook ? 0 : 1.2;
  sun.intensity = pbrLook ? 3.2 : 2.2;
  sun.castShadow = pbrLook;
  renderer.toneMapping = pbrLook ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  for (const l of looks) l.mesh.material.needsUpdate = true;
  const [, label] = VARIANTS.find(([k]) => k === variant);
  document.getElementById('label').textContent = `${variant} · ${label}`;
}
function setVariant(step) {
  const i = VARIANTS.findIndex(([k]) => k === variant);
  variant = VARIANTS[(i + step + VARIANTS.length) % VARIANTS.length][0];
  params.set('variant', variant);
  history.replaceState(null, '', `?${params}`);
  applyVariant();
}
function setView(v) {
  view = v;
  params.set('view', v);
  history.replaceState(null, '', `?${params}`);
  controls.enabled = v === 'orbit';
  for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.view === v);
  if (v === 'orbit') {
    camera.position.set(-180, 160, 200);
    controls.target.set(0, 0, 0);
  }
}
document.getElementById('prev').onclick = () => setVariant(-1);
document.getElementById('next').onclick = () => setVariant(1);
for (const b of document.querySelectorAll('#views button')) b.onclick = () => setView(b.dataset.view);
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') setVariant(-1);
  if (e.key === 'ArrowRight') setVariant(1);
});
applyVariant();
setView(view);

const statsEl = document.getElementById('stats');
const frameMs = [];
let last = performance.now();
let driveS = 160;
let driveDir = 1;
let frames = 0;
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  frameMs.push(now - last);
  if (frameMs.length > 60) frameMs.shift();
  last = now;

  if (view === 'drive') {
    driveS += driveDir * 9 * dt; // 9 m/s ≈ 32 km/h
    // The street's first 100 m run along the edge of the downloaded area, with nothing built on one side.
    if (driveS > driveLen.at(-1) - 20 || driveS < 100) driveDir *= -1;
    const eye = along(driveS).setY(2.6);
    camera.position.copy(eye);
    camera.lookAt(along(driveS + driveDir * 20).setY(2.0));
  } else controls.update();

  // The shadow box follows what the camera looks at, snapped to whole metres so shadows don't swim.
  const focus = view === 'drive' ? camera.position : controls.target;
  sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);

  renderer.info.reset();
  if (variant === 'C') pipeline.render();
  else renderer.render(scene, camera);

  if (++frames % 10 === 0) {
    const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;
    const { drawCalls, triangles } = renderer.info.render;
    statsEl.textContent =
      `PROTOTYPE  ${backend}  ${Math.round(innerWidth * renderer.getPixelRatio())}×${Math.round(innerHeight * renderer.getPixelRatio())}\n` +
      `frame ${avg.toFixed(1)} ms (${Math.round(1000 / avg)} fps)\n` +
      `draws ${drawCalls}  tris ${(triangles / 1e6).toFixed(2)} M\n` +
      `buildings ${buildingEls.length}  detail parts ${instances.toLocaleString('en')}\n` +
      `party walls skipped ${partyEdges}`;
  }
});
document.getElementById('loading').remove();
window.proto = { camera, drive, driveLen, renderer }; // console poking only
