// Minimap: the whole city from above, north up (map row 0 at the top), with the spots, the truck and
// the Sim's current route. Reads Sim state each frame; never writes to it.
export function createMinimap(canvas, map, tables) {
  const { palette } = tables;
  const { tile, truckSize, outline, routeWidth, spotRadius, labelSize } = tables.minimap;
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  canvas.style.setProperty('--size', `${map.rows * tile}px`);
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  const bctx = base.getContext('2d');
  let scale; // canvas px per map tile
  let ratio; // devicePixelRatio the canvases are sized for
  const centre = (t) => [(t.col + 0.5) * scale, (t.row + 0.5) * scale];

  // Sizes both canvases for the screen's pixel ratio, which changes with browser zoom or a move to
  // another screen. Roads, open ground and spot discs never change, so they're drawn once onto `base`.
  function resize() {
    ratio = devicePixelRatio;
    scale = tile * ratio;
    [canvas.width, canvas.height] = [base.width, base.height] = [map.cols * scale, map.rows * scale];
    bctx.fillStyle = hex(palette.ground);
    for (const { col, row } of map.open) bctx.fillRect(col * scale, row * scale, scale, scale);
    bctx.fillStyle = hex(palette.pavement);
    for (const { col, row } of map.roads) bctx.fillRect(col * scale, row * scale, scale, scale);
    bctx.fillStyle = hex(palette.spot);
    for (const s of map.spots) {
      bctx.beginPath();
      bctx.arc(...centre(s.zoneTile), spotRadius * scale, 0, 2 * Math.PI);
      bctx.fill();
    }
    // Resizing resets the context, so the label style is set again.
    ctx.font = `700 ${labelSize * scale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
  }
  resize();

  function update({ truck, order, route }) {
    if (devicePixelRatio !== ratio) resize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    const [tx, ty] = [(truck.x / map.tileSize) * scale, (truck.z / map.tileSize) * scale];

    if (route.length) {
      ctx.strokeStyle = hex(palette[order.phase === 'pickup' ? 'pickup' : 'dropoff']);
      ctx.lineWidth = routeWidth * scale;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      // Off the road the truck isn't on the route's first tile, so the line goes through it.
      const onStart = Math.floor(truck.x / map.tileSize) === route[0].col && Math.floor(truck.z / map.tileSize) === route[0].row;
      for (const t of route.slice(onStart ? 1 : 0)) ctx.lineTo(...centre(t));
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

    // Spot letters go over the truck marker, outlined so they stay readable on it.
    ctx.lineWidth = outline * scale;
    ctx.strokeStyle = hex(palette.trim);
    ctx.fillStyle = hex(palette.light);
    for (const s of map.spots) {
      const [x, y] = centre(s.zoneTile);
      ctx.strokeText(s.id, x, y + 0.1 * scale);
      ctx.fillText(s.id, x, y + 0.1 * scale);
    }
  }

  return { update };
}
