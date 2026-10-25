// Minimap: the whole city from above, north up (map row 0 at the top), with the spots, the truck and
// the Sim's current route. Reads Sim state each frame; never writes to it.
export function createMinimap(canvas, map, tables) {
  const { palette } = tables;
  const { tile, truckSize, outline, routeWidth, spotRadius, labelSize } = tables.minimap;
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  const scale = tile * devicePixelRatio; // canvas px per map tile
  canvas.width = map.cols * scale;
  canvas.height = map.rows * scale;
  canvas.style.setProperty('--size', `${map.rows * tile}px`);
  const ctx = canvas.getContext('2d');
  const centre = (t) => [(t.col + 0.5) * scale, (t.row + 0.5) * scale];

  // Roads and spots never change, so they're drawn once and copied in each frame.
  const base = document.createElement('canvas');
  [base.width, base.height] = [canvas.width, canvas.height];
  const bctx = base.getContext('2d');
  bctx.fillStyle = hex(palette.pavement);
  for (const { col, row } of map.roads) bctx.fillRect(col * scale, row * scale, scale, scale);
  bctx.font = `700 ${labelSize * scale}px system-ui, sans-serif`;
  bctx.textAlign = 'center';
  bctx.textBaseline = 'middle';
  for (const s of map.spots) {
    const [x, y] = centre(s.zoneTile);
    bctx.fillStyle = hex(palette.spot);
    bctx.beginPath();
    bctx.arc(x, y, spotRadius * scale, 0, 2 * Math.PI);
    bctx.fill();
    bctx.fillStyle = hex(palette.light);
    bctx.fillText(s.id, x, y + 0.1 * scale);
  }

  function update({ truck, order, route }) {
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
  }

  return { update };
}
