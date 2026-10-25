# Truck Sim

A browser truck-delivery game: drive a heavy truck around a small low-poly city, accept orders, load and unload cargo at the spots, and get paid. Steer with the on-screen wheel and pedals (mouse or touch, landscape tablets and desktop). The UI is German only.

**Play it:** https://pancetta.github.io/truck-sim/

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

- **Sim** (`src/sim/sim.js`): all game logic: vehicle, collisions, orders, and the **profile** (money and the rest of the progress that persists). It must stay headless: no Three.js, no DOM. It is the main test seam: tests build it with `createSim(tables, map, random, profile?)`, drive it through `step()` and the order and reset commands, and assert only on its state.
- **Save** (`src/save.js`): loads, saves and resets the profile in one slot per browser. It takes a storage object of the `localStorage` shape, so it is tested with a fake; `load()` always returns a valid profile.
- **Map** (`src/sim/map.js`, `src/city.txt`): parses the ASCII city grid into tiles, spots, colliders and the road graph, and answers routes.
- **Tables** (`src/tables.js`): every tunable (vehicle, orders and pay, cameras, palette, UI sizes) as plain data. Tweak numbers here.
- **Strings** (`src/strings.js`): all UI text, German only.
- **Renderer** (`src/renderer.js`): Three.js scene, cab and chase cameras. Reads Sim state, never writes it.
- **Controls** (`src/controls.js`): on-screen wheel and pedals, turned into the input the Sim takes.
- **HUD and orders UI** (`src/hud.js`, `src/orders.js`, `src/minimap.js`): dashboard, orders panel and goal banner, minimap. They read Sim state; orders go through the Sim's commands.
- **App loop** (`src/main.js`): wires the modules, runs the fixed-step Sim from `requestAnimationFrame`, pauses behind the portrait overlay, and autosaves whenever the profile changes.

## Where decisions live

- [Spec #1](https://github.com/pancetta/truck-sim/issues/1) (MVP), [spec #12](https://github.com/pancetta/truck-sim/issues/12) (phase 2) and their tickets: the intended design and why.
- [`CLAUDE.md`](CLAUDE.md): working rules for agents (review effort, issue tracker).
- [`CREDITS.md`](CREDITS.md): every third-party asset with source and licence.
- Originality rules (from the spec): only CC0 or self-made assets, our own flat-shaded look and palette, nothing copied from or modelled on other games.
