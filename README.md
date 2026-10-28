# Truck Sim

A browser truck-delivery game: drive a heavy truck through the real streets of Rione Monti in Rome (map data © OpenStreetMap contributors), accept orders, load and unload cargo at the spots, and get paid. Steer with the on-screen wheel and pedals (mouse or touch, landscape tablets and desktop). The UI is German only.

**Play it:** https://pancetta.github.io/truck-sim/

## In the game

- **Orders:** pick one of three offers, load at the pickup, unload at the drop-off. Pay grows with the road distance, plus a **time bonus** that shrinks to nothing at the offer's expected time. **Fragile** cargo pays a premium that hard braking and hits wear away. Drop-offs at a **dock** pay a bonus when you reverse into the bay, right up to the dock edge (in R a mirrored reversing-camera picture shows at the top of the screen).
- **Rank:** deliveries (and their bonuses) earn rank points; a higher rank unlocks harder offer types, Werkstatt upgrades and more traffic.
- **Werkstatt:** buy upgrades (motor, brakes, tyres, suspension, cargo bed) and looks (paint, livery, light bar, cab gimmick, rims, chrome), trying looks on before buying. Opens only while standing with no order.
- **Traffic:** AI cars drive the right-hand lane at each street's limit, keep to one-ways, come and go where streets leave the map, stop at red lights, give way to the bigger road and right before left between equal ones at unsignalled crossings, wait to turn left at lights while traffic comes the other way, and don't drive into a crossing whose exit is queued up or where the truck stands.
- **Speed limit:** by road class (50 km/h on the main roads, down to 30 in the side streets), shown on round signs where it changes; the speedometer turns red above it. The truck may drive against a one-way without a fine.
- **Fines:** crossing the stop line and entering the light junction on red (a police car must see it; no fine in the first second of red or on red and amber), speeding more than 10 km/h over the limit while a police car sees it, or driving into an AI car, costs money (never below 0); the notice shows what was taken. A car that drives into the truck costs nothing.
- **Saving:** money, rank, upgrades, looks and the distance driven save automatically in the browser; *Spielstand zurücksetzen* in the Werkstatt starts over.

On iPad (or Android), use *Zum Home-Bildschirm* to add the game to the home screen; opened from there it runs full screen in landscape. The home-screen app keeps its own save: iOS stores it separately from Safari's, so progress made in Safari doesn't carry over.

## Run, test, build

```bash
npm install
npm run dev     # dev server, served under /truck-sim/ (open the URL it prints)
npm test        # Vitest: headless Sim tests and the asset budget
npm run build   # production build into dist/
npm run assets  # download and process the Poly Haven assets (see "Assets")
```

Every push to `main` runs the *Test and deploy to Pages* workflow (`.github/workflows/pages.yml`): install, `npm test`, `npm run build`, then deploy `dist/` to GitHub Pages. A failing test stops the deploy.

## Assets

The sky, ground textures and (later) props come from [Poly Haven](https://polyhaven.com) (all CC0) through one command, `npm run assets` (`scripts/assets.js`). It reads the list in `scripts/assets.config.js`, then:

- **Fetches** each asset through the Poly Haven API into `assets-src/` (gitignored, kept between runs, checked against Poly Haven's md5). The large sources are never committed.
- **Processes** them into `public/`, which is committed:
  - Textures and the sky become KTX2 (Basis Universal: ETC1S for textures, UASTC HDR for the sky), which the GPU keeps compressed. They load through three's `KTX2Loader`, with the transcoder copied to `public/basis/`.
  - Models get a far copy simplified with meshoptimizer (`<id>_far.glb`), KTX2 textures and meshopt-compressed geometry. Loading them needs `GLTFLoader` with `setKTX2Loader` and `setMeshoptDecoder`.
  - Trees are drawn side-on into a picture for crossed quads. This runs `scripts/bake-tree.html` in headless Google Chrome (set `CHROME` to its binary if it isn't in `/Applications`).
- **Records** data the game needs at runtime in `src/assetInfo.json` (a sky's HDR scale, a tree picture's span and trunk position), and the asset list in `CREDITS.md`.

To add an asset, list it in `scripts/assets.config.js`, run `npm run assets`, and commit what changed. A run takes about 20 s on an unloaded M2 Mac, plus downloads.

**Budget**, checked by `npm test` (`scripts/assets.test.js`):
- Everything under `public/` stays at or under 12 MB.
- `public/textures/` holds only what the asset list makes, and `public/basis/` matches the installed three.

First playable frame under 3 s on a 10 Mbit/s link is measured, not tested. To meet it, the first frame waits only for a 1k sky; the 2k sky replaces it once loaded. Measurements are in [`docs/perf/2026-10-baseline.md`](docs/perf/2026-10-baseline.md).

## Code layout

Vite, plain JavaScript (ES modules), Three.js, no backend.

- **Sim** (`src/sim/sim.js`, AI traffic in `src/sim/traffic.js`): all game logic: vehicle, collisions, orders (offer types, time bonus, fragile damage, docks), upgrades (`buyUpgrade`), visual items (`buyVisual`, `equipVisual`, `owns`), rank, traffic lights, AI cars and their right of way, fines, and the **profile** (money and the rest of the progress that persists). It must stay headless: no Three.js, no DOM. It is the main test seam: tests build it with `createSim(tables, map, random, profile?)`, drive it through `step()` and the order and reset commands, and assert only on its state.
- **Save** (`src/save.js`): loads, saves and resets the profile in one slot per browser. It takes a storage object of the `localStorage` shape, so it is tested with a fake; `load()` always returns a valid profile; a save from an older version (the grid city's v1 and v2) starts fresh.
- **Map** (`src/sim/osm.js`, road graph in `src/sim/graph.js`): builds the map from the OpenStreetMap extract of Monti in `public/maps/` (made from `data/osm/` by `npm run maps`): the road graph and its routes, colliders (buildings, bollards, parked cars, barriers at the edge exits, signal posts), traffic lights, speed signs and the spots from the spot table.
- **Tables** (`src/tables.js`): every tunable (vehicle, orders and pay, cameras, sun and sky, ground materials, palette, UI sizes) as plain data. Tweak numbers here.
- **Strings** (`src/strings.js`): all UI text, German only.
- **Renderer** (`src/renderer.js`, `src/truckLook.js`, `src/streets.js`): Three.js scene on `WebGPURenderer` (WebGL 2 where WebGPU is missing; `?webgl` forces it), cab and chase cameras, the reversing-camera inset, and the Werkstatt's orbit camera. Draws the truck from a *look* (the equipped visual items plus Werkstatt previews) that the app hands it; `truckLook.js` holds the visual items' own geometry, `streets.js` the street dressing (pavements, lanterns, trees, small props). Reads Sim state, never writes it.
- **Controls** (`src/controls.js`): on-screen wheel and pedals, turned into the input the Sim takes.
- **HUD and orders UI** (`src/hud.js`, `src/orders.js`, `src/minimap.js`): dashboard, orders panel and goal banner, minimap. They read Sim state; orders go through the Sim's commands.
- **Werkstatt** (`src/werkstatt.js`): the garage button and panel; buys through the Sim's commands, holds the tried-on (unbought) visual items, and resets the save.
- **App loop** (`src/main.js`): wires the modules, runs the fixed-step Sim from `requestAnimationFrame` (at most `loop.maxSteps` steps per frame), pauses behind the portrait overlay and while the Werkstatt is open, and autosaves whenever the profile changes (the distance every 100 m).
- **Perf harness** (`src/perf.js`, `src/autopilot.js`, dev only): `?perf` shows frame-time and renderer stats; `?perf&auto` also lets an autopilot drive a fixed loop, unsaved. `?perf&hour=22` sets the game clock (here 22:00), to measure at night. It's loaded only with `?perf` and wraps the modules' per-frame calls, so the normal loop carries no cost for it. How to measure: [`docs/perf/2026-10-baseline.md`](docs/perf/2026-10-baseline.md).

## Where decisions live

- [Spec #1](https://github.com/pancetta/truck-sim/issues/1) (MVP), [spec #12](https://github.com/pancetta/truck-sim/issues/12) (phase 2) and their tickets: the intended design and why.
- [`CLAUDE.md`](CLAUDE.md): working rules for agents (review effort, issue tracker).
- [`CREDITS.md`](CREDITS.md): every third-party asset with source and licence.
- [`docs/adr/`](docs/adr/): decisions that change or outlive a spec, such as [ADR 0001](docs/adr/0001-realistic-look.md) (a realistic look replaces flat-shaded low-poly).
- Originality rules (from the spec, look changed by ADR 0001): only CC0 or self-made assets, our own dashboard, HUD and colour tables, generic vehicles with no real makes, nothing copied from or modelled on other games.
