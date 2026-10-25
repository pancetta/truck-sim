# Handoff: Truck Sim MVP

## Where things stand

- Repo: this folder (`~/Private/Code/truck-sim`), pushed to private GitHub repo `pancetta/truck-sim`.
- Agent skills configured (`CLAUDE.md`, `docs/agents/`): GitHub Issues, default triage labels,
  single-context domain docs, external peers host-only.
- No code written. The design was settled in two `/supermatt:grill-me` sessions (decisions below).
- Spec not written yet.

## Next steps

1. Run `/supermatt:to-spec`: synthesize the decisions below into a spec, no re-grilling needed.
   Test seams are agreed (see below).
2. Then `/supermatt:to-tickets` and implement.

## Goal

Browser-based truck simulator, eventually with more interactions, longer tasks and routes, more
action, and an income/upgrade system. First-person driving. Must be fully playable with mouse or
finger only (tablets). **This phase: an MVP.**

## Originality: an independent game, not a clone

Truck driving and delivery are a common genre. This game must stand on its own and must not copy
any existing game. Carry these rules into the spec:
- **No borrowed expression:** don't take code, models, textures, sounds, text, UI layout, HUD
  design or level design from any other truck game, and don't use another game or its
  screenshots as a visual or design reference.
- **Assets:** only CC0 (or self-made) assets. Record each asset's source and licence in a
  `CREDITS.md` file.
- **Own visual identity:** stylised, flat-shaded low-poly look with our own fixed colour palette
  (one palette table) and our own dashboard/HUD design. No realistic textures.
- **Name:** keep the generic working title "Truck Sim". Don't use a name built from another
  game's title. Choose the final name before the first public release.
- **Docs and code** don't name other games as inspiration or comparison.

## Guiding principle: this MVP will be reworked and extended

Expect major rework and extension over time (see "Explicitly deferred"). Implement with that in mind:
- Keep clear seams between sim logic (vehicle, orders/economy, map/road graph), rendering, input
  and UI, so any one can be replaced without touching the others.
- Keep tunables as data tables (cargo, pay, vehicle constants, map), not scattered literals.
- Don't build speculative hooks or abstractions for deferred features. Clean seams make them easy
  to add later; guessing their shape now makes them harder.
- `/supermatt:to-spec` should carry this principle into the spec.

## Settled decisions (MVP)

### Scope and core loop
- **Core loop only:** one truck, one city. Open order list → accept → drive to pickup → drive to
  drop-off → get paid. Money is a counter only.
- **Orders:** an orders button opens ~3 offers (cargo, distance, pay); pick one. Only one active
  order at a time. No depot visit needed.
- **Delivery:** drive into a marked zone and come to a stop → load/unload.
  **Pay = base + distance.** No timer, no cargo damage.
- **No saving:** money resets on reload (nothing to spend it on yet).

### Truck and driving model
- **Tech:** Three.js with our own arcade vehicle model (no physics engine).
- **Rigid truck** (no trailer), **semi-realistic** feel:
  - cargo weight changes mass: loaded truck accelerates and brakes slower and leans in turns;
  - **automatic gearbox**, gears and RPM simulated and shown on the dashboard.
- **Collisions:** solid stop, no damage. A **"reset to road"** button puts the truck on the
  nearest road when stuck.

### Controls and camera
- **On-screen steering wheel** (drag, bottom-left) + **gas/brake pedals** (hold, bottom-right).
  Identical behaviour with mouse and touch.
- **Reverse:** brake to a standstill, keep holding brake → truck rolls backwards. No extra button.
- **Camera:** first-person cab view by default; one button toggles a third-person chase camera.
- **Navigation:** corner minimap showing the shortest road route (from the tile grid's road graph).

### World and presentation
- **City:** hand-placed tile grid, ~8×8 blocks, routes of ~1–3 minutes,
  ~6–8 pickup/drop-off spots. **Empty streets** — no AI traffic; static obstacles only
  (parked cars, poles).
- **Art:** free CC0 low-poly kit (e.g. Kenney) for roads, buildings, truck; a simple self-built
  cab interior (dashboard + wheel), since kits lack interiors. Recoloured to our own palette
  (see "Originality").
- **Sound:** none in the MVP.
- **UI language:** German only.

### Platform
- Landscape tablets (iPad/Android, ~2019+) and desktop Chrome/Firefox/Safari with mouse.
  Phones best-effort only.
- Hosted on GitHub Pages only. No game portals or other publishing is planned, and no portal SDK.

### Settled in second grill session
- **Tooling:** Vite + plain JavaScript (ES modules); GitHub Actions workflow deploys `dist/` to Pages.
- **Test seams:** Vitest in Node, pure logic only. Covers the vehicle step function (speed/gear/RPM
  under load), road-graph shortest path, order generation and pay, and the zone stop/load check.
  These modules must not import Three.js. Rendering and input are checked by hand.
- **CI:** the Pages workflow runs `npm test` first; failing tests block the deploy.
- **Map:** ASCII grid in a JS file; scene, road graph and minimap are all generated from it.
- **Cargo:** fixed German list of cargo types with weights (e.g. Paletten 4 t, Getränke 8 t,
  Stahl 12 t). Weight affects handling only; pay stays base + distance.
- **Load/unload:** stopped in zone → ~2 s progress bar ("Wird beladen…"/"Wird entladen…"),
  resets if the truck moves.
- **No order cancel** in the MVP.
- **Steering wheel** auto-centres over ~0.5 s on release.
- **No keyboard controls** — mouse/touch only.
- **Portrait:** full-screen "Bitte Gerät drehen" overlay pauses the game until landscape.

## Explicitly deferred (post-MVP)

Upgrades and save state, multiple trucks, AI traffic and traffic lights, time bonus, cargo damage,
truck damage/repair, fuel, manual shifting, articulated trailers, mirrors, sound and music,
English UI, larger city.

## Open (decide during spec/implementation)

Implementer's call, no further grilling needed:
- Exact tile kit, map layout, exact cargo list and weights, pay constants.
