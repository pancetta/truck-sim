import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import * as tables from '../tables.js';
import { buildOsmMap, parkedCars } from './osm.js';
import { createSim, freshProfile, inside } from './sim.js';
import { seeded } from '../autopilot.js';

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

describe('OSM map: spots', () => {
  // Tables with `spots` (and their docks and start) in place of the extract's.
  const withSpots = (spots, docks = [], start = null) => ({ ...tables, osm: { ...tables.osm, spots, docks, start } });
  const centre = ({ zone }) => ({ x: (zone.minX + zone.maxX) / 2, z: (zone.minZ + zone.maxZ) / 2 });
  // East along z = 0 two-way, and from its east end a one-way south along x = 60 to a dead end, drawn north
  // (oneway=-1: traffic runs against its points).
  const street = way('residential', [[-90, 0], [0, 0], [60, 0]], { name: 'Via Prima' });
  const oneWay = way('residential', [[60, 90], [60, 0]], { name: 'Via Seconda', oneway: '-1' });
  const spots = [
    { id: 'A', name: 'Forno Uno', street: 'Via Prima', way: street.id, at: 40, side: 'right' },
    { id: 'B', name: 'Bottega Due', street: 'Via Prima', way: street.id, at: 120, side: 'left' },
    { id: 'C', name: 'Vini Tre', street: 'Via Seconda', way: oneWay.id, at: 30, side: 'right' },
  ];
  const t = withSpots(spots, [], 'B');
  const map = buildOsmMap({ bounds, ways: [street, oneWay] }, t);

  test('stand on their street at their distance along the way, on the kerb lane of their side (a one-way: its own)', () => {
    const { lane } = classes.residential;
    expect(map.spots.map((s) => [s.id, s.name, s.street])).toEqual([['A', 'Forno Uno', 'Via Prima'], ['B', 'Bottega Due', 'Via Prima'], ['C', 'Vini Tre', 'Via Seconda']]);
    expect(centre(map.spots[0])).toEqual({ x: -50, z: lane }); // east's right is +z
    expect(centre(map.spots[1])).toEqual({ x: 30, z: -lane });
    expect(centre(map.spots[2])).toEqual({ x: 60, z: 60 });
    for (const s of map.spots) expect(s.zone.maxX - s.zone.minX).toBe(tables.osm.zone);
    expect(map.spots.map((s) => s.pose.edge.name)).toEqual(['Via Prima', 'Via Prima', 'Via Seconda']);
  });

  test("a spot's street must be its way's name", () => {
    expect(() => buildOsmMap({ bounds, ways: [street] }, withSpots([{ ...spots[0], street: 'Via Sbagliata' }]))).toThrow(/Via Prima, not Via Sbagliata/);
  });

  test('a new game starts on the start spot, in its kerb lane facing along it', () => {
    const { truck, street: on } = createSim(t, map).state;
    expect(on).toBe('Via Prima'); // the HUD's street name
    expect(truck.x).toBeCloseTo(30);
    expect(truck.z).toBeCloseTo(-classes.residential.lane);
    expect(truck.heading).toBeCloseTo(-Math.PI / 2); // B is left of the way, in the westbound lane
    const onOneWay = createSim(withSpots(spots, [], 'C'), buildOsmMap({ bounds, ways: [street, oneWay] }, withSpots(spots, [], 'C'))).state.truck;
    expect(onOneWay.heading).toBeCloseTo(0); // south (+z), the way the one-way runs, against its points
  });

  test('offers pay by the legal route length between their spots', () => {
    const sim = createSim(t, map, seeded(1));
    const offers = sim.requestOffers();
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      const [from, to] = [o.pickup, o.dropoff].map((id) => map.spots.find((s) => s.id === id));
      expect(o.distance).toBeCloseTo(map.graph.route(from.pose, to.pose).length);
      expect(o.pay).toBe(Math.round(tables.orders.basePay + (tables.orders.payPerKm * o.distance) / 1000));
    }
    // C is down the one-way, which leads away from Via Prima: there's no way back, so no offer from it.
    expect(offers.some((o) => o.pickup === 'C')).toBe(false);
  });

  test("a dock's zone is where a truck reversed into its bay stands, and its dock edge stops a truck backing past it", () => {
    // A dead end north off Via Prima, its dock edge 20 m up, the bay facing south, out to the street.
    const dead = way('service', [[-40, 0], [-40, -40]], { name: 'Vicolo' });
    const docks = withSpots([{ id: 'D', name: 'Magazzino', street: 'Vicolo', way: dead.id, at: 10, side: 'right', bay: [-40, -20, 0] }], ['D']);
    const dockMap = buildOsmMap({ bounds, ways: [street, dead] }, docks);
    const [d] = dockMap.spots;
    expect(d.dock).toBe(true);
    expect(d.bay).toEqual({ x: -40, z: -20, heading: 0 });
    expect(centre(d)).toEqual({ x: -40, z: -20 + tables.vehicle.length / 2 });
    // Backing north up the bay, heading south: stopped with its rear at the dock edge.
    const sim = createSim(docks, dockMap);
    Object.assign(sim.state.truck, { x: -40, z: -10, heading: 0, speed: -2 });
    for (let i = 0; i < 300 && !sim.state.collision; i++) sim.step(1 / 60, { steer: 0, gas: 0, brake: 1 });
    expect(sim.state.collision).toBe(true);
    expect(sim.state.truck.z - tables.vehicle.length / 2).toBeCloseTo(-20, 0);
  });

  test("parked cars keep clear of a dock's street ends", () => {
    const dead = way('residential', [[0, 0], [0, -60]], { name: 'Vicolo', oneway: 'yes' });
    const parkedWith = (spots, docks) => buildOsmMap({ bounds, ways: [way('residential', [[-90, 0], [0, 0], [90, 0]], { oneway: 'yes' }), dead] }, withSpots(spots, docks)).colliders.filter((c) => c.kind === 'car');
    const dock = [{ id: 'D', name: 'Magazzino', street: 'Vicolo', way: dead.id, at: 10, side: 'right', bay: [0, -60, 180] }];
    const near = (cars) => cars.filter((c) => Math.hypot((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) < tables.osm.parked.dock);
    expect(near(parkedWith([], []))).not.toEqual([]);
    expect(near(parkedWith(dock, ['D']))).toEqual([]);
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

describe('OSM map: street furniture', () => {
  test('trees, bollards, fountains and waste baskets stand where OSM puts them, as solid props, but none reaching into the road', () => {
    const node = (x, z, tags) => ({ x, z, tags });
    const map = buildOsmMap({ bounds, ways: [way('residential', [[-50, 0], [50, 0]])] }, tables, {
      nodes: [
        node(10, 6, { natural: 'tree' }),
        node(-10, -6, { barrier: 'bollard' }),
        node(20, 7, { amenity: 'drinking_water' }),
        node(-20, 30, { amenity: 'waste_basket' }),
        node(0, 3, { natural: 'tree' }), // on the road, 7 m wide
        node(5, 3.6, { natural: 'tree' }), // its trunk over the kerb
        node(30, 6, { amenity: 'bench' }), // not one of ours
      ],
    });
    const props = map.colliders.filter((c) => ['tree', 'bollard', 'fountain', 'bin'].includes(c.kind));
    expect(props.map((c) => [c.kind, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2])).toEqual([['tree', 10, 6], ['bollard', -10, -6], ['fountain', 20, 7], ['bin', -20, 30]]);
    expect(driveFrom(map, 10, 14, Math.PI).collision).toBe(true); // north from behind the tree, into it
  });
});

describe('OSM map: traffic (#63)', () => {
  // Tables with `traffic` AI cars and no police, the traffic tables changed by `changes`.
  const withCars = (traffic, changes = {}) => ({
    ...tables,
    police: { ...tables.police, count: 0 },
    rank: { ...tables.rank, tiers: tables.rank.tiers.map((t) => ({ ...t, traffic })) },
    traffic: { ...tables.traffic, ...changes },
  });
  const IDLE = { steer: 0, gas: 0, brake: 0 };
  const car = tables.city.obstacles.car;

  test('AI cars come in at an edge exit, half a m past its barrier, and leave at the other half a m before reaching it', () => {
    const t = withCars(1, { exitSpawn: 1, spawnDistance: [0, 500], despawnDistance: 600 });
    const map = buildOsmMap({ bounds, ways: [way('residential', [[-150, 0], [150, 0]])] }, t);
    const sim = createSim(t, map, seeded(1));
    Object.assign(sim.state.truck, { x: 0, z: 60, heading: 0, speed: 0 }); // off the road
    sim.step(1 / 60, IDLE);
    const [first] = sim.state.traffic;
    const start = first.x;
    const inner = bounds.maxX - 1.5 * tables.osm.barrier; // the barriers' map-side faces
    expect(inner - Math.abs(start) - car.length / 2).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(inner - Math.abs(start) - car.length / 2).toBeLessThan(0.75); // found in 0.25 m steps
    let last = start;
    for (let s = 0; s < 60 && sim.state.traffic.includes(first); s += 1 / 60) {
      last = first.x;
      sim.step(1 / 60, IDLE);
    }
    expect(sim.state.traffic.includes(first)).toBe(false);
    expect(Math.sign(last)).toBe(-Math.sign(start)); // gone at the far end
    expect(inner - Math.abs(last) - car.length / 2).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(inner - Math.abs(last) - car.length / 2).toBeLessThan(1); // 0.25 m steps, and a step's driving
  });

  test("AI cars cruise at the limit of the edge they are on and are down to the next edge's by the time they reach it", () => {
    const t = withCars(0, { despawnDistance: 1000 });
    const wide = { minX: -300, minZ: -100, maxX: 100, maxZ: 100 };
    const map = buildOsmMap({ bounds: wide, ways: [way('secondary', [[-250, 0], [0, 0]]), way('residential', [[0, 0], [90, 0]])] }, t);
    const sim = createSim(t, map, seeded(1));
    Object.assign(sim.state.truck, { x: 0, z: 60, heading: 0, speed: 0 });
    const run = map.graph.paths.find((p) => p.kind === 'run' && p.edge.class === 'secondary' && p.startDir.x > 0);
    const turn = run.next.find((p) => p.out.edge.class === 'residential');
    sim.state.traffic.push({ id: 1, x: 0, z: 0, heading: 0, speed: 0, lane: run, route: [run, turn, turn.out], s: 0, police: false });
    const [ai] = sim.state.traffic;
    let fast = 0;
    let atTurn = null;
    for (let s = 0; s < 40 && ai.lane !== turn.out; s += 1 / 60) {
      sim.step(1 / 60, IDLE);
      if (ai.lane === run && run.length - ai.s > 40) fast = Math.max(fast, ai.speed);
      if (atTurn === null && ai.lane === run && run.length - ai.s <= car.length / 2) atTurn = ai.speed;
    }
    expect(fast).toBeCloseTo(classes.secondary.limit / 3.6, 5);
    expect(atTurn).toBeLessThan(classes.residential.limit / 3.6 + 0.1); // a step late at most
    for (let s = 0; s < 5; s += 1 / 60) sim.step(1 / 60, IDLE);
    expect(ai.speed).toBeCloseTo(classes.residential.limit / 3.6, 5);
  });

  test('the junction rule hint: right before left at a crossing, the light at a light junction, none off the road', () => {
    const t = withCars(0);
    const crossing = buildOsmMap({ bounds, ways: [way('residential', [[-90, 0], [0, 0], [90, 0]]), way('residential', [[0, -90], [0, 0], [0, 90]])] }, t);
    const lit = buildOsmMap({ bounds, ways: [way('secondary', [[-90, 0], [0, 0], [90, 0]], { name: 'Via A' }), way('secondary', [[0, -90], [0, 0], [0, 90]], { name: 'Via B' })] }, t);
    // The rule the truck sees standing at (x, z), facing east.
    const rule = (map, x, z) => {
      const sim = createSim(t, map, seeded(1));
      Object.assign(sim.state.truck, { x, z, heading: Math.PI / 2, speed: 0 });
      sim.step(1 / 60, IDLE);
      return sim.state.junctionRule;
    };
    expect(rule(crossing, -40, -classes.residential.lane)).toBe('rightBeforeLeft');
    expect(rule(lit, -40, -classes.secondary.lane)).toBe('light');
    expect(rule(crossing, -40, -40)).toBe(null); // no edge within a cell
  });

  test('the red-light fine carries over: over the line and into the light junction on red while police watch', () => {
    const t = { ...withCars(0), police: { ...tables.police, count: 0, radius: 500 } };
    const map = buildOsmMap({ bounds, ways: [way('secondary', [[-90, 0], [0, 0], [90, 0]], { name: 'Via A' }), way('secondary', [[0, -90], [0, 0], [0, 90]], { name: 'Via B' })] }, t);
    const sim = createSim(t, map, seeded(1), { ...freshProfile(), money: 500 });
    const light = sim.state.lights.find((l) => l.dx === 1);
    // Standing 3 m before the eastbound stop line until its light has been red past the grace.
    Object.assign(sim.state.truck, { x: light.x - 3 - tables.vehicle.length / 2, z: light.z, heading: Math.PI / 2, speed: 0 });
    let red = 0;
    for (let s = 0; s < 60 && red < tables.lights.redGrace + 0.5; s += 1 / 60) {
      sim.step(1 / 60, IDLE);
      red = light.phase === 'red' ? red + 1 / 60 : 0;
    }
    // A police car on the same street behind it, then full gas through the junction.
    const run = map.graph.paths.find((p) => p.kind === 'run' && p.startDir.x > 0 && p.from !== p.to && p.prims[0].x < -50);
    sim.state.traffic.push({ id: 99, x: 0, z: 0, heading: 0, speed: 0, lane: run, route: [run], s: 0, police: true });
    for (let s = 0; s < 10 && sim.state.truck.x < 20; s += 1 / 60) sim.step(1 / 60, { steer: 0, gas: 1, brake: 0 });
    expect(sim.state.lastFine).toEqual({ reason: 'redLight', amount: tables.fines.redLight });
  });

  describe('speeding', () => {
    const t = { ...withCars(0), police: { ...tables.police, count: 0, radius: 500 }, speeding: { ...tables.speeding, cooldown: 2 } };
    // A long two-way residential street (30 km/h) and, behind a row of buildings, a parallel one; a police car standing
    // at the west end of either, eastbound, when added; the truck westbound at a set speed, put back at the same place
    // every step so it stays in range.
    const long = { minX: -300, minZ: -100, maxX: 300, maxZ: 100 };
    const map = buildOsmMap({ bounds: long, ways: [
      way('residential', [[-280, 0], [280, 0]]),
      way('residential', [[-280, 60], [280, 60]]),
      building([[-250, 15], [250, 15], [250, 45], [-250, 45]]),
    ] }, t);
    const money = 500;

    // The fines taken while the truck drives `kmh` for `seconds`, with the police car on the street at z = `street`.
    function fines(kmh, seconds, street = 0) {
      const sim = createSim(t, map, seeded(1), { ...freshProfile(), money });
      const run = map.graph.paths.find((p) => p.kind === 'run' && p.startDir.x > 0 && Math.abs(p.prims[0].z - street) < 5);
      sim.state.traffic.push({ id: 99, x: 0, z: 0, heading: 0, speed: 0, lane: run, route: [run], s: 0, police: true });
      const pose = { x: 0, z: classes.residential.lane, heading: -Math.PI / 2 };
      let count = 0;
      for (let s = 0; s < seconds; s += 1 / 60) {
        Object.assign(sim.state.truck, pose, { speed: kmh / 3.6 });
        const before = sim.state.lastFine;
        sim.step(1 / 60, IDLE);
        if (sim.state.lastFine !== before) count++;
      }
      expect(sim.state.speedLimit).toBe(classes.residential.limit);
      return { count, reason: sim.state.lastFine?.reason, money: sim.state.profile.money };
    }
    const over = classes.residential.limit + tables.speeding.tolerance;

    test('over the limit by more than the tolerance while a police car sees it: fined', () => {
      expect(fines(over + 2, 1)).toEqual({ count: 1, reason: 'speeding', money: money - tables.fines.speeding });
    });

    test('within the tolerance, or unseen behind the buildings: not fined', () => {
      expect(fines(over - 1, 1).count).toBe(0);
      expect(fines(over + 20, 1, 60).count).toBe(0);
    });

    test('one fine per cooldown, however long the speeding lasts', () => {
      expect(fines(over + 2, 1.9).count).toBe(1);
      expect(fines(over + 2, 2.1).count).toBe(2);
      expect(fines(over + 2, 4.1).count).toBe(3);
    });
  });

  describe('parked cars', () => {
    const t = { ...tables, osm: { ...tables.osm, parked: { ...tables.osm.parked, density: 1 } } };
    const { junction, kerb, spot } = t.osm.parked;
    // A one-way residential street east across a two-way one at x = 0, a two-way residential and a one-way service
    // street further south.
    const map = buildOsmMap({ bounds, ways: [
      way('residential', [[-90, 0], [0, 0], [90, 0]], { oneway: 'yes' }),
      way('residential', [[0, -90], [0, 0], [0, 40]]),
      way('residential', [[-90, 60], [90, 60]]),
      way('service', [[-90, 80], [90, 80]], { oneway: 'yes' }),
    ] }, t);
    const parked = map.colliders.filter((c) => c.kind === 'car');
    const centre = (c) => ({ x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2 });

    test('line one kerb of the one-way residential street only, clear of its lane and of the junction', () => {
      expect(parked.length).toBeGreaterThan(15);
      const crossing = map.graph.nodes.find((n) => n.arms.length === 4);
      const clear = car.width / 2 + tables.traffic.sideGap;
      for (const c of parked.map(centre)) {
        expect(c.z).toBeCloseTo(-(classes.residential.width / 2 - kerb - car.width / 2) * Math.sign(-c.z || 1), 5);
        expect(Math.abs(c.z) - car.width / 2).toBeGreaterThanOrEqual(clear - 1e-9); // its lane runs on the centre line
        expect(Math.abs(c.x - crossing.x) - car.length / 2).toBeGreaterThanOrEqual(crossing.radius + junction - 1e-9);
      }
      for (const side of [-1, 1]) expect(new Set(parked.filter((c) => Math.sign(centre(c).x) === side).map((c) => Math.sign(centre(c).z))).size).toBe(1); // one kerb per edge
      expect(parked.every((c) => c.heading === Math.PI / 2)).toBe(true); // facing the traffic's way, east
    });

    test('keep clear of a spot zone', () => {
      const zone = { minX: 30, maxX: 44, minZ: -3.5, maxZ: 3.5 };
      const near = (c) => c.minX < zone.maxX + spot && c.maxX > zone.minX - spot;
      expect(parked.some(near)).toBe(true);
      expect(parkedCars(map.graph, [{ zone }], t).filter((c) => near(c) && c.maxZ > -10 && c.minZ < 10)).toEqual([]);
    });

    test('are solid: the truck driving along the kerb stops at one', () => {
      const first = parked.map(centre).sort((a, b) => a.x - b.x)[0];
      const state = driveFrom(map, first.x - 20, first.z, Math.PI / 2);
      expect(state.collision).toBe(true);
      expect(state.truck.x + tables.vehicle.length / 2).toBeCloseTo(first.x - car.length / 2, 0);
    });
  });
});

describe('OSM map: the real Monti extract', () => {
  const read = (file) => JSON.parse(readFileSync(`public/${file}`, 'utf8'));
  const map = buildOsmMap(read(tables.osm.file), tables, read(tables.osm.furniture));

  test('builds a connected-looking network with barriers at every edge exit and lights at its one main crossing', () => {
    const exits = map.graph.nodes.filter((n) => n.exit);
    expect(map.graph.edges.length).toBeGreaterThan(200);
    expect(exits.length).toBe(map.colliders.filter((c) => c.kind === 'barrier').length);
    // Only Via Cavour and Via di Santa Maria Maggiore cross as two main streets in the extract (spec #59's rule).
    expect(new Set(map.lights.map((l) => l.junction)).size).toBe(1);
  });

  // m from (x, z) to the segment from a to b.
  const segment = (x, z, a, b) => {
    const [dx, dz] = [b.x - a.x, b.z - a.z];
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(a.x + t * dx - x, a.z + t * dz - z);
  };

  test('no building reaches into a road or its pavement, nor stands on a road', () => {
    const into = [];
    for (const { points } of map.buildings) {
      const near = map.graph.edges.filter((e) => e.points.some((p) => points.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 150)));
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5);
        for (let k = 0; k <= n; k++) {
          const [x, z] = [a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n];
          for (const e of near) for (let j = 1; j < e.points.length; j++) if (segment(x, z, e.points[j - 1], e.points[j]) < e.width / 2 + pavement - 0.01) into.push({ x, z, edge: e.id });
        }
      });
    }
    expect(into).toEqual([]);
    const onRoad = map.graph.edges.flatMap((e) => e.points).filter((p) => map.buildings.some((b) => inside(p.x, p.z, b.points)));
    expect(onRoad).toEqual([]);
  });

  test('places every spot of the spot table on its street, each reachable from every other by the legal routes', () => {
    expect(map.spots.map((s) => s.id)).toEqual(tables.osm.spots.map((s) => s.id));
    expect(map.spots.filter((s) => s.dock).map((s) => s.id)).toEqual(tables.osm.docks);
    for (const s of map.spots) {
      expect(s.street).toBe(tables.osm.spots.find((t) => t.id === s.id).street);
      if (!s.dock) expect(s.pose.edge.name).toBe(s.street); // a dock's zone may be down a lane off it
      for (const to of map.spots) if (to !== s) expect(map.graph.route(s.pose, to.pose), `${s.id} → ${to.id}`).not.toBe(null);
    }
    expect(map.start).toMatchObject({ x: expect.any(Number), z: expect.any(Number), heading: expect.any(Number) });
  });

  test('puts most of OSM\'s street furniture in, and none of it reaching into a road', () => {
    const props = map.colliders.filter((c) => ['tree', 'bollard', 'fountain', 'bin'].includes(c.kind));
    expect(props.length).toBeGreaterThan(0.8 * read(tables.osm.furniture).nodes.length);
    const onRoad = ({ minX, maxX, minZ, maxZ }) => {
      const [x, z] = [(minX + maxX) / 2, (minZ + maxZ) / 2];
      return map.graph.edges.some((e) => e.points.some((b, k) => k && segment(x, z, e.points[k - 1], b) <= e.width / 2 + (maxX - minX) / 2));
    };
    expect(props.filter(onRoad)).toEqual([]);
  });
});
