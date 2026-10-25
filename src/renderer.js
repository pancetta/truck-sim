import * as THREE from 'three';

// Draws Sim state; never writes to it.
export function createRenderer(canvas, tables) {
  const { palette, camera: cam } = tables;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.add(new THREE.HemisphereLight(palette.light, palette.ground, 1.2));
  const sun = new THREE.DirectionalLight(palette.light, 1.5);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshLambertMaterial({ color: palette.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(2000, 200, palette.grid, palette.grid);
  grid.position.y = 0.01;
  scene.add(grid);

  // Placeholder truck: cargo box with the cab at the front (+z).
  const truck = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3, 6), new THREE.MeshLambertMaterial({ color: palette.truckBody }));
  body.position.set(0, 1.9, -1);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.6, 2), new THREE.MeshLambertMaterial({ color: palette.truckCab }));
  cab.position.set(0, 1.7, 3);
  truck.add(body, cab);
  scene.add(truck);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function render(state) {
    const { x, z, heading } = state.truck;
    truck.position.set(x, 0, z);
    truck.rotation.y = heading;

    // Basic chase camera: fixed offset behind and above the truck.
    camera.position.set(
      x - Math.sin(heading) * cam.chaseDistance,
      cam.chaseHeight,
      z - Math.cos(heading) * cam.chaseDistance,
    );
    camera.lookAt(x, cam.lookHeight, z);
    renderer.render(scene, camera);
  }

  return { render };
}
