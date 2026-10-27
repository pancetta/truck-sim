import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import * as tables from '../tables.js';
import { buildOsmMap } from './osm.js';
import { createSim, inside } from './sim.js';

// Inline OSM fixtures: a way is its highway class, points [[x, z]] in metres and extra tags. Node ids come from the
// points, so ways sharing a point share a node, as in OSM.
let ids = 0;
const way = (highway, points, tags = {}) => ({ id: ++ids, tags: { highway, ...tags }, nodes: points.map(([x, z]) => `${x},${z}`), points });
const building = (points, tags = {}) => ({ id: ++ids, tags: { building: 'yes', ...tags }, points: [...points, points[0]] });
const bounds = { minX: -100, minZ: -100, maxX: 100, maxZ: 100 };
const build = (...ways) => buildOsmMap({ bounds, ways }, tables);
const { classes, pavement } = tables.osm;
const GAS = { steer: 0, gas: 1, brake: 0 };

// Full gas from (x, z) on `heading` until the truck stops against something (or 20 s pass); returns the truck.
function driveFrom(map, x, z, heading) {
  const sim = createSim(tables, map);
  Object.assign(sim.state.truck, { x, z, heading, speed: 0 });
  for (let t = 0; t < 20 && !sim.state.collision; t += 1 / 60) sim.step(1 / 60, GAS);
  return sim.state;
}

describe('OSM map: drivable network', () => {
  test('pedestrian and tunnel ways are no road, and bollards close the pedestrian way where it meets the road', () => {
    const map = build(
      way('residential', [[-50, 0], [0, 0], [50, 0]]),
      way('pedestrian', [[0, 0], [0, 50]]),
      way('service', [[0, 0], [0, -50]], { tunnel: 'building_passage' }),
    );
    expect(map.graph.edges.map((e) => e.class)).toEqual(['residential']);
    // Heading 0 faces +z: up the pedestrian way, which bollards close at the pavement's outer edge.
    const kerb = classes.residential.width / 2 + pavement;
    const state = driveFrom(map, 0, 0, 0);
    expect(state.collision).toBe(true);
    expect(state.truck.z + tables.vehicle.length / 2).toBeLessThan(kerb);
    expect(state.truck.z + tables.vehicle.length / 2).toBeGreaterThan(kerb - 1);
  });

  test('bollards close a pedestrian square along the road it borders, and nowhere on the road', () => {
    const map = build(way('residential', [[-50, 0], [50, 0]]), way('pedestrian', [[-20, 0], [20, 0], [20, 30], [-20, 30], [-20, 0]], { area: 'yes' }));
    const bollards = map.colliders.filter((c) => c.kind === 'bollard').map((c) => ({ x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2 }));
    const kerb = classes.residential.width / 2 + pavement;
    expect(bollards.length).toBeGreaterThan(20);
    for (const b of bollards) expect(b.z).toBeCloseTo(kerb);
    expect(driveFrom(map, 0, 0, 0).collision).toBe(true);
  });

  test('a way cut by the map edge ends in an edge exit, closed by a barrier the truck stops at', () => {
    const map = build(way('residential', [[0, 0], [150, 0]]));
    const [edge] = map.graph.edges;
    expect(map.graph.nodes[edge.to]).toMatchObject({ x: bounds.maxX, z: 0, exit: true });
    expect(map.colliders.filter((c) => c.kind === 'barrier')).toHaveLength(1);
    const state = driveFrom(map, 50, -classes.residential.lane, Math.PI / 2); // east, in the right-hand lane
    expect(state.collision).toBe(true);
    expect(state.truck.x + tables.vehicle.length / 2).toBeLessThan(bounds.maxX - tables.osm.barrier / 2);
  });

  test('ways split into edges at the nodes they share, and a way that only passes by stays whole', () => {
    const map = build(way('residential', [[-50, 0], [0, 0], [50, 0]]), way('residential', [[0, 0], [0, 50]]), way('residential', [[-50, 20], [50, 20]]));
    // The first way splits where the second meets it; the third shares no node, so it doesn't split (or join) there.
    expect(map.graph.edges).toHaveLength(4);
    expect(map.graph.nodes.find((n) => n.x === 0 && n.z === 0).arms).toHaveLength(3);
  });

  test('widths and two-way lane offsets come from the class; a one-way has one lane on its centre line', () => {
    const map = build(
      way('secondary', [[-50, -40], [50, -40]]),
      way('service', [[-50, 40], [50, 40]]),
      way('residential', [[-50, 0], [50, 0]], { oneway: 'yes' }),
      way('residential', [[-50, 80], [50, 80]], { oneway: '-1' }),
    );
    const [secondary, service, oneWay, backwards] = map.graph.edges;
    expect([secondary.width, service.width]).toEqual([classes.secondary.width, classes.service.width]);
    expect(secondary.lanes).toHaveLength(2);
    expect(secondary.lanes[0].points[0]).toEqual({ x: -50, z: -40 + classes.secondary.lane }); // right of +x is +z
    expect(service.lanes[0].points[0].z).toBeCloseTo(40 + classes.service.lane);
    expect(oneWay.lanes.map((l) => l.points)).toEqual([[{ x: -50, z: 0 }, { x: 50, z: 0 }]]);
    // oneway=-1 runs against the way's drawing: the edge runs from its last point.
    expect(backwards.points).toEqual([{ x: 50, z: 80 }, { x: -50, z: 80 }]);
  });
});

describe('OSM map: buildings', () => {
  const kerb = classes.residential.width / 2 + pavement;
  const area = (points) => Math.abs(points.reduce((s, p, i) => s + p.x * points[(i + 1) % points.length].z - points[(i + 1) % points.length].x * p.z, 0)) / 2;

  test('an outline reaching into the road and its pavement is cut back to the pavement edge; the road keeps its width', () => {
    const map = build(way('residential', [[-50, 0], [50, 0]]), building([[-10, 3], [10, 3], [10, 20], [-10, 20]]), building([[-10, 30], [10, 30], [10, 40], [-10, 40]]));
    const [cut, clear] = map.buildings;
    expect(Math.min(...cut.points.map((p) => p.z))).toBeCloseTo(kerb);
    expect(area(cut.points)).toBeCloseTo(20 * (20 - kerb));
    expect(area(clear.points)).toBeCloseTo(200);
    expect(map.graph.edges[0].width).toBe(classes.residential.width);
    // The colliders follow the cut-back outlines.
    const colliders = map.colliders.filter((c) => c.kind === 'building');
    expect(colliders.map((c) => c.points)).toEqual(map.buildings.map((b) => b.points));
  });

  test('a road ending inside an outline cuts a notch; one running right through splits it in two', () => {
    const notch = build(way('service', [[0, -50], [0, 10]]), building([[-10, 0], [10, 0], [10, 20], [-10, 20]]));
    const c = classes.service.width / 2 + pavement;
    expect(notch.buildings).toHaveLength(1);
    expect(area(notch.buildings[0].points)).toBeCloseTo(400 - 2 * c * (10 + c));
    const split = build(way('service', [[0, -50], [0, 50]]), building([[-10, 0], [10, 0], [10, 20], [-10, 20]]));
    expect(split.buildings.map((b) => area(b.points))).toEqual([expect.closeTo(20 * (10 - c)), expect.closeTo(20 * (10 - c))]);
  });

  test('height from height, else from building:levels, else a seeded 3 to 5 storeys', () => {
    const { groundFloor, floor, parapet } = tables.buildings;
    const square = (x) => [[x, 50], [x + 10, 50], [x + 10, 60], [x, 60]];
    const plain = building(square(0));
    const map = build(way('residential', [[-50, 0], [50, 0]]), building(square(-40), { height: '21.5' }), building(square(-20), { 'building:levels': '4' }), plain);
    const [tall, four, guessed] = map.buildings.map((b) => b.height);
    expect(tall).toBe(21.5);
    expect(four).toBe(groundFloor + 3 * floor + parapet);
    expect([2, 3, 4].map((upper) => groundFloor + upper * floor + parapet)).toContain(guessed);
    expect(build(plain).buildings[0].height).toBe(guessed); // seeded by its OSM id, so the same every time
  });
});

describe('OSM map: lights and signs', () => {
  const via = (name, highway, points, tags) => way(highway, points, { name, ...tags });
  const cross = (a, b) => [via('Via A', a, [[-50, 0], [0, 0], [50, 0]]), via('Via B', b, [[0, -50], [0, 0], [0, 50]])];

  test('two named main streets crossing get a light on every approach, German style', () => {
    const map = build(...cross('tertiary', 'secondary'));
    expect(map.lights).toHaveLength(4);
    expect(map.lights.map((l) => l.axis).sort()).toEqual([0, 0, 1, 1]);
    // The approach from the west: driving +x, the post on the near right corner (right of +x is +z) where Via B's road
    // begins, inset into the junction; the stop line tables.lights.stopLine before the post.
    const { inset } = tables.city.obstacles.signal;
    const west = map.lights.find((l) => l.dx === 1);
    const corner = classes.secondary.width / 2 - inset;
    expect(west.post.x).toBeCloseTo(-corner);
    expect(west.post.z).toBeCloseTo(classes.tertiary.width / 2 + inset);
    expect(west.x).toBeCloseTo(-corner - tables.lights.stopLine);
    expect(map.colliders.filter((c) => c.kind === 'signal')).toHaveLength(4);
  });

  test('no lights at a T-junction, a minor crossing, the same street twice, or for an approach a one-way leaves by', () => {
    expect(build(via('Via A', 'tertiary', [[-50, 0], [0, 0], [50, 0]]), via('Via B', 'tertiary', [[0, 0], [0, 50]])).lights).toEqual([]);
    expect(build(...cross('residential', 'residential')).lights).toEqual([]);
    expect(build(via('Via A', 'tertiary', [[-50, 0], [0, 0], [50, 0]]), via('Via A', 'tertiary', [[0, -50], [0, 0], [0, 50]])).lights).toEqual([]);
    const oneWayOut = build(via('Via A', 'tertiary', [[-50, 0], [0, 0], [50, 0]]), via('Via B', 'tertiary', [[0, 0], [0, -50]], { oneway: 'yes' }), via('Via B', 'tertiary', [[0, 50], [0, 0]]));
    expect(oneWayOut.lights).toHaveLength(3);
  });

  test("a street's class is its main arm's: one changing class at the junction still gets lights", () => {
    const map = build(via('Via A', 'tertiary', [[-50, 0], [0, 0], [50, 0]]), via('Via B', 'tertiary', [[0, -50], [0, 0]]), via('Via B', 'residential', [[0, 0], [0, 50]]));
    expect(map.lights).toHaveLength(4);
  });

  test('the speed limit is the class limit of the edge the truck is on', () => {
    for (const [highway, { limit }] of Object.entries(classes)) {
      const sim = createSim(tables, build(way(highway, [[-50, 0], [50, 0]])));
      sim.step(1 / 60, GAS);
      expect([highway, sim.state.speedLimit]).toEqual([highway, limit]);
    }
  });

  test("driving straight through a junction keeps the limit of the street the truck is on, not a side street's", () => {
    const map = build(way('secondary', [[-50, 0], [0, 0], [50, 0]]), way('residential', [[0, 0], [0, 50]]));
    const sim = createSim(tables, map);
    Object.assign(sim.state.truck, { x: -30, z: classes.secondary.lane, heading: Math.PI / 2 }); // east, beside the side street's mouth
    const limits = new Set();
    for (let t = 0; t < 10; t += 1 / 60) {
      sim.step(1 / 60, GAS);
      limits.add(sim.state.speedLimit);
    }
    expect(sim.state.truck.x).toBeGreaterThan(10);
    expect([...limits]).toEqual([classes.secondary.limit]);
  });

  test('limit signs stand where the limit changes, facing the traffic onto the new limit, and on the way in from an edge exit', () => {
    const map = build(way('secondary', [[-50, 0], [0, 0]]), way('residential', [[0, 0], [50, 0]]), way('residential', [[50, 0], [150, 0]]));
    const { along } = tables.signs;
    const side = (w) => w / 2 + pavement / 2;
    const signs = map.signs.map(({ limit, x, z, angle }) => ({ limit, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, angle: Math.round(angle * 100) / 100 }));
    // Eastwards onto the residential edge (right of +x is +z), westwards onto the secondary one, and westwards in
    // from the exit at x = 100; none at x = 50, where the limit stays the same. A plate facing -x is turned -π/2.
    expect(signs).toEqual(expect.arrayContaining([
      { limit: 30, x: along, z: side(classes.residential.width), angle: -1.57 },
      { limit: 50, x: -along, z: -side(classes.secondary.width), angle: 1.57 },
      { limit: 30, x: bounds.maxX - along, z: -side(classes.residential.width), angle: 1.57 },
    ]));
    expect(signs).toHaveLength(3);
  });
});

describe('OSM map: no spots yet', () => {
  test('asking for offers gets none', () => {
    expect(createSim(tables, build(way('residential', [[-50, 0], [50, 0]]))).requestOffers()).toEqual([]);
  });
});

describe('OSM map: reset to road', () => {
  test('puts the truck on the nearest lane, facing along it: on a two-way the right-hand one, on a one-way its own way', () => {
    const map = build(way('residential', [[-50, 0], [50, 0]]), way('residential', [[-50, 40], [50, 40]], { oneway: 'yes' }));
    const sim = createSim(tables, map);
    Object.assign(sim.state.truck, { x: 10, z: -9, heading: Math.PI / 2 + 0.2 }); // beside the two-way, roughly east
    sim.resetToRoad();
    expect(sim.state.truck.z).toBeCloseTo(classes.residential.lane); // east's right is +z
    expect(sim.state.truck.heading).toBeCloseTo(Math.PI / 2);
    Object.assign(sim.state.truck, { x: 10, z: 49, heading: -Math.PI / 2 }); // beside the one-way, facing west against it
    sim.resetToRoad();
    expect(sim.state.truck.z).toBeCloseTo(40);
    expect(sim.state.truck.heading).toBeCloseTo(Math.PI / 2);
  });
});

describe('OSM map: the real Monti extract', () => {
  const map = buildOsmMap(JSON.parse(readFileSync(`public/${tables.osm.file}`, 'utf8')), tables);

  test('builds a connected-looking network with barriers at every edge exit and lights at its one main crossing', () => {
    const exits = map.graph.nodes.filter((n) => n.exit);
    expect(map.graph.edges.length).toBeGreaterThan(200);
    expect(exits.length).toBe(map.colliders.filter((c) => c.kind === 'barrier').length);
    // Only Via Cavour and Via di Santa Maria Maggiore cross as two main streets in the extract (spec #59's rule).
    expect(new Set(map.lights.map((l) => l.junction)).size).toBe(1);
  });

  test('no building reaches into a road or its pavement, nor stands on a road', () => {
    const seg = (x, z, a, b) => {
      const [dx, dz] = [b.x - a.x, b.z - a.z];
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(a.x + t * dx - x, a.z + t * dz - z);
    };
    const into = [];
    for (const { points } of map.buildings) {
      const near = map.graph.edges.filter((e) => e.points.some((p) => points.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 150)));
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5);
        for (let k = 0; k <= n; k++) {
          const [x, z] = [a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n];
          for (const e of near) for (let j = 1; j < e.points.length; j++) if (seg(x, z, e.points[j - 1], e.points[j]) < e.width / 2 + pavement - 0.01) into.push({ x, z, edge: e.id });
        }
      });
    }
    expect(into).toEqual([]);
    const onRoad = map.graph.edges.flatMap((e) => e.points).filter((p) => map.buildings.some((b) => inside(p.x, p.z, b.points)));
    expect(onRoad).toEqual([]);
  });
});
