// The OSM map builder (spec #59, "Map module"): turns OpenStreetMap-shaped data into the map the Sim and the renderer
// use. `data` is public/maps/monti.json (from `npm run maps`) or a test's inline
// fixture: { bounds: { minX, minZ, maxX, maxZ }, ways: [{ id, tags, nodes (highways only), points: [[x, z]] }] } in
// metres, x east and z south. `furniture` is public/maps/monti-furniture.json or a fixture's: { nodes: [{ x, z, tags }] }.
// `terrain` is public/maps/monti-terrain.json, the map's height grid, or none (flat at 0).
//   Drivable network: ways of a tables.osm.classes highway class, but no tunnels or areas, cut where they leave the
//     bounds (an edge exit, closed by a gate, but not on a pedestrian way) and split at every node they share into edges.
//     Pedestrian ways are pedestrian edges (#89): the graph keeps them off its junctions (graph.js), and each has a
//     bollard gate where it leaves the road, whose gap only narrow Vehicles fit through.
//   Edge exits (`exits`): each one's gate, a barrier the truck stops at (kind 'barrier') that opens for AI cars, and
//     its exit road on past the map's edge into the haze, where AI cars that leave drive on (see exitRoad).
//   Pedestrian ways and squares: squares are no edges, closed by bollards where the road and its pavements meet them;
//     the map keeps both as `pedestrian` { lines, squares } for the renderer to pave.
//   Buildings: closed building ways, cut back where they reach into a road or its pavement.
//   Edge walls: along the paved area's open edges (paved.js), solid (kind 'wall'), so the truck keeps to the paving.
//   Lights: on every approach to a junction where two named streets of tables.osm.lightClasses cross.
//   Speed limit signs: where the limit changes along the way, and on the way in from an edge exit. Give-way signs: on
//     the approaches to a junction without lights where another arm ranks higher; stop signs on those where it ranks
//     tables.stopSign.gap higher, whose graph slot gets `stop: true`.
//   Props: the furniture's trees, bollards, fountains and waste baskets, solid (kinds
//     'tree', 'bollard', 'fountain' and 'bin'); none reaching into the road.
//   Parked cars: along the kerbs of the streets that leave room for them beside their lane (see parkedCars).
//   `id`: the map's id (tables.osm.id).
//   Spots: from the spot table (tables.osm.spots), each with its `kind`, its zone on the kerb lane, a dock's in its bay, and its
//     kerb `lane` pose; a petrol station (tables.osm.stations) has its pump island (`pumps`, solid, kind 'station') on
//     the pavement beside its zone, the restaurant (tables.osm.restaurant) its terrace (`terrace`, solid, kind
//     'restaurant'), and home (tables.osm.home) its `garage` pose there, on which the renderer draws its doors.
//     `start` is the start spot's kerb lane pose, where a new game begins.
//   Pavement lines (`pavements`): where pedestrians walk, along both sides of every edge (see pavementLines).
//   Terrain (#104): `heightAt(x, z)`, the ground's height, and `slopeAt` (terrain.js). Nothing stands on it yet.

import { createGraph } from './graph.js';
import { createCells } from './cells.js';
import { poseAt } from './lanes.js';
import { pavementLines } from './pavements.js';
import { inside } from './sim.js';
import { roadPieces, pavementPieces, pedestrianPieces, openEdges } from './paved.js';
import { createTerrain } from './terrain.js';

// The furniture's props by OSM tag: [tag, value, collider kind].
const PROPS = [['natural', 'tree', 'tree'], ['barrier', 'bollard', 'bollard'], ['amenity', 'drinking_water', 'fountain'], ['amenity', 'waste_basket', 'bin']];

export function buildOsmMap(data, tables, furniture = { nodes: [] }, terrain = null) {
  const o = tables.osm;
  const { bounds } = data;
  const { cell } = tables.city;
  const classOf = (w) => o.classes[w.tags.highway];
  const drivable = data.ways.filter((w) => classOf(w) && !w.tags.tunnel && w.tags.area !== 'yes');
  const colliders = [];

  // Each drivable way as runs of points ({ key, x, z }) inside the bounds; a run's ends where it crosses the bounds
  // are edge exits, keyed by way and segment.
  const runs = [];
  for (const w of drivable) {
    let run = null;
    const exit = w.tags.highway !== 'pedestrian'; // a pedestrian way just ends at the map's edge, where a wall stands
    w.points.forEach(([x, z], k) => {
      if (k === 0) return;
      const a = { key: w.nodes[k - 1], x: w.points[k - 1][0], z: w.points[k - 1][1] };
      const b = { key: w.nodes[k], x, z };
      const clip = clipSegment(a, b, bounds);
      if (!clip) return void (run = null);
      // An edge exit, with the way's points on past it.
      const at = (t, end) => ({ key: `exit ${w.id}.${k}.${end}`, x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z), exit, outside: end ? w.points.slice(k) : w.points.slice(0, k).reverse() });
      if (clip[0] > 0 || !run) runs.push((run = { way: w, points: [clip[0] > 0 ? at(clip[0], 0) : a] }));
      run.points.push(clip[1] < 1 ? at(clip[1], 1) : b);
      if (clip[1] < 1) run = null;
    });
  }

  // Nodes where runs end or meet (an OSM node used more than once), and edges between them along the runs.
  const uses = new Map();
  for (const r of runs) for (const p of r.points) uses.set(p.key, (uses.get(p.key) ?? 0) + 1);
  const nodeOf = new Map(); // key → node index
  const nodes = [];
  const outside = []; // node index → an edge exit's way on past it, as [x, z]
  const node = (p) => {
    if (!nodeOf.has(p.key)) {
      nodeOf.set(p.key, nodes.push({ x: p.x, z: p.z, exit: !!p.exit }) - 1);
      outside[nodes.length - 1] = p.outside;
    }
    return nodeOf.get(p.key);
  };
  const edges = [];
  for (const { way, points } of runs) {
    const { width, lane, limit } = classOf(way);
    const oneWay = ['yes', 'true', '1', '-1'].includes(way.tags.oneway);
    let start = 0;
    points.forEach((p, k) => {
      if (k === 0 || (k < points.length - 1 && uses.get(p.key) < 2)) return;
      const piece = points.slice(start, k + 1);
      if (way.tags.oneway === '-1') piece.reverse(); // drawn against the way it runs
      edges.push({ from: node(piece[0]), to: node(piece.at(-1)), way: way.id, class: way.tags.highway, width, laneOffset: lane, limit, name: way.tags.name ?? '', oneWay, pedestrian: way.tags.highway === 'pedestrian', points: piece.map(({ x, z }) => ({ x, z })) });
      start = k;
    });
  }
  const graph = createGraph(nodes, edges, tables.traffic.laneOffset, cell);

  // Each node's arms: the edge, the way out along it (unit u) and whether traffic may come in along it. As in the graph,
  // a pedestrian edge is none.
  const arms = nodes.map(() => []);
  for (const e of edges.filter((e) => !e.pedestrian)) {
    for (const end of [0, 1]) {
      const n = end ? e.to : e.from;
      const s = end ? Math.max(0, e.length - 5) : Math.min(5, e.length);
      const p = graph.pointAt(e, s);
      const l = Math.hypot(p.x - nodes[n].x, p.z - nodes[n].z) || 1;
      arms[n].push({ e, u: [(p.x - nodes[n].x) / l, (p.z - nodes[n].z) / l], in: !e.oneWay || end === 1, out: !e.oneWay || end === 0 });
    }
  }
  // m along arm a from its node to where the other arms' roads end and its own begins.
  // shortcut: each other arm counts as a straight line through the node, so an obtuse one moves the mouth out further
  // than it needs; measure against the arms' kerbs if lights or signs stand too far back on wide-angled junctions.
  const mouth = (a, others) =>
    Math.max(0, ...others.map((b) => {
      const sin = Math.abs(a.u[0] * b.u[1] - a.u[1] * b.u[0]);
      const cos = Math.abs(a.u[0] * b.u[0] + a.u[1] * b.u[1]);
      return sin > 0.3 ? (b.e.width / 2 + (a.e.width / 2) * cos) / sin : 0;
    }));
  // The point m along arm a and m right of travel along it, that is away from its node.
  const beside = (n, a, along, right) => ({ x: nodes[n].x + a.u[0] * along - a.u[1] * right, z: nodes[n].z + a.u[1] * along + a.u[0] * right });

  // Lights where two streets cross: both go on through (two arms each), and each has an arm of a light class. A street
  // is told apart by its name, since OSM splits one into several ways (often a class apiece, so the class is the
  // street's, not every arm's). One light per approach, German style: the post on the near
  // right corner, tables.city.obstacles.signal.inset into the junction, the stop line tables.lights.stopLine before
  // it; `axis` 0 for the first street's approaches and 1 for the rest, `half` its road's half width.
  const lights = [];
  const { width: post, inset } = tables.city.obstacles.signal;
  nodes.forEach((_, n) => {
    const streets = new Map();
    for (const a of arms[n]) if (a.e.name) streets.set(a.e.name, [...(streets.get(a.e.name) ?? []), a]);
    const crossing = [...streets.values()].filter((list) => list.length >= 2 && list.some((a) => o.lightClasses.includes(a.e.class)));
    if (crossing.length < 2) return;
    const junction = lights.length ? lights.at(-1).junction + 1 : 0;
    for (const a of arms[n].filter((a) => a.in)) {
      const r = mouth(a, arms[n].filter((b) => b !== a)) - inset;
      const p = beside(n, a, r, -(a.e.width / 2 + inset)); // travel is against u, so its right is left of u
      const line = beside(n, a, r + tables.lights.stopLine, 0);
      // `node` and `slot`: its junction and arm on the graph (arms[n] runs in the order of the node's slots, lanes.js)
      lights.push({ junction, node: n, slot: arms[n].indexOf(a), axis: crossing[0].includes(a) ? 0 : 1, x: line.x, z: line.z, dx: -a.u[0], dz: -a.u[1], half: a.e.width / 2, post: p });
      colliders.push({ kind: 'signal', ...outline(rect(p, a.u, post / 2, post / 2)) });
    }
  });

  // Speed limit signs on the right-hand pavement, tables.signs.along m into an edge out of a node where another arm has
  // another limit, and into an edge from an edge exit; facing the traffic, which the plate's `angle` turns it to.
  const signs = [];
  nodes.forEach((nd, n) => {
    for (const a of arms[n]) {
      const others = arms[n].filter((b) => b !== a);
      if (!a.out || !(nd.exit || others.some((b) => b.e.limit !== a.e.limit))) continue;
      const p = beside(n, a, mouth(a, others) + tables.signs.along, a.e.width / 2 + o.pavement / 2);
      signs.push({ kind: 'speed', limit: a.e.limit, ...p, angle: Math.atan2(-a.u[0], -a.u[1]) });
    }
  });
  // Give-way signs on the right-hand pavement of each approach to a junction without lights where another arm cars come
  // in by ranks higher (tables.traffic.priority, as the Sim's junction rule has it), tables.signs.along m before the
  // junction's mouth, facing the traffic; none that would stand on a road or in another junction. A stop sign instead
  // where that arm ranks tables.stopSign.gap higher: only with its sign is the approach a stop approach.
  const lit = new Set(lights.map((l) => l.node));
  const rank = (a) => tables.traffic.priority[a.e.class] ?? 0;
  nodes.forEach((_, n) => {
    if (arms[n].length < 3 || lit.has(n)) return;
    for (const a of arms[n]) {
      const others = arms[n].filter((b) => b !== a);
      const top = Math.max(...others.filter((b) => b.in).map(rank));
      if (!a.in || !(top > rank(a))) continue;
      const stop = top - rank(a) >= tables.stopSign.gap;
      // A stop sign stands before the junction's box too, where the truck must stand still (tables.stopSign.reach).
      const along = Math.max(mouth(a, others), stop ? graph.nodes[n].radius : 0) + tables.signs.along;
      const p = beside(n, a, along, -(a.e.width / 2 + o.pavement / 2)); // travel is against u
      // A short arm's would stand past its far end, on the next road, or in the next junction, whose rule the HUD shows there.
      const inJunction = graph.nodes.some((m, k) => k !== n && m.arms.length >= 3 && Math.hypot(m.x - p.x, m.z - p.z) < m.radius);
      if (along > a.e.length || graph.onRoad(p.x, p.z) || inJunction) continue;
      if (stop) graph.nodes[n].slots[arms[n].indexOf(a)].stop = true; // arms[n] runs in the order of the slots
      signs.push({ kind: stop ? 'stop' : 'giveWay', ...p, angle: Math.atan2(a.u[0], a.u[1]) });
    }
  });

  // The road and its pavements, and the pedestrian edges: per edge segment, a box that far either side of it (a
  // pedestrian edge has no pavements) and past its ends, as { box, road, edge }. Buildings are cut back out of them; bollards
  // stand on a road's outer edge where it meets a pedestrian square.
  const corridors = [];
  const corridorCells = createCells(cell);
  for (const e of edges) {
    const c = e.width / 2 + (e.pedestrian ? 0 : o.pavement);
    for (let k = 1; k < e.points.length; k++) {
      const [a, b] = [e.points[k - 1], e.points[k]];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < 1e-6) continue;
      const u = [(b.x - a.x) / l, (b.z - a.z) / l];
      const corridor = { box: rect({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, u, l / 2 + c, c), road: !e.pedestrian, edge: e };
      corridors.push(corridor);
      const { minX, minZ, maxX, maxZ } = outline(corridor.box);
      corridorCells.add(corridor, minX, minZ, maxX, maxZ);
    }
  }
  // Whether (x, z) lies in a corridor; with `road`, in a road's.
  const inCorridor = (x, z, road = false) => corridorCells.some(x, z, x, z, (c) => (c.road || !road) && insideConvex(c.box, x, z));

  // Edge exits: a gate across the road and its pavements, its own thickness in from the map's edge, and the exit road
  // on past the map's edge, a car's length longer than the haze reaches (as traffic.js has it). `u` points into the map,
  // `edge` is the exit's.
  const exits = [];
  const haze = tables.camera.fog[1] + tables.camera.chaseDistance + tables.city.obstacles.car.length;
  for (const [n, nd] of nodes.entries()) {
    if (!nd.exit) continue;
    const [a] = arms[n];
    const gate = beside(n, a, o.barrier, 0);
    colliders.push({ kind: 'barrier', ...outline(rect(gate, a.u, o.barrier / 2, a.e.width / 2 + o.pavement)) });
    exits.push({ node: n, gate, u: a.u, edge: a.e, road: exitRoad(nd, outside[n], bounds, haze, o.exitStep) });
  }

  // Pedestrian ways and squares, and the bollards that close them off from the road.
  const pedestrian = data.ways.filter((w) => w.tags.highway === 'pedestrian');
  const squares = pedestrian.filter((w) => w.tags.area === 'yes').map((w) => w.points.map(([x, z]) => ({ x, z })));
  const lines = pedestrian.filter((w) => w.tags.area !== 'yes');
  const inSquare = (x, z) => squares.some((ring) => inside(x, z, ring));
  const bollards = [];
  const crowded = (x, z) => bollards.some((q) => Math.hypot(q.x - x, q.z - z) < o.bollardSpacing * 0.6);
  const size = tables.city.props;
  // Bollard gates (#89): across each pedestrian edge where it leaves the road, just past where all of it is out of the
  // roads' corridors, a bollard either side of a tables.osm.gate m gap down its middle and more every bollardSpacing m out
  // to its sides, and on across a pedestrian square there; only a Vehicle narrower than the gap gets through. `zone`:
  // per pedestrian edge, the m along it between its gates (from an end with no road, all the way), which the fence below
  // closes off; an edge that never leaves the roads' corridors runs along their pavements and has none.
  const zone = new Map();
  for (const e of edges.filter((e) => e.pedestrian)) {
    const range = [0, e.length];
    [e.from, e.to].forEach((end, k) => {
      if (!nodes[end].arms.length) return; // no road there
      range[k] = k ? 0 : e.length;
      const half = e.width / 2;
      for (let d = 0; d < e.length; d += 0.25) {
        const s = k ? e.length - d : d;
        const [p, q] = [graph.pointAt(e, s), graph.pointAt(e, k ? Math.max(0, s - 0.5) : Math.min(e.length, s + 0.5))];
        const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        const [ux, uz] = [(q.x - p.x) / l, (q.z - p.z) / l]; // along the edge, away from the road
        const at = (across, on = 0) => ({ x: p.x + ux * on - uz * across, z: p.z + uz * on + ux * across });
        if ([-1, -0.5, 0, 0.5, 1].some((f) => inCorridor(at(f * half).x, at(f * half).z, true))) continue;
        for (let across = (o.gate + size.bollard) / 2; ; across += o.bollardSpacing) {
          const sides = [at(across, size.bollard / 2), at(-across, size.bollard / 2)].filter((b) => across <= half || (inSquare(b.x, b.z) && !inCorridor(b.x, b.z, true)));
          if (!sides.length) break;
          for (const b of sides) if (!crowded(b.x, b.z)) bollards.push(b);
        }
        range[k] = s;
        break;
      }
    });
    zone.set(e, range);
  }
  // Whether (x, z) lies in a pedestrian edge's corridor between its gates (`inside` true), or on the road's side of one.
  const inZone = (x, z, inside = true) =>
    corridorCells.some(x, z, x, z, (c) => {
      if (c.road || !insideConvex(c.box, x, z)) return false;
      const { s } = graph.project(c.edge, x, z);
      return (s >= zone.get(c.edge)[0] && s <= zone.get(c.edge)[1]) === inside;
    });
  // The fence: bollards every tables.osm.bollardSpacing m along the roads' corridors' outer edge where it lies in a
  // pedestrian edge's zone, or in a pedestrian square but not on the road's side of a gate (whose gap it would close),
  // and in no other road's corridor.
  for (const { box } of corridors.filter((c) => c.road)) {
    box.forEach((a, k) => {
      const b = box[(k + 1) % 4];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s < l; s += o.bollardSpacing) {
        const [x, z] = [a[0] + ((b[0] - a[0]) * s) / l, a[1] + ((b[1] - a[1]) * s) / l];
        if (!inCorridor(x, z, true) && !crowded(x, z) && (inZone(x, z) || (inSquare(x, z) && !inZone(x, z, false)))) bollards.push({ x, z });
      }
    });
  }
  for (const p of bollards) colliders.push({ kind: 'bollard', ...outline(rect(p, [1, 0], size.bollard / 2, size.bollard / 2)) });

  // The street furniture where OSM puts it, unless that reaches into the road.
  for (const { x, z, tags } of furniture.nodes) {
    const kind = PROPS.find(([tag, value]) => tags[tag] === value)?.[2];
    const road = graph.nearest(x, z);
    if (kind && road.d > road.edge.width / 2 + size[kind] / 2) colliders.push({ kind, ...outline(rect({ x, z }, [1, 0], size[kind] / 2, size[kind] / 2)) });
  }

  // Buildings, cut back out of the corridors, with their height: OSM's `height`, else from `building:levels`, else a
  // seeded tables.osm.floors. Roofs (OSM building=roof, open canopies) are left out.
  const { groundFloor, floor, parapet } = tables.buildings;
  const buildings = [];
  for (const w of data.ways) {
    const [first, last] = [w.points[0], w.points.at(-1)];
    if (!w.tags.building || w.tags.building === 'roof' || first[0] !== last[0] || first[1] !== last[1]) continue;
    const levels = parseFloat(w.tags['building:levels']) || o.floors[0] + Math.floor(seeded(w.id) * (o.floors[1] - o.floors[0] + 1));
    const height = parseFloat(w.tags.height) || groundFloor + (Math.max(1, Math.round(levels)) - 1) * floor + parapet;
    let pieces = [w.points.slice(0, -1)];
    const { minX, minZ, maxX, maxZ } = outline(pieces[0]);
    const near = new Set(); // a box is filed under every cell it spans
    corridorCells.some(minX, minZ, maxX, maxZ, (c) => void near.add(c.box));
    for (const box of near) pieces = pieces.flatMap((p) => subtract(p, box));
    for (const p of pieces) {
      if (Math.abs(area2(p)) / 2 < o.minArea) continue;
      const points = p.map(([x, z]) => ({ x, z }));
      buildings.push({ points, height });
      colliders.push({ kind: 'building', ...outline(p) });
    }
  }

  // Edge walls on the open edges of the paved area (paved.js), `tables.osm.wall` m thick on the open ground's side, so
  // the truck keeps to the paving and meets nothing it can't see.
  const toXZ = (w) => w.points.map(([x, z]) => ({ x, z }));
  const pedestrianWays = { lines: lines.map(toXZ), squares };
  const paved = [...roadPieces(graph).map((p) => p.ring), ...pavementPieces(graph, o.pavement), ...pedestrianPieces(pedestrianWays, o.classes.pedestrian.width)];
  const closers = colliders.filter((c) => c.kind === 'building' || c.kind === 'barrier');
  // None across an exit road where cars that leave drive on: from half a car in from the barrier's map-side face along
  // the road's first stretch, as wide as the road. Past the barrier, which is wider, the truck can't get; before it,
  // within the road, only the walls along the map's edge stand, where the truck can't go either.
  const pastGates = exits.map(({ gate, u, edge, road }) => {
    const back = o.barrier / 2 + tables.city.obstacles.car.length / 2;
    const face = { x: gate.x + u[0] * back, z: gate.z + u[1] * back };
    return roadPieces({ nodes: [], edges: [{ points: [face, road[0], road[1]], width: edge.width }] }).map((p) => p.ring);
  }).flat();
  const gateCells = createCells(cell);
  for (const r of pastGates) {
    const { minX, minZ, maxX, maxZ } = outline(r);
    gateCells.add(r, minX, minZ, maxX, maxZ);
  }
  const pastGate = (a, b) =>
    gateCells.some(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), (r) =>
      [0, 0.25, 0.5, 0.75, 1].some((t) => insideConvex(r, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))));
  for (const { a, b, out } of openEdges(paved, closers, bounds, o.closed, cell)) {
    if (pastGate(a, b)) continue;
    const [ox, oz] = [out[0] * o.wall, out[1] * o.wall];
    colliders.push({ kind: 'wall', ...outline([a, b, [b[0] + ox, b[1] + oz], [a[0] + ox, a[1] + oz]]) });
  }

  // The spots (tables.osm.spots), placed before the parked cars, which keep clear of their zones. A spot whose way the
  // data doesn't have is left out (an inline fixture has none of the extract's ways).
  const spots = [];
  let start = null;
  for (const t of o.spots) {
    const w = data.ways.find((w) => w.id === t.way);
    if (!w) continue;
    const fail = (why) => {
      throw new Error(`Spot ${t.id}: ${why}`);
    };
    if (w.tags.name !== t.street) fail(`way ${t.way} is ${w.tags.name}, not ${t.street}`);
    if (o.docks.includes(t.id) !== !!t.bay) fail(t.bay ? 'has a bay but is no dock' : 'is a dock without a bay');
    const [x, z, u] = alongWay(w.points, t.at) ?? fail(`way ${t.way} is shorter than ${t.at} m`);
    const near = graph.edges.filter((e) => e.way === t.way).map((e) => graph.project(e, x, z)).sort((a, b) => a.d - b.d)[0] ?? fail(`way ${t.way} isn't drivable`);
    const e = near.edge;
    // The kerb lane: on a two-way the one on the spot's side, a one-way's own; heading the way it runs.
    const side = t.side === 'right' ? 1 : -1;
    const lane = e.oneWay ? 0 : e.laneOffset;
    const kerb = { x: near.x - u[1] * side * lane, z: near.z + u[0] * side * lane }; // right of u is (-u.z, u.x)
    const [a, b] = [e.points[near.k], e.points[Math.min(near.k + 1, e.points.length - 1)]];
    const forward = e.oneWay ? Math.sign((b.x - a.x) * u[0] + (b.z - a.z) * u[1]) || 1 : side; // along u, or against it
    const heading = Math.atan2(u[0] * forward, u[1] * forward);
    // A dock's bay: the middle of its dock edge and the heading a truck docked in it faces; its zone is where that
    // truck stands, so the dock bonus can be earned while unloading. The bay is the starter truck's (tables.fleet), and
    // the zone wide enough to hold any Vehicle's middle when it docks (osm.test.js).
    const bay = t.bay && { x: t.bay[0], z: t.bay[1], heading: (t.bay[2] * Math.PI) / 180 };
    const f = bay && [Math.sin(bay.heading), Math.cos(bay.heading)];
    // The dock edge's platform (the renderer's, tables.buildings.dock.depth deep and as wide as buildings.js dockHalf)
    // is solid, so a truck can't back past the edge where no wall stands behind it.
    const { depth } = tables.buildings.dock;
    if (bay) colliders.push({ kind: 'dock', ...outline(rect({ x: bay.x - (f[0] * depth) / 2, z: bay.z - (f[1] * depth) / 2 }, f, depth / 2, tables.fleet.truck.width / 2 + tables.orders.dockCentre + 0.5)) });
    const centre = bay ? { x: bay.x + (f[0] * tables.fleet.truck.length) / 2, z: bay.z + (f[1] * tables.fleet.truck.length) / 2 } : kerb;
    const r = o.zone / 2;
    const zone = { minX: centre.x - r, maxX: centre.x + r, minZ: centre.z - r, maxZ: centre.z + r };
    // A petrol station's pump island or the restaurant's terrace (solid): on the middle of the pavement beside its zone,
    // heading along the road with the road on its left.
    const station = o.stations.includes(t.id);
    const restaurant = o.restaurant === t.id;
    const out = e.width / 2 + o.pavement / 2;
    const beside = { x: near.x - u[1] * side * out, z: near.z + u[0] * side * out, heading: Math.atan2(u[0] * side, u[1] * side) };
    const [length, width] = station ? tables.station.island : tables.restaurant.terrace;
    if (station || restaurant) colliders.push({ kind: station ? 'station' : 'restaurant', ...outline(rect(beside, [u[0] * side, u[1] * side], length / 2, width / 2)) });
    const kerbLane = { ...kerb, heading };
    const home = o.home === t.id;
    const [pumps, terrace, garage] = [station ? beside : null, restaurant ? beside : null, home ? beside : null];
    spots.push({ id: t.id, kind: t.kind, name: t.name, street: t.street, dock: o.docks.includes(t.id), station, restaurant, home, zone, pose: graph.nearest(centre.x, centre.z), bay, lane: kerbLane, pumps, terrace, garage });
    if (t.id === o.start) start = kerbLane;
  }
  colliders.push(...parkedCars(graph, spots, tables));
  // The pedestrian ways and squares, which the renderer paves.
  const pavements = pavementLines(graph, colliders.filter((c) => ['building', 'barrier', 'dock'].includes(c.kind)), bounds, tables);

  // Zebra crossings (tables.zebras) across the arms of light junctions, and across an arm of a lower road class than
  // another at its junction: the strip's middle `back` m out from the mouth, where the strip ends short of the edge's
  // other junction box, keeps `depth` m from any other strip and a pavement line passes both its kerbs. Each is
  // { edge (id), s (m along it), x, z (the middle), dx, dz (along the edge, away from the junction), half (the road's
  // half width), kerbs: [right of (dx, dz), left] (the middles of the pavements beside the strip), strip (its corners,
  // in order) }.
  const zt = tables.zebras;
  const zebras = [];
  const nearLines = (p) => pavements.some((l) => l.points.some((q, k) => k > 0 && segmentDistance(p.x, p.z, [l.points[k - 1].x, l.points[k - 1].z], [q.x, q.z]) < 0.5));
  nodes.forEach((_, n) => {
    if (arms[n].length < 3) return;
    const top = Math.max(...arms[n].map(rank));
    for (const a of arms[n]) {
      const { e } = a;
      if (e.from === e.to || !zt.classes.includes(e.class) || !(lit.has(n) || rank(a) < top)) continue;
      const along = mouth(a, arms[n].filter((b) => b !== a)) + zt.back;
      const s = e.from === n ? along : e.length - along;
      const far = graph.nodes[e.from === n ? e.to : e.from];
      if (along + zt.depth / 2 > e.length - far.radius || zebras.some((q) => q.edge === e.id && Math.abs(q.s - s) < 2 * zt.depth)) continue;
      const [p, q] = [graph.pointAt(e, Math.max(0, s - 0.5)), graph.pointAt(e, Math.min(e.length, s + 0.5))];
      const l = Math.hypot(q.x - p.x, q.z - p.z);
      const sign = e.from === n ? 1 : -1; // away from the junction
      const [dx, dz] = [(sign * (q.x - p.x)) / l, (sign * (q.z - p.z)) / l];
      const mid = graph.pointAt(e, s);
      const out = e.width / 2 + o.pavement / 2;
      const kerbs = [{ x: mid.x - dz * out, z: mid.z + dx * out }, { x: mid.x + dz * out, z: mid.z - dx * out }];
      if (!kerbs.every(nearLines)) continue;
      const [ax, az, rx, rz] = [(dx * zt.depth) / 2, (dz * zt.depth) / 2, -dz * (e.width / 2), dx * (e.width / 2)];
      const strip = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([f, r]) => ({ x: mid.x + f * ax + r * rx, z: mid.z + f * az + r * rz }));
      zebras.push({ edge: e.id, s, x: mid.x, z: mid.z, dx, dz, half: e.width / 2, kerbs, strip });
    }
  });
  return { id: o.id, bounds, spots, start, colliders, lights, signs, graph, buildings, pavements, pedestrian: pedestrianWays, zebras, exits, ...createTerrain(terrain) };
}

// The point `at` m along a polyline of [x, z] points, and the unit direction there: [x, z, u]; undefined past its end.
function alongWay(points, at) {
  for (let k = 1, s = 0; k < points.length; k++) {
    const [a, b] = [points[k - 1], points[k]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > 0 && s + l >= at) {
      const t = Math.max(0, (at - s) / l);
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), [(b[0] - a[0]) / l, (b[1] - a[1]) / l]];
    }
    s += l;
  }
}

// Parked cars (`car` colliders, with the `heading` they face) along one kerb of each edge of a tables.osm.parked class
// whose width leaves room beside its lane for a car and `kerb` m, with `sideGap` from the AI cars (tables.traffic):
// on Monti only one-way residential streets. One kerb per edge, seeded, as are the gaps: a `density` share of the
// places every car length plus `gap` m along each straight stretch, clear of the junction boxes by `junction` m, of
// each spot's zone by `spot` m, of the ends of a dock's street by `dock` m (trucks swing in and out there) and of every
// lane path (any edge's, turns included) by half a car and `sideGap`.
export function parkedCars(graph, spots, tables) {
  const o = tables.osm.parked;
  const car = tables.city.obstacles.car;
  const { sideGap } = tables.traffic;
  const clear = car.width / 2 + sideGap; // m from a lane's centre line to a parked car
  const lanes = []; // a point every m along every lane path
  for (const p of graph.paths) {
    for (let s = 0; s <= p.length; s += 1) {
      const pose = { x: 0, z: 0, heading: 0 };
      poseAt(p, Math.min(s, p.length), pose);
      lanes.push(pose);
    }
  }
  const mouths = spots.filter((s) => s.bay).flatMap((s) => [graph.nodes[s.pose.edge.from], graph.nodes[s.pose.edge.to]]);
  const laneCells = createCells(tables.city.cell);
  for (const q of lanes) laneCells.add(q, q.x, q.z, q.x, q.z);
  const out = [];
  graph.edges.forEach((e, n) => {
    const lane = e.oneWay ? 0 : e.laneOffset;
    if (!o.classes.includes(e.class) || e.width / 2 - lane - clear < car.width + o.kerb) return;
    const side = seeded(n + 0.5) < 0.5 ? 1 : -1; // right of the edge's direction, or left
    const across = side * (e.width / 2 - o.kerb - car.width / 2);
    const [from, to] = [graph.nodes[e.from].radius + o.junction, e.length - graph.nodes[e.to].radius - o.junction];
    for (let k = 1; k < e.points.length; k++) {
      const [a, b] = [e.points[k - 1], e.points[k]];
      const l = e.at[k] - e.at[k - 1];
      const u = [(b.x - a.x) / l, (b.z - a.z) / l];
      for (let s = car.length / 2 + 1; s <= l - car.length / 2 - 1; s += car.length + o.gap) {
        if (e.at[k - 1] + s - car.length / 2 < from || e.at[k - 1] + s + car.length / 2 > to) continue;
        if (seeded(n * 1000 + k * 37 + s) >= o.density) continue;
        const c = { x: a.x + u[0] * s - u[1] * across, z: a.z + u[1] * s + u[0] * across }; // right of u is (-u.z, u.x)
        const box = rect(c, u, car.length / 2, car.width / 2);
        const { minX, minZ, maxX, maxZ } = outline(box);
        const onLane = (q) => Math.abs((q.x - c.x) * u[0] + (q.z - c.z) * u[1]) < car.length / 2 + clear && Math.abs(-(q.x - c.x) * u[1] + (q.z - c.z) * u[0]) < car.width / 2 + clear;
        if (laneCells.some(minX - clear, minZ - clear, maxX + clear, maxZ + clear, onLane)) continue;
        if (spots.some(({ zone: z }) => z.minX - o.spot < maxX && z.maxX + o.spot > minX && z.minZ - o.spot < maxZ && z.maxZ + o.spot > minZ)) continue;
        if (mouths.some((m) => Math.hypot(m.x - c.x, m.z - c.z) < o.dock)) continue;
        out.push({ kind: 'car', ...outline(box), heading: Math.atan2(u[0], u[1]) });
      }
    }
  });
  return out;
}

// The part of segment a→b inside the bounds as [t0, t1] (0..1 along it), or null where it misses them (Liang–Barsky).
function clipSegment(a, b, { minX, minZ, maxX, maxZ }) {
  let [t0, t1] = [0, 1];
  const [dx, dz] = [b.x - a.x, b.z - a.z];
  for (const [p, q] of [[-dx, a.x - minX], [dx, maxX - a.x], [-dz, a.z - minZ], [dz, maxZ - a.z]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 < t1 ? [t0, t1] : null;
}

// A box round point c, `along` m either way along unit u and `across` m either side, as [x, z] corners.
function rect(c, u, along, across) {
  const [ax, az, nx, nz] = [u[0] * along, u[1] * along, -u[1] * across, u[0] * across];
  return [[c.x - ax - nx, c.z - az - nz], [c.x + ax - nx, c.z + az - nz], [c.x + ax + nx, c.z + az + nz], [c.x - ax + nx, c.z - az + nz]];
}

// A collider's outline (`points`) and bounds from a ring of [x, z] points.
function outline(ring) {
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), points: ring.map(([x, z]) => ({ x, z })) };
}

// An edge exit's road on past the map's edge, its centre line as { x, z } from the exit: along the way's points
// `outside` it (to where the way comes back in), each at least `step` m on from the last so its bends have room to
// round (a point just past the edge put a 0.4 m bend at a gate, and cars crawled through it), then straight out from
// the side of the map it leaves by, to `far` m past that side, so a car at its end is out of sight from anywhere in
// the map.
function exitRoad(exit, outside, bounds, far, step) {
  const within = ([x, z]) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  const back = outside.findIndex(within);
  const points = [{ x: exit.x, z: exit.z }];
  for (const [x, z] of back < 0 ? outside : outside.slice(0, back)) {
    if (Math.hypot(x - points.at(-1).x, z - points.at(-1).z) >= step) points.push({ x, z });
  }
  const sides = [[-1, 0, exit.x - bounds.minX], [1, 0, bounds.maxX - exit.x], [0, -1, exit.z - bounds.minZ], [0, 1, bounds.maxZ - exit.z]];
  const [nx, nz] = sides.reduce((a, b) => (b[2] < a[2] ? b : a));
  const end = points.at(-1);
  const past = (end.x - exit.x) * nx + (end.z - exit.z) * nz;
  if (past < far) points.push({ x: end.x + nx * (far - past), z: end.z + nz * (far - past) });
  return points;
}

// A stable number in [0, 1) per OSM id.
function seeded(id) {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Twice the signed area of a ring of [x, z] points.
const area2 = (ring) => ring.reduce((s, [x, z], i) => s + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * z, 0);
const cross = (o, a, x, z) => (a[0] - o[0]) * (z - o[1]) - (a[1] - o[1]) * (x - o[0]);

// Whether (x, z) lies inside the convex ring `box`, more than 1 cm from its sides, whichever way round it runs.
function insideConvex(box, x, z) {
  const sign = Math.sign(area2(box));
  return box.every((a, k) => (sign * cross(a, box[(k + 1) % box.length], x, z)) / Math.hypot(box[(k + 1) % box.length][0] - a[0], box[(k + 1) % box.length][1] - a[1]) > 0.01);
}

// m from (x, z) to the segment from a to b ([x, z] points).
function segmentDistance(x, z, a, b) {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - x, a[1] + t * dz - z);
}

// The ring p minus the convex ring r (both of [x, z] points): the pieces left, each a ring. Where p's outline crosses
// r's, the part inside r is replaced by r's outline (Weiler–Atherton). A p wholly inside r leaves nothing; an r wholly
// inside p would be a hole, which is left filled (a road can't run under a building without crossing its outline).
// shortcut: where p only touches r's outline at a point the pairing of entries and exits can fail; then p is kept whole
// (counted in osm.test.js on the real extract, so a new extract that hits it shows).
export function subtract(p, r) {
  if (area2(p) < 0) p = p.toReversed();
  if (area2(r) < 0) r = r.toReversed();
  const n = r.length;
  const items = []; // p's corners and, in order between them, where its outline enters or leaves r
  let crossings = 0;
  for (let i = 0; i < p.length; i++) {
    const [a, b] = [p[i], p[(i + 1) % p.length]];
    items.push({ x: a[0], z: a[1] });
    // Cyrus–Beck: the part of a→b strictly inside r, [tE, tL], and the sides of r it comes in and goes out by.
    let [tE, tL, kE, kL] = [0, 1, -1, -1];
    for (let k = 0; k < n && tE <= tL; k++) {
      const [s, e] = [r[k], r[(k + 1) % n]];
      // Inside means over 0.1 mm in, so an outline already cut along r's side (or a neighbour's on the same line) stays out.
      const num = cross(s, e, a[0], a[1]) - 1e-4 * Math.hypot(e[0] - s[0], e[1] - s[1]);
      const den = cross(s, e, b[0], b[1]) - cross(s, e, a[0], a[1]);
      if (den === 0) {
        if (num <= 0) tE = 2;
      } else if (den > 0 && -num / den >= tE) [tE, kE] = [-num / den, k];
      else if (den < 0 && -num / den <= tL) [tL, kL] = [-num / den, k];
    }
    if (tE >= tL) continue;
    const at = (t, k, entry) => {
      const [x, z] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const [s, e] = [r[k], r[(k + 1) % n]];
      const u = ((x - s[0]) * (e[0] - s[0]) + (z - s[1]) * (e[1] - s[1])) / ((e[0] - s[0]) ** 2 + (e[1] - s[1]) ** 2);
      crossings++;
      return { x, z, entry, pos: k + Math.max(0, Math.min(1, u)) };
    };
    if (kE >= 0) items.push(at(tE, kE, true));
    if (kL >= 0) items.push(at(tL, kL, false));
  }
  if (!crossings) return insideConvex(r, p[0][0], p[0][1]) ? [] : [p];
  const exits = items.filter((it) => it.entry === false);
  if (exits.length * 2 !== crossings) return [p];

  // From each exit not yet used: along p to the next entry, then back round r to the nearest exit, and on until the
  // ring closes.
  const back = (from, to) => (((from - to) % n) + n) % n;
  const used = new Set();
  const pieces = [];
  for (const start of exits) {
    if (used.has(start)) continue;
    const ring = [];
    let exit = start;
    for (let guard = 0; !used.has(exit); guard++) {
      if (guard > items.length) return [p];
      used.add(exit);
      let i = items.indexOf(exit);
      do ring.push([items[i].x, items[i].z]);
      while (items[(i = (i + 1) % items.length)].entry !== true);
      const entry = items[i];
      ring.push([entry.x, entry.z]);
      exit = exits.reduce((best, x) => (back(entry.pos, x.pos) < back(entry.pos, best.pos) ? x : best));
      const corners = r.map((c, k) => ({ c, d: back(entry.pos, k) })).filter(({ d }) => d > 0 && d < back(entry.pos, exit.pos));
      for (const { c } of corners.sort((x, y) => x.d - y.d)) ring.push(c);
    }
    if (exit !== start) return [p];
    pieces.push(ring.filter((q, k) => Math.hypot(q[0] - ring[(k + 1) % ring.length][0], q[1] - ring[(k + 1) % ring.length][1]) > 1e-6));
  }
  return pieces;
}
