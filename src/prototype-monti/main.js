// PROTOTYPE (throwaway, branch prototype/monti-look). Question: how close to "photoreal" do free CC0 materials plus
// procedural facade detail get on real OSM footprints (Rione Monti, Rome) in three.js, and what does it cost?
// Variants via ?variant= or ←/→: A flat colours (today's look), B CC0 PBR + HDRI sky + sun shadows,
// C = B + screen-space ambient occlusion (GTAO) + haze. Views: Orbit (mouse) and Drive (camera at cab height).
import * as THREE from 'three/webgpu';
import { pass, mrt, normalView, screenUV, builtinAOContext } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

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
// Poly Haven wall textures: [name, takes a palette tint, metres per repeat]. Index 0 also dresses the kerbs.
const WALL_TEXTURES = [
  ['painted_plaster_wall', true, 3],
  ['damaged_plaster', true, 3],
  ['grey_plaster_02', true, 3],
  ['worn_plaster_wall', true, 3],
  ['clay_plaster', false, 3],
  ['red_brick_03', false, 2],
];
const GRIME = 2.5; // m of darkening at the foot of each wall
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
// Pushes one triangle of [x, y, z, u, v] corners; a corner's optional sixth item overrides `color` there.
function tri(d, a, b, c, color) {
  for (const [x, y, z, u, v, own] of [a, b, c]) {
    d.pos.push(x, y, z);
    d.uv.push(u, v);
    const col = own ?? color;
    if (col) d.col.push(col.r, col.g, col.b);
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

const walls = WALL_TEXTURES.map(() => newData());
const roofs = newData();
const parts = { glass: [], frame: [], sill: [], shutter: [], cornice: [], plinth: [], bollard: [], cap: [] };
const facades = []; // outside walls, for the wall lanterns
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
  // One in ten exposed brick, some untinted clay plaster, the rest a tinted plaster at random.
  const r = rnd(el.id, 8);
  const texture = r < 0.1 ? 5 : r < 0.25 ? 4 : Math.floor(rnd(el.id, 9) * 4);
  const [, tinted, tile] = WALL_TEXTURES[texture];
  const brightness = 0.85 + rnd(el.id, 3) * 0.2;
  const tint = tinted ? linear(pick(WALL_TINTS, el.id, 2)).multiplyScalar(brightness) : new THREE.Color(1, 1, 1).multiplyScalar(brightness);
  const grimy = tint.clone().multiplyScalar(0.62);
  const shutter = linear(pick(SHUTTERS, el.id, 4));
  const stone = linear(STONE);

  // A random texture offset per building, so neighbours' plaster doesn't line up; walls split at GRIME so the
  // darkening fades out over the bottom band only.
  let along0 = rnd(el.id, 10) * 20;
  const v0 = rnd(el.id, 11) * 20;
  const bands = height > GRIME ? [[0, GRIME, grimy, tint], [GRIME, height, tint, tint]] : [[0, height, grimy, tint]];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const [dx, dz] = [q[0] - p[0], q[1] - p[1]];
    const L = Math.hypot(dx, dz);
    const [u0, u1] = [along0 / tile, (along0 + L) / tile];
    along0 += L;
    for (const [y0, y1, c0, c1] of bands) {
      const [va, vb] = [v0 + y0 / tile, v0 + y1 / tile];
      const [p0, q0, q1, p1] = [[p[0], y0, p[1], u0, va, c0], [q[0], y0, q[1], u1, va, c0], [q[0], y1, q[1], u1, vb, c1], [p[0], y1, p[1], u0, vb, c1]];
      tri(walls[texture], p0, q0, q1);
      tri(walls[texture], p0, q1, p1);
    }
    if (edgeUse.get(edgeKey(nodes[i], nodes[(i + 1) % nodes.length])) > 1) return partyEdges++;
    if (L < 1.5) return;

    const [ux, uz] = [dx / L, dz / L];
    const e = { px: p[0], pz: p[1], ux, uz, nx: -uz, nz: ux, rot: Math.atan2(-uz, ux) };
    facades.push({ e, L, height, id: el.id, i });
    const put = (part, along, y, out, sx, sy, sz, color) =>
      parts[part].push({ x: e.px + ux * along + e.nx * out, y, z: e.pz + uz * along + e.nz * out, rot: e.rot, sx, sy, sz, color });

    put('cornice', L / 2, height - 0.3, 0.2, L + 0.5, 0.6, 0.6, stone);
    // Front at 0.06 m, behind the door frames (0.08) and glass (0.10): coplanar faces flickered.
    put('plinth', L / 2, 0.35, 0.03, L + 0.1, 0.7, 0.06, linear('#a39a8a'));
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

const upward = (a, b, c) => ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) >= 0 ? [a, b, c] : [a, c, b]);
// A strip of half-width w along pts at height y: a quad per segment and a disc per joint, with world UVs so
// overlaps match exactly. With `kerb` (a tint), vertical faces down to the ground go into the walls mesh.
function ribbon(d, pts, w, y, tile, kerb) {
  const v = (x, z) => [x, y, z, x / tile, z / tile];
  // Vertical face from a to b, facing left of a→b (the walls' winding).
  const side = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) / 3;
    tri(walls[0], [a[0], 0, a[1], 0, 0], [b[0], 0, b[1], L, 0], [b[0], y, b[1], L, y / 3], kerb);
    tri(walls[0], [a[0], 0, a[1], 0, 0], [b[0], y, b[1], L, y / 3], [a[0], y, a[1], 0, y / 3], kerb);
  };
  pts.forEach(([x, z], i) => {
    const ring = Array.from({ length: 12 }, (_, s) => [x + Math.cos((s * Math.PI) / 6) * w, z + Math.sin((s * Math.PI) / 6) * w]);
    ring.forEach((p, s) => {
      const q = ring[(s + 1) % 12];
      tri(d, ...upward(v(x, z), v(...p), v(...q)));
      if (kerb) side(q, p);
    });
    if (i === pts.length - 1) return;
    const [x2, z2] = pts[i + 1];
    const L = Math.hypot(x2 - x, z2 - z);
    if (L < 0.01) return;
    const [nx, nz] = [(-(z2 - z) / L) * w, ((x2 - x) / L) * w];
    const quad = [[x + nx, z + nz], [x2 + nx, z2 + nz], [x2 - nx, z2 - nz], [x - nx, z - nz]];
    tri(d, ...upward(v(...quad[0]), v(...quad[1]), v(...quad[2])));
    tri(d, ...upward(v(...quad[0]), v(...quad[2]), v(...quad[3])));
    if (kerb) {
      side(quad[0], quad[1]);
      side(quad[2], quad[3]);
    }
  });
}

// Asphalt where OSM says so (secondary/tertiary default to it); everything else stays sampietrini, which is the
// ground plane.
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
  ribbon(asphaltData, el.geometry.map(toXZ), (ROAD_WIDTH[t.highway] ?? 6) / 2, 0.03, 4, null);
}
const groundData = newData();
flat(groundData, [[-600, -600], [600, -600], [600, 600], [-600, 600]], 0, 1.4, null);

// ---- street furniture from OSM ----------------------------------------------------------------------------------
const furniture = (await (await fetch(`${BASE}monti-furniture.json`)).json()).elements;
const KERB = 0.15; // m
const kerbTint = linear('#d8d2c4');
const pavement = { pavers: newData(), asphalt: newData(), cobble: newData() };
const nodesOf = (tag, value) => furniture.filter((e) => e.type === 'node' && e.tags[tag] === value).map((e) => ({ id: e.id, xz: toXZ(e) }));
for (const el of furniture) {
  if (el.type !== 'way') continue;
  const s = el.tags.surface;
  const [kind, tile] = s === 'asphalt' ? ['asphalt', 4] : s === 'sett' ? ['cobble', 1.4] : ['pavers', 1.5];
  ribbon(pavement[kind], el.geometry.map(toXZ), (parseFloat(el.tags.width) || 2) / 2, KERB, tile, kerbTint);
}
const iron = linear('#3b443c');
for (const { xz: [x, z] } of nodesOf('barrier', 'bollard')) {
  parts.bollard.push({ x, y: 0.45, z, rot: 0, sx: 0.22, sy: 0.9, sz: 0.22, color: linear('#4a4844') });
  parts.cap.push({ x, y: 0.92, z, rot: 0, sx: 0.26, sy: 0.05, sz: 0.26, color: linear('#4a4844') });
}
// Nasoni: Rome's cast-iron drinking fountains, a post with a spout over a drain grate.
for (const { id, xz: [x, z] } of nodesOf('amenity', 'drinking_water')) {
  const rot = rnd(id, 1) * Math.PI * 2;
  const [ox, oz] = [Math.sin(rot), Math.cos(rot)];
  parts.bollard.push({ x, y: 0.58, z, rot, sx: 0.32, sy: 1.15, sz: 0.32, color: iron });
  parts.cap.push({ x, y: 1.18, z, rot, sx: 0.38, sy: 0.08, sz: 0.38, color: iron });
  parts.sill.push({ x: x + ox * 0.22, y: 0.62, z: z + oz * 0.22, rot, sx: 0.05, sy: 0.05, sz: 0.26, color: iron });
  parts.sill.push({ x: x + ox * 0.25, y: 0.02, z: z + oz * 0.25, rot, sx: 0.55, sy: 0.04, sz: 0.45, color: linear('#2a2a28') });
}

// OSM maps almost none of Monti's lamps (they hang on the walls), so a lantern goes on street-facing walls about
// every 24 m, half a window bay off the window axis. Street-facing: 2 m out from the wall is inside a street's
// half-width plus 4 m.
const roadSegs = drivable.flatMap((w) => {
  const pts = w.geometry.map(toXZ);
  const reach = (ROAD_WIDTH[w.tags.highway] ?? 6) / 2 + 4;
  return pts.slice(1).map((q, i) => [pts[i], q, reach]);
});
const nearStreet = (x, z) =>
  roadSegs.some(([a, b, reach]) => {
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < reach;
  });
const wallLamps = [];
for (const { e, L, height, id, i } of facades) {
  if (height < 6) continue;
  const n = Math.floor(L / 24) + (rnd(id, i + 900) < (L % 24) / 24 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const along = Math.min(L - 0.6, ((k + 0.5) * L) / n + 1.6);
    const [x, z] = [e.px + e.ux * along, e.pz + e.uz * along];
    if (nearStreet(x + e.nx * 2, z + e.nz * 2)) wallLamps.push({ x, y: 3.3, z, rot: e.rot });
  }
}
const atNodes = (list, y = 0) => list.map(({ id, xz: [x, z] }) => ({ x, y, z, rot: rnd(id, 5) * Math.PI * 2 }));

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
const gltfLoader = new GLTFLoader();
const model = (id) => gltfLoader.loadAsync(`${BASE}models/${id}/${id}_1k.gltf`);
const [skyHdr, wallMs, roofM, groundM, asphaltM, grassM, paversM, treeTex, wallLampModel, poleLampModel, binModel] = await Promise.all([
  new HDRLoader().loadAsync(`${BASE}sky_2k.hdr`),
  Promise.all(WALL_TEXTURES.map(([name]) => pbr(name, { vertexColors: true }))),
  pbr('clay_roof_tiles_02'),
  pbr('cobblestone_square'),
  pbr('asphalt_02'),
  pbr('leafy_grass'),
  pbr('floor_pavement'),
  texLoader.loadAsync(`${BASE}tree_jacaranda.png`),
  model('street_lamp_02'),
  model('street_lamp_01'),
  model('metal_trash_can'),
]);
skyHdr.mapping = THREE.EquirectangularReflectionMapping;
treeTex.colorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const looks = []; // { mesh, A, B }: the flat and the PBR material of each mesh
function add(mesh, A, B) {
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  looks.push({ mesh, A, B });
}
const flatWalls = lambert('#ffffff', { vertexColors: true, flatShading: true });
walls.forEach((d, k) => add(new THREE.Mesh(toGeometry(d), wallMs[k]), flatWalls, wallMs[k]));
add(new THREE.Mesh(toGeometry(roofs), roofM), lambert('#b5603e'), roofM);
add(new THREE.Mesh(toGeometry(groundData), groundM), lambert('#9a968e'), groundM);
add(new THREE.Mesh(toGeometry(asphaltData), asphaltM), lambert('#4a4d55'), asphaltM);
add(new THREE.Mesh(toGeometry(grassData), grassM), lambert('#6d9b4f'), grassM);
add(new THREE.Mesh(toGeometry(pavement.pavers), paversM), lambert('#b9b0a0'), paversM);
add(new THREE.Mesh(toGeometry(pavement.asphalt), asphaltM), lambert('#4a4d55'), asphaltM);
add(new THREE.Mesh(toGeometry(pavement.cobble), groundM), lambert('#9a968e'), groundM);

const box = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
const partGeometry = { bollard: cylinder, cap: cylinder };
const partLooks = {
  glass: [lambert('#2c3440'), new THREE.MeshStandardMaterial({ color: '#1b2128', roughness: 0.06, metalness: 0.6 })],
  frame: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.8 })],
  sill: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.8 })],
  shutter: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.55 })],
  cornice: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.85 })],
  plinth: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.9 })],
  bollard: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.6 })],
  cap: [lambert('#ffffff'), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.6 })],
};
const m4 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);
let instances = 0;
for (const [name, list] of Object.entries(parts)) {
  const [A, B] = partLooks[name];
  const mesh = new THREE.InstancedMesh(partGeometry[name] ?? box, B, list.length);
  list.forEach((p, i) => {
    m4.compose(new THREE.Vector3(p.x, p.y, p.z), quat.setFromAxisAngle(yAxis, p.rot), new THREE.Vector3(p.sx, p.sy, p.sz));
    mesh.setMatrixAt(i, m4);
    if (p.color) mesh.setColorAt(i, p.color);
  });
  instances += list.length;
  mesh.castShadow = name === 'cornice' || name === 'shutter' || name === 'bollard';
  mesh.receiveShadow = true;
  scene.add(mesh);
  looks.push({ mesh, A, B });
}

// Trees: the jacaranda rendered once (prototype-monti-bake.html) on three crossed quads. Upward normals light all
// quads alike, as a canopy; the picture is TREE_SPAN metres wide with the trunk at u = 0.54.
const TREE_SPAN = 24.2;
const treeData = newData();
for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
  const P = (u, v) => [(u - 0.54) * Math.cos(a), v, (u - 0.54) * Math.sin(a), u, v];
  tri(treeData, P(0, 0), P(1, 0), P(1, 1));
  tri(treeData, P(0, 0), P(1, 1), P(0, 1));
}
const treeGeometry = toGeometry(treeData);
treeGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: 18 }, () => [0, 1, 0]).flat(), 3));
const trees = furniture.filter((e) => e.tags?.natural === 'tree');
const treeLook = { map: treeTex, alphaTest: 0.5, side: THREE.DoubleSide };
const treeB = new THREE.MeshStandardMaterial({ ...treeLook, roughness: 1 });
const treeMesh = new THREE.InstancedMesh(treeGeometry, treeB, trees.length);
trees.forEach((t, i) => {
  const [x, z] = toXZ(t);
  const pine = t.tags.leaf_type === 'needleleaved' || t.tags.genus === 'Pinus';
  const s = TREE_SPAN * (pine ? 0.5 + rnd(t.id, 6) * 0.1 : 0.32 + rnd(t.id, 6) * 0.15);
  treeMesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), quat.setFromAxisAngle(yAxis, rnd(t.id, 7) * Math.PI), new THREE.Vector3(s, s, s)));
});
treeMesh.castShadow = true; // not receiving: the crossed quads shadowed each other black
scene.add(treeMesh);
looks.push({ mesh: treeMesh, A: new THREE.MeshLambertMaterial(treeLook), B: treeB });

// A Poly Haven model as instances standing on y = 0 at each placement. `wall`: its back at z = 0, so it sits on a
// facade whose outward normal is the placement's local +z. Each sub-mesh gets a near and a far InstancedMesh:
// full detail within LOD_NEAR metres of the camera, a meshoptimizer-simplified copy (`keep` of the vertices)
// beyond; updateLods() re-sorts the instances between them.
const LOD_NEAR = 25; // m
const simplifier = new SimplifyModifier();
const lodModels = [];
let fullTris = 0;
let lowTris = 0;
async function instanceModel(gltf, placements, { wall = false, keep = 0.05 } = {}) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const c = bounds.getCenter(new THREE.Vector3());
  const base = new THREE.Matrix4().makeTranslation(-c.x, -bounds.min.y, wall ? -bounds.min.z : -c.z);
  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  const parts = [];
  for (const o of meshes) {
    const low = await simplifier.modify(o.geometry, Math.floor(o.geometry.attributes.position.count * (1 - keep)));
    const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    fullTris += tris(o.geometry);
    lowTris += tris(low);
    const matrices = placements.map((p) =>
      new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), quat.setFromAxisAngle(yAxis, p.rot), new THREE.Vector3(1, 1, 1)).multiply(base).multiply(o.matrixWorld),
    );
    const [near, far] = [o.geometry, low].map((g) => {
      const mesh = new THREE.InstancedMesh(g, o.material, placements.length);
      mesh.frustumCulled = false; // instances move between near and far, so the bounds would go stale
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      looks.push({ mesh, A: o.material, B: o.material });
      return mesh;
    });
    parts.push({ near, far, matrices });
  }
  lodModels.push({ placements, parts });
}
let lodOn = !new URLSearchParams(location.search).has('nolod');
function updateLods(eye) {
  for (const { placements, parts } of lodModels) {
    const close = placements.map((p) => !lodOn || Math.hypot(p.x - eye.x, p.z - eye.z) < LOD_NEAR);
    for (const { near, far, matrices } of parts) {
      let [n, f] = [0, 0];
      matrices.forEach((m, i) => (close[i] ? near.setMatrixAt(n++, m) : far.setMatrixAt(f++, m)));
      [near.count, far.count] = [n, f];
      near.instanceMatrix.needsUpdate = far.instanceMatrix.needsUpdate = true;
    }
  }
}
const poleLamps = atNodes(nodesOf('highway', 'street_lamp'));
const bins = atNodes(nodesOf('amenity', 'waste_basket'));
await instanceModel(wallLampModel, wallLamps, { wall: true });
await instanceModel(poleLampModel, poleLamps);
await instanceModel(binModel, bins);
const propsLine = `trees ${trees.length}  lanterns ${wallLamps.length}+${poleLamps.length}  bins ${bins.length}\n` +
  `prop meshes ${(fullTris / 1000).toFixed(1)}k → ${(lowTris / 1000).toFixed(1)}k tris beyond ${LOD_NEAR} m`;

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
// trackTimestamp: GPU time per frame where the browser offers timestamp queries.
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL, trackTimestamp: true });
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
  if (e.key === 'l') lodOn = !lodOn; // compare with all props at full detail
});
applyVariant();
setView(view);

const statsEl = document.getElementById('stats');
const frameMs = [];
let last = performance.now();
let driveS = 160;
let driveDir = 1;
let frames = 0;
let gpuMs = null;
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

  if (frames % 10 === 0) updateLods(camera.position);
  renderer.info.reset();
  if (variant === 'C') pipeline.render();
  else renderer.render(scene, camera);
  renderer.resolveTimestampsAsync('render').then((ms) => {
    if (ms) gpuMs = ms;
  });

  if (++frames % 10 === 0) {
    const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;
    const { drawCalls, triangles } = renderer.info.render;
    statsEl.textContent =
      `PROTOTYPE  ${backend}  ${Math.round(innerWidth * renderer.getPixelRatio())}×${Math.round(innerHeight * renderer.getPixelRatio())}\n` +
      `frame ${avg.toFixed(1)} ms (${Math.round(1000 / avg)} fps)  gpu ${gpuMs ? gpuMs.toFixed(1) + ' ms' : 'n/a'}\n` +
      `LOD ${lodOn ? 'on' : 'off'} (L toggles)\n` +
      `draws ${drawCalls}  tris ${(triangles / 1e6).toFixed(2)} M\n` +
      `buildings ${buildingEls.length}  detail parts ${instances.toLocaleString('en')}\n` +
      `party walls skipped ${partyEdges}\n${propsLine}`;
  }
});
document.getElementById('loading').remove();
window.proto = { camera, controls, drive, driveLen, renderer, wallLamps, trees: trees.map(toXZ), nasoni: nodesOf('amenity', 'drinking_water') }; // console poking only
