# Truck Sim

A browser truck-delivery game: drive a heavy truck around a small low-poly city, accept orders, load and unload cargo at the spots, and get paid. Steer with the on-screen wheel and pedals (mouse or touch, landscape tablets and desktop). The UI is German only.

**Play it:** https://pancetta.github.io/truck-sim/

## In the game

- **Orders:** pick one of three offers, load at the pickup, unload at the drop-off. Pay grows with the road distance, plus a **time bonus** that shrinks to nothing at the offer's expected time. **Fragile** cargo pays a premium that hard braking and hits wear away. Drop-offs at a **dock** pay a bonus when you reverse into the bay (the reversing camera comes on in R).
- **Rank:** deliveries (and their bonuses) earn rank points; a higher rank unlocks harder offer types, Werkstatt upgrades and more traffic.
- **Werkstatt:** buy upgrades (motor, brakes, tyres, suspension, cargo bed) and looks (paint, livery, light bar, cab gimmick, rims, chrome), trying looks on before buying. Opens only while standing with no order.
- **Traffic:** AI cars drive the right-hand lane, stop at red lights, give way right before left at unsignalled crossings, wait to turn left at lights while traffic comes the other way, and don't drive into a crossing whose exit is queued up.
- **Fines:** crossing a stop line forwards on red, or touching an AI car, costs money (never below 0); the notice shows what was taken.
- **Saving:** money, rank, upgrades, looks and the distance driven save automatically in the browser; *Spielstand zurücksetzen* in the Werkstatt starts over.

On iPad (or Android), use *Zum Home-Bildschirm* to add the game to the home screen; opened from there it runs full screen in landscape. The home-screen app keeps its own save: iOS stores it separately from Safari's, so progress made in Safari doesn't carry over.

## Run, test, build

```bash
npm install
npm run dev     # dev server, served under /truck-sim/ (open the URL it prints)
npm test        # Vitest, headless Sim tests
npm run build   # production build into dist/
```

Every push to `main` runs the *Test and deploy to Pages* workflow (`.github/workflows/pages.yml`): install, `npm test`, `npm run build`, then deploy `dist/` to GitHub Pages. A failing test stops the deploy.

## Code layout

Vite, plain JavaScript (ES modules), Three.js, no backend.

- **Sim** (`src/sim/sim.js`, AI traffic in `src/sim/traffic.js`): all game logic: vehicle, collisions, orders (offer types, time bonus, fragile damage, docks), upgrades (`buyUpgrade`), visual items (`buyVisual`, `equipVisual`, `owns`), rank, traffic lights, AI cars and their right of way, fines, and the **profile** (money and the rest of the progress that persists). It must stay headless: no Three.js, no DOM. It is the main test seam: tests build it with `createSim(tables, map, random, profile?)`, drive it through `step()` and the order and reset commands, and assert only on its state.
- **Save** (`src/save.js`): loads, saves and resets the profile in one slot per browser. It takes a storage object of the `localStorage` shape, so it is tested with a fake; `load()` always returns a valid profile, migrating saves from older versions.
- **Map** (`src/sim/map.js`, `src/city.txt`): parses the ASCII city grid into tiles, spots, colliders (signal posts included), traffic lights and the road graph, and answers routes.
- **Tables** (`src/tables.js`): every tunable (vehicle, orders and pay, cameras, palette, UI sizes) as plain data. Tweak numbers here.
- **Strings** (`src/strings.js`): all UI text, German only.
- **Renderer** (`src/renderer.js`, `src/truckLook.js`): Three.js scene, cab and chase cameras, and the Werkstatt's orbit camera. Draws the truck from a *look* (the equipped visual items plus Werkstatt previews) that the app hands it; `truckLook.js` holds the visual items' own geometry. Reads Sim state, never writes it.
- **Controls** (`src/controls.js`): on-screen wheel and pedals, turned into the input the Sim takes.
- **HUD and orders UI** (`src/hud.js`, `src/orders.js`, `src/minimap.js`): dashboard, orders panel and goal banner, minimap. They read Sim state; orders go through the Sim's commands.
- **Werkstatt** (`src/werkstatt.js`): the garage button and panel; buys through the Sim's commands, holds the tried-on (unbought) visual items, and resets the save.
- **App loop** (`src/main.js`): wires the modules, runs the fixed-step Sim from `requestAnimationFrame` (at most `loop.maxSteps` steps per frame), pauses behind the portrait overlay and while the Werkstatt is open, and autosaves whenever the profile changes (the distance every 100 m).
- **Perf harness** (`src/perf.js`, `src/autopilot.js`, dev only): `?perf` shows frame-time and renderer stats; `?perf&auto` also lets an autopilot drive a fixed loop, unsaved. It's loaded only with `?perf` and wraps the modules' per-frame calls, so the normal loop carries no cost for it. How to measure: [`docs/perf/2026-10-baseline.md`](docs/perf/2026-10-baseline.md).

## Where decisions live

- [Spec #1](https://github.com/pancetta/truck-sim/issues/1) (MVP), [spec #12](https://github.com/pancetta/truck-sim/issues/12) (phase 2) and their tickets: the intended design and why.
- [`CLAUDE.md`](CLAUDE.md): working rules for agents (review effort, issue tracker).
- [`CREDITS.md`](CREDITS.md): every third-party asset with source and licence.
- Originality rules (from the spec): only CC0 or self-made assets, our own flat-shaded look and palette, nothing copied from or modelled on other games.
