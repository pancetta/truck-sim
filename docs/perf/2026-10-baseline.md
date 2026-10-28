> **Decision (2026-10-25, owner):** despite the measurements below, the renderer moves to Three's `WebGPURenderer` to prepare for phase 3 graphics. The migration lands after the `?perf` harness so the switch is measured against this baseline; it landed with #28 within budget (see "WebGPURenderer switch (#28)" below). Other decisions: adaptive resolution between DPR 1.25 and 2, starting at 1.5 on touch devices (landed with #29, see "Adaptive resolution (#29)"), and sky-tinted distance fog at roughly 300–400 m together with sector culling.

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

## Adaptive resolution (#29)

The pixel ratio now follows the GPU load (`src/resolution.js`, tunables in `tables.resolution`). Before, it was fixed at the device ratio capped at 2.

**Behaviour:**
- It starts at 1.5 on touch screens (`pointer: coarse`), and at the device ratio capped at 2 elsewhere.
- It stays between 1.25 and 2, and never goes above the device ratio. On a DPR 1 screen it stays at 1.
- Frames are judged in 3 s windows by their mean interval. Each interval counts as at most 50 ms, so a single stall, a pause or a hidden tab doesn't move the ratio.
  - If a window's mean is over 18 ms, the ratio steps down 0.25.
  - After two windows in a row at or under 17.2 ms, it steps up 0.25.
  - Between those two thresholds it holds.
- If a step up is taken back in the very next window, the next try needs twice as many good windows: 2, 4, 8 and so on, up to 32 (about 96 s). So a ratio the GPU can't hold isn't retried every few seconds.
- The ratio changes at the start of a frame, just before that frame draws. The `?perf` overlay shows it as `dpr` and `buffer`.
- *Why the mean, and not a share of slow frames:* the first version counted frames over 20 ms. Unloaded, Safari in the simulator misses 2–3% of frames at any ratio. Under load its intervals spread over 17–20 ms instead of snapping to 33 ms. At 1.75 under load it sat at a mean of 18.1–18.9 ms (about 53 fps) for 30 s, because few frames passed 20 ms. Unloaded, the window mean is 16.6–17.1 ms; overloaded, it is 17.5 ms and up.
- *Limit:* the thresholds assume the browser can draw at 60 Hz. A 50 Hz screen, or iOS Low Power Mode at 30 fps, sits at 1.25.

**How measured:** iPad (A16) simulator, iPadOS 27.0 Safari, landscape, `?perf&auto` from the dev server. The simulator uses the Mac's GPU and runs the WebGL 2 backend. Load came from a scratch knob, not in the repo: N transparent full-screen quads in front of the camera, switched on 30 s after load. The scene's own GPU cost is far too low to load the Mac's GPU, and this load scales with the pixel count, as phase-3 shading will. A scratch on-screen log recorded each 3 s window.

**Simulator, ms mean frame interval per 3 s window:**

| Load | Ratio over time | Mean before the load | Mean at the ratio it settles on |
|---|---|---|---|
| none | 1.5 at start, 1.75 at about 9 s, 2 at about 15 s, then holds | 16.7 | 16.6–16.7 at 2 |
| 50 quads from 30 s | 2 → 1.75 → 1.5 within 6 s; tries 1.75 again after 6 s and 12 s, both taken back | 16.7 at 2; 20.6 in the first loaded window | 16.7–16.8 at 1.5 |
| 60 quads from 30 s | 2 → 1.75 → 1.5 → 1.25 within 9 s | 16.7 at 2; 20.6–22.0 at 2 and 1.75 loaded | 16.9–18.7 at 1.25 (this load is beyond what 1.25 absorbs) |
| 40 quads from 30 s, slow-share rule | holds 2 with 0–4% slow frames (mean 16.9–18.0) | 16.7 | – |

**Hitches:** the frame after a change took 16–18 ms. In one run with five changes, up and down, under load, they took 17, 16, 17, 17 and 18 ms. A change resizes the drawing buffer and its depth and MSAA targets, then draws into them in the same frame, so no cleared or stretched frame shows.

**GPU** (Chrome 155 headless on the M2, WebGPU, chase camera, uncapped as in #28, buffer 1180×820 times the ratio, ratio pinned by a scratch knob). Load average was 4–84 from other sessions, so read these as indicative:

| Ratio | 2 | 1.75 | 1.5 | 1.25 |
|---|---|---|---|---|
| Pixels, share of ratio 2 | 100% | 77% | 56% | 39% |
| Uncapped frame, median, plain scene | 0.63 ms | 0.54 ms | 0.56 ms | 0.86 ms |
| Uncapped frame, median, 20 scratch quads | 3.56 ms | 2.42 ms | 1.96 ms | 1.36 ms |

The plain scene is too light for the ratio to show: the uncapped frame is CPU-bound at about 0.6 ms. Under fill load, frame time falls with the pixel count. At 1.25 it costs 38% of ratio 2. That is in line with the phase-3 stress table above: 5.66 ms of GPU at DPR 2 and 3.30 ms at 1.5. Frame time on the real iPad remains for the owner's `?perf&auto` run. Watch the `dpr` value there.

## City culling and fog (#30)

The static kit city (roads, buildings, parked cars, lamp poles) is now one `BatchedMesh` with three's per-instance frustum culling, instead of one city-wide `InstancedMesh` per model. Sky-coloured fog starts at 150 m and is full at 350 m, which is also the camera's far plane (`tables.camera.fog`). Fog and far plane both use view depth, so geometry is fully fogged where it gets clipped and nothing pops. AI cars outside the view are skipped when their instances are written. The small box meshes (zones, dock edges, lines, signals, lamps) stay city-wide; they are a few thousand triangles.

**Why not sector instancing:** a first version split each model's `InstancedMesh` into 8×8-tile sectors. Triangles fell to 67k, but programs rose from 39 to 384 and render CPU from 0.52 to 1.34 ms. three r186 names each `InstancedMesh`'s uniform buffer after the mesh, so no two meshes share a shader, and each sector compiled its own pipeline when it first came into view. Padding every sector to one buffer size didn't help. The `BatchedMesh` has one shader and needs 18–20 programs in all.

**Sorting:** `sortObjects` is off. Depth-sorting the visible placements every frame raised allocations from 57 to 100 KB per frame without a measurable render-time gain.

**How measured:** `?perf&auto` A/B runs of production builds, as for #28. *Before* is main at `1c03c07`, *after* is the same plus this change, both before #29 landed, so at a fixed pixel ratio of 2. Chrome 155 headless, `apple metal-3` (WebGPU), 1180×820 at DPR 2. The machine was shared with other sessions; the load average is given per row.

**Chrome, cab, vsync, two alternating pairs at load 3.7–5.0** (ms, median / p95 / mean):

| | before | after |
|---|---|---|
| Frame | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 |
| Render CPU, pair 1 | 0.56 / 1.22 / 0.63 | 0.84 / 1.42 / 0.88 |
| Render CPU, pair 2 | 0.84 / 1.28 / 0.82 | 1.07 / 1.56 / 1.07 |
| Draw calls / triangles | 38 / 314k | 357 / 46k |
| Programs | 39 | 18 |
| Allocated per frame | 32–33 KB | 57 KB |

Chase: 34 calls / 316k triangles before, 355 / 48k after. On WebGPU three issues one draw per visible placement of the batch, so the call count is high, but they share one pipeline and bindings.

**Where the extra render CPU goes:** a CPU profile (8 s, cab) puts JavaScript at 0.58–0.60 ms per frame before and 0.65–0.67 ms after, of which `BatchedMesh.onBeforeRender` (testing all 2,314 placements against the view) is about 0.17 ms. The rest of the overlay's difference is native time for the ~350 draw commands and the per-frame upload of the batch's index texture.

**Uncapped** (chase, `--disable-frame-rate-limit --disable-gpu-vsync`, load 26–30, so noisy): median frame 0.63 and 0.71 ms before, 0.97 ms after. On the M2 this scene is CPU-bound uncapped, so the extra culling CPU shows and the triangle savings don't.

**iPad (A16) simulator**, iPadOS 27.0 Safari, WebGL 2 backend (no WebGPU adapter in the simulator), landscape at DPR 2 (buffer 2360×1376), load average about 6–10. Safari's WebGL 2 has `WEBGL_multi_draw`, so the batch is one call there.

| ms, median / p95 / mean | before | after |
|---|---|---|
| Frame, cab | 16.66 / 17.50 / 16.72 | 16.66 / 16.74 / 16.67 |
| Render, cab | 0.40 / 0.58 / 0.41 | 0.92 / 1.08 / 0.92 |
| Busy, cab | 0.54 / 0.80 / 0.55 | 1.04 / 1.24 / 1.04 |
| Draw calls / triangles, cab | 38 / 314k | 14 / 56k |
| Frame, chase | – / – / 16.67¹ | 16.66 / 17.06 / 16.75 |
| Render, chase | – | 0.56 / 0.70 / 0.56 |
| Draw calls / triangles, chase | 32 / 316k | 11 / 59k |

¹ That tab ran with Safari's coarse 1 ms timer, so only the mean is usable.

**Verdict:**
- *Triangles:* cut by 82–85% in both views (about 314k to 46–59k), above the "about half" asked for. Every later per-triangle cost (richer models, a shadow pass) scales with this.
- *Render CPU:* up by about 0.3 ms per frame in Chrome and 0.5 ms on the simulator's WebGL 2 backend. 60 fps holds everywhere measured. A cheaper cull (precomputed bounds, or a few sector batches tested first) could win most of that back if CPU ever gets tight.
- *Visuals:* a QA pass rendered each frame twice, with culling on and with every frustum test forced true. Cab, chase, rear, Werkstatt orbit and AI cars entering from the screen edge were pixel-identical on both backends. The fully fogged horizon is exactly the sky colour, so there is no seam.
- *Order marker:* the zone column now fades out with distance like everything else, and isn't drawn past 350 m. The HUD arrow and the minimap still lead to it.
- *Real iPad:* not measured. Its tile-based GPU bins every vertex, so the triangle cut may matter more there than on the M2; the owner's `?perf&auto` run will tell.

## Traffic at 50 km/h and speed signs (#33)

**How measured:** `?perf&auto` A/B runs of production builds, as for #28. *Before* is main at `bb92b79`, *after* is the same plus #33's feature commit, run alternately twice per view. Chrome headless, `apple metal-3` (WebGPU), 1180×820, adaptive ratio settled at 1.25; Chrome capped this run at 30 Hz, so frame time says nothing and busy time is the comparison. Load average 2.8–4.3. The 20 s overlay window ends 25 s after load, while the autopilot is still driving the first straight.

| ms, median (two runs) | before | after |
|---|---|---|
| Busy, cab | 0.97, 1.10 | 0.89, 0.92 |
| Render, cab | 0.78, 0.90 | 0.70, 0.73 |
| Sim, cab | 0.11, 0.12 | 0.12, 0.11 |
| Busy, chase | 0.98, 1.10 | 1.19, 0.99 |
| Render, chase | 0.77, 0.88 | 0.95, 0.80 |
| Draw calls / triangles, cab | 357 / 46k | 366 / 49k |
| Draw calls / triangles, chase | 372–373 / 52k | 382–383 / 55k |

The traffic step at 100 cars (`traffic.bench.test.js`): 88 µs and 18 KB allocated per step, against about 90 µs and 15 KB before.

**Verdict:** no frame-time cost beyond run-to-run noise (about ±0.2 ms). The 53 signs add 9–10 draws and 3k triangles; they share the city batch's one pipeline.

**Autopilot change:** QA found that from about 90 s in on the perf seed, the autopilot (which ignores right of way) rammed one car over and over. Since #33 it waits behind an AI car going its way, so a lap now takes about 235 s instead of 190 s. Overlay windows taken after the first 90 s are only comparable with runs from #33 on.

## Lighting and ground materials (#37)

The flat look's hemisphere light, sun without shadows, sky colour and linear fog are replaced by:
- the Poly Haven HDRI as background and as the light from all around (`scene.environment`);
- ACES filmic tone mapping;
- a sun with a 2048 PCF shadow map over ±60 m, centred 30 m ahead of the camera;
- sky-coloured haze that is still full at the far plane.

Roads get a PBR asphalt mesh, and the ground gets PBR cobbles. All kit materials move from Lambert to Standard. Numbers are in `tables.lighting` and `tables.ground`.

**How measured:** `?perf&auto` A/B runs of production builds, as for #28. *Before* is main at `d13eb2e`, *after* is the same plus this change.
- *Chrome:* 155 headless on the M2, `apple metal-3` (WebGPU), 1180×820 at DPR 2 (the ratio settles at 2), load average 3–5. GPU time comes from a scratch build with `trackTimestamp`: the mean of the render pass's timestamp queries over 10 s, at vsync. At vsync the GPU clocks down, so read these as relative.
- *Uncapped runs:* came out too noisy to use. Each frame's timestamp spans overlapped, and the medians swung 2× between variants.
- *iPad (A16) simulator:* iPadOS 27.0 Safari, WebGL 2 backend, landscape (buffer 2360×1376). It uses the Mac's GPU. The window is the overlay's last 20 s, read 30 s and 55 s after load.

**Chrome** (ms, median; GPU is the mean):

| | before | after | after, 1024 map | after, no shadow |
|---|---|---|---|---|
| Render CPU, cab | 0.75 | 1.76 | 1.69 | 0.81 |
| Render CPU, chase | 0.92 | 1.65 | 1.72 | 1.01 |
| GPU at vsync, cab | 1.58 | 6.63 | 6.42 | 6.80 |
| GPU at vsync, chase | 2.12 | 8.25 | 7.30 | 6.66 |
| Draw calls / triangles, cab | 366 / 50k | 473 / 63k | 472 / 63k | 385 / 51k |
| Programs | 18–20 | 34–36 | 34–36 | 24–26 |
| Frames over 20 ms in 10 s | 0 | 0 | 0 | 0 |

- *Where the GPU time goes:* single-feature variants in chase (one run each, ±1 ms noise) put the cost about evenly on the shading, not on the shadow map:
  - the ground and asphalt meshes, about 2 ms;
  - the sky's light (image-based lighting), about 1.7 ms;
  - sampling the sky for the haze colour, about 0.6 ms.
- *Anisotropic filtering:* 8 against 4 or 1 made no difference in alternating pairs (7.3–7.4 ms each).
- *Shadow map size:* 1024 against 2048 saved at most 1 ms, within the noise, so the map stays at 2048 (5.9 cm per texel).
- *Draw order:* the ground draws last and the asphalt just before it, so the depth test skips their texturing under buildings.

**Shadow CPU:** the shadow pass costs about 0.9 ms of render CPU. It is a second draw of the city batch, which three culls per placement against the sun's view, plus about 90 draws.

**iPad (A16) simulator** (ms, median / p95 / mean):

| | before | after |
|---|---|---|
| Frame, cab | 16.66 / 16.76 / 16.81 | 16.66 / 18.02 / 16.68; 16.66 / 17.82 / 16.67 later |
| Frame, chase | 16.66 / 16.74 / 16.67 | 16.66 / 17.88 / 16.69 |
| Render, cab | 0.92 / 1.08 / 1.02 | 2.04 / 2.38 / 2.06; 2.16 / 2.44 / 2.13 later |
| Render, chase | 0.86 / 1.02 / 0.86 | 2.16 / 2.50 / 2.15 |
| Draw calls / triangles, cab | 14 / 53k | 16–18 / 33–70k |

The adaptive ratio stayed at 2 throughout: no 3 s window had a mean frame interval over 18 ms. Safari's intervals spread more (p95 about 18 against 16.8 ms), but the mean stays at 60 fps.

**After the review fixes** (`69a2ed4`: the shadow map renders once per frame, kit normals dropped, the asphalt draws first): two alternating before/after pairs in Chrome, cab and chase, vsync. The load average was 6.5–11.6, so these are noisy.

| | before | after |
|---|---|---|
| GPU at vsync, cab | 2.88, 1.57 | 5.47, 4.68 |
| GPU at vsync, chase | 1.31, 3.34 | 6.30, 5.69 |
| Render CPU, median | 1.10–1.25 | 1.93–2.66 |
| Frames over 20 ms in 10 s | 0 | 0 |

**Load:**
- *Download:* JS +6.5 KB (+2.5 KB gzip). The new assets in `public/textures/` add 9.2 MB:
  - the 2k HDRI, 5.4 MB (3.6 MB gzipped);
  - six 1k JPEGs, 3.7 MB.
- *First playable frame* (local, Chrome headless): 600–790 ms against 290–355 ms. The extra time goes to decoding the HDRI and filtering it for the sky's light.

Cutting both the download and the decode time is #38's job (asset pipeline and download budget).

**Verdict:**
- *60 fps:* holds in the cab and chase views in Chrome and in the simulator, both backends.
- *Render CPU:* +1–1.2 ms per frame, mostly the shadow pass.
- *GPU:* on the M2 at DPR 2, up from about 2 to 6.5–8 ms at vsync clocks. By the baseline's estimate, an A16-class GPU has 40–50% of the M2's throughput. That would put the cab view near 13–16 ms at DPR 2, and about 7–9 ms at the touch start ratio of 1.5. The adaptive ratio (#29) is the safety net: it steps down to 1.25 before frames drop.
- *Real iPad:* still unmeasured. The simulator says nothing about iPad GPU speed. The owner's `?perf&auto` run on the iPad decides, so watch `dpr` there. If it sits at 1.25 and still misses 60 fps, the first costs to cut are the sky's light on the kit models (a cheaper diffuse-only material) and the haze's sky sample (a constant colour beyond the fog start).

## Asset pipeline and download budget (#38)

The sky and ground textures now come from `npm run assets` (README, "Assets") as KTX2. The pipeline's dev dependencies were vetted before install:
- `@gltf-transform/core`, `extensions`, `functions`, `meshoptimizer` and `ktx2-encoder`: each upstream repository's README publishes that exact `npm install` command (donmccurdy/glTF-Transform, zeux/meshoptimizer, gz65555/ktx2-encoder).
- `sharp` comes in through `@gltf-transform/functions` and is the decoder ktx2-encoder's README names.
- `npm audit signatures`: 24 packages have verified attestations.

None of them is used by `npm test` or `npm run build`. The ground maps are ETC1S at quality 128; UASTC came out larger than the JPGs (0.9–1.4 MB per map). The sky is UASTC HDR. The first frame waits only for a 1k copy of the sky, which also stays the scene's light. The 2k sky starts loading once everything the first frame waits for is in, and then replaces the 1k sky as background and haze. The pipeline's model stage (meshopt far copies) and tree stage (pictures baked in headless Chrome) were run on `street_lamp_02` and `jacaranda_tree`, then left out of the asset list until #40 uses them. The lamp went from 20,338 to 1,228 triangles in its far copy, 508 KB near and 58 KB far, from 1.6 MB of sources. The tree picture came out at a 24.4 m span and its trunk at 0.53 across, against the prototype's 24.2 m and 0.54.

**How measured:** production builds of main at `cd90b9c` (*before*) and this change (*after*), served the way GitHub Pages serves them. The server gzipped everything except images and KTX2, as Pages does for the `.hdr`. Chrome 155 headless on the M2, 1180×820 at DPR 2, load average 3–8.

**Download and first playable frame** (cold cache; Chrome throttled to 10 Mbit/s down with 40 ms latency, two runs each):

| | before | after |
|---|---|---|
| First playable frame, 10 Mbit/s | 7.22, 7.23 s | 2.74, 2.82 s |
| First playable frame, unthrottled | 0.79, 0.89 s | 0.54, 0.59 s |
| On the wire until then | 8.09 MB | 2.58 MB |
| Sky | 3.59 MB (2k `.hdr`, gzipped) | 0.46 MB (1k KTX2); the 2k (1.78 MB) follows |
| Ground textures (6 maps) | 3.75 MB JPEG | 1.09 MB KTX2 |
| Basis transcoder | – | 0.25 MB (`basis_transcoder.wasm`, gzipped) |
| JS bundle | 1,059 KB / 299 KB gzip | 1,115 KB / 322 KB gzip (`KTX2Loader` and its zstd decoder) |
| `public/` in all (the budget's measure) | 10.3 MB | 5.0 MB of 12 MB |

Without the 1k first sky, the after build took 3.75 s (3.90 MB). The sky alone was 46% of what the first frame waited for.

After the review, the 2k sky waits until the first frame's loads are done. Re-measured with other sessions loading the machine (load average 7–10), in alternating runs: main took 8.36, 8.44 and 8.82 s, this change 3.45, 4.56 and 3.80 s. Under load, the CPU work of transcoding and compiling shaders grows along with the download.

**Texture memory** (from the formats the transcoder picked; checked by logging them on each backend):
- *Chrome on the M2*, both backends: ETC2 for the ground maps (0.5 B per pixel), BC6H for the skies (1 B per pixel).
- *iPad (A16) simulator* (WebGL 2): ETC2 for the ground, and half-float RGBA for the skies. WebGL 2 there has no HDR ASTC, and WebGPU has neither BC6H nor HDR ASTC on iPad.

| MB, ground + sky | before | after, Mac | after, iPad |
|---|---|---|---|
| Ground (6 maps, 1k with mipmaps) | 33.6 | 4.2 | 4.2 |
| Sky | 16.8 (2k half-float) | 2.6 (2k + 1k, BC6H) | 21.0 (2k + 1k, half-float) |
| In all | 50.3 | 6.8 | 25.2 |

The JS heap in the overlay fell from 41–52 MB to 23–37 MB: the decoded JPEGs are no longer kept.

**Frame cost** (`?perf&auto`, cab, vsync):

| | before | after |
|---|---|---|
| Chrome frame, median / p95 / mean | 16.67 / 16.67 / 16.67 | 16.67 / 16.67 / 16.67 |
| Chrome draw calls / triangles | 472–476 / 63–64k | 472 / 63k |
| Chrome render CPU, median / p95 / mean | 2.38–2.50 / 3.06–3.18 / 2.23–2.34 | 2.41–2.43 / 3.13–3.27 / 2.23–2.29 |
| Chrome GPU at vsync, alternating runs | 5.10, 5.23, 6.50, 6.52 | 6.00, 6.35, 6.37, 6.39 (one outlier at 10.55) |
| iPad simulator frame, mean (Safari's timer is 1 ms coarse) | 16.66 | 16.84 |
| iPad simulator render, mean | 2.17 | 2.21 |

Both simulator runs settled at a ratio of 1.75 (`dpr`). The frame cost doesn't change measurably: the sky and ground are sampled as before, from compressed data.

**Found on the way:**
- `ktx2-encoder` marks every texture sRGB unless told otherwise. three then decoded the packed AO / roughness map as colour, and the asphalt drew 13% darker. `scripts/assets.config.js` now sets the transfer function per kind of map.
- KTX2 textures can't be flipped on upload, so the pipeline flips standalone pictures when encoding. Otherwise the sky showed its lower half.
- When the sky is scaled into half-float range, Basis records the scale in the `KTXmapRange` key, which three ignores. The 2k sky's brightest value (the sun, 73,216) is beyond that range, so the encoder scaled the whole sky by 0.89. The pipeline writes the scale to `src/assetInfo.json`, and the renderer applies it.
- three r186's `WebGPURenderer` can't upload `KTX2Loader`'s uncompressed half-float fallback, on either backend. The sky and everything hazed went black on the iPad simulator. The renderer rewraps it as a `DataTexture` (a `shortcut:` in `renderer.js`).

**Verdict:**
- *Budget:* 5.0 MB of the 12 MB under `public/`, checked in `npm test`. 7 MB is left for #39–#42.
- *First playable frame:* 2.7–2.8 s at 10 Mbit/s on a quiet machine, under the 3 s target, with about 0.25 s to spare. On a loaded machine it took 3.4–4.6 s, while main took 8.4–8.8 s. Later assets the first frame needn't wait for (props, far copies, tree pictures) should load after it, as the 2k sky does.
- *60 fps:* holds in Chrome and in the simulator, at the same frame cost as before. The real iPad's numbers, including the sky's 21 MB of half-float texture there, remain for the owner's run.

## Procedural buildings (#39)

The Kenney building models give way to procedural buildings (`src/buildings.js`, numbers in `tables.buildings`): rows of buildings along every street face of a block, with plastered or brick walls, recessed windows in stone surrounds, sills, shutters, shop fronts, cornices, plinths and tiled roofs. Four Poly Haven textures come with them: three walls and a roof, 1.95 MB. The kit's commercial models go (−0.2 MB), so `public/` is now 7.3 MB of 12 MB.

**How it is drawn:**
- *Merged meshes:* walls, roofs and facade parts are merged per 196 m chunk of the map, a mesh per material. Each chunk is culled whole against the view and the sun. 98 m chunks drew fewer triangles, but cost 0.5–2 ms more render CPU, from twice as many objects in both passes.
- *Close-up detail:* window surrounds, sills and open shutters (86% of the city's 0.92M triangles) are in separate meshes, one per direction the facades face. They draw only within 120 m and only on facades facing the camera, and they cast no shadow.
- *Geometry:* indexed and without normals (flat shading), with colours as bytes. Box parts share their eight corners. That makes 31 MB of vertex data for the whole city. three keeps it in the JS heap as well as on the GPU. The heap after a forced GC goes from 21 to 64 MB.
- *Textures:* the wall and roof textures load after the first frame. Until then the materials use one-texel stand-ins sampled alike, so the swap builds no new shaders: 43 programs throughout.
- *Generation:* about 350 ms on the M2. It runs one macrotask after `createRenderer`, so the model and texture requests go out first.

**How measured:** as for #37 and #38. Production builds of main `324a938` (*before*) and this change (*after*), `?perf&auto`, alternating runs, load average 6–13.

**Chrome** (M2, WebGPU, DPR 2, vsync):

| | before | after |
|---|---|---|
| Render CPU median, cab | 1.68, 1.76 | 2.09, 2.25 |
| Render CPU median, chase | 2.28, 2.13 | 1.99, 2.26 |
| GPU at vsync, cab | 5.05, 5.91 | 4.94, 6.67 |
| GPU at vsync, chase | 5.26, 6.58 | 6.54, 6.77 |
| Draw calls / triangles, cab | 476–477 / 63–64k | 263–265 / 177k |
| Frames over 20 ms | 0 | 0 |
| First playable frame at 10 Mbit/s | 2.95–3.25 s | 3.06–3.28 s |
| On the wire | 2.58 MB | 2.39 MB |

**iPad (A16) simulator** (Safari, WebGL 2, cab, a window of 1,200 frames; ms median / p95 / mean):

| | frame | render | ratio | calls / tris |
|---|---|---|---|---|
| before | 16.68 / 20.16 / 17.03 | 2.28 / 3.08 / 2.36 | 2 | 18 / 38k |
| first version: close-up detail cast shadows | 18.52 / 21.42 / 18.76 | 1.88 / 2.48 / 1.95 | 1.25 | 88 / 258k |
| … close-up detail switched off | 17.30 / 27.96 / 18.95 | 1.94 / 2.96 / 2.08 | 1.25 | 61 / 68k |
| … walls without textures | 18.70 / 25.90 / 19.44 | 2.04 / 2.70 / 2.09 | 1.25 | 74 / 227k |
| … buildings cast no shadow at all | 16.68 / 19.96 / 17.07 | 1.40 / 2.12 / 1.50 | 1.5 | 49 / 117k |
| shipped: close-up detail casts no shadow | 16.74 / 19.86 / 17.22 | 1.60 / 2.42 / 1.68 | 1.25–1.5 | 81–104 / 113–175k |

- *The cost was the shadow pass*, not triangles or textures: the close-up detail of whole chunks drawn into the sun's shadow map. Without it, the simulator holds 60 fps.
- *Ratio:* the adaptive ratio settled lower than before. It was at 1.25 one minute in and 1.5 later, against 2 before. The simulator draws on the Mac's GPU, so this says little about a real iPad's GPU.

**Verdict:**
- *60 fps:* holds in the cab view in Chrome and in the simulator, but the simulator gets there at a lower pixel ratio than before.
- *Real iPad:* the owner's `?perf&auto` run on a real iPad decides. If it misses, these are the first costs to cut:
  - building shadows (walls and roofs still cast);
  - the detail distance (`tables.buildings.detailDistance`);
  - the walls' full PBR maps.
- *Budget:* the download budget check passes, at 7.3 of 12 MB. Render CPU is up 0.3–0.5 ms in the cab view.

## Procedural vehicles (#41)

The Kenney sedan, SUV and van are replaced by cars generated in `src/vehicles.js` from `tables.vehicles`: a hatch, a sedan and a van, all fitted to `city.obstacles.car`. Each has a painted body and a details mesh, at a near and a far detail level. AI cars and the 14 parked cars share one instanced mesh per kind, detail level and part. `drawCars` culls and fills them each frame. Two parked spots get Poly Haven's `covered_car` (579 KB near, 114 KB far), which loads after the first frame. With #39, `public/` is now 6.8 MB of the 12 MB budget (the three Kenney cars it drops were 0.56 MB).

**How measured:** `?perf&auto` in the cab view. *Before* is main at `324a938`, *after* is this change. *100 cars* is a scratch copy with every rank tier at 100 cars and the spawn ring at 45–400 m, as for #37. Chrome 155 headless on the M2, `apple metal-3` (WebGPU), 1180×820 at DPR 2, vsync, load average 4–6. The iPad (A16) simulator ran Safari on the WebGL 2 backend, in landscape, with the window read about 60 s after load. The machine was shared with other sessions, so the simulator's numbers move by ±2 ms between runs; before and after were run back to back.

**Chrome** (ms, median / p95 / mean; GPU is the mean of the timestamp queries at vsync):

| | before | after | before, 100 cars | after, 100 cars |
|---|---|---|---|---|
| Render CPU | 1.69 / 2.83 / 1.89 | 2.12 / 2.79 / 1.90 | 2.08 / 2.59 / 1.98 | 2.21 / 2.66 / 2.03 |
| GPU at vsync | 6.68 | 4.82 | 4.63 | 4.77 |
| Draw calls / triangles | 472 / 63k | 477 / 60k | 456 / 198k | 460 / 85k |
| Programs | 35 | 54 | 35 | 54 |
| Frames over 20 ms in 10 s | 0 | 0 | 0 | 0 |

**iPad (A16) simulator** (frame and render in ms, median / p95 / mean):

| | before | after |
|---|---|---|
| Frame, 8 cars | 16.66 mean (#38) | 16.68 / 18.98 / 16.87 at ratio 2 |
| Render, 8 cars | 2.21 mean (#38) | 2.18 / 2.58 / 2.17 |
| Frame, 100 cars | 16.66 / 18.02 / 16.83 at ratio 1.75 | 16.72 / 18.92 / 17.00 at ratio 2 |
| Render, 100 cars | 2.32 / 3.20 / 2.39 | 2.48 / 2.98 / 2.51 |

**Found on the way:**
- *Car shadows:* the first version let every car cast a shadow. With 100 cars the simulator then ran 20–23 ms per frame at ratio 1.25, against 16.7 ms on main. With no car shadows it was back at main's numbers. Now only the near detail level (within `vehicles.near`, 25 m of the truck) casts shadows. Cars beyond that stand without one, which haze and distance hide.
- *First sight of a kind:* the first frame a covered car came into view stalled for 130–180 ms in Chrome; `compileAsync` and `initTexture` didn't help. `drawCars` now leaves every car mesh visible, with no instances, for one frame after loading. three then sets up its shaders and textures for the view and the shadow but draws nothing, so the cost lands in the first half-second.
- *Covered car:* the pipeline's meshopt output stores positions as normalized int16, which can't hold metres once the fit is baked in, so the renderer converts them to floats first. Its five meshes share one material and are merged into one per detail level.
- *Programs:* 35 → 54. The added ones are the paint, the details and the covered car's materials, each for the view and the shadow, compiled during the warm-up frame.

**On top of #39** (rebased onto `3241507`, the procedural buildings; re-measured back to back, load average 7–8):

| | main with #39 | #41 with #39 |
|---|---|---|
| Chrome, 8 cars: render CPU / GPU / triangles | 1.57 / 2.89 / 1.79; 6.69; 175k | 2.12 / 3.30 / 2.18; 7.95; 172k |
| Chrome, 100 cars: render CPU / GPU / triangles | 2.05 / 2.69 / 1.97; 8.05; 317k | 1.62 / 2.64 / 1.80; 5.17; 205k |
| Simulator, 100 cars: frame | 24.26 / 31.90 / 24.90 at ratio 1.25 | 18.08 / 21.72 / 18.63 at ratio 1.25 |
| Simulator, 100 cars: render / triangles | 2.52 / 3.04 / 2.55; 308k | 1.92 / 2.66 / 1.99; 187k |

With #39's buildings, main itself misses 60 fps in the 100-car stress run on the simulator. #41 makes that run faster, because the 100 Kenney cars cost more than the generated ones' far detail level, but it still runs at 18 ms rather than 16.7.

**Verdict:**
- *60 fps:* holds in the cab view in Chrome, with 8 cars and with 100. In the simulator it holds with 8 cars. With 100 cars it held before #39, but not on top of it: 18.1 ms per frame, down from main's 24.3 ms. #39's buildings are the larger cost there (see its section).
- *Triangles:* down from 198k to 85k at 100 cars, because far cars use 14×12-section bodies.
- *Real iPad:* still unmeasured. The simulator says nothing about the A16's GPU speed.

## Street dressing (#40)

The streets get pavements, lanterns, trees and small props (`src/streets.js`, numbers in `tables.streets` and `tables.city.plaza`):
- *Pavements:* raised 15 cm with stone kerbs, on the outer 1.4 m of road tiles beside buildings. That is the band the road models already drew as pavement and the Sim keeps clear of the lanes. They are not solid, and none run across a dock's bay.
- *Lanterns:* Poly Haven's `street_lamp_02` hangs between two windows of #39's buildings, about every 24 m, and on each `p` pole, which is now an iron post.
- *Facade props:* potted plants beside some doors and flower boxes on some sills.
- *Open ground:* rows of crossed-quad trees (three baked species), with bins, bollards and drinking fountains. They are solid Sim colliders.

The new assets add 1.2 MB, so `public/` is now 8.0 MB of 12 MB with #41's covered car, counted as the budget test counts it: the pavement texture 418 KB, the lantern 508 KB plus a 58 KB far copy, and the tree pictures 204 KB. They all load after the first frame, so the first frame waits for about as much as before (2.39 MB).

**How it is drawn:**
- *Pavements and kerbs:* two merged meshes, always drawn. The pavement uses the ground material's later-loading maps.
- *Instanced sets:* every lantern, post, pot, box, bollard, bin and fountain is drawn from an instanced set by distance. Each frame looks only at the 32 m cells within reach and copies precomputed matrices: 0.04 ms in Node. Visiting every place had cost 0.42 ms.
- *Lantern levels:* the full model (20k triangles) within `near`, then the far copy (1.2k) up to `cull`. The glass is always the far copy's, so it doesn't change at the swap.
- *Trees:* three instanced meshes, one per species, culled whole.

**How measured:** as for #39. Production builds of main `3241507` (*before*, with #39) and this change (*after*), `?perf&auto`, alternating runs.

**iPad (A16) simulator** (Safari, WebGL 2, cab, a window of 1,200 frames; ms median / p95 / mean):

| | frame | render | ratio | calls / tris |
|---|---|---|---|---|
| before | 16.68 / 17.38 / 16.72 | 1.30 / 1.74 / 1.37 | 1.5 | 57 / 100k |
| lanterns full model to 10 m, far copy to 100 m, props to 150 m, props cast shadows | 17.08–17.14 / 19.36–19.48 / 17.42–17.49 | 1.92 / 2.52–2.54 / 1.99 | 1.5 | 77 / 167–170k |
| … props cast no shadows | 16.90–17.00 / 19.16–19.20 / 17.29–17.37 | 1.86–1.88 / 2.38 / 1.93 | 1.5 | 73–75 / 156–161k |
| shipped: also lanterns 8 m / 70 m, props 90 m | 16.84–16.86 / 18.80–18.86 / 17.16–17.19 | 1.80 / 2.40–2.42 / 1.87–1.88 | 1.75 | 64–69 / 137–163k |

**Earlier, before #39:**
- With the lanterns' full model to 20 m, far copies to 150 m and lantern shadows, the simulator dropped to its lowest ratio, 1.25, at a mean frame of 18.4 ms.
- Without lanterns, it matched main.
- *The cost is the lanterns.* What helped was fewer of them (shorter distances), no shadows from them or the props, and the cheaper per-frame update. The pavements, kerbs and trees cost next to nothing.

**Chrome** (M2, WebGPU, DPR 2, vsync, the shipped build; ms):

Load average 2–10, alternating runs:

| | before | after |
|---|---|---|
| Render CPU median, cab | 3.10, 2.12 | 2.30, 2.38 |
| Render CPU median, chase | 1.98, 1.34 | 2.06, 2.33 |
| GPU at vsync, cab | 6.66, 7.46 | 7.82, 7.90 |
| GPU at vsync, chase | 8.01, 8.30 | 9.06, 8.72 |
| Draw calls / triangles, cab | 262–268 / 172k | 273 / 221–223k |
| Frame median / p95 | 16.67 / 16.67 | 16.67 / 16.67 |
| First playable frame at 10 Mbit/s (load average ~17, earlier build) | 4.38, 4.64 s | 4.62, 4.75 s |
| On the wire | 2.27–3.06 MB | 2.39 MB |

**Verdict:**
- *60 fps:* holds in the cab view in Chrome. In the simulator, the median frame is 0.2 ms over vsync, and the ratio climbs to 1.75, against 1.5 for main.
- *Real iPad:* still unmeasured. If it misses, these are the first costs to cut:
  - the lantern far copies' distance (`tables.streets.lantern.cull`);
  - the flower boxes (`tables.streets.flowers`: 1,207 boxes in the city, about 100 triangles each).
- *Budget:* the download budget check passes at 8.0 of 12 MB, and the first playable frame is unchanged. Render CPU is up about 0.5 ms in the simulator, from about 15 more objects.

## Skyline ring (#42)

A generated ring of background buildings now stands round the grid city (`src/skyline.js`, numbers in `tables.skyline`). It starts 14 m outside the map's edge and reaches 300 m beyond that. It has 2,536 plain blocks with a painted window picture and hipped roofs in #39's roof texture, plus three domes, three bell towers and two roof arcades. Each landmark stands at the end of a street that runs out to the edge, so it shows down that street. The ring is two meshes, walls and roofs, with no colliders and no shadows either way. It draws after the city (`renderOrder` 0.5), so the depth test skips what the city hides. The haze fades it like everything else. The far plane is unchanged at 350 m, which is about the ring's far side seen from the edge road, so nothing had to grow. The ground plane is now centred on the map so it reaches under the ring. The ring adds nothing to download: its picture is a 64 px canvas, and the JS grows by 2 KB.

**How measured:** as for #39 and #41. Production builds of main `2444973` (*before*) and this change (*after*), with the timestamp patch. `?perf&auto` on Chrome 155 headless on the M2 (WebGPU, 1180×820 at DPR 2, vsync), in three alternating rounds of cab and chase, gated on load average under 15. The first round still ran at 13–17 and is the noisiest. The iPad (A16) simulator ran Safari on WebGL 2 in the cab view, two alternating rounds, each window read about 150 s after load. Other sessions' headless Chrome runs overlapped some simulator windows, so its numbers move by about ±1.5 ms.

**Chrome** (render CPU median ms; GPU is the mean of the timestamp queries at vsync, ms):

| | before | after |
|---|---|---|
| Render CPU, cab | 2.13, 1.92, 1.94 | 3.08, 1.47, 1.80 |
| Render CPU, chase | 2.31, 1.80, 1.68 | 2.45, 2.38, 1.70 |
| GPU, cab | 7.53, 9.08, 6.11 | 7.70, 8.16, 7.79 |
| GPU, chase | 12.59, 7.65, 8.61 | 7.14, 6.70, 6.21 |
| Draw calls / triangles, cab | 266–271 / 172–181k | 266–271 / 214–222k |
| Draw calls / triangles, chase | 266–267 / 151–155k | 267–271 / 193–198k |
| First playable frame at 10 Mbit/s | 3.82, 3.25 s | 3.43, 3.44 s |
| On the wire | 2.27 MB | 2.27 MB |

**iPad (A16) simulator** (ms, median / p95 / mean):

| | frame | render | ratio |
|---|---|---|---|
| before, round 1 | 17.92 / 20.58 / 18.05 | 1.68 / 2.24 / 1.73 | 1.25 |
| after, round 1 | 16.72 / 19.30 / 17.39 | 1.46 / 2.04 / 1.54 | 1.75 |
| before, round 2 | 18.60 / 21.42 / 18.70 | 1.80 / 2.38 / 1.85 | 1.25 |
| after, round 2 | 16.66 / 18.06 / 16.76 | 1.60 / 2.26 / 1.68 | 1.5 |

- *Cost:* +42k triangles, drawn whole every frame. Each mesh's bounds span the whole ring, so it is never culled, even from the city centre, where all of it lies past the far plane. It adds two draw calls and one program (the walls' material; the roofs share #39's). Render CPU, GPU and the simulator's frame times show no cost above the noise. Both simulator rounds of *after* came out ahead of *before*, which is noise from the overlapping runs, not a gain.
- *Build:* 40–55 ms on the M2 (`planSkyline` plus `skylineMeshes`), in the macrotask after #39's buildings, before the first frame. The first playable frame stayed within its noise.
- *Left in:* the walls between back-to-back buildings, which are never seen, and the zero-area triangles where hipped roofs meet a single ridge point. About a quarter of the roof triangles are zero-area. Cheap to remove if the real iPad shows vertex cost.
**On top of #40** (#40 landed while this was measured; one Chrome round in the cab view, main `4b03a4f` against this change, load average 4–5): render CPU 2.31, 2.84 → 2.70, 2.32 ms; GPU 6.84, 7.76 → 9.35, 7.37 ms; draw calls / triangles 277 / 219k → 279 / 260k. Frames held 16.67 ms throughout. The simulator wasn't re-run on top of #40.

**Verdict:**
- *60 fps:* no measurable cost on top of main in Chrome or in the simulator. In these simulator runs main itself sat at ratio 1.25 and 18 ms, as in #41's notes.
- *Budget:* the download budget check passes, with nothing added to `public/`.
- *Real iPad:* still unmeasured.

## Police patrols (#68)

Two police cars (`tables.police`) drive on top of the tier's AI cars and stay anywhere in the city. Each step the Sim checks whether one sees the truck: police cars within 60 m only, two lines of at most 120 samples each. The renderer gains one car kind, which means four instanced meshes (near and far, body and details). They are hidden while no police car is in view. There is also a second sedan skin, and the details atlas grows from 256×64 to 512×256.

**How measured:** Chrome headless on the M2 (WebGPU, 1180×820, DPR 1), `?perf&auto` on the dev servers of main `d938a17` and this change, in two alternating rounds of 40 s each, load average 5–11. These are relative checks only; the iPad wasn't measured. The traffic bench (`traffic.bench.test.js`) ran alternately on both, at load average under 5.

| | main | police |
|---|---|---|
| busy, mean ms | 2.45, 2.49 | 1.85, 2.43 |
| sim, mean ms | 0.08, 0.08 | 0.07, 0.09 |
| render, mean ms | 2.34, 2.37 | 1.76, 2.30 |
| traffic step, 100 (+2 police) cars | 99.1, 98.9 µs | 107.0, 108.0 µs |

**Verdict:** no measurable frame cost. The bench step is about 8 % slower with 2 % more cars. The police cars drive far from the truck, and their spawns change the random draws, so the replayed traffic is not the same. It stays far under the bench's 1 ms limit.

## Junction rules (#69)

The city gains 5 light junctions (12 in all, 48 lights) and 208 right before left warning signs, which join the city's batched mesh as one more geometry (a post and five thin layers, culled with the rest). Each Sim step walks at most a few tiles ahead of the truck for the HUD hint. In the traffic step, a car that is first at a crossing gets an arrival stamp. `atJunctions` uses index loops and plain bit stores, because the extra lights pushed the old loop's per-step allocation over the bench's 32 KB.

**How measured:** `traffic.bench.test.js` on the M2, Node 26, several runs each, at a load average under 5. Main `1cdb2b4` on the old and new maps was against this change.

| | traffic step, 100 (+2 police) cars | allocated per step |
|---|---|---|
| main, old map | 105 µs | 26 KB |
| main, new map | 104 µs | 35 KB (over budget) |
| this change, new map | 104–112 µs | 23–28 KB |

**Verdict:** within the bench's budget (1 ms, 32 KB). Frame times weren't measured with `?perf`. The added signs and lights are static geometry in batches that already exist.

## Cab interior and instruments (#57)

The cab interior is our own geometry: about ten meshes merged by material (dash, trim, headliner, cluster, chrome, wheel, needles), a dial texture drawn once on a canvas, and a small gear texture redrawn only when the gear changes. It is drawn in the cab view only.

**How measured:** `?perf&auto` in headless Chrome (WebGPU, Metal) at 1180×820 with deviceScaleFactor 2, the overlay read after 30 s, on the M2. Main `c33e600` against this change, one heavy process at a time. These are relative Chrome numbers, not iPad numbers. The real-iPad run is the owner's `?perf&auto`.

| | frame ms median / p95 | render ms median / p95 | calls |
|---|---|---|---|
| main, cab view (2 runs) | 16.7 / 33.3, 16.7 / 16.8 | 5.8 / 12.3, 5.9 / 10.4 | 201–217 |
| this change, cab view | 16.7 / 16.8 | 5.5 / 8.6 | 176 |
| this change, chase view | 16.7 / 16.7 | 5.7 / 8.5 | 288 |

**Verdict:** no measurable frame cost. Both hold 60 fps in Chrome, and the run-to-run spread on main is larger than any difference. The adaptive resolution picked dpr 1.25–2 across runs, so the call counts move with the view.

## German light layout (#70)

The posts move to the near right corner and the stop lines 9 m before them. AI cars stop at the line, and the lights gain a red-and-amber phase. The geometry is the same per light, so only the traffic step can change.

**How measured:** the traffic bench and `?perf&auto` in headless Chrome as for #57 (1180×820, cab view), main `6251417` against this change, alternating. The machine was under outside load (load average 5–20), so these numbers are noisy.

| | traffic step, 100 (+2 police) cars | allocated per step | busy ms mean (2 runs) |
|---|---|---|---|
| main | 164–167 µs; 229–283 µs under load | 26–27 KB | 6.89, 3.76 |
| this change | 139–147 µs; 261–365 µs under load; 104 µs alone | 24–28 KB | 8.19, 3.29 |

**Verdict:** within the bench's budget (1 ms, 32 KB). There is no measurable frame cost: draw calls and triangles are unchanged, and the busy times move with the load, not the change.

## Turn stutter (#73)

Play-testers saw stutter in quick turns. `?perf` now also records a per-frame trace (frame interval, Sim steps, the drawn truck, the camera, dpr), which `perfTrace()` in the console returns.

**How measured:** dev build at 1180×820, `?perf&auto` with the truck put 6 tiles before each of the loop's four corners at 12 m/s, the autopilot taking the turn, 9 s per corner. The chase arm was measured separately with the truck held at a junction (col 8, row 8, and three spots off its centre) and turned on the spot at 1.5 rad/s. Judder is how far a frame's camera turn rate is off its 13-frame mean. Turning frames are those turning at over 0.25 rad/s. **Headed Chrome is needed:** headless Chrome paces frames perfectly (every frame one Sim step), which hides the bug.

| headed Chrome, 60 Hz | 0- or 2-step frames | turning frames with judder > 50 % | arm jump per frame, max |
|---|---|---|---|
| main `a1e324f`, chase (2 runs) | 1–31 % per corner | 1–27 % per corner; all 0/2-step turning frames | 2.2 m (junction spin) |
| main `a1e324f`, cab | 2–32 % | 1–33 %; all 0/2-step turning frames | – |
| this change, chase | 0–41 % | 1 % | 0.26 m |
| this change, cab | 0–39 % | 1–2 % | – |
| headless Chrome, either (control) | 0 % | 1 % | – |

No frame was over 25 ms from the turns (max 18.8 ms; one 34 ms frame in 4,000, not repeated) and the pixel ratio never changed, so frame spikes and resolution steps are ruled out. The headless busy time is unchanged (2.6 ms mean with the blend, 3.0 without, within noise; the blend runs outside the timers).

**Verdict:** the stutter was the frame loop drawing the latest fixed step while the display's frames don't line up with it (`src/blend.js` now draws between the last two steps), plus the chase arm's instant pull-in (now at most `camera.chasePullIn`). These are Chrome numbers. The iPad check is the owner's `?perf&auto` run.

## Monti look (#65)

With `?map=monti`, Monti gets the realistic look. Roads are ribbons along the graph's edges with a disc on each junction, in #37's asphalt. Raised pavements with stone kerbs (#40's materials) run along every road edge, and the pedestrian ways and squares are paved level with the road (`src/roads.js`). Buildings use #39's facades on the real outlines (`planBuildings` in `src/buildings.js`): one facade run per wall, with party walls left blank. No textures are added.

- *Pavements:* each is a strip along a road, less every convex road piece cut out of it with `subtract` from the map builder, so it stops exactly where the road surface starts. A test on the real extract checks that no paving covers a road piece by more than 1 cm and that no lane runs under paving. They come to 18k triangles of paving and 61k of kerb stones, in two meshes, built in about 330 ms with the buildings, after the first requests go out.
- *Close-up detail:* Monti's facades face every way, so their close-up meshes are bucketed by the nearest of the four directions, as on the grid, and also cut into `tables.buildings.nearChunk` (49 m) squares. With whole 196 m chunks, the cab view drew 513k triangles; with 49 m squares it draws 340k.

**How measured:** Chrome on the M2, dev build, `?map=monti&perf`, 1257×856 at dpr 2, truck standing, vsync, the overlay read after 7–10 s. The grid was measured in the same sitting with `?perf`. These are relative numbers; the iPad check is the owner's `?perf&auto` run.

| | draw calls / triangles | render ms median / p95 | texture memory (three's `info.memory`) | geometry buffers |
|---|---|---|---|---|
| Monti before (#62, plain blocks), cab | 25 / 78k | – | – | – |
| Monti, cab at the start | 105 / 340k | 2.1 / 3.4 | 56.2 MB (49 textures) | 17.4 MB |
| Monti, chase at the start | 99 / 356k | 1.9 / 3.2 | | |
| Monti, cab at the five-arm junction | 114 / 318k | 1.9 / 3.0 | | |
| Grid, cab at the start (10 cars) | 370 / 241k | 3.5 / 5.5 | 56.3 MB (56 textures) | 12.1 MB |

Frames held 16.7 ms throughout. Against #37–#42's budget, Monti draws under a third of the grid's draw calls with the same texture memory, and spends less render CPU. It draws about 1.4× the grid's triangles and holds 1.4× its geometry buffers. AI traffic isn't on Monti yet (#63). Monti has no lanterns, plants, trees or skyline yet (#66).

## Monti dressing and skyline (#66)

Monti gets its street furniture, lanterns, plants and skyline. OSM's trees, bollards, fountains and waste baskets stand where the furniture extract puts them, unless that is on the road. They are solid, like the grid's plaza props, and drawn with #40's props and tree pictures. #40's wall lanterns, door pots and flower boxes go on the real walls that face a road (`tables.streets.roadReach`). The skyline is the prototype's ring of real buildings: walls with #42's window picture and flat roofs in the roof texture, two meshes with no colliders and no shadows. `npm run maps` keeps only the ring buildings outside the map within the camera's reach (`camera.fog[1]`, 350 m): 2,109 of 9,466. That cuts the file from 1.96 MB to 0.44 MB, so the download shrinks by 1.5 MB. The ring is 54k wall and 24k roof triangles, built in about 50 ms.

**How measured:** as for #65. Headless Chrome on the M2, dev build, `?map=monti&perf`, 1257×856 at dpr 2, truck standing, overlay read after 9 s. main (`e9b11e2`) was measured in the same sitting. Relative numbers only; the iPad check is the owner's `?perf&auto` run.

| | draw calls / triangles | render ms median / p95 | texture memory | geometry buffers |
|---|---|---|---|---|
| main, cab at the start | 105 / 338k | 2.2 / 3.0 | 56.2 MB (49 textures) | 15.2 MB |
| #66, cab at the start | 120 / 423k | 2.5 / 4.1 | 56.2 MB (56 textures) | 19.6 MB |
| main, chase at the start | 99 / 354k | 2.3 / 3.0 | | 16.1 MB |
| #66, chase at the start | 113 / 436k | 2.9 / 4.1 | | 20.6 MB |
| main, cab by a fountain (Via Leonina) | 127 / 376k | 1.1 / 2.9 | | 19.6 MB |
| #66, cab by a fountain (Via Leonina) | 141 / 460k | 3.0 / 4.1 | | 24.1 MB |

Frames held 16.7 ms throughout. The dressing adds about 15 draw calls: the ring's two, plus the instanced props, lanterns and trees. The ring accounts for most of the 85k added triangles, since it is never culled. three counts 7 more textures (the tree pictures and the lantern's), but its texture bytes stay at 56.2 MB. On the iPad, the first things to cut are still `lantern.cull` and `flowers` (#40), and then the ring's triangles (one roof and wall mesh per side, so each can be culled).

## Switch to Monti (#67)

Monti is the only map. The grid city, the road kit, the generated skyline and the grid's spot buildings are gone. The page preloads the two map files (`index.html`) and builds the map before anything else; the skyline ring now loads after the first frame.

**How measured:** production builds of main (`76a8f8a`, the grid by default) and this change, served the way Pages serves them (gzip except images and KTX2), Chrome 155 headless on the M2, 1180×820 at dpr 2, load average 1.4–2.4. The runs alternated main and #67. Relative numbers only; the iPad numbers are the owner's `?perf&auto` run.

**`?perf&auto`** (vsync, overlay after 25 s; median / p95 / mean ms):

| | busy | render | sim | draw calls / triangles | JS heap |
|---|---|---|---|---|---|
| main (grid), cab | 2.63 / 3.27 / 2.61 | 2.52 / 3.15 / 2.49 | 0.08 | 320 / 267k | 96 MB |
| #67 (Monti), cab | 2.82 / 3.36 / 2.78 | 2.68 / 3.17 / 2.64 | 0.10 | 97 / 336k | 126 MB |
| main (grid), chase | 2.58 / 3.16 / 2.56 | 2.46 / 3.02 / 2.43 | 0.09 | 321 / 248k | 111 MB |
| #67 (Monti), chase | 2.92 / 3.44 / 2.87 | 2.76 / 3.25 / 2.72 | 0.10 | 91 / 335k | 127 MB |

Frames held 16.7 ms throughout; three counts 56 textures in both.

**Map build** (`?perf`'s new "map build" line: `buildOsmMap` in `main.js`): 138–140 ms in the production build, 673–677 ms in the dev build. The Sim's traffic setup that follows adds about 40 ms (Node).

**First playable frame** (cold cache, 10 Mbit/s with 40 ms latency; two runs each):

| | main (grid) | #67 |
|---|---|---|
| 10 Mbit/s | 2.87, 2.87 s | 3.25, 3.24 s |
| 10 Mbit/s, before the preload and the later ring | 2.92, 2.92 s | 3.35, 3.34 s |
| Unthrottled | 0.97 s | 1.35 s |
| On the wire until then | 2.33 MB | 2.32 MB |

*Verdict:* 0.25 s over the 3 s target, and about 0.45 s over #38's 2.7–2.8 s. The bytes are the same as main's, so the gap is CPU before the renderer can start its downloads. A CPU profile of an unthrottled load puts about 0.25 s of it in the map build: cutting the building outlines back from the roads (`subtract` in `osm.js`), the road graph's `nearest`, and the bollards along pedestrian ways. Creating the renderer before the Sim gained nothing. To get under 3 s, bake the built map (or at least the cut-back outlines) in `npm run maps`, or build it in a worker while the textures download.

## Day and night (#52)

The light follows the game clock: the sun moves and changes colour and strength, the sky, its haze and its light are tinted, and at night the moon lights the city. At night the truck's headlights and the street lights come on. They are drawn glows, not lights: an additive glow on the road ahead of the truck, and for each lantern a glow on its wall and one on the pavement, drawn by distance with the lanterns (`lantern.cull`), plus the lantern glass glowing. `?perf&hour=22` sets the clock, so `?perf&auto&hour=22` measures the loop at night.

*Why not real lights:* three's lights cost every lit fragment of every frame, whatever their intensity, so they cost by day too. Switching them on only at night rebuilt every shader, which stalled a frame for 6.9 s in one run. One spot light for the headlights and three point lights in the nearest lanterns took the cab view's GPU time from 8.0 to 11.5 ms, by day as well as at night. The glows cost 0.4 ms at night and nothing by day. They are drawn by day with no instances (the headlight glow in the first frame), so their shaders are ready at dusk: no frame over 100 ms when the lights switch on at 20:00 or off at 06:00.

**How measured:** production builds of main (`0cd86ce`) and this change, Chrome 155 headless on the M2, 1180×820 at dpr 2, `?perf&auto` (vsync), load average 1.5–4. GPU time is from WebGPU timestamp queries (`trackTimestamp` in a patched copy of each build, 900 frames after 6 s of driving), so it is inflated by the GPU's low clocks at vsync and good for comparing only. Relative numbers; the iPad numbers are the owner's `?perf&auto&hour=22` run.

| | GPU ms median / p95 | render ms median / p95 | draw calls / triangles |
|---|---|---|---|
| main, cab | 8.0 / 8.3 | 2.7 / 3.3 | 113 / 353k |
| #52 by day (08:00), cab | 8.1 / 8.4 | 3.0 / 3.6 | 129 / 405k |
| #52 at night (22:00), cab | 8.4 / 8.7 | 2.7 / 3.3 | 117 / 361k |
| main, chase | 9.3 / 9.8 | 2.8 / 3.3 | 108 / 359k |
| #52 by day, chase | 9.5 / 9.9 | 3.0 / 3.5 | 120 / 400k |
| #52 at night, chase | 9.7 / 10.2 | 2.8 / 3.4 | 111 / 366k |
| #52 with real lights (1 spot + 3 point), cab, day or night | 11.5 / 12.0 | | |

Frames held 16.7 ms throughout. At night the city has 5 AI cars rather than 8 (`traffic.night`); the overlay counts 7 and 10 with the two police cars. By day at 08:00 the low sun's shadow takes in more buildings than #37's fixed noon sun: 16 more draw calls and 52k more triangles in the shadow pass, at 0.1 ms of GPU and 0.3 ms of render CPU.

After these numbers, QA made the night lighter (moon 0.6, sky key `0x2a3450`), added a reversing-light glow in gear R, and lit the Werkstatt showroom as at noon. These change uniform values and add one glow mesh that is drawn only in reverse, so the table still holds.

## Weather (#53)

Rain and fog fade in and out over 30 s on a schedule (`tables.weather`). Both shorten the fog range and with it the camera's far plane, thicken the haze, dim the sun and turn the sky an even grey. Rain also darkens the roads and pavements and makes them glossier (their materials' own colour and roughness, so no new shaders), and draws 1,500 streaks as one mesh whose vertex shader wraps them round the camera (12k triangles, one draw call, drawn only in rain and in the first frame so its shader is ready). `?perf&weather=rain` (or `fog`) brings only that weather, ramping in from clear over the first 30 s.

**How measured:** as for #52: production builds of main (`4cad4b5`) and this change with WebGPU timestamp queries, Chrome headless on the M2, 1180×820 at dpr 2, `?perf&auto` (vsync), 900 frames after 35 s of driving (the rain at full strength). Main and this change were run back to back, twice each, as the machine drifted by up to 0.3 ms between batches. Relative numbers; the iPad numbers are the owner's `?perf&auto&weather=rain` run (`&hour=22` for night).

| | GPU ms median / p95 | render ms median / p95 | draw calls / triangles |
|---|---|---|---|
| main at night (22:00), cab | 7.8 / 8.4 | 2.6 / 3.2 | 96 / 258k |
| #53 clear at night, cab | 8.1 / 8.6 | 2.7 / 3.3 | 96 / 258k |
| #53 rain at night, cab | 8.1 / 8.7 | 2.7 / 3.3 | 97 / 270k |
| #53 rain by day (12:00), cab | 7.7 / 8.1 | 2.8 / 4.4 | 89 / 253k |
| #53 fog by day, cab | 7.5 / 8.0 | 2.7 / 3.2 | 83 / 241k |
| main at night, chase | 9.1 / 9.6 | 3.1 / 4.4 | 85 / 266k |
| #53 rain at night, chase | 9.5 / 10.1 | 2.7 / 3.2 | 87 / 279k |

Frames held 16.7 ms throughout. The weather costs about 0.3 ms of GPU in every frame, clear weather too: the sky and haze now read uniforms (fog range, haze, grey) where they had constants, and mix in the grey, in every fogged fragment. A build without the grey horizon sample measured the same, so the sample itself is not the cost. In rain the streaks cost no more on top, as the shorter far plane draws less of the city; fog's far plane at 110 m draws fewer still.

## Files

The instrumented copies, drivers and raw JSONL results lived in the investigating session's scratchpad and aren't in the repo. The harness (overlay and autopilot route) is in the repo as the dev-only `?perf` mode: `src/perf.js` and `src/autopilot.js`, with tunables in `tables.perf`.
