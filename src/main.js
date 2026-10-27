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
import { createBlend } from './blend.js';

const { step, maxFrame, maxSteps } = tables.loop;
// ?perf loads the dev-only perf harness; ?perf&auto also lets the autopilot drive, unsaved (see perf.js).
const params = new URLSearchParams(location.search);
const perf = params.has('perf') ? await import('./perf.js') : null;
const auto = perf && params.has('auto');

// iPad Safari ignores user-scalable=no and doesn't fully honour touch-action: none, so a
// pinch or a quick double tap on a pedal zooms the page. Cancel those gestures in script.
// Pointer events still fire, so the wheel and pedals keep working; real buttons keep their
// default touch handling so their clicks still work.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault());
}
document.addEventListener('touchstart', (e) => e.target.closest?.('button') || e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

// ?map=monti loads the Monti map (spec #59) instead of the grid city, for development until it replaces it (#67).
const fetchJson = async (file) => (await fetch(`${import.meta.env.BASE_URL}${file}`)).json();
const map = params.get('map') === 'monti'
  ? (await import('./sim/osm.js')).buildOsmMap(await fetchJson(tables.osm.file), tables, await fetchJson(tables.osm.furniture))
  : parseMap(cityMap, tables);
let storage = null;
try {
  storage = window.localStorage;
} catch {
  // storage blocked (e.g. cookies off): the save module then plays unsaved
}
const save = createSave(auto ? null : storage, tables);
const sim = createSim(tables, map, auto ? perf.seeded(tables.perf.seed) : Math.random, save.load());
const blend = createBlend();
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
resetButton.addEventListener('click', () => {
  sim.resetToRoad();
  blend.remember(sim.state);
});
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
  // After a stall the Sim catches up at most maxSteps steps; the rest of the time is dropped.
  pending = werkstatt.open ? 0 : Math.min(pending + dt, maxSteps * step);
  if (werkstatt.open) orders.dismissNotices();
  while (pending >= step) {
    blend.remember(sim.state);
    sim.step(step, input);
    pending -= step;
  }
  // Drawn between the last two steps, by the time left over, so the motion is even whatever steps this frame had.
  view.render(blend.at(sim.state, pending / step), input, werkstatt.look, werkstatt.showroom);
  hud.update(sim.state, view.inCab);
  orders.update(sim.state);
  minimap.update(sim.state);
  werkstatt.update(sim.state);
  save.save(sim.state.profile); // writes only when the profile changed (see save.js)
  requestAnimationFrame(frame);
}

// The loading screen covers the controls until the city is in; only then does the Sim start.
view.ready.then(() => {
  // A first frame behind the loading screen, so compiling the shaders (up to 1 s on the WebGL 2 backend) doesn't stall play.
  view.render(sim.state, { steer: 0 }, werkstatt.look, werkstatt.showroom);
  perf?.installPerf({ sim, map, view, controls, hud, orders, minimap, werkstatt }, tables, auto);
  loading.remove();
  last = performance.now();
  requestAnimationFrame(frame);
});
