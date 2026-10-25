import './style.css';
import * as tables from './tables.js';
import { strings } from './strings.js';
import { createSim } from './sim/sim.js';
import { createControls } from './controls.js';
import { createRenderer } from './renderer.js';

const { step, maxFrame } = tables.loop;

const sim = createSim(tables);
const controls = createControls(document.getElementById('controls'), tables, strings);
const view = createRenderer(document.getElementById('scene'), tables);

let last = performance.now();
let pending = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, maxFrame);
  last = now;
  const input = controls.update(dt);
  pending += dt;
  while (pending >= step) {
    sim.step(step, input);
    pending -= step;
  }
  view.render(sim.state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
