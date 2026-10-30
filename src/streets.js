// Street dressing (#40, tables.streets): lanterns and potted plants on the street-facing walls of the real outlines,
// and OSM's street furniture (trees, bollards, bins, fountains; placed by osm.js). The layout functions are plain data
// (streets.test.js); createStreets() builds the meshes and draws the lanterns by distance. The renderer lays the
// pavements (roads.js).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeParts, groundAt } from './buildings.js';
import assetInfo from './assetInfo.json';

// Where lanterns hang: { x, y, z, angle }, (x, z) on the wall at the ground's height y, turned by `angle` about y so
// the model's +z points out over the road. On the street sides of the planned buildings (buildings.js), halfway between
// two windows, the one nearest to each point `spacing` m apart along the street (counted from the map's origin, so the
// rhythm runs on from building to building); `clear` m clear of a speed sign.
// `reach`: see roadAhead.
export function lanternMounts(map, plan, { spacing, clear }, bay, reach) {
  const mounts = [];
  for (const side of plan.flatMap((b) => b.sides).filter((s) => s.street)) {
    const { x, z, ux, uz, length } = side;
    const [nx, nz] = [-uz, ux]; // out of the wall
    const bays = Math.floor((length - 1) / bay); // as facadeParts lays them out
    // m along the street: along the wall, growing east or south whichever it runs nearer.
    const sign = Math.abs(ux) >= Math.abs(uz) ? Math.sign(ux) : Math.sign(uz);
    const along = (px, pz) => sign * (px * ux + pz * uz);
    // Each gap between two windows as [m along the street, x, z].
    const gaps = Array.from({ length: bays - 1 }, (_, k) => {
      const [gx, gz] = [x + (ux * (k + 1) * length) / bays, z + (uz * (k + 1) * length) / bays];
      return [along(gx, gz), gx, gz];
    });
    const ends = [along(x, z), along(x + ux * length, z + uz * length)];
    const [lo, hi] = [Math.min(...ends), Math.max(...ends)];
    for (let k = Math.ceil(lo / spacing - 0.5); (k + 0.5) * spacing < hi; k++) {
      if (!gaps.length) break;
      const [, gx, gz] = gaps.reduce((a, g) => (Math.abs(g[0] - (k + 0.5) * spacing) < Math.abs(a[0] - (k + 0.5) * spacing) ? g : a));
      if (map.signs.some((c) => Math.hypot(c.x - gx, c.z - gz) < clear) || !roadAhead(map, gx, gz, nx, nz, reach)) continue;
      mounts.push({ x: gx, y: map.heightAt(gx, gz), z: gz, angle: Math.atan2(nx, nz) });
    }
  }
  return mounts;
}

// Potted plants and flower boxes on the planned buildings' street sides: { x, y, z, angle }, standing on the
// pavement or a sill, turned so their +z points out from the wall. A pair of pots beside a door, for a `pots` share of
// the doors, unless a speed sign stands within a metre; a box on the sill of every open window (the ones
// with glass showing) of a `flowers` share of the buildings. Which ones comes from where they are.
export function facadeProps(map, plan, tables) {
  const { pots: potShare, flowers, roadReach } = tables.streets;
  const pots = [];
  const boxes = [];
  for (const b of plan) {
    const boxed = hash(b.minX, b.minZ) < flowers;
    for (const side of b.sides.filter((s) => s.street)) {
      const [nx, nz] = [-side.uz, side.ux]; // out of the wall
      const angle = Math.atan2(nx, nz);
      const ahead = (part) => roadAhead(map, part.x, part.z, nx, nz, roadReach);
      for (const part of facadeParts(b, side, tables)) {
        if (part.cell === 'door' && hash(part.x, part.z) < potShare && ahead(part)) {
          // The door's leaf stands 8 cm out; the pots 0.45 m out, either side of it.
          const pair = [-1, 1].map((s) => {
            const along = s * (part.size[0] / 2 + 0.45);
            const [x, z] = [part.x + side.ux * along + nx * 0.37, part.z + side.uz * along + nz * 0.37];
            return { x, y: groundAt(map, tables, x, z), z, angle };
          });
          if (!pair.some((p) => map.signs.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 1))) pots.push(...pair);
        } else if (boxed && part.cell.startsWith('glass') && ahead(part)) {
          // On the sill, whose top is 0.95 m under the window's middle; the glass is 1 cm out, the sill 28 cm deep.
          boxes.push({ x: part.x + nx * 0.14, y: part.y - 0.95, z: part.z + nz * 0.14, angle });
        }
      }
    }
  }
  return { pots, boxes };
}

// The meshes. `loadTexture` and `loader` are the renderer's KTX2 texture loader and its GLTFLoader (set up for the
// pipeline's KTX2 textures and meshopt geometry). The props on the ground go up at once; `dress(plan)` adds what
// stands on the planned buildings, and `load(into)` fetches the lantern models and tree pictures, which nothing on the
// first frame waits for, and adds them to `into`. `update()` picks what to draw each frame.
export function createStreets(scene, map, tables, { loadTexture, loader, models }) {
  const { lantern, propCull } = tables.streets;

  // Instanced sets drawn by distance (update()): each { places: [{ x, y, z, angle }], levels: [{ upTo, meshes }],
  // height, atNight }. A place is drawn with the meshes of the first level it is within `upTo` m of the camera of, if it
  // is in view (as a sphere `height` m across); past the last level, not at all; and an `atNight` set only at night. A
  // mesh's userData.base goes between the place and its geometry. Places are kept by `CELL` m square, so a frame looks
  // only at those within reach.
  const CELL = 32;
  const cellKey = (c, r) => c * 4096 + r; // a number, not a string, so update() allocates nothing per cell
  const sets = [];
  const propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4 });
  function addSet(places, levels, height, atNight = false, into = scene) {
    const cells = new Map(); // cell -> place indices
    places.forEach(({ x, z }, i) => {
      const key = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
      cells.set(key, [...(cells.get(key) ?? []), i]);
    });
    for (const { meshes } of levels) {
      for (const mesh of meshes) {
        mesh.count = 0;
        mesh.frustumCulled = false; // update() picks the places in view
        const base = mesh.userData.base ?? new THREE.Matrix4();
        // Each place's matrix for this mesh, as update() copies it into the instance buffer.
        mesh.userData.matrices = places.map(({ x, y = 0, z, angle = 0 }) => new THREE.Matrix4().makeRotationY(angle).setPosition(x, y, z).multiply(base).elements);
        into.add(mesh);
      }
    }
    sets.push({ places, cells, levels, height, atNight });
  }
  // A small prop of our own: one mesh of `parts` ([geometry, colour]), culled past `upTo` m.
  const prop = (places, parts, height, upTo = propCull) => {
    if (!places.length) return;
    const mesh = new THREE.InstancedMesh(mergeGeometries(parts.map(([g, colour]) => coloured(g, colour))), propMaterial, places.length);
    mesh.receiveShadow = true;
    addSet(places, [{ upTo, meshes: [mesh] }], height);
  };

  // The props on the Sim's colliders: the bollards, bins and fountains, on whatever ground they stand on.
  const { bollard, bin, fountain, pot, box } = tables.streets;
  const at = (kind) => map.colliders.filter((c) => c.kind === kind).map((b) => {
    const [x, z] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
    return { x, y: groundAt(map, tables, x, z), z };
  });
  prop(at('bollard'), [[cylinder(bollard.radius, bollard.height), bollard.colour], [cylinder(bollard.radius * 1.2, 0.05, bollard.height), bollard.colour]], bollard.height);
  prop(at('bin'), [[cylinder(bin.radius, bin.height), bin.colour], [cylinder(bin.radius * 1.08, 0.06, bin.height - 0.06), bin.colour]], bin.height);
  // A nasone: a post with a cap and a spout over a drain grate, turned a quarter at random.
  prop(at('fountain').map((p) => ({ ...p, angle: Math.floor(hash(p.x, p.z) * 4) * (Math.PI / 2) })), [
    [cylinder(fountain.radius, fountain.height), fountain.colour],
    [cylinder(fountain.radius * 1.2, 0.08, fountain.height), fountain.colour],
    [new THREE.BoxGeometry(0.05, 0.05, 0.26).translate(0, fountain.height * 0.55, fountain.radius + 0.1), fountain.colour],
    [new THREE.BoxGeometry(0.55, 0.04, 0.45).translate(0, 0.02, fountain.radius + 0.12), fountain.grate],
  ], fountain.height);

  // Lanterns: the model's parts, one per material (iron, and glass round the bulb), each as a near and a far instanced
  // mesh, set up by load() at the mounts dress() finds. The glass part is the one to light up at night (#52).
  let mounts = [];
  const glassMaterials = [];

  // What stands on the planned buildings (buildings.js): the wall lanterns' mounts, potted plants and flower boxes.
  function dress(plan) {
    mounts = lanternMounts(map, plan, lantern, tables.buildings.bay, tables.streets.roadReach);
    // Their light at night (tables.streets.lanternLight): a glow on the wall and one on the pavement in front.
    const { up, wall, ground, out, colour, glow } = tables.streets.lanternLight;
    const material = glowMaterial(colour, glow);
    const glowAt = (size, base) => Object.assign(new THREE.InstancedMesh(new THREE.PlaneGeometry(size, size), material, mounts.length), { userData: { base } });
    const onWall = glowAt(wall, new THREE.Matrix4().makeTranslation(0, lantern.height + up, 0.05));
    const onGround = glowAt(ground, new THREE.Matrix4().makeTranslation(0, tables.streets.pavement.height + 0.02, out).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
    addSet(mounts, [{ upTo: lantern.cull, meshes: [onWall, onGround] }], ground + 2 * out, true); // takes in the pavement's glow
    const { pots, boxes } = facadeProps(map, plan, tables);
    prop(pots, [
      [new THREE.CylinderGeometry(pot.radius, pot.radius * 0.75, pot.height, 10).translate(0, pot.height / 2, 0), pot.colour],
      [new THREE.IcosahedronGeometry(pot.radius * 1.6, 0).scale(1, 1.3, 1).translate(0, pot.height + pot.radius * 1.3, 0), pot.leaves],
    ], pot.height + pot.radius * 3);
    // Its back against the wall, along the sill (x); flowers in a few colours in the leaves.
    const [w, h, d] = box.size;
    prop(boxes, [
      [new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), box.colour],
      [new THREE.BoxGeometry(w - 0.06, 0.12, d - 0.04).translate(0, h + 0.06, 0), pot.leaves],
      ...box.flowers.map((colour, i) => [new THREE.BoxGeometry(0.07, 0.07, 0.07).translate((i - (box.flowers.length - 1) / 2) * (w / box.flowers.length), h + 0.15, ((i % 2) - 0.5) * 0.06), colour]),
    ], h + 0.2);
  }

  function load(into) {
    const lamps = Promise.all([lantern.model, `${lantern.model}_far`].map((file) => loader.loadAsync(`${models}${file}.glb`))).then(([near, far]) => {
      const parts = [near, far].map((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const meshes = [];
        gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
        return meshes;
      });
      // The model's foot at y = 0; its back is already at z = 0, against the wall. Each part keeps its own transform
      // (it undoes the geometry's quantisation, so it can't be baked into the integer positions). The glass is the far
      // copy's at every distance, with the full model's materials: the two looked different, so lanterns changed as
      // they passed `near`, and plain panes need no detail.
      const foot = new THREE.Box3().setFromObject(near.scene).min.y;
      const levels = [{ upTo: lantern.near, meshes: [] }, { upTo: lantern.cull, meshes: [] }];
      parts[0].forEach((part, i) => {
        const glass = part.material.transparent;
        // Premultiplied, as DirectRenderPipeline's output step expects (see the renderer's zone marker).
        if (glass) {
          part.material.premultipliedAlpha = true;
          part.material.emissive.setHex(tables.streets.lanternLight.colour);
          part.material.emissiveIntensity = 0; // update() lights it at night
          glassMaterials.push(part.material);
        }
        [glass ? parts[1][i] : part, parts[1][i]].forEach((o, k) => {
          const mesh = new THREE.InstancedMesh(o.geometry, part.material, mounts.length);
          mesh.userData.base = new THREE.Matrix4().makeTranslation(0, -foot, 0).multiply(o.matrixWorld);
          mesh.receiveShadow = true; // casting none: their shadows are too small to show, and each is one more draw
          levels[k].meshes.push(mesh);
        });
      });
      addSet(mounts.map((m) => ({ ...m, y: m.y + lantern.height })), levels, 1.7, false, into);
    });
    const trees = Promise.all(tables.streets.trees.map(({ picture }) => loadTexture(`${picture}.ktx2`))).then((pictures) => addTrees(pictures, into));
    return Promise.all([lamps, trees]);
  }

  // Trees on three crossed quads per species, each face both ways round, lit from above like one canopy; not shadowed,
  // as the quads shadowed each other black. A tree's species, size, turn and mirroring come from where it stands.
  function addTrees(pictures, into) {
    const species = tables.streets.trees;
    const lists = species.map(() => []);
    for (const { x, y, z } of at('tree')) lists[Math.floor(hash(x, z) * 9973) % species.length].push([x, y, z]);
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
      lists[k].forEach(([x, y, z], i) => {
        const s = size[0] + (size[1] - size[0]) * hash(z, x);
        const flip = hash(x + 1, z) < 0.5 ? -1 : 1; // mirrored copies look like other trees
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, hash(x, z + 1) * Math.PI), new THREE.Vector3(s * flip, s, s)));
      });
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      into.add(mesh);
    });
  }

  // Fills the sets' meshes with the places in view (`inView`, a test on a bounding sphere), by their distance from `eye`;
  // the lanterns' glass glows at `night`.
  const bounds = new THREE.Sphere();
  function update(eye, inView, night) {
    for (const material of glassMaterials) material.emissiveIntensity = night ? tables.streets.lanternLight.glass : 0;
    for (const { places, cells, levels, height, atNight } of sets) {
      for (const { meshes } of levels) for (const mesh of meshes) mesh.count = 0;
      if (atNight && !night) continue; // kept in the scene with none drawn, so their shaders are ready at dusk
      const reach = levels.at(-1).upTo;
      const [c0, c1, r0, r1] = [eye.x - reach, eye.x + reach, eye.z - reach, eye.z + reach].map((v) => Math.floor(v / CELL));
      bounds.radius = height / 2 + 0.6;
      for (let c = c0; c <= c1; c++) {
        for (let r = r0; r <= r1; r++) {
          for (const i of cells.get(cellKey(c, r)) ?? []) {
            const { x, y = 0, z } = places[i];
            const d = Math.hypot(x - eye.x, z - eye.z);
            if (d > reach) continue;
            bounds.center.set(x, y + height / 2, z);
            if (!inView(bounds)) continue;
            for (const mesh of levels.find((l) => d <= l.upTo).meshes) mesh.instanceMatrix.array.set(mesh.userData.matrices[i], 16 * mesh.count++);
          }
        }
      }
      for (const { meshes } of levels) for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { dress, load, update };
}

// An additive glow material (#52): `colour` times `glow` in the middle of a round glow fading to nothing at its edge.
export function glowMaterial(colour, glow) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(255 * Math.max(0, 1 - Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2)) ** 2);
      data.set([v, v, v, 255], 4 * (y * size + x));
    }
  }
  const map = Object.assign(new THREE.DataTexture(data, size, size), { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, needsUpdate: true });
  return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(colour).multiplyScalar(glow), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
}

// Whether a road lies in front of (x, z) on a wall facing (nx, nz). Not all of a planned building's street side
// (buildings.js) does: a wall can face a courtyard or open ground. The nearest road must be in front of the wall, its
// edge within `reach` m.
// shortcut: the nearest road only, so a courtyard wall with a road within reach beyond the courtyard counts; check
// along the way out if lanterns show up in courtyards.
function roadAhead(map, x, z, nx, nz, reach) {
  const p = map.graph.nearest(x + nx, z + nz);
  return p.d - p.edge.width / 2 < reach && (p.x - x) * nx + (p.z - z) * nz > 0;
}

const hash = (x, z) => Math.abs(Math.sin(x * 12.9898 + z * 78.233)); // stable pseudo-random per place, as in renderer.js

// One geometry of quads, each [corners, normal]: four corners round the quad, turned so the quad faces along its
// normal; a null normal keeps the corners' order and takes straight up as the normal. With `repeat`, UVs from world x
// and z, that many m per copy of the texture.
export function quads(list, repeat) {
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

export function coloured(geometry, colour) {
  const part = (geometry.index ? geometry.toNonIndexed() : geometry).deleteAttribute('uv');
  const c = new THREE.Color(colour);
  return part.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: part.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
}
