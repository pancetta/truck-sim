// The pedestrians' look (#78, #101, tables.pedestrians), our own: figures of rounded limbs and a lathed torso, standing
// on the pavement and facing the way they walk, in the realistic look of ADR 0001. A pedestrian's id picks its figure
// (figureOf): a build (adults, kids, older people), an outfit of PIECES (hair, a hat, a skirt or coat, a jacket's hem,
// bags, bare legs or arms) and its colours. Within `near` m of the truck in full detail, casting shadows; farther a few
// boxes without. Each detail level is one instanced mesh holding every piece; per instance the shader (figureMaterial)
// hides the pieces not worn, colours the rest, swings the legs and arms at the walk cycle's phase and stride (stepGait,
// from how far the pedestrian moved) and places it. Only the ones in view are drawn.
import * as THREE from 'three/webgpu';
import { attribute, vec3, float, int, sin, cos, max, select, sRGBTransferEOTF, transformNormalToView, vertexStage } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured } from './streets.js';

// The pieces an outfit (tables.pedestrians.figures[].wear) can name, as bits of a figure's `wear`.
export const PIECES = { crop: 1, long: 2, bun: 4, hat: 8, skirt: 16, jacket: 32, bag: 64, backpack: 128, bare: 256, tee: 512 };
const HAIR = PIECES.crop | PIECES.long | PIECES.bun;

// The figure is built for 1.75 m; its joints, in m up.
const HIP = 0.9;
const KNEE = 0.49;
const SHOULDER = 1.41;
// At a stride of 1 the legs swing ±HIP_SWING rad from the hip, the knee of the leg swinging forward bends up to
// KNEE_BEND, and the arms swing ±ARM_SWING against the legs.
const HIP_SWING = 0.42;
const KNEE_BEND = 0.9;
const ARM_SWING = 0.35;
const MAX_STRIDE = 1.4; // times a walking pace's, however fast one moves
const SETTLE = 10; // per s, how fast the stride follows the pace
const TELEPORT = 2; // m in a frame: one that moved farther appeared there and starts afresh

const STRIDE = 13; // floats per instance

// Where a part's colour comes from: the figure's top, bottom (trousers, a hat), skin and hair, the legs (bottom, or
// skin with `bare`), the forearms (top, or skin with `tee`), or its own vertex colour.
const [TOP, BOTTOM, SKIN, HAIR_COLOUR, LEGS, FOREARMS, OWN] = [0, 1, 2, 3, 4, 5, 6];
// What a part swings with: nothing, the thigh (about the hip), the shin and foot (about the knee, then the hip), the arm.
const [BODY, THIGH, SHIN, ARM] = [0, 1, 2, 3];
const SHOES = 0x2a2522;
const BAG = 0x5a3a24;
const BACKPACK = 0x2f3b4a;

// A deterministic draw in [0, 1) for `id`, a different one per `salt`.
function hash(id, salt) {
  let h = Math.imul(id ^ Math.imul(salt + 1, 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}
const pick = (list, id, salt) => list[Math.floor(hash(id, salt) * list.length)];

// Pedestrian `id`'s look: { build (its name), wear (PIECES bits), scale, lean, stride, step (m, as far as its legs
// swing), colours [top, bottom, skin, hair] as 0xrrggbb }.
export function figureOf(id, p) {
  const builds = Object.entries(p.figures);
  let r = hash(id, 0) * builds.reduce((sum, [, b]) => sum + b.share, 0);
  const [name, build] = builds.find(([, b]) => (r -= b.share) < 0) ?? builds.at(-1);
  const wear = pick(build.wear, id, 1).split(' ').reduce((mask, piece) => mask | (PIECES[piece] ?? 0), 0);
  const colours = [pick(p.outfits, id, 2), pick(p.trousers, id, 3), pick(p.skins, id, 4), pick(build.hairs ?? p.hairs, id, 5)];
  const scale = build.scale * (p.height / 1.75);
  return { build: name, wear, scale, lean: build.lean, stride: build.stride, step: p.step * build.scale * build.stride, colours };
}

// Moves the walk cycle `g` { x, z, phase (rad, a step per π), stride (1 at walking pace) } to where its pedestrian is
// now, `dt` s on: a step per `step` m moved, the stride easing towards the pace (1 at `speed` m/s). The Sim moves
// people only on its steps, so on a screen faster than them a frame's pace is 0 or more: it is eased in uncapped.
export function stepGait(g, x, z, dt, step, speed) {
  const d = Math.hypot(x - g.x, z - g.z);
  g.x = x;
  g.z = z;
  if (d > TELEPORT) {
    g.phase = g.stride = 0;
    return;
  }
  g.phase = (g.phase + (Math.PI * d) / step) % (2 * Math.PI);
  if (dt > 0) g.stride = Math.min(MAX_STRIDE, g.stride + (d / dt / speed - g.stride) * Math.min(1, dt * SETTLE));
}

// A part: geometry with its colour `slot` (or OWN `colour`), the `limb` it swings with, and the `piece` bits that show
// it (0: always).
function part(geometry, slot, { limb = BODY, piece = 0, colour = 0xffffff } = {}) {
  const g = coloured(geometry, colour);
  const n = g.getAttribute('position').count;
  return g.setAttribute('rig', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [limb, slot, piece]).flat(), 3));
}
// A rounded limb `r` thick from `top` down to `bottom` m up, at (x, z).
const capsule = (r, top, bottom, x, z = 0) => new THREE.CapsuleGeometry(r, Math.max(0.01, top - bottom - 2 * r), 3, 8).translate(x, (top + bottom) / 2, z);
// A body of revolution through [radius, y] points, `depth` times as deep as wide.
const lathe = (points, depth) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 12).scale(1, 1, depth);
const box = (w, h, d, x, y, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
// An open tube from `top` down to `bottom` m up, `rt` and `rb` round, `depth` times as deep as wide; // `back` only behind, its edges tucked behind the head.
const tube = (rt, rb, top, bottom, depth, back = false) =>
  new THREE.CylinderGeometry(rt, rb, top - bottom, 12, 1, true, back ? Math.PI / 2 + 0.4 : 0, back ? Math.PI - 0.8 : 2 * Math.PI).scale(1, 1, depth).translate(0, (top + bottom) / 2, 0);
const head = (r, y) => new THREE.SphereGeometry(r, 12, 10).scale(0.9, 1.12, 1).translate(0, y, 0);

function nearFigure() {
  const sides = (make) => [-1, 1].map(make);
  return mergeGeometries([
    ...sides((s) => part(capsule(0.068, HIP, KNEE - 0.02, s * 0.09), BOTTOM, { limb: THIGH })),
    ...sides((s) => part(capsule(0.052, KNEE + 0.02, 0.07, s * 0.09), LEGS, { limb: SHIN })),
    ...sides((s) => part(box(0.09, 0.07, 0.22, s * 0.09, 0, 0.04), OWN, { limb: SHIN, colour: SHOES })),
    part(lathe([[0, 0.8], [0.12, 0.81], [0.16, 0.88], [0.155, 0.96]], 0.7), BOTTOM), // the hips
    part(lathe([[0.15, 0.93], [0.14, 1.06], [0.165, 1.25], [0.17, 1.33], [0.15, SHOULDER], [0.09, 1.46], [0.05, 1.48]], 0.62), TOP),
    ...sides((s) => part(capsule(0.046, SHOULDER + 0.01, 1.13, s * 0.21), TOP, { limb: ARM })),
    ...sides((s) => part(capsule(0.04, 1.15, 0.86, s * 0.215, 0.02), FOREARMS, { limb: ARM })),
    ...sides((s) => part(new THREE.SphereGeometry(0.042, 8, 6).scale(0.8, 1.2, 1).translate(s * 0.215, 0.82, 0.02), SKIN, { limb: ARM })),
    part(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8).translate(0, 1.5, 0), SKIN), // the neck
    part(head(0.1, 1.64), SKIN),
    part(new THREE.SphereGeometry(0.106, 12, 6, 0, 2 * Math.PI, 0, Math.PI / 2).rotateX(-0.45).scale(0.9, 1.12, 1).translate(0, 1.645, -0.005), HAIR_COLOUR, { piece: HAIR }), // the forehead free
    part(tube(0.1, 0.115, 1.66, 1.4, 0.95, true), HAIR_COLOUR, { piece: PIECES.long }),
    part(new THREE.SphereGeometry(0.05, 8, 6).translate(0, 1.7, -0.09), HAIR_COLOUR, { piece: PIECES.bun }),
    part(new THREE.CylinderGeometry(0.095, 0.1, 0.09, 12).translate(0, 1.745, 0), BOTTOM, { piece: PIECES.hat }),
    part(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 14).translate(0, 1.7, 0), BOTTOM, { piece: PIECES.hat }),
    part(tube(0.165, 0.25, 0.93, 0.45, 0.75), TOP, { piece: PIECES.skirt }),
    part(tube(0.16, 0.175, 0.95, 0.79, 0.7), TOP, { piece: PIECES.jacket }),
    part(box(0.06, 0.2, 0.24, 0.24, 0.6, 0.02), OWN, { limb: ARM, piece: PIECES.bag, colour: BAG }), // in the hand
    part(box(0.28, 0.36, 0.13, 0, 1.04, -0.17), OWN, { piece: PIECES.backpack, colour: BACKPACK }),
  ]);
}

function farFigure() {
  return mergeGeometries([
    part(box(0.3, 0.86, 0.18, 0, 0), LEGS),
    part(box(0.4, 0.45, 0.3, 0, 0.45), TOP, { piece: PIECES.skirt }),
    part(box(0.44, 0.6, 0.24, 0, 0.86), TOP),
    part(box(0.18, 0.24, 0.2, 0, 1.5), SKIN),
    part(box(0.2, 0.08, 0.22, 0, 1.68), HAIR_COLOUR, { piece: HAIR }),
  ]);
}

// The figures' material, from per instance `place` (x, y, z, heading), `gait` (phase, stride, lean, scale), `look`
// (top, bottom, skin and hair as 0xrrggbb) and `wear`, and per vertex `rig` (limb, slot, piece).
function figureMaterial() {
  const place = attribute('place', 'vec4');
  const gait = attribute('gait', 'vec4');
  const look = attribute('look', 'vec4');
  const wear = int(attribute('wear', 'float'));
  const rig = attribute('rig', 'vec3');
  const [limb, slot, piece] = [rig.x, rig.y, int(rig.z)];
  const has = (bits) => wear.bitAnd(int(bits)).notEqual(int(0));

  // Rotates `v` about the axis across at `pivot` m up by `a` rad, forward (+z) for a limb hanging down.
  const swing = (v, pivot, a) => {
    const y = v.y.sub(pivot);
    return vec3(v.x, y.mul(cos(a)).add(v.z.mul(sin(a))).add(pivot), v.z.mul(cos(a)).sub(y.mul(sin(a))));
  };
  const side = select(attribute('position', 'vec3').x.greaterThan(0), float(1), float(-1));
  const s = sin(gait.x).mul(side);
  const stride = gait.y;
  const hip = select(limb.equal(THIGH).or(limb.equal(SHIN)), stride.mul(s).mul(HIP_SWING), 0);
  const knee = select(limb.equal(SHIN), stride.mul(max(cos(gait.x).mul(side), 0)).mul(-KNEE_BEND), 0);
  const arm = select(limb.equal(ARM), stride.mul(s).mul(-ARM_SWING), 0);
  const lean = select(limb.equal(THIGH).or(limb.equal(SHIN)).or(attribute('position', 'vec3').y.lessThan(HIP)), 0, gait.z.negate());
  const bent = (v, pivots) => swing(swing(swing(swing(v, pivots * KNEE, knee), pivots * HIP, hip), pivots * SHOULDER, arm), pivots * HIP, lean);
  // The body sinks as the legs spread, so the foot on the ground stays there.
  const sink = vec3(0, cos(stride.mul(sin(gait.x)).mul(HIP_SWING)).oneMinus().mul(HIP), 0);
  const shown = piece.equal(int(0)).or(has(piece));
  const local = select(shown, bent(attribute('position', 'vec3'), 1).sub(sink), vec3(0)).mul(gait.w);
  // Turned to its heading, +z forward.
  const turn = (v) => vec3(v.x.mul(cos(place.w)).add(v.z.mul(sin(place.w))), v.y, v.z.mul(cos(place.w)).sub(v.x.mul(sin(place.w))));

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  material.positionNode = turn(local).add(place.xyz);
  material.normalNode = transformNormalToView(vertexStage(turn(bent(attribute('normal', 'vec3'), 0)))).normalize();
  const hex = select(slot.equal(TOP), look.x, select(slot.equal(BOTTOM), look.y, select(slot.equal(SKIN), look.z, select(slot.equal(HAIR_COLOUR), look.w,
    select(slot.equal(LEGS), select(has(PIECES.bare), look.z, look.y), select(has(PIECES.tee), look.z, look.x))))));
  const rgb = sRGBTransferEOTF(vec3(hex.div(65536).floor(), hex.div(256).floor().mod(256), hex.mod(256)).div(255));
  material.colorNode = vertexStage(select(slot.equal(OWN), attribute('color', 'vec3'), rgb));
  return material;
}

export function createPeople(scene, tables, road) {
  const p = tables.pedestrians;
  const ground = tables.streets.pavement.height; // on the road (at `road` m) only off the kerb at a zebra
  const material = figureMaterial();
  // Per level its mesh and per instance attributes.
  const levels = [nearFigure(), farFigure()].map((figure, level) => {
    const geometry = new THREE.InstancedBufferGeometry().copy(figure);
    // One buffer, so the figure takes 5 of WebGPU's 8 vertex buffers: per instance place, gait, look and wear.
    const data = new THREE.InstancedInterleavedBuffer(new Float32Array(p.count * STRIDE), STRIDE).setUsage(THREE.DynamicDrawUsage);
    for (const [name, size, offset] of [['place', 4, 0], ['gait', 4, 4], ['look', 4, 8], ['wear', 1, 12]]) {
      geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(data, size, offset));
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // update() puts the ones in view into it, and its shader places them
    Object.assign(mesh, { castShadow: level === 0, receiveShadow: true });
    scene.add(mesh);
    return { mesh, geometry, data, count: 0 };
  });
  // The first update draws a collapsed figure at each level (scale 0), so their shaders are set up before the first
  // pedestrian comes into view.
  let warm = true;
  const people = new WeakMap(); // per pedestrian its { gait, figure }
  const bounds = new THREE.Sphere(new THREE.Vector3(), p.height / 2 + 0.3);
  const set = (array, i, x, y, z, w) => {
    array[i] = x;
    array[i + 1] = y;
    array[i + 2] = z;
    array[i + 3] = w;
  };

  // Draws the Sim's `pedestrians` that pass `inView` (a test on a bounding sphere), in detail within `near` of `truck`,
  // their walk cycles `dt` s on.
  function update(pedestrians, truck, inView, dt) {
    for (const level of levels) level.count = 0;
    for (const q of pedestrians) {
      let person = people.get(q);
      if (!person) people.set(q, (person = { gait: { x: q.x, z: q.z, phase: 0, stride: 0 }, figure: figureOf(q.id, p) }));
      const { gait, figure } = person;
      stepGait(gait, q.x, q.z, dt, figure.step, p.speed);
      const y = q.onRoad ? road : ground;
      bounds.center.set(q.x, y + p.height / 2, q.z);
      if (!inView(bounds)) continue;
      const level = levels[Math.hypot(q.x - truck.x, q.z - truck.z) < p.near ? 0 : 1];
      const a = level.data.array;
      const i = level.count++ * STRIDE;
      const c = figure.colours;
      set(a, i, q.x, y, q.z, q.heading);
      set(a, i + 4, gait.phase, gait.stride * figure.stride, figure.lean, figure.scale);
      set(a, i + 8, c[0], c[1], c[2], c[3]);
      a[i + 12] = figure.wear;
    }
    for (const { mesh, geometry, data, count } of levels) {
      geometry.instanceCount = warm ? Math.max(count, 1) : count;
      mesh.visible = geometry.instanceCount > 0;
      // Only the instances in use go up to the GPU; none for none (WebGL 2 reads a length of 0 as all of it).
      if (!count) continue;
      data.clearUpdateRanges();
      data.addUpdateRange(0, count * STRIDE);
      data.needsUpdate = true;
    }
    warm = false;
  }

  return { update };
}
