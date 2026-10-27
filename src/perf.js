// Dev-only performance harness, opened with ?perf (see docs/perf/2026-10-baseline.md). It wraps the per-frame
// calls of the app's modules with timers, so without ?perf the app's frame loop carries no cost for it.
// Works with WebGLRenderer and WebGPURenderer (either backend).
import { createAutopilot } from './autopilot.js';

export { seeded } from './autopilot.js';

export function installPerf({ sim, map, view, controls, hud, orders, minimap, werkstatt }, tables, auto) {
  const { window: size, refresh } = tables.perf;
  const renderer = view.renderer;
  const parts = { sim: 0, render: 0, dom: 0, minimap: 0 }; // ms spent in the current frame
  const rows = ['frame', 'busy', ...Object.keys(parts), 'steps'];
  const rings = Object.fromEntries(rows.map((row) => [row, new Float64Array(size)]));
  // Per-frame trace of what was drawn, for judging smoothness (#73): perfTrace() in the console returns it.
  const traced = ['t', 'truckX', 'truckZ', 'camX', 'camZ', 'camYaw', 'dpr'];
  const trace = Object.fromEntries(traced.map((row) => [row, new Float64Array(size)]));
  const camera = view.camera;
  const look = camera.position.clone();
  let frames = 0;
  let steps = 0;

  const time = (module, key, part) => {
    const call = module[key];
    module[key] = (...args) => {
      const t = performance.now();
      const result = call(...args);
      parts[part] += performance.now() - t;
      if (part === 'sim') steps++;
      return result;
    };
  };
  let drawn = sim.state; // the state the last frame drew (main.js draws between the last two Sim steps)
  const render = view.render;
  view.render = (state, ...rest) => render((drawn = state), ...rest);
  time(sim, 'step', 'sim');
  time(view, 'render', 'render');
  time(hud, 'update', 'dom');
  time(orders, 'update', 'dom');
  time(werkstatt, 'update', 'dom');
  time(minimap, 'update', 'minimap');

  if (auto) {
    const autopilot = createAutopilot(sim, map, tables);
    sim.requestOffers();
    sim.acceptOrder(sim.state.offers[0].id);
    autopilot.place();
    controls.update = autopilot.update;
  }

  // Runs once per frame next to the app's own frame callback (before or after it, consistently), so each
  // record pairs one frame interval with one frame's work.
  let last = 0;
  requestAnimationFrame(function tick(now) {
    if (last) {
      const i = frames++ % size;
      rings.frame[i] = now - last;
      rings.busy[i] = parts.sim + parts.render + parts.dom + parts.minimap;
      for (const part in parts) {
        rings[part][i] = parts[part];
        parts[part] = 0;
      }
      rings.steps[i] = steps;
      steps = 0;
      // The frame drawn in the callback at `last` (this one runs before the app's).
      trace.t[i] = last;
      trace.truckX[i] = drawn.truck.x;
      trace.truckZ[i] = drawn.truck.z;
      trace.camX[i] = camera.position.x;
      trace.camZ[i] = camera.position.z;
      camera.getWorldDirection(look);
      trace.camYaw[i] = Math.atan2(look.x, look.z);
      trace.dpr[i] = renderer.getPixelRatio();
    }
    last = now;
    requestAnimationFrame(tick);
  });

  // Oldest first: the frame interval and Sim steps of each traced frame next to its camera.
  window.perfTrace = () => {
    const n = Math.min(frames, size);
    const order = (a) => Array.from({ length: n }, (_, k) => a[(frames - n + k) % size]);
    return Object.fromEntries([...['frame', 'steps'].map((row) => [row, order(rings[row])]), ...traced.map((row) => [row, order(trace[row])])]);
  };

  const box = document.createElement('pre'); // below the goal banner, so manual ?perf driving still shows the goal
  box.style.cssText =
    'position:fixed;left:30%;top:28%;z-index:99;margin:0;padding:4px 8px;background:#000c;color:#0f0;font:600 12px/1.3 ui-monospace,monospace;pointer-events:none';
  document.body.append(box);
  const backend = renderer.isWebGPURenderer
    ? renderer.backend.isWebGPUBackend
      ? 'WebGPU'
      : 'WebGPURenderer on WebGL 2'
    : 'WebGL';
  const gpu = gpuName(renderer);
  const ms = (x) => x.toFixed(2).padStart(6);
  // The mean stays accurate where the browser coarsens performance.now (Safari: 1 ms); the median doesn't.
  const stats = (row) => {
    const sorted = rings[row].slice(0, Math.min(frames, size)).sort();
    const mean = sorted.reduce((sum, x) => sum + x, 0) / (sorted.length || 1);
    return [sorted[sorted.length >> 1] ?? 0, sorted[Math.floor(sorted.length * 0.95)] ?? 0, mean];
  };

  setInterval(() => {
    const { render: r, memory: m } = renderer.info;
    const heap = performance.memory ? `${(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(0)} MB` : 'n/a';
    box.textContent = [
      `ms (median / p95 / mean, last ${Math.min(frames, size)} frames)`,
      ...rows.slice(0, -1).map((row) => `${row.padEnd(8)}${stats(row).map(ms).join(' /')}`),
      `sim steps per frame ≤ ${Math.max(...rings.steps)}`,
      // WebGPURenderer counts draw calls in drawCalls (its calls is a running total) and programs in memory.
      `calls ${r.drawCalls ?? r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k  programs ${renderer.info.programs?.length ?? m.programs}  geometries ${m.geometries}  textures ${m.textures}`,
      `${backend}  dpr ${renderer.getPixelRatio()}  buffer ${renderer.domElement.width}×${renderer.domElement.height}  heap ${heap}  cars ${sim.state.traffic.length}`,
      gpu,
    ].join('\n');
  }, refresh * 1000);
}

function gpuName(renderer) {
  const gl = renderer.isWebGPURenderer ? renderer.backend.gl : renderer.getContext();
  // Chrome masks RENDERER ("WebKit WebGL"); the debug extension still gives the real GPU, so SwiftShader shows.
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  if (gl) return gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  const info = renderer.backend.device?.adapterInfo;
  return info ? `${info.vendor} ${info.architecture} ${info.description}`.trim() : 'GPU unknown';
}
