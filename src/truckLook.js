import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Our own geometry for the Werkstatt's visual items (tables.visuals), in truck space: metres, +z forward,
// +x towards the driver's (left) side, y up from the ground. The places match the kit truck as the
// renderer stretches it (1.67 m tall); paint is a recolouring and lives in the renderer.
const BOX = { side: 1.095, back: -3.75, front: 1.05 }; // cargo box side walls, x and z; they span y 0.5–1.6
const WHEEL = { x: 1.01, y: 0.3, z: [2.55, -1.44], stretch: 2.4 }; // outer hub face; the kit wheels are stretched along z
const ROOF = { y: 1.41, z: 1.6 }; // cab roof
const BUMPER = { front: [3.92, 0.3], back: [-3.94, 0.34] }; // z, y
const PIVOT = { dice: [0.2, 2.8, 3.55], figure: [0.15, 2.1, 3.45] }; // gimmicks sway about these; see camera.gimmickLook

const materials = new Map();
const lambert = (color) => materials.get(color) ?? materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true })).get(color);
const glow = (color) => new THREE.MeshBasicMaterial({ color });

// A thin bar on a side wall from (u0, v0) to (u1, v1); u runs forward along z, v is the height.
function bar(u0, v0, u1, v1, width) {
  const length = Math.hypot(u1 - u0, v1 - v0);
  return new THREE.BoxGeometry(0.02, width, length)
    .rotateX(-Math.atan2(v1 - v0, u1 - u0))
    .translate(0, (v0 + v1) / 2, (u0 + u1) / 2);
}

// Livery designs: bars per colour index, on one side wall.
const DESIGNS = {
  stripes: () => [
    [bar(BOX.back, 1.08, BOX.front, 1.08, 0.24)],
    [bar(BOX.back, 0.87, BOX.front, 0.87, 0.07), bar(BOX.back, 1.29, BOX.front, 1.29, 0.07)],
  ],
  chevrons: () => [
    [-3.2, -2.4, -1.6, -0.8].flatMap((u) => [bar(u, 0.7, u + 0.45, 1.05, 0.15), bar(u + 0.45, 1.05, u, 1.4, 0.15)]),
  ],
  checker: () => {
    const size = 0.2;
    const rows = [[], []];
    for (let i = 0; BOX.back + (i + 1) * size <= BOX.front; i++) {
      for (let j = 0; j < 2; j++) {
        const u = BOX.back + (i + 0.5) * size;
        rows[(i + j) % 2].push(bar(u - size / 2, 0.98 + j * size, u + size / 2, 0.98 + j * size, size));
      }
    }
    return rows;
  },
  zigzag: () => {
    const points = [[BOX.back, 1.35], [-2.4, 0.75], [-1.6, 1.4], [-0.4, 0.7], [0.3, 1.2], [BOX.front, 0.95]];
    return [points.slice(1).map(([u, v], i) => bar(...points[i], u, v, 0.14))];
  },
};

// Pips of a die `size` wide at the origin: 1 to 6, one value per face (+x, -x, +y, -y, +z, -z).
const PIPS = [[[0, 0]], [[-1, -1], [1, 1]], [[-1, -1], [0, 0], [1, 1]], [[-1, -1], [-1, 1], [1, -1], [1, 1]]];
PIPS.push([...PIPS[3], [0, 0]], [...PIPS[3], [-1, 0], [1, 0]]);
function pips(size) {
  const pip = size / 6;
  return PIPS.flatMap((face, n) =>
    face.map(([a, b]) => {
      const p = [a * size * 0.27, b * size * 0.27];
      const axis = Math.floor(n / 2);
      p.splice(axis, 0, (n % 2 ? -1 : 1) * size * 0.5);
      return new THREE.BoxGeometry(pip, pip, pip).translate(...p);
    }),
  );
}

// One mesh per colour; `parts` are [colour, geometries] pairs.
function meshes(parts) {
  const group = new THREE.Group();
  for (const [material, geometries] of parts) group.add(new THREE.Mesh(mergeGeometries(geometries), material));
  return group;
}

// Builders by slot: an item's group, added to the exterior (or, for the gimmick, to the cab).
const BUILDERS = {
  livery({ design, colours }, palette) {
    const perColour = DESIGNS[design]();
    const sides = (list) => [BOX.side, -BOX.side].flatMap((x) => list.map((g) => g.clone().translate(x, 0, 0)));
    return meshes(perColour.map((list, i) => [lambert(palette[colours[i]]), sides(list)]));
  },
  lightBar({ lamp }, palette) {
    const base = new THREE.BoxGeometry(1.7, 0.08, 0.3).translate(0, ROOF.y + 0.04, ROOF.z);
    const lamps =
      lamp === 'lampAmber'
        ? [0.65, -0.65].map((x) => new THREE.CylinderGeometry(0.1, 0.12, 0.18, 10).translate(x, ROOF.y + 0.17, ROOF.z))
        : [-0.6, -0.2, 0.2, 0.6].map((x) => new THREE.BoxGeometry(0.24, 0.16, 0.12).translate(x, ROOF.y + 0.16, ROOF.z + 0.08));
    return meshes([[lambert(palette.trim), [base]], [glow(palette[lamp]), lamps]]);
  },
  gimmick({ kind, colour }, palette) {
    const size = 0.065;
    // Two dice on a string, the second turned and a little lower.
    const place = (geometries, i) => geometries.map((g) => g.rotateY(i * 0.6).translate(i ? 0.04 : -0.04, -0.5 - i * 0.03, 0));
    const pivot =
      kind === 'dice'
        ? meshes([
            [lambert(palette.wall), [new THREE.BoxGeometry(0.01, 0.46, 0.01).translate(0, -0.23, 0), ...[0, 1].flatMap((i) => place(pips(size), i))]],
            [lambert(palette[colour]), [0, 1].flatMap((i) => place([new THREE.BoxGeometry(size, size, size)], i))],
          ])
        : meshes([
            [lambert(palette.trim), [new THREE.CylinderGeometry(0.02, 0.02, 0.07, 6).translate(0, 0.035, 0)]],
            [lambert(palette[colour]), [new THREE.BoxGeometry(0.1, 0.13, 0.07).translate(0, 0.13, 0)]],
            [lambert(palette.pavement), [new THREE.IcosahedronGeometry(0.065, 0).translate(0, 0.26, 0)]],
          ]);
    pivot.position.fromArray(PIVOT[kind]);
    return pivot;
  },
  rims({ colour, spokes }, palette) {
    const hubs = [];
    const discs = [];
    const arms = [];
    for (const side of [1, -1]) {
      for (const z of WHEEL.z) {
        // Built round the x axis at the origin, then stretched along z like the kit wheel and moved onto it.
        const place = (g) => g.scale(1, 1, WHEEL.stretch).translate(side * WHEEL.x, WHEEL.y, z);
        discs.push(place(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 16).rotateZ(Math.PI / 2)));
        hubs.push(place(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 8).rotateZ(Math.PI / 2)));
        for (let k = 0; k < (spokes ?? 0); k++) {
          arms.push(place(new THREE.BoxGeometry(0.05, 0.035, 0.17).translate(0, 0, 0.085).rotateX((k * 2 * Math.PI) / spokes)));
        }
      }
    }
    const disc = spokes ? palette.trim : palette[colour];
    return meshes([[lambert(disc), discs], [lambert(palette.chrome), hubs], ...(spokes ? [[lambert(palette[colour]), arms]] : [])]);
  },
  chrome({ bullBar }, palette) {
    const parts = Object.values(BUMPER).map(([z, y]) => new THREE.BoxGeometry(2.4, 0.2, 0.2).translate(0, y, z));
    if (bullBar) {
      const z = BUMPER.front[0] + 0.12;
      parts.push(
        ...[0.75, 0.25, -0.25, -0.75].map((x) => new THREE.CylinderGeometry(0.04, 0.04, 0.6, 8).translate(x, 0.7, z)),
        ...[1.0, 0.7].map((y) => new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8).rotateZ(Math.PI / 2).translate(0, y, z)),
      );
    }
    return meshes([[lambert(palette.chrome), parts]]);
  },
};

// The extra parts the equipped visual items add to the truck: `exterior` goes on the outside, `cab` with the
// interior. show(ids) shows exactly those items' parts (built once, on first show); sway() swings the
// gimmick with the body roll, as a damped pendulum (tables.gimmickSway).
export function createTruckParts(tables) {
  const { palette, visuals, gimmickSway } = tables;
  const exterior = new THREE.Group();
  const cab = new THREE.Group();
  const built = new Map(); // item id → its group, or null for items without parts
  let shown = [];
  let gimmick = null;
  let angle = 0; // rad, gimmick sway
  let rate = 0; // rad/s

  function build(id) {
    if (!built.has(id)) {
      const item = visuals[id];
      const group = item.price > 0 ? BUILDERS[item.slot]?.(item, palette) : null;
      if (group) (item.slot === 'gimmick' ? cab : exterior).add(group);
      built.set(id, group ?? null);
    }
    return built.get(id);
  }

  function show(ids) {
    for (const group of shown) group.visible = false;
    shown = ids.map(build).filter(Boolean);
    for (const group of shown) group.visible = true;
    gimmick = ids.map((id) => visuals[id].slot === 'gimmick' && built.get(id)).find(Boolean) ?? null;
  }

  function sway(roll, dt) {
    const w = 2 * Math.PI * gimmickSway.frequency;
    rate += (w * w * (gimmickSway.perRoll * roll - angle) - 2 * gimmickSway.damping * w * rate) * dt;
    angle += rate * dt;
    if (gimmick) gimmick.rotation.z = angle;
  }

  return { exterior, cab, show, sway };
}
