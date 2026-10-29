// Street events (#80), part of the headless Sim: a market or roadworks closes an edge for a while, a garbage truck stands
// in a lane. They come from their own seeded schedule (tables.events), so they don't change the traffic's or the offers'
// draws. An event is { id, kind ('market', 'roadworks' or 'garbage'), left (s until it ends) } and:
// - a closing one: `edge` (its id), `on` (whether its barriers are up) and `barriers`, two colliders across the road
//   and its pavements, `back` m out from each end junction's box. The edge counts as closed from the start (`closed`):
//   no route, AI car turn or new car goes onto it; the barriers go up once no car and not the truck is on it, while it
//   is out of the truck's view.
// - a garbage truck: `car`, the AI car (traffic.js); it ends when the car drives on or leaves.

import { outOfView } from './traffic.js';

// `traffic` is the Sim's (traffic.js), `random` the schedule's own seeded one. `version` goes up whenever the closed
// edges change, so a route can be found anew.
export function createEvents(tables, map, traffic, random) {
  const ev = tables.events;
  const { nodes, edges } = map.graph;
  const list = [];
  const closed = new Set();
  let version = 0;
  let nextId = 1;
  const lasting = ([least, most]) => least + (most - least) * random();
  let wait = lasting(ev.every);
  const viewCos = Math.cos(tables.traffic.spawnView);

  // The edges a market or roadworks may close: between two junctions (of 3+ arms, neither an edge exit), long enough,
  // with no spot or zebra crossing on it.
  const busy = new Set([...map.spots.map((s) => s.pose.edge.id), ...(map.zebras ?? []).map((z) => z.edge)]);
  const span = (e) => e.length - nodes[e.from].radius - nodes[e.to].radius - 2 * ev.back;
  const candidates = edges.filter((e) => [e.from, e.to].every((n) => nodes[n].arms.length >= 3 && !nodes[n].exit) && span(e) >= ev.minLength && !busy.has(e.id));

  // The barrier across edge e `along` m from its from node, facing along it: { kind, minX…maxZ, points }.
  function barrier(e, along) {
    const a = map.graph.pointAt(e, along);
    const b = map.graph.pointAt(e, along + 0.5);
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    const [fx, fz] = [(b.x - a.x) / l, (b.z - a.z) / l];
    const [d, w] = [ev.depth / 2, e.width / 2 + tables.osm.pavement];
    const points = [[d, w], [d, -w], [-d, -w], [-d, w]].map(([u, r]) => ({ x: a.x + fx * u - fz * r, z: a.z + fz * u + fx * r }));
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    return { kind: 'event', minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), points };
  }

  // Whether node `to` can still be reached from `from` along legal ways, past the closed edges and e.
  function reaches(from, to, e) {
    const seen = new Set([from]);
    for (const queue = [from]; queue.length; ) {
      const n = queue.pop();
      if (n === to) return true;
      for (const id of nodes[n].arms) {
        const a = edges[id];
        if (a === e || closed.has(id) || (a.oneWay && a.from !== n)) continue;
        const m = a.from === n ? a.to : a.from;
        if (!seen.has(m)) queue.push(m), seen.add(m);
      }
    }
    return false;
  }

  // Whether edge e's ends and middle are out of the truck's view.
  const unseen = (e, truck) => [0, 0.5, 1].every((u) => outOfView(map.graph.pointAt(e, u * e.length), truck, ev.hidden, viewCos));

  // An edge to close, out of the truck's view and with a way round it, at random; null for none.
  function pickEdge(truck) {
    const fits = candidates.filter((e) => {
      if (closed.has(e.id) || !traffic.closable(e) || !unseen(e, truck)) return false;
      return reaches(e.from, e.to, e) && (e.oneWay || reaches(e.to, e.from, e));
    });
    return fits.length ? fits[Math.floor(random() * fits.length)] : null;
  }

  function open(truck) {
    const kinds = Object.entries(ev.kinds);
    let u = random() * kinds.reduce((sum, [, k]) => sum + k.weight, 0);
    const [kind, k] = kinds.find(([, k]) => (u -= k.weight) < 0) ?? kinds.at(-1);
    const left = lasting(k.duration);
    if (kind === 'garbage') {
      const car = traffic.addGarbage(truck, left);
      if (car) list.push({ id: nextId++, kind, left, car });
      return;
    }
    const e = pickEdge(truck);
    if (!e) return;
    const ends = [nodes[e.from].radius + ev.back, e.length - nodes[e.to].radius - ev.back];
    list.push({ id: nextId++, kind, left, edge: e.id, on: false, barriers: ends.map((s) => barrier(e, s)) });
    closed.add(e.id);
    traffic.close(e.id);
    version++;
  }

  // Ends the events that are over, puts up the barriers of the ones whose edge is clear and out of the truck's view
  // (`clear(event)`: the truck is off it and off its barriers, the Sim's to tell), and opens one when it is time.
  function step(dt, truck, clear) {
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      x.left -= dt;
      const done = x.car ? x.car.halt <= 0 || !traffic.cars.includes(x.car) : x.left <= 0;
      if (!done) {
        if (x.edge !== undefined && !x.on) x.on = !traffic.uses(x.edge) && clear(x) && unseen(edges[x.edge], truck);
        continue;
      }
      list.splice(i, 1);
      if (x.edge === undefined) continue;
      closed.delete(x.edge);
      traffic.close(x.edge, false);
      version++;
    }
    wait -= dt;
    if (wait > 0) return;
    wait = lasting(ev.every);
    if (list.length < ev.count) open(truck);
  }

  return {
    list,
    closed,
    step,
    get version() {
      return version;
    },
  };
}
