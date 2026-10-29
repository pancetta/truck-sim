// The street events' look (#80, sim/events.js), our own, built from boxes and cylinders: while a market or roadworks
// has its barriers up, each barrier is a red and white striped board on posts across the road and its pavements, with
// a no-entry sign in its middle; between them a market has a row of stalls under striped awnings along the middle of the
// road, roadworks a dug patch with a heap of spoil, cones round it. Each event is one mesh, built when its barriers go up
// and dropped when it ends. Garbage trucks are AI cars: riders.js draws them.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured } from './streets.js';
import { drape } from './drape.js';

const RED = 0xc62828;
const WHITE = 0xf2f2ee;
const POST = 0x8a8d90;
const WOOD = 0x7a5a3a;
const EARTH = 0x4a3b2c;
const CONE = 0xff6a13;
const AWNINGS = [0x2e6f9e, 0x2f8a52, 0xb83a3a, 0xd99a1e];
const PRODUCE = [0xd8452b, 0xf0c419, 0x6aa84f, 0xe07b39, 0x8e3b6e];

// A box `w` across, `h` tall and `d` along, its bottom middle at (x, y, z) in an event part's frame (z along the road).
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cylinder = (top, bottom, h, x, y, z) => new THREE.CylinderGeometry(top, bottom, h, 10).translate(x, y + h / 2, z);

export function createStreetEvents(scene, map, tables) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  const shown = new Map(); // event id → its mesh

  // The parts ([geometry, colour]) of a barrier `w` m across, in its own frame.
  function barrier(w) {
    const parts = [];
    for (let x = -w / 2, k = 0; x < w / 2 - 1e-6; x += 0.5, k++) {
      const len = Math.min(0.5, w / 2 - x);
      parts.push([box(len, 0.25, 0.06, x + len / 2, 0.75, 0), k % 2 ? WHITE : RED]);
    }
    for (let x = -w / 2 + 0.1; x <= w / 2; x += Math.max(1, (w - 0.2) / Math.ceil((w - 0.2) / 3))) parts.push([box(0.06, 1, 0.06, x, 0, 0), POST]);
    parts.push([box(0.05, 0.7, 0.05, 0, 1, 0), POST]);
    parts.push([cylinder(0.32, 0.32, 0.04, 0, 0, 0).rotateX(Math.PI / 2).translate(0, 1.95, 0), RED]);
    parts.push([box(0.4, 0.1, 0.06, 0, 1.9, 0), WHITE]); // the bar, proud of the disc both ways
    return parts;
  }

  // A market stall, its table along the road, `k` picking its colours.
  function stall(x, z, k) {
    const parts = [[box(2.2, 0.85, 1, x, 0, z).rotateY(Math.PI / 2), WOOD]];
    for (let i = 0; i < 3; i++) parts.push([box(0.6, 0.18, 0.5, x, 0.85, z - 0.7 + i * 0.7), PRODUCE[(k + i) % PRODUCE.length]]);
    for (const [dx, dz] of [[-0.6, -1.2], [-0.6, 1.2], [0.6, -1.2], [0.6, 1.2]]) parts.push([box(0.05, 2.1, 0.05, x + dx, 0, z + dz), POST]);
    for (let i = 0; i < 4; i++) parts.push([box(1.6, 0.05, 0.65, x, 2.1, z - 0.975 + i * 0.65), i % 2 ? WHITE : AWNINGS[k % AWNINGS.length]]);
    return parts;
  }

  // Roadworks' parts, `length` m along a road `width` m wide, in a frame along it from its middle.
  function roadworks(length, width) {
    const parts = [];
    const [w, d] = [Math.min(2.6, width / 2), Math.min(6, length - 4)];
    parts.push([box(w, 0.03, d, 0, 0, 0), EARTH], [box(1.2, 0.6, 1.6, w / 2 + 0.8, 0, 0), EARTH]);
    for (const [x, z] of [[-w / 2 - 0.4, -d / 2 - 0.4], [w / 2 + 0.4, -d / 2 - 0.4], [-w / 2 - 0.4, d / 2 + 0.4], [w / 2 + 0.4, d / 2 + 0.4], [-w / 2 - 0.4, 0]]) {
      parts.push([cylinder(0.03, 0.17, 0.5, x, 0, z), CONE], [cylinder(0.09, 0.11, 0.08, x, 0.25, z), WHITE]);
    }
    return parts;
  }

  // The event's mesh: its barriers (colliders, see events.js), and between them its middle.
  function build(x) {
    const e = map.graph.edges[x.edge];
    const parts = [];
    const place = (list, cx, cz, heading) => parts.push(...list.map(([g, c]) => coloured(g.rotateY(heading).translate(cx, 0, cz), c)));
    const frames = x.barriers.map(({ points: [a, b, , d] }) => ({
      cx: (a.x + d.x) / 2 + (b.x - a.x) / 2,
      cz: (a.z + d.z) / 2 + (b.z - a.z) / 2,
      heading: Math.atan2(a.x - d.x, a.z - d.z), // along the road
      w: Math.hypot(b.x - a.x, b.z - a.z),
    }));
    for (const f of frames) place(barrier(f.w), f.cx, f.cz, f.heading);
    // Along the edge itself between the barriers, round its bends.
    const [from, to] = [map.graph.nodes[e.from].radius + tables.events.back, e.length - map.graph.nodes[e.to].radius - tables.events.back];
    const at = (s) => {
      const [a, b] = [map.graph.pointAt(e, s - 0.25), map.graph.pointAt(e, s + 0.25)];
      return [(a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(b.x - a.x, b.z - a.z)];
    };
    if (x.kind === 'market') {
      const n = Math.max(1, Math.floor((to - from - 4) / 4));
      for (let i = 0; i < n; i++) place(stall(((i % 2) - 0.5) * Math.min(1.6, e.width / 4), 0, i), ...at((from + to) / 2 + (i - (n - 1) / 2) * 4));
    } else place(roadworks(to - from, e.width), ...at((from + to) / 2));
    const mesh = new THREE.Mesh(drape(mergeGeometries(parts), map, Infinity), material); // each corner on the ground under it
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  // Shows the events whose barriers are up (`on`) among `events` (the Sim's), and drops the ones that ended.
  function update(events) {
    for (const x of events) {
      if (!x.on || shown.has(x.id)) continue;
      const mesh = build(x);
      scene.add(mesh);
      shown.set(x.id, mesh);
    }
    for (const [id, mesh] of shown) {
      if (events.some((x) => x.id === id)) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
      shown.delete(id);
    }
  }

  return { update };
}
