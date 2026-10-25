import * as THREE from 'three';

// Draws Sim state; never writes to it.
export function createRenderer(canvas, tables, map) {
  const { palette, camera: cam, city } = tables;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.add(new THREE.HemisphereLight(palette.light, palette.ground, tables.lighting.ambient));
  const sun = new THREE.DirectionalLight(palette.light, tables.lighting.sun);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshLambertMaterial({ color: palette.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // City from the parsed map, as placeholder boxes until the art ticket.
  const ts = map.tileSize;
  const roads = map.roads.map(({ col, row }) => ({ minX: col * ts, maxX: (col + 1) * ts, minZ: row * ts, maxZ: (row + 1) * ts }));
  const solids = (kind) => map.colliders.filter((b) => b.kind === kind);
  const [low, high] = city.buildingHeight;
  // Stable pseudo-random height per tile.
  const towers = (b) => ({ ...b, height: low + (high - low) * Math.abs(Math.sin(b.minX * 12.9898 + b.minZ * 78.233)) });
  addBoxes(palette.road, roads, 0.02);
  addBoxes(palette.zone, map.spots.map((s) => s.zone), 0.04);
  addBoxes(palette.building, solids('building').map(towers));
  addBoxes(palette.spot, solids('spot').map(towers));
  addBoxes(palette.car, solids('car'), city.obstacles.car.height);
  addBoxes(palette.pole, solids('pole'), city.obstacles.pole.height);

  // One instanced draw call per colour; boxes stand on the ground, `height` tall unless they carry their own.
  function addBoxes(color, boxes, height) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color }), boxes.length);
    const m = new THREE.Matrix4();
    boxes.forEach((b, i) => {
      const h = b.height ?? height;
      m.makeScale(b.maxX - b.minX, h, b.maxZ - b.minZ).setPosition((b.minX + b.maxX) / 2, h / 2, (b.minZ + b.maxZ) / 2);
      mesh.setMatrixAt(i, m);
    });
    scene.add(mesh);
  }

  // Active order's zone: a see-through column, one colour for the pickup and one for the drop-off.
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(ts, 4, ts),
    new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
  );
  marker.position.y = 2;
  scene.add(marker);

  // Placeholder truck: cargo box with the cab at the front (+z).
  const truck = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3, 6), new THREE.MeshLambertMaterial({ color: palette.truckBody }));
  body.position.set(0, 1.9, -1);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.6, 2), new THREE.MeshLambertMaterial({ color: palette.truckCab }));
  cab.position.set(0, 1.7, 3);
  truck.add(body, cab);

  // Cab interior, our own design: a dashboard and a steering wheel inside the cab box.
  // The cab box's faces only render from outside, so from the driver's seat the walls are see-through.
  const dashboard = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.6), new THREE.MeshLambertMaterial({ color: palette.dashboard }));
  dashboard.position.set(0, 1.85, 3.65);
  const wheelMaterial = new THREE.MeshLambertMaterial({ color: palette.steeringWheel });
  // The column tilts the wheel towards the driver; the wheel spins about the column's axis (local +z).
  const column = new THREE.Group();
  column.position.set(cam.cabEye[0], 2.08, 3.32);
  column.rotation.x = 0.9;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5), wheelMaterial);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.25;
  const wheel = new THREE.Group();
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.03), wheelMaterial);
  spoke.position.y = -0.11;
  wheel.add(
    new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), wheelMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.03), wheelMaterial),
    spoke,
  );
  column.add(shaft, wheel);
  truck.add(dashboard, column);
  scene.add(truck);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const eye = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let cabView = true;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function render(state, input) {
    const { x, z, heading, roll } = state.truck;
    truck.position.set(x, 0, z);
    truck.rotation.set(0, heading, roll); // XYZ order: roll about the truck's own forward axis
    // Same angle as the on-screen wheel; positive is clockwise from the driver's seat.
    wheel.rotation.z = THREE.MathUtils.degToRad(input.steer * tables.controls.wheelLock);

    const { order } = state;
    marker.visible = !!order;
    if (order) {
      const { zone } = map.spots.find((s) => s.id === (order.phase === 'pickup' ? order.pickup : order.dropoff));
      marker.position.x = (zone.minX + zone.maxX) / 2;
      marker.position.z = (zone.minZ + zone.maxZ) / 2;
      marker.material.color.setHex(order.phase === 'pickup' ? palette.pickup : palette.dropoff);
    }

    if (cabView) {
      // Truck-space points, so the camera follows anything that moves the truck.
      camera.position.copy(truck.localToWorld(eye.fromArray(cam.cabEye)));
      camera.lookAt(truck.localToWorld(lookAt.fromArray(cam.cabLook)));
    } else {
      // Basic chase camera: fixed offset behind and above the truck.
      camera.position.set(
        x - Math.sin(heading) * cam.chaseDistance,
        cam.chaseHeight,
        z - Math.cos(heading) * cam.chaseDistance,
      );
      camera.lookAt(x, cam.lookHeight, z);
    }
    renderer.render(scene, camera);
  }

  function toggleCamera() {
    cabView = !cabView;
  }

  return { render, toggleCamera };
}
