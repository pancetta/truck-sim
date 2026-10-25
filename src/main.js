import './style.css';
import * as tables from './tables.js';
import { strings } from './strings.js';
import { createSim } from './sim/sim.js';
import { createSave } from './save.js';
import { parseMap } from './sim/map.js';
import cityMap from './city.txt?raw';
import { createControls } from './controls.js';
import { createRenderer } from './renderer.js';
import { createHud } from './hud.js';
import { createOrders } from './orders.js';
import { createMinimap } from './minimap.js';
import { createWerkstatt } from './werkstatt.js';

const { step, maxFrame } = tables.loop;

// iPad Safari ignores user-scalable=no and doesn't fully honour touch-action: none, so a
// pinch or a quick double tap on a pedal zooms the page. Cancel those gestures in script.
// Pointer events still fire, so the wheel and pedals keep working; real buttons keep their
// default touch handling so their clicks still work.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault());
}
document.addEventListener('touchstart', (e) => e.target.closest?.('button') || e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

const map = parseMap(cityMap, tables);
let storage = null;
try {
  storage = window.localStorage;
} catch {
  // storage blocked (e.g. cookies off): the save module then plays unsaved
}
const save = createSave(storage, tables);
const sim = createSim(tables, map, Math.random, save.load());
// What autosave compares: the profile with the distance in whole 100 m, so driving saves every 100 m, not every frame.
const saveKey = (p) => JSON.stringify({ ...p, distance: Math.floor(p.distance / 100) });
let savedProfile = saveKey(sim.state.profile);
if (import.meta.env.DEV) window.sim = sim; // dev builds only: lets manual QA inspect state and place the truck
const controls = createControls(document.getElementById('controls'), tables, strings);
const loading = document.getElementById('loading');
const view = createRenderer(document.getElementById('scene'), tables, map, (share) => loading.style.setProperty('--progress', share));
document.getElementById('rotate').textContent = strings.rotate;
const portrait = matchMedia('(orientation: portrait)');

const cameraButton = document.createElement('button');
cameraButton.type = 'button';
cameraButton.className = 'camera-toggle';
cameraButton.textContent = strings.camera;
cameraButton.addEventListener('click', view.toggleCamera);
document.getElementById('controls').append(cameraButton);
const hud = createHud(document.getElementById('dash'), tables, strings);
const orders = createOrders(document.getElementById('orders'), sim, map, tables, strings);
const minimap = createMinimap(document.getElementById('minimap'), map, tables);
// A reset clears the save and reloads, which starts a fresh Sim and rebuilds everything wired to it.
const werkstatt = createWerkstatt(document.getElementById('werkstatt'), sim, tables, strings, () => {
  save.reset();
  location.reload();
});

const resetButton = document.createElement('button');
resetButton.type = 'button';
resetButton.className = 'reset';
resetButton.textContent = strings.resetToRoad;
resetButton.addEventListener('click', () => sim.resetToRoad());
document.getElementById('controls').append(resetButton);

let last = performance.now();
let pending = 0;

function frame(now) {
  if (portrait.matches) {
    // Paused behind the rotate overlay; keep `last` current so resuming doesn't fast-forward.
    last = now;
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min((now - last) / 1000, maxFrame);
  last = now;
  const input = controls.update(dt);
  // The open Werkstatt pauses the world; drawing and autosave (after a purchase) go on.
  pending = werkstatt.open ? 0 : pending + dt;
  while (pending >= step) {
    sim.step(step, input);
    pending -= step;
  }
  view.render(sim.state, input);
  hud.update(sim.state);
  orders.update(sim.state);
  minimap.update(sim.state);
  werkstatt.update(sim.state);
  // Autosave whenever the profile changes (a payment, fine, purchase or another 100 m driven).
  const profile = saveKey(sim.state.profile);
  if (profile !== savedProfile) {
    save.save(sim.state.profile);
    savedProfile = profile;
  }
  requestAnimationFrame(frame);
}

// The loading screen covers the controls until the city is in; only then does the Sim start.
view.ready.then(() => {
  loading.remove();
  last = performance.now();
  requestAnimationFrame(frame);
});
