> **Decision (2026-10-25, owner):** despite the measurements below, the renderer moves to Three's `WebGPURenderer` to prepare for phase 3 graphics. The migration lands after the `?perf` harness so the switch is measured against this baseline; it landed with #28 within budget (see "WebGPURenderer switch (#28)" below). Other decisions: adaptive resolution between DPR 1.25 and 2 (start at 1.5 on touch devices), and sky-tinted distance fog at roughly 300–400 m together with sector culling.

# Truck Sim: performance and architecture before phase 3

Date: 2026-10-25. Measured by an agent on a shared Apple M2 Mac (10-core GPU). The repo was untouched; all work is in `scratchpad/perf/`.

## What was measured

- **Commits:** `90634ea` (AI traffic #20; most numbers) and `ca463a0` (main at start, no traffic). While this ran, #20, #21 and #18 landed on main (`f606718`). That commit wasn't re-measured, but its code still has every hot spot below. #21 also adds more `Math.hypot` and array-allocating collision code to `traffic.js`.
- **Builds:** production `vite build` of instrumented copies (`inst/`, `minst/`, `wgpu/`), served with `vite preview` on ports 5181–5183. The servers sent COOP/COEP headers so `performance.now` has fine resolution.
- **Browsers:**
  - Chrome 155 headless, GPU string `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)`. This is GPU-backed, not SwiftShader.
  - Playwright WebKit 2203 (UA `Version/26.0 Safari`, GPU `Apple GPU`).
  - iPad (A16) simulator, iPadOS 27.0 Safari (`Version/27.0`, `WebKit WebGL`).
- **Viewport:** 1180×820 at DPR 2, so the drawing buffer is 2360×1640.
- **Route:** a scripted pure-pursuit autopilot (`inst/src/autopilot.js`) on a fixed loop of rows 8/36 and columns 1/57, with an order accepted. Each run has 5 s of warm-up, then 20 s recorded (12–15 s for some runs).
- **Split:** `performance.now` around the Sim steps, `view.render`, HUD+orders+werkstatt ("DOM"), the minimap and the save. Browser style, layout and paint time comes from Chrome traces.
- **GPU time:** `EXT_disjoint_timer_query_webgl2` (Chrome only). At vsync the GPU clocks down, which inflates timer values, so the uncapped run (`--disable-frame-rate-limit`) is the cost comparison to trust.
- **Allocations and GC:** CDP trace GC events plus the sampling heap profiler, mapped through source maps.
- **Noise:** other sessions share this machine. A first batch ran at load average 90–400 and was thrown away. Every table below was re-run with each scenario gated on load average under 15.

**Not measurable here:**
- Real iPad numbers. There is no device. The simulator renders through the Mac's GPU.
- WebKit GPU time and WebKit GC. WebKit exposes neither a timer query nor CDP.
- WebGPU in WebKit. Playwright's WebKit has no WebGPU, and in the simulator `requestAdapter()` returns null.

## Baseline (Chrome, vsync, 60 Hz)

| | main `ca463a0` cab | `90634ea` 12 cars cab | `90634ea` 12 cars chase |
|---|---|---|---|
| Frame time median / p95 (ms) | 16.67 / 16.67 | 16.67 / 16.67 | 16.67 / 16.67 |
| Main-thread busy median / p95 | 1.15 / 1.55 | 1.28 / 1.74 | 1.35 / 1.78 |
| Sim step | 0.17 / 0.29 | 0.27 / 0.40 | 0.28 / 0.45 |
| Render submit | 0.59 / 0.82 | 0.64 / 0.88 | 0.68 / 0.94 |
| HUD + orders DOM (JS) | 0.15 | 0.15 | 0.16 |
| Minimap | 0.19 | 0.19 | 0.19 |
| Browser style + layout + paint (trace) | – | – | ≈0.55 (layout 0.2) |
| GPU, uncapped / at vsync | – | – | 1.74 / 2.6 |
| Uncapped frame time (fps) | – | – | 2.71 ms (411 fps) |
| Draw calls / triangles | 32 / 294k | 35 / 321k | 32 / 323k |
| Programs / geometries / textures | 5 / 32 / 0 | 5 / 36 / 0 | 7 / 37 / 0 |
| JS heap | 11 MB | 12 MB | 13 MB |
| Allocated per frame | 265 KB | 273 KB | 275 KB |
| GC per 20 s: minor / major, total, max pause | 84 / 1, 36 ms, 6.6 ms | 96 / 1, 36 ms, 4.8 ms | 98 / 2, 34 ms, 2.1 ms |

**WebKit 26.0 (Playwright), 12 cars chase:** busy 1.6 / 2.2 ms, sim 0.28, render 0.58, DOM 0.36, minimap 0.36, 60 fps. The DOM and minimap cost about twice what they cost in Chrome.

**iPad simulator (iPadOS 27):** renders correctly, shadows and instancing included. Busy 0.6–1.4 ms, and frames settle at 16.7 ms once warm. Treat this as compatibility only.

### Load and payload

| Item | Size or time |
|---|---|
| JS bundle | 658 KB min, 171 KB gzip, 139 KB brotli. three core about 408 KB of the mapped bytes, GLTFLoader 42 KB, game code about 35 KB |
| CSS | 7 KB |
| Models (GLB + PNG) | 1.07 MB raw, 210 KB gzip. GitHub Pages serves GLB gzipped. The 4 kit cars are 172–240 KB raw each (2,000–2,500 triangles); buildings 6–27 KB |
| Live site wire total | 617 KB |
| Time to first playable frame, local (Chrome, cache off) | 180–235 ms: JS start about 42 ms, scene built about 90 ms, models ready about 180 ms |
| Biggest load cost | `readPixels` (colour-map lookup per triangle), 38 ms CPU |
| Time to first playable frame, live site | 656 ms cold, about 225 ms warm CDN |
| Throttled (10 Mbit/s / 40 ms; 1.6 Mbit/s / 150 ms) | 1.5 s and 8.4 s, uncompressed because local preview doesn't gzip, so an upper bound |

## Phase-3 stress (`90634ea` + scratch knobs)

To reach 50 and 100 cars the spawn ring was widened to 400 m. Pedestrians are instanced capsules of about 130 triangles that walk the pavements in the Sim. "Heavy" means `MeshStandardMaterial`, one shadow-casting sun with a 2048 map covering ±70 m, `PCFSoftShadowMap`, and every mesh casting and receiving.

Chrome at vsync (all runs held 60 fps with 0 frames over 20 ms):

| Scenario | Busy med / p95 | Sim (peds) | Render | Allocated per frame | Minor GC per 20 s | Triangles | Calls |
|---|---|---|---|---|---|---|---|
| 50 cars | 1.53 / 2.17 | 0.50 | 0.70 | 439 KB | 139 | 407k | 31 |
| 100 cars | 1.77 / 2.71 | 0.88 | 0.57 | 772 KB | 244 | 516k | 32 |
| 12 cars + 300 peds, naive | 1.47 / 2.31 | 0.46 (0.18) | 0.71 | 313 KB | 99 | 357k | 32 |
| 12 cars + 300 peds, grid | 1.53 / 2.23 | 0.36 (0.08) | 0.81 | 309 KB | 97 | 356k | 33 |
| 12 cars, heavy | 1.73 / 2.53 | 0.26 | 1.15 | 356 KB | 121 | 638k | 60 |
| Phase 3: 100 cars + 300 peds + heavy | 1.1–1.7 / 2.7–2.9 | 0.4–0.8 | 0.5–0.7 | 840–876 KB | 247–252 | 1.09M | 62 |

GPU cost in Chrome, uncapped, at full clocks:

| Scenario | GPU ms | fps |
|---|---|---|
| 12 cars | 1.74 | 411 |
| 100 cars | 1.79 | 437 |
| Standard material, no shadow | 1.80 | 464 |
| + sun shadow 2048 | **5.11** | 266 |
| + sun shadow 4096 | **7.51** | 202 |
| Phase 3, DPR 2 | **5.66** | 249 |
| Phase 3, DPR 1.5 | 3.30 | 335 |
| Phase 3, DPR 1 | 2.47 | 414 |

Sim alone (Node/V8, ms per 60 Hz step):

| Load | Time per step |
|---|---|
| 0 cars (parked truck) | 0.058 |
| 12 cars | 0.077 |
| 50 cars | 0.118 |
| 100 cars | 0.257 |
| 200 cars | 0.812 (quadratic) |
| 12 cars, with collider broad phase | 0.016 |
| 100 cars, with collider broad phase | 0.206 |
| Peds naive, 100 / 300 / 1000 | 0.010 / 0.080 / 0.737 |
| Peds grid, 100 / 300 / 1000 | 0.008 / 0.019 / 0.063 |

**WebKit phase 3:** busy 2.3 / 3.8 ms, sim 1.0 / 2.2 ms (peds 0.25), still 60 fps on the M2. JSC runs this Sim about 1.5–2× slower than V8.

## Where the time and garbage go

- **Allocations, 12 cars, 182 MB in 10 s:**
  - 60% from `overlaps` in `sim.js`, via `fits()`. It tests the truck against all ~2,400 colliders every step, with fresh closures and arrays each time.
  - 13% from three's `getParameters` and `getProgramCacheKey`, every frame. One `kitMaterial` is shared by instanced meshes with and without `instanceColor`, so three re-derives the program on each draw.
  - About 14% from `traffic.js`.
  - The per-frame `lights…join()`.
- **Allocations at 100 cars:** `targetSpeed` allocates 151 MB and `Math.hypot` 72 MB per 10 s. Both sit in the O(n²) neighbour loop.
- **Triangles:** every instanced mesh spans the whole city, so frustum culling never rejects anything. All 320k triangles are drawn every frame, plus the whole city again in the shadow pass. A per-instance frustum test along the route shows only 29–51% are on screen, and 10–13% are on screen and within 300 m.

**Two tiny fixes, measured** (Chrome, 12 cars chase; scratch knobs `fixcoll` and `fixmat`):

| | Baseline | Collider tile index | Material per variant | Both |
|---|---|---|---|---|
| Sim | 0.28 | 0.12 | 0.25 | 0.15 |
| Render | 0.68 | 0.72 | 0.41 | 0.53 |
| Allocated per frame | 275 KB | 129 KB | 228 KB | **70 KB** |
| Minor GC per 20 s | 98 | 40 | 83 | **23** |

All 71 Sim tests pass with the tile index switched on.

## Ranked bottlenecks for phase 3

1. **GPU fill and shading at DPR 2, made worse by shadows.** The shadow pass is the biggest single cost. On the M2, a 2048 map adds +3.3 ms and a 4096 map adds +5.7 ms. Going from DPR 2 to 1.5 cuts GPU time by 42%. Triangles barely matter: 320k → 516k adds 0.05 ms. *Estimate, not measured:* an A16 or A17-class GPU has roughly 40–50% of the M2's throughput, which would put phase 3 at DPR 2 at about 11–14 ms of GPU per frame. That leaves no headroom and invites thermal throttling. Measure on a real iPad (T1) before trusting this.
2. **No culling and no LOD.** The whole city is drawn twice (colour and shadow) every frame. Richer models multiply this cost directly.
3. **GC churn.** 275 KB per frame today and 850 KB at phase 3. Chrome's pauses are short (at most 2–6 ms). WebKit's could not be measured, and iPad memory is tighter.
4. **Traffic is O(n²) and full of allocations.** It is fine up to about 100 cars (≤0.9 ms per frame), then grows quadratically. Pedestrians done naively are fine at 300 and cost 0.74 ms per step at 1,000.
5. **The DOM forces a layout every frame.** The goal text and arrow are written unconditionally and the minimap is redrawn in full: about 0.5 ms of browser work, and twice the JS cost in WebKit.

**Not bottlenecks:** draw calls (31–64), the program count, the bundle, and the Sim at ≤100 cars.

## Architecture verdict

**Keep the basis: Three.js `WebGLRenderer`, a fixed-step Sim on the main thread, and a DOM HUD. Fix the specific items below.**

- **WebGPU.** Safari 26.0 ships it on macOS, iOS, iPadOS and visionOS. Sources: [WebKit blog, "WebKit Features in Safari 26.0", 15 Sep 2025](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), and Apple's [Safari 26.0 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes): "Added support for WebGPU." But on this scene, three r186's `WebGPURenderer` measured *worse*:
  - render CPU in Chrome: 0.99–1.44 ms against 0.6–0.7 ms;
  - GPU timestamps at vsync: 4.3 and 11.3 ms against 2.6 and 7.4 ms (different query mechanisms, so treat as indicative);
  - its WebGL2 fallback: 2× slower uncapped (5.45 against 2.71 ms per frame), and 1.0–1.3 ms render CPU in the iPad simulator against 0.4–0.6 ms;
  - the bundle grows from 664 KB to 902 KB (173 to 251 KB gzip);
  - every material would move to node materials or TSL.

  Revisit only if phase 3 needs compute shaders, for example GPU-driven crowds.
- **Web Worker.** The Sim is ≤1 ms per frame even at 100 cars and 300 peds. GitHub Pages can't send COOP/COEP headers, so there is no SharedArrayBuffer without a service worker, and the README rules service workers out. Not worth it now. Revisit if the Sim exceeds about 4 ms per frame on a real iPad.
- **Fixed step + render on every animation frame:** keep it, but cap catch-up at about 4 steps per frame. `maxFrame` 0.25 s currently allows up to 15 steps after a stall, and under machine load Sim p95 reached 16 ms in WebKit.

## Recommendations

| # | Change | Expected gain | Cost | Risk | Before phase-3 graphics? |
|---|---|---|---|---|---|
| R1 | Perf overlay + scripted route as a dev-only `?perf` (port of `inst/`), used on a real iPad | Makes every later number checkable | S | Low | **Yes** |
| R2 | Collider tile index in `fits()` | Sim −55%, allocations −53% | S | Low (tests pass) | **Yes** |
| R3 | One material per instancing/tint variant; replace the lights `join()` with a version counter | Render CPU −40%, allocations −17% | XS | Low | **Yes** |
| R4 | Pixel-ratio policy: cap at 1.5 on touch devices, plus an adaptive resolution scaler driven by frame time | GPU −42% at phase-3 load | S | Softer image | **Yes** |
| R5 | Split city instancing into sectors (e.g. 8×8 tiles) or use `BatchedMesh` with per-instance culling; far plane or fog at about 300–400 m | Drawn triangles −50% (frustum) to about −87% (with distance), in both passes; calls rise to about 100–200 | M | Medium (visual QA) | **Yes** |
| R6 | Shadow budget: one 2048 map fitted tightly around the truck, casters only from near sectors, blob shadows for cars and peds; no 4096 or soft-shadow sprawl | Avoids +3–6 ms GPU | S | Low | With lighting |
| R7 | Traffic hot path: squared distances instead of `Math.hypot`; reuse `corners` and `pts` arrays; look lights up by tile; grid neighbour query | About −120 KB per frame from `hypot` alone at 100 cars; O(n) scaling | S–M | Low | Before more than 50 cars |
| R8 | Pedestrians as SoA typed arrays + uniform grid from day one | 1,000 peds: 0.06 ms against 0.74 ms | S | Low | With peds |
| R9 | HUD writes only on change; minimap dynamic layer at about 15 Hz | About 0.3–0.5 ms per frame including layout | S | Low | No |
| R10 | Asset pipeline: gltf-transform + meshopt + KTX2 once detailed or textured models arrive; optionally bake vertex colours at build time (saves 38 ms at load) | Small today: 210 KB gzip | M | Low | Only with new assets |
| R11 | Bundle: leave as is. Code splitting saves little because nearly everything is needed for the first frame | – | – | – | No |

## Proposed tickets (prefactors first, each landable on its own)

1. **T1 Perf harness:** a dev-only `?perf` overlay (frame, Sim, render, DOM and minimap split, `renderer.info`) and the scripted autopilot route. QA by running it on the target iPad and recording the baseline.
2. **T2 Collider broad phase:** tile-indexed colliders in `sim.js` `fits()`, plus a test that it agrees with the brute-force check.
3. **T3 Render allocations:** material variants for instanced meshes; change detection for the light phases.
4. **T4 Resolution policy:** DPR cap and adaptive scaler, with tunables in `tables.js`.
5. **T5 City sectors and culling:** sector-instanced (or batched) city; camera far plane or fog. Verify drawn triangles with T1.
6. **T6 Traffic hot path:** allocation-free neighbour and stop-line checks plus a grid query; a bench test at 100 cars.
7. **T7 HUD and minimap:** change-only DOM writes and a throttled minimap.
8. **T8 (phase 3) Lighting:** `MeshStandardMaterial` and a fitted sun shadow, under a GPU budget checked with T1 on the iPad.
9. **T9 (phase 3) Pedestrians:** SoA + grid, instanced per sector.
10. **T10 (phase 3, optional) Asset pipeline:** meshopt, KTX2 and baked colours.

## Harness baseline (#26)

The `?perf` harness (T1) is now in the repo, so the numbers below are the ones to compare later tickets against. They come from the harness, not the scratch instrumentation above. The two differ: 8 cars (fresh profile, rank tier 0) rather than 12, a seeded Sim, and the code of `2abeec4` plus the harness. Don't mix the two tables.

**How to measure:**
- Open the game with `?perf` for the overlay, or `?perf&auto` to let the autopilot drive the loop on rows 8/36 and columns 1/57 with an order accepted. The autopilot starts from a fresh profile with the Sim seeded (`tables.perf.seed`), plays unsaved, and never touches the player's save.
- The overlay shows median / p95 / mean over the last 1200 frames (20 s at 60 Hz), refreshed every second, so read it 25 s after loading, a camera switch, or a pause. Paused frames (portrait, Werkstatt) count with zero work and pull the medians down. The camera button switches cab and chase.
- **busy** is the sum of sim, render, dom (HUD, orders, Werkstatt) and minimap. It leaves out the browser's own style, layout and paint.
- **steps** is the highest number of Sim steps in one frame within the window. It is at most `tables.loop.maxSteps` (4); after a stall the rest of the time is dropped.
- Renderer stats come from the last frame. WebGPURenderer counts programs per shader stage, so its program count isn't comparable with WebGL's.
- Safari coarsens `performance.now` unless the page is cross-origin isolated, and GitHub Pages can't send COOP/COEP headers. On the live site, trust the **mean**, not the median.
- Locally the build was served by `vite preview` with COOP/COEP headers (a scratch config), as in the baseline above.

**Chrome 155 headless**, GPU `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)`, 1180×820 at DPR 2 (buffer 2360×1640), vsync 60 Hz, load average about 6:

| ms, median / p95 / mean | cab | chase |
|---|---|---|
| Frame | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 |
| Busy | 0.59 / 1.39 / 0.72 | 0.56 / 1.67 / 0.70 |
| Sim | 0.14 / 0.36 / 0.18 | 0.14 / 0.40 / 0.18 |
| Render | 0.25 / 0.69 / 0.32 | 0.24 / 0.84 / 0.32 |
| DOM | 0.09 / 0.18 / 0.10 | 0.08 / 0.19 / 0.09 |
| Minimap | 0.10 / 0.22 / 0.12 | 0.08 / 0.23 / 0.10 |
| Sim steps per frame, max | 1 | 1 |
| Draw calls / triangles | 37 / 312k | 33 / 314k |
| Programs / geometries / textures | 5 / 34 / 0 | 6 / 35 / 0 |
| JS heap | 39 MB | 9 MB |

The heap reading depends on when GC last ran, so read it as a trend, not a size.

**iPad (A16) simulator**, iPadOS 27.0 Safari, GPU `Apple GPU` (the Mac's GPU), landscape at DPR 2 (buffer 2360×1376 below Safari's toolbar):

| ms, median / p95 / mean | cab | chase |
|---|---|---|
| Frame | 16.66 / 16.74 / 16.67 | 16.66 / 16.74 / 16.76 |
| Busy | 0.60 / 0.76 / 0.60 | 0.60 / 0.78 / 0.60 |
| Sim | 0.16 / 0.22 / 0.17 | 0.16 / 0.22 / 0.17 |
| Render | 0.20 / 0.26 / 0.20 | 0.20 / 0.28 / 0.21 |
| DOM | 0.12 / 0.16 / 0.12 | 0.12 / 0.16 / 0.13 |
| Minimap | 0.10 / 0.14 / 0.10 | 0.10 / 0.14 / 0.11 |
| Draw calls / triangles | 33 / 304k | 33 / 314k |
| Programs / geometries / textures | 5 / 34 / 0 | 6 / 35 / 0 |
| JS heap | n/a | n/a |

As before, the simulator uses the Mac's GPU, so this checks compatibility, not iPad speed. The owner runs `?perf&auto` on the real iPad.

**WebGPURenderer check** (a scratch copy with `three/webgpu` and `renderer.init()`, Chrome, cab, about 10 s): the overlay showed every value on both backends. On WebGPU (`apple metal-3`): busy 1.62 / 2.43, render 0.90 / 1.46, 38 calls, 312k triangles, 39 programs. On its WebGL 2 fallback: busy 1.41 / 2.42, render 0.79 / 1.41. These are smoke-test numbers, not a comparison; #28 measures the switch.

**Step cap:** after a 1 s main-thread stall in Chrome, the overlay's steps maximum rose from 1 to 4. Before the cap it would have been 15 (0.25 s of `maxFrame`).

## WebGPURenderer switch (#28)

The renderer now runs on `WebGPURenderer` (`three/webgpu`). Where WebGPU is missing it falls back to the WebGL 2 backend on its own, and `?webgl` forces that backend. It renders through three's `DirectRenderPipeline`, which does the sRGB conversion in the material shaders, as `WebGLRenderer` did. Also folded in:
- one kit material per mesh variant (plain, instanced, instanced and tinted);
- a `lightsVersion` counter in the Sim instead of the per-frame `join()` of light phases.

**Why `DirectRenderPipeline`:** `WebGPURenderer`'s default pipeline draws the scene into a half-float 4× MSAA target at full resolution and then adds a full-screen output pass. In Chrome, the WebGL 2 backend then took 7.9 ms per uncapped frame, against 2.6 ms for `WebGLRenderer`. In the iPad simulator, which has no WebGPU adapter and so runs that backend, 100 cars dropped frames: frame median / p95 / mean of 16.68 / 21.28 / 18.00 and 18.22 / 24.76 / 19.13 ms in two runs, against 16.66 / 16.78 / 16.70 ms before. The CPU was busy for only 3–4 ms, so this was GPU-bound. An 8-bit output buffer (`outputBufferType`) brought the uncapped frame down to only 5.1 ms. `DirectRenderPipeline` brought it down to 2.5 ms. It blends the translucent order marker in sRGB space, as `WebGLRenderer` did. Its output step expects premultiplied colour, so the marker material sets `premultipliedAlpha`. With straight alpha the opacity was applied twice: a test quad came out (73, 86, 64) instead of `WebGLRenderer`'s (89, 114, 74), and with `premultipliedAlpha` it matches exactly.

**First frame:** shaders compile on the first render, which took 0.5–1 s on the WebGL 2 backend. `main.js` now draws one frame before it removes the loading screen. The longest frame in the first 2 s of play is then 17 ms on the WebGL 2 backend and 67 ms on WebGPU, against 33 ms on main.

**How measured:** `?perf&auto` A/B runs in one sitting, from production builds served with COOP/COEP by a scratch static server.
- *Before:* main at `81df88a` (`WebGLRenderer`, with #27 and #32).
- *After:* the same commit plus this change.
- *Chrome:* Chrome 155 headless at 1180×820 and DPR 2 (buffer 2360×1640), load average 3–9. The GPU string is `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)` on WebGL and `apple metal-3` on WebGPU.
- *Per run:* the overlay is read after 25 s. Then come 10 s of allocation sampling (the CDP sampling heap profiler, including objects already collected) and a count of frame intervals.
- *100 cars:* a scratch copy with every rank tier at 100 cars and the spawn ring widened to 45–400 m (despawn at 450 m), as in the phase-3 stress above.

**Chrome, vsync 60 Hz, 8 cars** (ms, median / p95 / mean):

| | before, WebGL | after, WebGPU | after, `?webgl` |
|---|---|---|---|
| Frame, cab | 16.67 / 16.67 / 16.68 | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 |
| Frame, chase | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 |
| Frames over 20 ms in 10 s (cab, chase) | 0, 0 | 0, 0 | 0, 0 |
| Busy, cab | 0.56 / 1.23 / 0.66 | 0.54 / 1.85 / 0.79 | 0.54 / 1.46 / 0.69 |
| Busy, chase | 0.87 / 1.52 / 0.86 | 0.48 / 1.22 / 0.57 | 0.83 / 1.59 / 0.90 |
| Render CPU, cab | 0.35 / 0.85 / 0.44 | 0.38 / 1.34 / 0.56 | 0.38 / 1.07 / 0.49 |
| Render CPU, chase | 0.61 / 1.09 / 0.60 | 0.32 / 0.88 / 0.40 | 0.58 / 1.20 / 0.64 |
| Allocated per frame, cab / chase | 132 / 134 KB | 97 / 95 KB | 98 / 97 KB |
| Draw calls / triangles, cab | 37 / 312k | 38 / 314k | 38 / 314k |

Render CPU is within run-to-run noise of before, with a slightly longer p95 tail on WebGPU. Allocations fall by about 27%. The material variants and the lights counter save more than `WebGPURenderer` adds.

**GPU** (Chrome, chase):

| | before, WebGL | after, WebGPU | after, `?webgl` |
|---|---|---|---|
| Uncapped frame time, median / mean | 2.42 / 2.56 ms | 0.98 / 1.07 ms | 2.47 / 1.80 ms |
| GPU timer per frame at vsync, chase / cab | 5.56 / 5.74 ms¹ | 2.75 / 2.66 ms | 2.79 ms / – |

¹ Measured at `bc6c292` earlier the same day. #27 doesn't touch the GPU.

Uncapped (`--disable-frame-rate-limit --disable-gpu-vsync`), a frame can't be shorter than its GPU work once the pipeline is full, so that row is the comparison to trust. The timer row uses scratch copies with `EXT_disjoint_timer_query_webgl2` (before) and three's `trackTimestamp` (after). Those are two different mechanisms, and the GPU clocks down at vsync, so read that row as indicative. Uncapped, three's timestamp pool skips frames while a resolve is pending, and its readings were unusable. In short: WebGPU costs less GPU than before, and the WebGL 2 backend costs the same.

**Chrome, 100 cars, vsync** (ms, median / p95 / mean):

| | before, WebGL² | after, WebGPU | after, `?webgl` |
|---|---|---|---|
| Frame, cab | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 |
| Frame, chase | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 | – |
| Frames over 20 ms in 10 s (cab, chase) | 1, 1 | 1, 0 | 1, – |
| Render CPU, cab | 0.27 / 0.52 / 0.29 | 0.34 / 0.63 / 0.36 | 0.31 / 0.76 / 0.37 |
| Render CPU, chase | 0.30 / 0.64 / 0.33 | 0.31 / 0.63 / 0.34 | – |
| Allocated per frame, cab | 4011 KB | 3762 KB | 3772 KB |
| Triangles | 511k | 513k | 513k |

² At `bc6c292`, without #27's collider index.

The one 33 ms frame per 10 s at 100 cars appears before and after alike. It's a GC pause from the traffic hot path's 4 MB per frame (R7), not the renderer. #31 landed after these runs and removes those allocations.

**iPad (A16) simulator**, iPadOS 27.0 Safari, landscape at DPR 2 (buffer 2360×1376), ms, median / p95 / mean. The simulator has no WebGPU adapter, so *after* runs on the WebGL 2 backend. It found the backend automatically, with no `?webgl`.

| | before, WebGL (`bc6c292`) | after, WebGL 2 backend |
|---|---|---|
| Frame, cab, 8 cars | 16.66 / 16.74 / 16.67 | 16.66 / 16.76 / 16.69 |
| Frame, chase, 8 cars | – | 16.66 / 16.82 / 16.69 |
| Render, cab, 8 cars | 0.26 / 0.40 / 0.26 | 0.26 / 0.40 / 0.28 |
| Render, chase, 8 cars | – | 0.28 / 0.40 / 0.29 |
| Busy, cab, 8 cars | 0.48 / 0.72 / 0.50 | 0.42 / 0.60 / 0.43 |
| Frame, cab, 100 cars | 16.66 / 16.78 / 16.70 | 16.66 / 16.74 / 16.67 |
| Frame, chase, 100 cars | – | 16.66 / 16.72 / 16.79 |
| Render, cab, 100 cars | 0.24 / 0.44 / 0.28 | 0.28 / 0.44 / 0.30 |

As before, the simulator uses the Mac's GPU. It shows the WebGL 2 backend holding 60 fps, but says nothing about iPad speed. WebGPU on the iPad itself remains for the owner's `?perf&auto` run.

**Budget verdict:**
- *60 fps on the autopilot route:* holds in Chrome (both views, both backends, no frame over 20 ms) and in the simulator.
- *60 fps at 100 cars:* holds as well as before, in Chrome and in the simulator. The one GC hitch per 10 s in Chrome is there before and after.
- *Allocations per frame:* 95–98 KB, against 132–134 KB before.
- *Render CPU:* about the same as before (median 0.3–0.6 ms in Chrome, 0.26–0.30 ms in the simulator).
- *GPU:* lower on WebGPU. The WebGL 2 backend matches `WebGLRenderer`.
- *Bundle:* 922 KB minified / 259 KB gzip, against 664 / 173 KB. `three/webgpu` brings the node system; the classic `WebGLRenderer` is tree-shaken out.
- *Programs:* about 40 against 5–6. WebGPURenderer counts one per shader stage and pipeline (see above), so the two counts aren't comparable.
- *Device loss:* a lost GPU device or WebGL context now reloads the page. Neither backend restores itself, while `WebGLRenderer` did. The save survives the reload; an order in progress doesn't.

## Files

The instrumented copies, drivers and raw JSONL results lived in the investigating session's scratchpad and aren't in the repo. The harness (overlay and autopilot route) is in the repo as the dev-only `?perf` mode: `src/perf.js` and `src/autopilot.js`, with tunables in `tables.perf`.
