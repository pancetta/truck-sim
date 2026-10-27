// Minimap: the whole city from above, north up, with the spots, the truck and the Sim's current route. Reads Sim state
// each frame but redraws only at tables.minimap.rate; never writes to it. The roads are the graph's edges at their
// widths, with the main streets (tables.osm.lightClasses) named. Sizes are in units of tables.minimap.unit m.
export function createMinimap(canvas, map, tables) {
  const { palette } = tables;
  const { unit, px, truckSize, outline, routeWidth, spotRadius, labelSize, streetLabel, rate } = tables.minimap;
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  const { bounds } = map;
  canvas.style.setProperty('--size', `${((bounds.maxZ - bounds.minZ) / unit) * px}px`);
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  const bctx = base.getContext('2d');
  const labels = document.createElement('canvas');
  const lctx = labels.getContext('2d');
  let scale; // canvas px per unit
  let ratio; // devicePixelRatio the canvases are sized for
  let drawn = -Infinity; // performance.now() of the last redraw
  const at = (x, z) => [((x - bounds.minX) / unit) * scale, ((z - bounds.minZ) / unit) * scale]; // canvas px of a point

  // Sizes the canvases for the screen's pixel ratio, which changes with browser zoom or a move to another
  // screen. Roads and spot discs never change, so they're drawn once onto `base`, and the spot
  // letters, which go over the truck marker, onto `labels`.
  function resize() {
    ratio = devicePixelRatio;
    scale = px * ratio;
    [canvas.width, canvas.height] = [base.width, base.height] = [labels.width, labels.height] = at(bounds.maxX, bounds.maxZ);
    bctx.strokeStyle = hex(palette.pavement);
    bctx.lineJoin = bctx.lineCap = 'round';
    for (const e of map.graph.edges) {
      bctx.lineWidth = (e.width / unit) * scale;
      bctx.beginPath();
      for (const p of e.points) bctx.lineTo(...at(p.x, p.z));
      bctx.stroke();
    }
    nameStreets();
    bctx.fillStyle = hex(palette.spot);
    for (const s of map.spots) {
      bctx.beginPath();
      bctx.arc(...zoneCentre(s), spotRadius * scale, 0, 2 * Math.PI);
      bctx.fill();
    }
    // Outlined so the letters stay readable on the truck marker.
    lctx.font = `700 ${labelSize * scale}px system-ui, sans-serif`;
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    lctx.lineJoin = 'round';
    lctx.lineWidth = outline * scale;
    lctx.strokeStyle = hex(palette.trim);
    lctx.fillStyle = hex(palette.light);
    for (const s of map.spots) {
      const [x, y] = zoneCentre(s);
      lctx.strokeText(s.id, x, y + 0.1 * scale);
      lctx.fillText(s.id, x, y + 0.1 * scale);
    }
    ctx.lineJoin = 'round'; // resizing resets the context; the truck marker's outline needs it without a route too
    drawn = -Infinity; // resizing clears the canvas, so the next update redraws
  }
  const zoneCentre = ({ zone }) => at((zone.minX + zone.maxX) / 2, (zone.minZ + zone.maxZ) / 2);

  // Each main street's name once, along the middle of its longest edge of a main class, upright and outlined; none for
  // one with less than tables.minimap.streetLength m of main road (a square, a stub), which would only crowd the map.
  function nameStreets() {
    const longest = new Map(); // street name → its longest main edge
    const length = new Map(); // street name → m of main road
    for (const e of map.graph.edges) {
      if (!e.name || !tables.osm.lightClasses.includes(e.class)) continue;
      length.set(e.name, (length.get(e.name) ?? 0) + e.length);
      if (e.length > (longest.get(e.name)?.length ?? 0)) longest.set(e.name, e);
    }
    for (const name of longest.keys()) if (length.get(name) < tables.minimap.streetLength) longest.delete(name);
    bctx.font = `600 ${streetLabel * scale}px system-ui, sans-serif`;
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.lineJoin = 'round';
    bctx.lineWidth = outline * scale;
    bctx.strokeStyle = hex(palette.trim);
    bctx.fillStyle = hex(palette.light);
    for (const [name, e] of longest) {
      const mid = e.length / 2;
      const [a, b] = [map.graph.pointAt(e, mid - 1), map.graph.pointAt(e, mid + 1)];
      let angle = Math.atan2(b.z - a.z, b.x - a.x);
      if (Math.abs(angle) > Math.PI / 2) angle -= Math.sign(angle) * Math.PI;
      bctx.save();
      bctx.translate(...at(map.graph.pointAt(e, mid).x, map.graph.pointAt(e, mid).z));
      bctx.rotate(angle);
      bctx.strokeText(name, 0, 0);
      bctx.fillText(name, 0, 0);
      bctx.restore();
    }
  }
  resize();

  function update({ truck, order, route }) {
    if (devicePixelRatio !== ratio) resize();
    const now = performance.now();
    if (now - drawn < 1000 / rate - 2) return; // 2 ms slack, so frame jitter doesn't push a redraw a frame late
    drawn = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    const [tx, ty] = at(truck.x, truck.z);

    if (route.length) {
      ctx.strokeStyle = hex(palette[order.phase === 'pickup' ? 'pickup' : 'dropoff']);
      ctx.lineWidth = routeWidth * scale;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      for (const p of route) ctx.lineTo(...at(p.x, p.z));
      ctx.stroke();
    }

    // The truck as an arrowhead along its heading; forward is (sin, cos) in map x/z, which is canvas x/y.
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(-truck.heading);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.moveTo(0, truckSize);
    ctx.lineTo(truckSize * 0.7, -truckSize * 0.7);
    ctx.lineTo(0, -truckSize * 0.3);
    ctx.lineTo(-truckSize * 0.7, -truckSize * 0.7);
    ctx.closePath();
    ctx.fillStyle = hex(palette.truckBody);
    ctx.strokeStyle = hex(palette.trim);
    ctx.lineWidth = outline;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.drawImage(labels, 0, 0);
  }

  return { update };
}
