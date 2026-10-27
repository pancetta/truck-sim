// An OSM map (?map=monti) drawn plain until it gets the realistic look (#65): road surfaces along the road graph's
// edges, and buildings as tinted blocks on their (cut-back) outlines.
import * as THREE from 'three/webgpu';

const { ShapeUtils } = THREE;

// The road surface at height y: a quad per edge segment and a disc per point, half the edge's width round its centre
// line, and a disc on each node as wide as its widest arm, so bends and junctions are closed. Faces up; no UVs.
export function roadSurface(graph, y) {
  const pos = [];
  // Counter-clockwise seen from above (+y), so the face points up.
  const tri = (a, b, c) => pos.push(a.x, y, a.z, ...((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0 ? [b.x, y, b.z, c.x, y, c.z] : [c.x, y, c.z, b.x, y, b.z]));
  const disc = (c, r) => {
    for (let k = 0; k < 12; k++) {
      const [a, b] = [k, k + 1].map((s) => ({ x: c.x + Math.cos((s * Math.PI) / 6) * r, z: c.z + Math.sin((s * Math.PI) / 6) * r }));
      tri(c, a, b);
    }
  };
  for (const e of graph.edges) {
    const w = e.width / 2;
    e.points.forEach((p, k) => {
      disc(p, w);
      const q = e.points[k + 1];
      const l = q && Math.hypot(q.x - p.x, q.z - p.z);
      if (!l) return;
      const [nx, nz] = [(-(q.z - p.z) / l) * w, ((q.x - p.x) / l) * w];
      const [a, b, c, d] = [{ x: p.x + nx, z: p.z + nz }, { x: q.x + nx, z: q.z + nz }, { x: q.x - nx, z: q.z - nz }, { x: p.x - nx, z: p.z - nz }];
      tri(a, b, c);
      tri(a, c, d);
    });
  }
  for (const n of graph.nodes) disc(n, Math.max(...n.arms.map((id) => graph.edges[id].width / 2)));
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Walls and a flat roof per building ({ points, height }), in one of `tints` picked by its place, the roof darker.
export function plainBuildings(buildings, tints) {
  const pos = [];
  const col = [];
  const put = (colour, ...corners) => {
    for (const [x, y, z] of corners) pos.push(x, y, z), col.push(colour.r, colour.g, colour.b);
  };
  for (const { points, height } of buildings) {
    const wall = new THREE.Color(tints[Math.floor(Math.abs(Math.sin(points[0].x * 12.9898 + points[0].z * 78.233)) * 9973) % tints.length]);
    // Walls face out: walking an outline that is clockwise in x/z (ShapeUtils' sense), the outside is on the left.
    const ring = ShapeUtils.isClockWise(points.map((p) => new THREE.Vector2(p.x, p.z))) ? points : points.toReversed();
    ring.forEach((p, k) => {
      const q = ring[(k + 1) % ring.length];
      put(wall, [p.x, 0, p.z], [q.x, 0, q.z], [q.x, height, q.z], [p.x, 0, p.z], [q.x, height, q.z], [p.x, height, p.z]);
    });
    const roof = wall.clone().multiplyScalar(0.75);
    for (const [a, b, d] of ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.z)), [])) {
      const [p, q, r] = [ring[a], ring[b], ring[d]];
      const up = (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z) > 0;
      put(roof, [p.x, height, p.z], ...(up ? [[q.x, height, q.z], [r.x, height, r.z]] : [[r.x, height, r.z], [q.x, height, q.z]]));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.computeVertexNormals();
  return geometry;
}
