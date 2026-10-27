import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clockText, kmText, playedText } from './hud.js';

// The cab interior, our own design, in truck space as in truckLook.js (metres, +z forward, +x towards the driver's
// (left) side, y up): dashboard with the instrument cluster, windscreen pillars, doors, headliner, passenger seat and
// the steering wheel. The renderer shows it only in the cab view, where the kit's cab isn't drawn, so the driver
// sees out between the pillars.
// Low, so the road shows over it; its top carries the cab gimmick (truckLook PIVOT).
const DASH = { top: 1.5, back: 2.155, front: 2.9, side: 1.17 };
// Headliner. Above the kit's cab roof (2.33 m), which no view shows together with the interior: a lower one would
// fill the top of the view.
const ROOF = 2.4;
const SCREEN = { top: 2.85, sill: 1.65 }; // windscreen z under the roof (it meets the dash's front); door sill height
// The cluster rises from the dash, facing the driver's eye, above the wheel's rim. Between the dials: the gear, and under
// it a display with the total distance, the clock and the time played, its foot just clear of the wheel's rim (the rim
// hides the strip under the dials). The small fuel dial is right of the RPM dial, the small energy dial left of the
// speedometer (`small`: their radius and x either side).
const CLUSTER = {
  centre: [0.55, 1.59, 2.36],
  width: 0.54,
  height: 0.16,
  dial: 0.068,
  dialX: 0.13,
  small: { dial: 0.042, x: 0.22 },
  gear: { size: [0.05, 0.034], y: 0.05 },
  info: { size: [0.11, 0.056], y: -0.002 },
};
const PX = 1650; // cluster texture pixels per metre

// The needle's turn (rotation.z, rad, anticlockwise) for `value` on a dial from 0 to `max` that sweeps `sweep` rad
// clockwise, from lower left through the top; pinned at both ends.
export function dialAngle(value, max, sweep) {
  return sweep / 2 - THREE.MathUtils.clamp(value / max, 0, 1) * sweep;
}

// One dial at (x, y) canvas px, radius r px: ticks every `minor`, numbers every `major` (shown divided by `unit`, or as
// `text` gives them), red from red[0] to red[1] if given, and the unit label under the centre.
function drawDial(ctx, x, y, r, { max, major, minor, unit = 1, text = (v) => String(v / unit), red, label }, sweep) {
  const point = (value, radius) => {
    const a = dialAngle(value, max, sweep);
    return [x - Math.sin(a) * radius, y - Math.cos(a) * radius];
  };
  ctx.fillStyle = '#0b0c10';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
  if (red) {
    // Canvas angles run clockwise from +x; a needle turn a points at -π/2 - a.
    ctx.strokeStyle = '#d1495b';
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.86, -Math.PI / 2 - dialAngle(red[0], max, sweep), -Math.PI / 2 - dialAngle(red[1], max, sweep));
    ctx.stroke();
  }
  ctx.strokeStyle = ctx.fillStyle = '#f2f2f2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(r * 0.19)}px system-ui, sans-serif`;
  for (let v = 0; v <= max; v += minor) {
    const isMajor = v % major === 0;
    ctx.lineWidth = isMajor ? r * 0.035 : r * 0.018;
    ctx.beginPath();
    ctx.moveTo(...point(v, r * 0.92));
    ctx.lineTo(...point(v, isMajor ? r * 0.76 : r * 0.83));
    ctx.stroke();
    if (isMajor) ctx.fillText(text(v), ...point(v, r * 0.6));
  }
  ctx.font = `${Math.round(r * 0.13)}px system-ui, sans-serif`;
  ctx.fillText(label, x, y + r * 0.45);
}

function material(color, roughness) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

// A thin bar from point a to point b (truck space), `w` × `d` across.
function strut(a, b, w, d) {
  const [from, to] = [new THREE.Vector3(...a), new THREE.Vector3(...b)];
  const g = new THREE.BoxGeometry(w, from.distanceTo(to), d);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
  return g.translate(...from.add(to).multiplyScalar(0.5).toArray());
}

// The interior group, and update() to set the wheel turn (degrees, positive clockwise from the seat) and the
// instruments from the Sim's state.
export function createCab(tables, strings) {
  const { palette, camera, vehicle, cab, fuel, energy } = tables;
  const sweep = THREE.MathUtils.degToRad(cab.sweep);
  const rpmMax = vehicle.torqueCurve.at(-1)[0];
  const dash = material(palette.dashboard, 0.75);
  const trim = material(palette.trim, 0.8);
  const interior = new THREE.Group();

  // Dashboard, padded top edge, doors with their sills, pillars and roof rails; the passenger seat.
  const { top, back, front, side } = DASH;
  const across = 2 * side;
  interior.add(
    new THREE.Mesh(
      mergeGeometries([
        new THREE.BoxGeometry(across, top - 1.1, front - back).translate(0, (top + 1.1) / 2, (front + back) / 2),
        new THREE.CylinderGeometry(0.05, 0.05, across, 12).rotateZ(Math.PI / 2).translate(0, top - 0.03, back + 0.03), // padded edge
      ]),
      dash,
    ),
    new THREE.Mesh(
      mergeGeometries([
        ...[side, -side].flatMap((x) => [
          new THREE.BoxGeometry(0.06, SCREEN.sill - 0.95, front - 0.9).translate(x, (SCREEN.sill + 0.95) / 2, (front + 0.9) / 2),
          new THREE.CylinderGeometry(0.025, 0.025, front - 0.9, 8).rotateX(Math.PI / 2).translate(x * 0.98, SCREEN.sill, (front + 0.9) / 2),
          strut([x * 0.98, top, front], [x * 0.96, ROOF, SCREEN.top], 0.09, 0.07), // A-pillar
          new THREE.BoxGeometry(0.1, 0.06, SCREEN.top - 0.9).translate(x * 0.97, ROOF - 0.03, (SCREEN.top + 0.9) / 2),
        ]),
        new THREE.BoxGeometry(across, 0.05, 0.06).translate(0, ROOF - 0.025, SCREEN.top), // windscreen header
        new THREE.BoxGeometry(0.52, 0.14, 0.5).translate(-0.6, 1.28, 1.7), // passenger seat cushion
        new THREE.BoxGeometry(0.52, 0.7, 0.12).rotateX(-0.15).translate(-0.6, 1.66, 1.38), // and back
      ]),
      trim,
    ),
    new THREE.Mesh(new THREE.BoxGeometry(across, 0.03, SCREEN.top - 0.9).translate(0, ROOF + 0.015, (SCREEN.top + 0.9) / 2), material(palette.headliner, 0.9)),
  );

  // Instrument cluster: one texture for the dial faces, drawn once; needles turn over it, and two small displays
  // between the dials, the gear and the info display, are redrawn when what they show changes.
  const { width, height, dial, dialX, small } = CLUSTER;
  const quarter = (v) => ['0', '½', '1'][v / 2];
  const face = document.createElement('canvas');
  [face.width, face.height] = [Math.round(width * PX), Math.round(height * PX)];
  const ctx = face.getContext('2d');
  ctx.fillStyle = '#16181d';
  ctx.fillRect(0, 0, face.width, face.height);
  // The fuel dial in quarters of the tank, marked empty, half and full, red below tables.fuel.low; the energy dial
  // likewise, red below tables.energy.tired.
  const dials = [
    { x: -dialX, r: dial, max: cab.speedMax, major: 20, minor: 10, label: strings.kmh },
    { x: dialX, r: dial, max: rpmMax, major: 500, minor: 100, unit: 100, red: [vehicle.upshiftRpm, rpmMax], label: strings.rpmScale },
    { x: small.x, r: small.dial, max: 4, major: 2, minor: 1, text: quarter, red: [0, 4 * fuel.low], label: strings.fuel },
    { x: -small.x, r: small.dial, max: 4, major: 2, minor: 1, text: quarter, red: [0, 4 * energy.tired], label: strings.energy },
  ];
  for (const d of dials) drawDial(ctx, (width / 2 + d.x) * PX, face.height / 2, d.r * PX, d, sweep);
  // Lit from behind: brighter than white, so they read as lit after tone mapping.
  const backlit = (map, hex = 0xffffff) => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(hex).multiplyScalar(cab.backlight) });
  const faceTexture = Object.assign(new THREE.CanvasTexture(face), { colorSpace: THREE.SRGBColorSpace, anisotropy: 4 });

  const cluster = new THREE.Group();
  cluster.position.fromArray(CLUSTER.centre);
  cluster.lookAt(new THREE.Vector3().fromArray(camera.cabEye)); // +z towards the eye, +x to the driver's right
  cluster.add(
    new THREE.Mesh(new THREE.PlaneGeometry(width, height), backlit(faceTexture)),
    new THREE.Mesh(
      mergeGeometries([
        new THREE.BoxGeometry(width + 0.04, 0.02, 0.14).translate(0, height / 2 + 0.01, 0.04), // hood over the dials
        ...[1, -1].map((s) => new THREE.BoxGeometry(0.02, height + 0.02, 0.14).translate(s * (width / 2 + 0.01), 0, 0.04)),
        new THREE.BoxGeometry(width, height + 0.1, 0.1).translate(0, -0.05, -0.051), // down into the dash
      ]),
      dash,
    ),
    new THREE.Mesh(
      mergeGeometries([
        ...dials.map((d) => new THREE.TorusGeometry(d.r, 0.005, 6, 40).translate(d.x, 0, 0.002)),
        ...dials.map((d) => new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12).rotateX(Math.PI / 2).translate(d.x, 0, 0.006)),
      ]),
      material(palette.chrome, 0.3),
    ),
  );
  const needleMaterial = backlit(null, palette.needle);
  const needles = dials.map((d) => {
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.005, d.r * 0.95, 0.002).translate(0, d.r * 0.35, 0), needleMaterial);
    needle.position.set(d.x, 0, 0.003);
    cluster.add(needle);
    return needle;
  });

  // A display at `y` m on the cluster: show(lines, font) draws the lines of text, `font` m high, evenly down it.
  function display({ size, y }) {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = size.map((m) => Math.round(m * PX));
    const ctx = canvas.getContext('2d');
    const texture = Object.assign(new THREE.CanvasTexture(canvas), { colorSpace: THREE.SRGBColorSpace });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), backlit(texture));
    mesh.position.set(0, y, 0.001);
    cluster.add(mesh);
    return (lines, font) => {
      ctx.fillStyle = '#0b0c10';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = new THREE.Color(palette.lampAmber).getStyle();
      ctx.font = `700 ${Math.round(font * PX)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pad = canvas.width * 0.05;
      lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, ((i + 0.5) * canvas.height) / lines.length, canvas.width - 2 * pad));
      texture.needsUpdate = true;
    };
  }
  const showGear = display(CLUSTER.gear);
  const showInfo = display(CLUSTER.info);
  interior.add(cluster);
  let shownGear;
  let shownInfo = [];

  // Steering column and wheel: the column tilts the wheel towards the driver; the wheel spins about the column's
  // axis (local +z, away from the driver). Only its top shows, under the dials, with a marker as on the on-screen
  // wheel.
  const wheelMaterial = material(palette.steeringWheel, 0.55);
  const column = new THREE.Group();
  column.position.set(camera.cabEye[0], 1.51, 1.96);
  column.rotation.x = 0.9;
  const spoke = (angle) => new THREE.BoxGeometry(0.14, 0.035, 0.016).translate(0.11, 0, 0).rotateZ(angle);
  const wheel = new THREE.Mesh(
    mergeGeometries([
      new THREE.TorusGeometry(0.21, 0.024, 10, 48),
      new THREE.CylinderGeometry(0.065, 0.075, 0.05, 24).rotateX(Math.PI / 2).translate(0, 0, -0.01),
      spoke(-0.15),
      spoke(Math.PI + 0.15),
      spoke(-Math.PI / 2),
    ]),
    wheelMaterial,
  );
  // A sleeve round the rim's top, 3 cm long.
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.026, 10, 4, 0.14).rotateZ(Math.PI / 2 - 0.07), material(palette.yellow, 0.6)));
  column.add(
    new THREE.Mesh(
      mergeGeometries([
        new THREE.CylinderGeometry(0.035, 0.035, 0.5, 12).rotateX(Math.PI / 2).translate(0, 0, 0.25),
        new THREE.BoxGeometry(0.11, 0.1, 0.22).translate(0, 0, 0.2), // shroud
      ]),
      wheelMaterial,
    ),
    wheel,
  );
  interior.add(column);

  function update({ truck: { speed, rpm, gear }, profile }, wheelTurn) {
    wheel.rotation.z = THREE.MathUtils.degToRad(wheelTurn);
    needles[0].rotation.z = dialAngle(Math.abs(speed) * 3.6, cab.speedMax, sweep);
    needles[1].rotation.z = dialAngle(rpm, rpmMax, sweep);
    needles[2].rotation.z = dialAngle((profile.fuel / fuel.tank) * 4, 4, sweep);
    needles[3].rotation.z = dialAngle(profile.energy * 4, 4, sweep);
    if (gear !== shownGear) showGear([String((shownGear = gear))], CLUSTER.gear.size[1] * 0.8);
    // Whole km and minutes, so it redraws about once a game minute (a real second), not every frame.
    const info = [Math.floor(profile.distance / 1000), Math.floor(profile.timeOfDay), Math.floor(profile.timePlayed / 60)];
    if (info.every((n, i) => n === shownInfo[i])) return;
    shownInfo = info;
    const [km, minute, played] = info;
    showInfo([kmText(km * 1000, strings), clockText(minute), playedText(played * 60, strings)], 0.013);
  }

  return { interior, update };
}
