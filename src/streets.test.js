import { describe, it, expect } from 'vitest';
import * as tables from './tables.js';
import { way, building, build, monti as buildMonti } from './sim/fixtures.js';
import { inside } from './sim/sim.js';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, DataTexture, Scene, Vector3 } from 'three/webgpu';
import { lanternMounts, facadeProps, createStreets } from './streets.js';
import { planBuildings, facadeParts } from './buildings.js';

describe('Streets: drawn by distance', () => {
  it('lanterns as the full model near the camera, the far copy further out, none past the cull distance or out of view', async () => {
    const { near, cull } = tables.streets.lantern;
    // shortcut: a one-part box stands in for the lantern model and a pixel for every texture; enough for update().
    const lamp = new BoxGeometry();
    const loader = { loadAsync: async () => ({ scene: new Group().add(new Mesh(lamp, new MeshStandardMaterial())) }) };
    const loadTexture = async () => new DataTexture(new Uint8Array(4), 1, 1);
    const scene = new Scene();
    // A straight street along z = 0 with a row of buildings either side.
    const map = build([
      way('residential', [[-90, 0], [90, 0]]),
      building([[-80, 5], [80, 5], [80, 20], [-80, 20]]),
      building([[-80, -20], [80, -20], [80, -5], [-80, -5]]),
    ]);
    const plan = planBuildings(map, tables);
    const mounts = lanternMounts(map, plan, tables.streets.lantern, tables.buildings.bay, tables.streets.roadReach);
    const streets = createStreets(scene, map, tables, { loadTexture, loader, models: '' });
    streets.dress(plan);
    await streets.load();
    const [nearMesh, farMesh] = scene.children.filter((o) => o.geometry === lamp);
    const eye = new Vector3(mounts[0].x, 2, 0); // in the street, beside a lantern
    const distances = mounts.map((m) => Math.hypot(m.x - eye.x, m.z - eye.z));
    streets.update(eye, () => true);
    expect(nearMesh.count).toBe(distances.filter((d) => d <= near).length);
    expect(farMesh.count).toBe(distances.filter((d) => d > near && d <= cull).length);
    expect(nearMesh.count).toBeGreaterThan(0);
    expect(farMesh.count).toBeGreaterThan(nearMesh.count);
    streets.update(eye, () => false);
    expect(nearMesh.count + farMesh.count).toBe(0);
  });
});

describe('Streets on the Monti map', () => {
  const monti = buildMonti();
  const montiPlan = planBuildings(monti, tables);
  const { roadReach } = tables.streets;
  const inBuilding = (x, z) => monti.buildings.some((b) => inside(x, z, b.points));
  // m to the edge of the road nearest to (x, z) moved by (ox, oz), and whether that road lies along (ox, oz).
  const kerb = (x, z, ox, oz) => {
    const p = monti.graph.nearest(x + ox, z + oz);
    return [p.d - p.edge.width / 2, (p.x - x) * ox + (p.z - z) * oz > 0];
  };

  it('hangs lanterns on the real walls, turned out over a road in front of them', () => {
    const walls = lanternMounts(monti, montiPlan, tables.streets.lantern, tables.buildings.bay, roadReach);
    expect(walls.length).toBeGreaterThan(300);
    for (const { x, z, angle } of walls) {
      const [ox, oz] = [Math.sin(angle), Math.cos(angle)];
      expect(inBuilding(x - ox * 0.3, z - oz * 0.3), `lantern at ${x}, ${z}`).toBe(true);
      expect(inBuilding(x + ox * 0.3, z + oz * 0.3)).toBe(false);
      const [d, ahead] = kerb(x, z, ox, oz);
      expect(d).toBeLessThan(roadReach);
      expect(ahead).toBe(true);
    }
  });

  // The street sides' facade parts, by 10 m square, and those within a few metres of (x, z).
  const parts = montiPlan.flatMap((b) => b.sides.filter((s) => s.street).flatMap((s) => facadeParts(b, s, tables).map((p) => ({ ...p, ground: b.ground }))));
  const square = (x, z) => `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
  const bySquare = Map.groupBy(parts, (p) => square(p.x, p.z));
  const near = (x, z) => [-10, 0, 10].flatMap((dx) => [-10, 0, 10].flatMap((dz) => bySquare.get(square(x + dx, z + dz)) ?? []));

  it('hangs lanterns between the windows, clear of the speed signs', () => {
    for (const { x, z } of lanternMounts(monti, montiPlan, tables.streets.lantern, tables.buildings.bay, roadReach)) {
      const windows = near(x, z).filter((p) => /^(glass|louvre|shop|door|roller)/.test(p.cell));
      expect(windows.filter((p) => Math.hypot(p.x - x, p.z - z) < p.size[0] / 2 + 0.15), `lantern at ${x}, ${z}`).toEqual([]);
      for (const c of monti.signs) expect(Math.hypot(c.x - x, c.z - z)).toBeGreaterThanOrEqual(tables.streets.lantern.clear);
    }
  });

  it('stands pots in pairs beside some doors, clear of the speed signs, and flower boxes on the sills of some open windows', () => {
    const { pots, boxes } = facadeProps(monti, montiPlan, tables);
    expect(pots.length % 2).toBe(0);
    expect(pots.length / 2).toBeLessThan(parts.filter((p) => p.cell === 'door').length / 2);
    for (const { x, z } of pots) {
      expect(near(x, z).some((d) => d.cell === 'door' && Math.hypot(d.x - x, d.z - z) < 1.5)).toBe(true);
      expect(inBuilding(x, z)).toBe(false);
      for (const c of monti.signs) expect(Math.hypot(c.x - x, c.z - z)).toBeGreaterThanOrEqual(1);
    }
    // Within the window's surround: its side posts stand 0.55 m either side of the window's middle.
    expect(tables.streets.box.size[0] / 2).toBeLessThan(0.55);
    const isSill = (s) => s.cell === 'plain' && s.size[0] === 1.6 && s.size[2] === 0.28;
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.length).toBeLessThan(parts.filter(isSill).length / 2);
    for (const { x, y, z } of boxes) expect(near(x, z).some((s) => isSill(s) && Math.hypot(s.x - x, s.z - z) < 0.05 && Math.abs(s.ground + s.y + s.size[1] / 2 - y) < 1e-6)).toBe(true);
  });

  it('stands pots and props on the pavement where they are on it, and on the ground elsewhere, on the terrain', () => {
    const { pots } = facadeProps(monti, montiPlan, tables);
    expect(pots.length).toBeGreaterThan(50);
    const { height } = tables.streets.pavement;
    const scene = new Scene();
    createStreets(scene, monti, tables, { loadTexture: null, loader: null, models: '' });
    // The bins' instanced mesh: one matrix per bin, its y the ground's.
    const bins = monti.colliders.filter((c) => c.kind === 'bin');
    const [binMesh] = scene.children.filter((o) => o.userData.matrices?.length === bins.length);
    const ys = binMesh.userData.matrices.map((m) => m[13]);
    const placed = [...pots.map((p) => ['pot', p]), ...bins.map((b, i) => ['bin', { x: (b.minX + b.maxX) / 2, y: ys[i], z: (b.minZ + b.maxZ) / 2 }])];
    const roads = monti.graph.edges.filter((e) => !e.pedestrian);
    for (const [kind, { x, y, z }] of placed) {
      // A pedestrian edge is flush (#89): only a road has raised pavements.
      const p = roads.map((e) => monti.graph.project(e, x, z)).reduce((a, b) => (b.d < a.d ? b : a));
      const onPavement = p.d - p.edge.width / 2 <= tables.osm.pavement;
      expect(y - monti.heightAt(x, z), `${kind} at ${x}, ${z}`).toBeCloseTo(onPavement ? height : 0, 9);
    }
    expect(bins.filter((b, i) => Math.abs(ys[i] - monti.heightAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) - height) < 1e-9).length).toBeGreaterThan(0);
  });
});
