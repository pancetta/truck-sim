import './style.css';
import * as tables from './tables.js';
import { strings } from './strings.js';
import { createSim } from './sim/sim.js';
import { createControls } from './controls.js';
import { createRenderer } from './renderer.js';

const STEP = 1 / 60; // fixed Sim timestep, s

const sim = createSim(tables);
const controls = createControls(document.getElementById('controls'), tables, strings);
const view = createRenderer(document.getElementById('scene'), tables);

let last = performance.now();
let pending = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.25); // don't fast-forward after a stall
  last = now;
  const input = controls.update(dt);
  pending += dt;
  while (pending >= STEP) {
    sim.step(STEP, input);
    pending -= STEP;
  }
  view.render(sim.state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
