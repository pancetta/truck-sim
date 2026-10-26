// Street dressing (#40, tables.streets): raised pavements with stone kerbs, lanterns on street-facing walls and on
// the poles, and the trees and small props the Sim puts on open ground (tables.city.plaza). The layout functions are
// plain data (streets.test.js); createStreets() builds the meshes and draws the lanterns by distance.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIRS } from './sim/map.js';
import assetInfo from './assetInfo.json';

const tileKey = (col, row) => `${col},${row}`;
// Tiles a building or spot stands on: solid, with a wall along each side that faces a road.
const blockTiles = (map) =>
  new Set(map.colliders.filter((b) => b.kind === 'building' || b.kind === 'spot').map((b) => tileKey(Math.floor(b.minX / map.tileSize), Math.floor(b.minZ / map.tileSize))));

// Pavement on road tiles, as rectangles, and the kerbs along their road edges as segments with the outward direction
// (dx, dz). A road tile is split 3 × 3 at `width` m from each side: a side strip is pavement where a building or spot
// tile is beside it, unless that is a dock across the strip from its zone; a corner square where any of the three
// tiles round it is one. A cell side that faces neither pavement nor a block is kerb.
export function pavementLayout(map, width) {
  const ts = map.tileSize;
  const blocks = blockTiles(map);
  const isBlock = (col, row) => blocks.has(tileKey(col, row));
  const docks = new Set(map.spots.filter((s) => s.dock).map((s) => `${tileKey(s.zoneTile.col, s.zoneTile.row)},${(s.dir + 2) % 4}`));
  const bounds = [0, width, ts - width, ts]; // m across a tile, cell by cell
  const cells = new Set(); // keys of paved cells, 3 per tile each way
  for (const { col, row } of map.roads) {
    for (const [i, j] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) {
      const [dx, dz] = [i - 1, j - 1];
      const paved = dx && dz
        ? isBlock(col + dx, row) || isBlock(col, row + dz) || isBlock(col + dx, row + dz)
        : isBlock(col + dx, row + dz) && !docks.has(`${tileKey(col, row)},${DIRS.findIndex(([a, b]) => a === dx && b === dz)}`);
      if (paved) cells.add(tileKey(3 * col + i, 3 * row + j));
    }
  }
  const rect = (gx, gz) => {
    const [x, z] = [Math.floor(gx / 3) * ts, Math.floor(gz / 3) * ts];
    return { minX: x + bounds[gx % 3], maxX: x + bounds[(gx % 3) + 1], minZ: z + bounds[gz % 3], maxZ: z + bounds[(gz % 3) + 1] };
  };
  const pavements = [];
  const kerbs = [];
  for (const key of cells) {
    const [gx, gz] = key.split(',').map(Number);
    const r = rect(gx, gz);
    pavements.push(r);
    for (const [dx, dz] of DIRS) {
      const [nx, nz] = [gx + dx, gz + dz];
      if (cells.has(tileKey(nx, nz)) || isBlock(Math.floor(nx / 3), Math.floor(nz / 3))) continue;
      const x = dx > 0 ? r.maxX : r.minX;
      const z = dz > 0 ? r.maxZ : r.minZ;
      kerbs.push(dx ? { x0: x, z0: r.minZ, x1: x, z1: r.maxZ, dx, dz } : { x0: r.minX, z0: z, x1: r.maxX, z1: z, dx, dz });
    }
  }
  return { pavements, kerbs };
}

// Where lanterns hang: { x, z, angle, pole }, (x, z) on the wall or the pole's side, turned by `angle` about y so
// the model's +z points out over the road. On walls, at every `spacing` m along each street-facing side of a block
// tile (counted from the map's edge, so the rhythm runs on from tile to tile), clear of the corners where a wall
// turns; and one on each pole, on its road side.
export function lanternSpots(map, { spacing, post }) {
  const ts = map.tileSize;
  const blocks = blockTiles(map);
  const spots = [];
  const margin = 1; // m from a corner
  for (const key of blocks) {
    const [col, row] = key.split(',').map(Number);
    for (const [dc, dr] of DIRS) {
      if (!map.isRoad(col + dc, row + dr)) continue;
      const alongX = dr !== 0;
      const wall = alongX ? (row + 0.5 + dr / 2) * ts : (col + 0.5 + dc / 2) * ts;
      // Whether the wall runs on into the tile `step` along, or turns a corner there.
      const runsOn = (step) => {
        const [c, r] = alongX ? [col + step, row] : [col, row + step];
        return blocks.has(tileKey(c, r)) && map.isRoad(c + dc, r + dr);
      };
      const start = (alongX ? col : row) * ts + (runsOn(-1) ? 0 : margin);
      const end = (alongX ? col + 1 : row + 1) * ts - (runsOn(1) ? 0 : margin);
      for (let k = Math.ceil(start / spacing - 0.5); (k + 0.5) * spacing < end; k++) {
        const along = (k + 0.5) * spacing;
        spots.push({ ...(alongX ? { x: along, z: wall } : { x: wall, z: along }), angle: Math.atan2(dc, dr), pole: false });
      }
    }
  }
  for (const b of map.colliders.filter((c) => c.kind === 'pole')) {
    const [x, z] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
    const angle = Math.atan2((Math.floor(x / ts) + 0.5) * ts - x, (Math.floor(z / ts) + 0.5) * ts - z); // towards the tile's middle
    spots.push({ x: x + Math.sin(angle) * post, z: z + Math.cos(angle) * post, angle, pole: true });
  }
  return spots;
}

// The meshes. `loadTexture` and `loader` are the renderer's KTX2 texture loader and its GLTFLoader (set up for the
// pipeline's KTX2 textures and meshopt geometry). Pavements, kerbs and props go up at once; `load()` fetches the
// textures, lantern models and tree pictures, which nothing on the first frame waits for.
export function createStreets(scene, map, tables, { loadTexture, loader, models }) {
  const { pavement, lantern } = tables.streets;
  const { pavements, kerbs } = pavementLayout(map, pavement.width);

  // Pavement tops, a quad per cell with UVs from world x and z so the texture runs on across cells. Until its textures
  // come, the material shows placeholders of the same kind, so swapping them in doesn't rebuild its shader.
  const pixel = (r, g, b, colour) => Object.assign(new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1), { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: colour ? THREE.SRGBColorSpace : THREE.NoColorSpace, needsUpdate: true });
  const pavers = new THREE.MeshStandardMaterial({ map: pixel(170, 165, 155, true), normalMap: pixel(128, 128, 255), aoMap: pixel(255, 230, 0), roughnessMap: pixel(255, 230, 0) });
  const y = pavement.height;
  const top = quads(pavements.map((r) => [[[r.minX, y, r.minZ], [r.minX, y, r.maxZ], [r.maxX, y, r.maxZ], [r.maxX, y, r.minZ]], [0, 1, 0]]), pavement.repeat);
  // Kerb stones: a strip along the edge just above the pavement, against depth fighting, and the face down to the road.
  const kerbTop = pavement.height + 0.003;
  const stones = quads(kerbs.flatMap(({ x0, z0, x1, z1, dx, dz }) => {
    const [ix, iz] = [-dx * pavement.kerb, -dz * pavement.kerb]; // into the pavement
    const strip = [[x0, kerbTop, z0], [x0 + ix, kerbTop, z0 + iz], [x1 + ix, kerbTop, z1 + iz], [x1, kerbTop, z1]];
    const face = [[x0, 0, z0], [x0, kerbTop, z0], [x1, kerbTop, z1], [x1, 0, z1]];
    return [[strip, [0, 1, 0]], [face, [dx, 0, dz]]];
  }));
  const kerbMaterial = new THREE.MeshStandardMaterial({ color: pavement.kerbColour, roughness: 0.8 });
  for (const mesh of [new THREE.Mesh(top, pavers), new THREE.Mesh(stones, kerbMaterial)]) {
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Lanterns: the model's parts, one per material (iron, and glass round the bulb), each as a near and a far instanced
  // mesh, filled every frame with the lanterns in view by distance (update()). The glass part is the one to light up at
  // night (#52).
  const spots = lanternSpots(map, lantern);
  const lanterns = []; // { near, far } per part
  const lanternBounds = new THREE.Sphere(new THREE.Vector3(), 1.2);
  const partMatrix = new THREE.Matrix4();
  const spotMatrices = spots.map(({ x, z, angle }) => new THREE.Matrix4().makeRotationY(angle).setPosition(x, lantern.height, z));

  // Props from the Sim's colliders: the poles' posts, bollards, bins and fountains, as one static mesh. Trees load later.
  const propParts = [];
  const prop = (geometry, colour, x, z, angle = 0) => propParts.push(coloured(geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(angle).setPosition(x, 0, z)), colour));
  const { bollard, bin, fountain } = tables.streets;
  const centre = (b) => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  const postHeight = lantern.height + 1.7; // up to the top of the lantern's bracket
  for (const b of map.colliders) {
    const [x, z] = centre(b);
    const turn = Math.floor(hash(x, z) * 4) * (Math.PI / 2);
    if (b.kind === 'pole') {
      prop(cylinder(lantern.post, postHeight), lantern.postColour, x, z);
      prop(cylinder(lantern.post * 1.8, 0.5), lantern.postColour, x, z);
    } else if (b.kind === 'bollard') {
      prop(cylinder(bollard.radius, bollard.height), bollard.colour, x, z);
      prop(cylinder(bollard.radius * 1.2, 0.05, bollard.height), bollard.colour, x, z);
    } else if (b.kind === 'bin') {
      prop(cylinder(bin.radius, bin.height), bin.colour, x, z);
      prop(cylinder(bin.radius * 1.08, 0.06, bin.height - 0.06), bin.colour, x, z);
    } else if (b.kind === 'fountain') {
      // A nasone: a post with a cap and a spout over a drain grate.
      prop(cylinder(fountain.radius, fountain.height), fountain.colour, x, z);
      prop(cylinder(fountain.radius * 1.2, 0.08, fountain.height), fountain.colour, x, z);
      prop(new THREE.BoxGeometry(0.05, 0.05, 0.26).translate(0, fountain.height * 0.55, fountain.radius + 0.1), fountain.colour, x, z, turn);
      prop(new THREE.BoxGeometry(0.55, 0.04, 0.45).translate(0, 0.02, fountain.radius + 0.12), fountain.grate, x, z, turn);
    }
  }
  if (propParts.length) {
    const props = new THREE.Mesh(mergeGeometries(propParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4 }));
    props.castShadow = props.receiveShadow = true;
    scene.add(props);
  }

  function load() {
    const textures = Promise.all(['Diffuse', 'nor_gl', 'arm'].map((kind) => loadTexture(`${pavement.texture}_${kind}.ktx2`))).then(([map, normalMap, arm]) => {
      for (const t of [map, normalMap, arm]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
      }
      Object.assign(pavers, { map, normalMap, aoMap: arm, roughnessMap: arm });
    });
    const lamps = Promise.all([lantern.model, `${lantern.model}_far`].map((file) => loader.loadAsync(`${models}${file}.glb`))).then(([near, far]) => {
      const parts = [near, far].map((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const meshes = [];
        gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
        return meshes;
      });
      // The model's foot at y = 0; its back is already at z = 0, against the wall. Each part keeps its own transform
      // (it undoes the geometry's quantisation, so it can't be baked into the integer positions).
      const foot = new THREE.Box3().setFromObject(near.scene).min.y;
      parts[0].forEach((part, i) => {
        const [n, f] = [part, parts[1][i]].map((o, k) => {
          // Premultiplied, as DirectRenderPipeline's output step expects (see the renderer's zone marker).
          if (o.material.transparent) o.material.premultipliedAlpha = true;
          const mesh = new THREE.InstancedMesh(o.geometry, o.material, spots.length);
          mesh.userData.base = new THREE.Matrix4().makeTranslation(0, -foot, 0).multiply(o.matrixWorld);
          mesh.frustumCulled = false; // update() picks the lanterns in view
          mesh.count = 0;
          mesh.receiveShadow = true; // casting none: their shadows are too small to show, and each is one more draw
          scene.add(mesh);
          return mesh;
        });
        lanterns.push({ near: n, far: f });
      });
    });
    const trees = Promise.all(tables.streets.trees.map(({ picture }) => loadTexture(`${picture}.ktx2`))).then((pictures) => addTrees(pictures));
    return Promise.all([textures, lamps, trees]);
  }

  // Trees on three crossed quads per species, each face both ways round, lit from above like one canopy; not shadowed,
  // as the quads shadowed each other black. A tree's species, size, turn and mirroring come from where it stands.
  function addTrees(pictures) {
    const species = tables.streets.trees;
    const lists = species.map(() => []);
    for (const b of map.colliders.filter((c) => c.kind === 'tree')) {
      const [x, z] = centre(b);
      lists[Math.floor(hash(x, z) * 9973) % species.length].push([x, z]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    species.forEach(({ picture, size }, k) => {
      if (!lists[k].length) return;
      const { trunk } = assetInfo[`textures/${picture}.ktx2`];
      const quadsAt = [0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => {
        const at = (u, v) => [(u - trunk) * Math.cos(a), v, (u - trunk) * Math.sin(a)];
        const corners = [at(0, 0), at(0, 1), at(1, 1), at(1, 0)];
        return [corners, [...corners].reverse()];
      }).flat();
      const geometry = quads(quadsAt.map((corners) => [corners, null]));
      const uvs = { 0: [0, 0], 1: [0, 1], 2: [1, 1], 3: [1, 0] };
      const order = [[0, 1, 2, 0, 2, 3], [3, 2, 1, 3, 1, 0]]; // corner of each vertex, for the face and its reverse
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(quadsAt.flatMap((_, i) => order[i % 2].flatMap((c) => uvs[c])), 2));
      const material = new THREE.MeshStandardMaterial({ map: pictures[k], alphaTest: 0.5, roughness: 1 });
      const mesh = new THREE.InstancedMesh(geometry, material, lists[k].length);
      lists[k].forEach(([x, z], i) => {
        const s = size[0] + (size[1] - size[0]) * hash(z, x);
        const flip = hash(x + 1, z) < 0.5 ? -1 : 1; // mirrored copies look like other trees
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, hash(x, z + 1) * Math.PI), new THREE.Vector3(s * flip, s, s)));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      scene.add(mesh);
    });
  }

  // Fills the lantern meshes with the lanterns `inView` (a test on a bounding sphere), near or far by their distance
  // from `eye`; none past lantern.cull.
  function update(eye, inView) {
    if (!lanterns.length) return;
    const counts = lanterns.map(() => [0, 0]);
    spots.forEach(({ x, z }, i) => {
      const d = Math.hypot(x - eye.x, z - eye.z);
      lanternBounds.center.set(x, lantern.height + 0.8, z);
      if (d > lantern.cull || !inView(lanternBounds)) return;
      const k = d < lantern.near ? 0 : 1;
      lanterns.forEach(({ near, far }, p) => {
        const mesh = k ? far : near;
        mesh.setMatrixAt(counts[p][k]++, partMatrix.multiplyMatrices(spotMatrices[i], mesh.userData.base));
      });
    });
    lanterns.forEach(({ near, far }, p) => {
      [near.count, far.count] = counts[p];
      near.instanceMatrix.needsUpdate = far.instanceMatrix.needsUpdate = true;
    });
  }

  return { load, update, lanterns };
}

const hash = (x, z) => Math.abs(Math.sin(x * 12.9898 + z * 78.233)); // stable pseudo-random per place, as in renderer.js

// One geometry of quads, each [corners, normal]: four corners round the quad, turned so the quad faces along its
// normal; a null normal keeps the corners' order and takes straight up as the normal. With `repeat`, UVs from world x
// and z, that many m per copy of the texture.
function quads(list, repeat) {
  const positions = [];
  const normals = [];
  const [pa, ab, ac] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const [corners, normal] of list) {
    const [a, b, c, d] = corners;
    pa.fromArray(a);
    ab.fromArray(b).sub(pa);
    ac.fromArray(c).sub(pa);
    const turned = normal && ab.cross(ac).dot(pa.fromArray(normal)) < 0;
    positions.push(...(turned ? [...a, ...c, ...b, ...a, ...d, ...c] : [...a, ...b, ...c, ...a, ...c, ...d]));
    for (let i = 0; i < 6; i++) normals.push(...(normal ?? [0, 1, 0]));
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (repeat) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(positions.flatMap((v, i) => (i % 3 === 0 ? [v / repeat, -positions[i + 2] / repeat] : [])), 2));
  return geometry;
}

// An upright cylinder from y = `base` to `base + height`.
const cylinder = (radius, height, base = 0) => new THREE.CylinderGeometry(radius, radius, height, 12).translate(0, base + height / 2, 0);

function coloured(geometry, colour) {
  const part = geometry.toNonIndexed().deleteAttribute('uv');
  const c = new THREE.Color(colour);
  return part.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: part.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
}
