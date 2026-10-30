import './style.css';
import * as tables from './tables.js';
import { strings } from './strings.js';
import { createSim } from './sim/sim.js';
import { createSave } from './save.js';
import { buildOsmMap } from './sim/osm.js';
import { createControls } from './controls.js';
import { createRenderer } from './renderer.js';
import { createHud } from './hud.js';
import { createOrders } from './orders.js';
import { createMinimap } from './minimap.js';
import { createWerkstatt } from './werkstatt.js';
import { createBlend } from './blend.js';
import { createStart, creditsFrom } from './start.js';
import creditsMarkdown from '../CREDITS.md?raw';

const { step, maxFrame, maxSteps } = tables.loop;
// ?perf loads the dev-only perf harness; ?perf&auto also lets the autopilot drive, unsaved (see perf.js).
const params = new URLSearchParams(location.search);
const perf = params.has('perf') ? await import('./perf.js') : null;
const auto = perf && params.has('auto');
// ?neu: the page reloaded for a Neues Spiel over a Save, so play starts at once; dropped so a reload shows the start screen.
const query = () => (params.toString() ? `?${params}` : '');
const newGame = params.has('neu');
if (newGame) {
  params.delete('neu');
  history.replaceState(null, '', `${location.pathname}${query()}`);
}

// iPad Safari ignores user-scalable=no and doesn't fully honour touch-action: none, so a
// pinch or a quick double tap on a pedal zooms the page. Cancel those gestures in script.
// Pointer events still fire, so the wheel and pedals keep working; real buttons keep their
// default touch handling so their clicks still work, and the scrolling panels theirs so they
// scroll (their touch-action, pan-y, rules out double-tap zoom; the gesture handlers, pinch).
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault());
}
document.addEventListener('touchstart', (e) => e.target.closest?.('button, .orders-panel, .werkstatt-panel ul, .start-page') || e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

// The Monti map (spec #59), built from its OpenStreetMap files and height grid; ?perf shows how long the build took.
const fetchJson = async (file) => (await fetch(`${import.meta.env.BASE_URL}${file}`)).json();
const [osmData, furniture, terrain] = await Promise.all([tables.osm.file, tables.osm.furniture, tables.osm.terrain].map(fetchJson));
const buildStart = performance.now();
const map = buildOsmMap(osmData, tables, furniture, terrain);
const mapBuild = performance.now() - buildStart;
let storage = null;
try {
  storage = window.localStorage;
} catch {
  // storage blocked (e.g. cookies off): the save module then plays unsaved
}
const save = createSave(auto ? null : storage, tables);
// The autopilot's drive never runs dry or tires, so a tow never breaks the loop and its steering never lags.
let simTables = auto ? { ...tables, fuel: { ...tables.fuel, perKm: 0, perClimb: 0 }, energy: { ...tables.energy, drive: Infinity } } : tables;
// ?perf&weather=rain (or fog) brings only that weather, coming in over weather.ramp s, so it can be measured (#53).
const only = perf && params.get('weather');
if (only === 'rain' || only === 'fog') simTables = { ...simTables, weather: { ...tables.weather, clear: [0, 0], fog: only === 'fog' ? 1 : 0 } };
const sim = createSim(simTables, map, auto ? perf.seeded(tables.perf.seed) : Math.random, save.load());
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

// The start screen (#112): after loading, and from the Menü button, pausing play as the Werkstatt does. Neues Spiel over a
// Profile that was played clears the Save and reloads with ?neu, which starts a fresh Sim; with none, play just starts.
let played = save.found;
const reload = () => location.replace(`${location.pathname}${query()}`);
const start = createStart(document.getElementById('start'), tables, strings, creditsFrom(creditsMarkdown), {
  onNewGame() {
    if (!played) return start.hide();
    if (!confirm(strings.start.newGameConfirm)) return;
    save.reset();
    params.set('neu', '');
    reload();
  },
  onReset() {
    save.reset();
    reload();
  },
  onChooseMap: save.chooseMap,
});
const menuButton = document.createElement('button');
menuButton.type = 'button';
menuButton.className = 'menu-toggle';
menuButton.textContent = strings.start.menu;
menuButton.addEventListener('click', () => start.show(sim.state, true, save.map()));
document.getElementById('controls').append(menuButton);

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
  // The open Werkstatt or start screen pauses the world; drawing and, in the Werkstatt, autosave (after a purchase) go on.
  // After a stall the Sim catches up at most maxSteps steps; the rest of the time is dropped.
  const paused = werkstatt.open || start.open;
  if (!start.open) played = true;
  pending = paused ? 0 : Math.min(pending + dt, maxSteps * step);
  if (paused) orders.dismissNotices();
  while (pending >= step) {
    blend.remember(sim.state);
    const tow = sim.state.lastTow;
    sim.step(step, input);
    if (sim.state.lastTow !== tow) blend.remember(sim.state); // the tow moves the truck at once, as a reset does
    pending -= step;
  }
  // Drawn between the last two steps, by the time left over, so the motion is even whatever steps this frame had.
  view.render(blend.at(sim.state, pending / step), input, werkstatt.look, start.open ? 'orbit' : werkstatt.showroom);
  hud.update(sim.state, view.inCab);
  orders.update(sim.state);
  minimap.update(sim.state);
  werkstatt.update(sim.state);
  // Writes only when the profile changed (see save.js); never under the start screen, so one only looked at stays no
  // Save, and a reset from it isn't written back before the reload.
  if (!start.open) save.save(sim.state.profile);
  requestAnimationFrame(frame);
}

// The loading screen covers the controls until the city is in; only then does the Sim start.
view.ready.then(() => {
  // A first frame behind the loading screen, so compiling the shaders (up to 1 s on the WebGL 2 backend) doesn't stall play.
  view.render(sim.state, { steer: 0 }, werkstatt.look, werkstatt.showroom);
  perf?.installPerf({ sim, map, view, controls, hud, orders, minimap, werkstatt }, tables, auto, mapBuild);
  loading.remove();
  if (!auto && !newGame) start.show(sim.state, save.found, save.map());
  last = performance.now();
  requestAnimationFrame(frame);
});
