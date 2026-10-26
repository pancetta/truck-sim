# A realistic look replaces flat-shaded low-poly

The MVP spec (#1) bound the game to a "stylised flat-shaded low-poly" look: CC0 kit models recoloured to one palette, no realistic textures. For phase 3 we drop that: the city, its props and its vehicles move towards a realistic look, with physically based CC0 materials (Poly Haven, ambientCG), an HDRI sky, sun shadows, haze, and procedurally generated buildings, street furniture and cars. The Monti prototype (branch `prototype/monti-look`) showed that free materials plus our own procedural detail look far better than the flat look while staying within an iPad's budget, once far props get low-poly copies and small ones are culled.

The rest of the originality rules stay binding: only CC0 or self-made assets, each listed in `CREDITS.md`; nothing copied from or modelled on other games; our own dashboard, HUD and colour tables (wall tints, paints, signs). Vehicles stay generic, with no real makes or badges.

## Considered options

- **Keep flat low-poly and polish it** (better kit models, colour grading): cheap, but the prototype made clear it caps how good the city can look.
- **Streamed photogrammetry (Google photorealistic 3D tiles)**: ruled out by its terms (no caching or extraction), per-load billing on a public site, meshes you can't drive on, and the iPad budget.
- **Bought realistic models**: their licences forbid shipping the model files, which a public GitHub Pages repo does.

## Consequences

- The palette table no longer defines the whole look; colour tables for materials join it, and the renderer gains texture assets, so download size and texture memory need a budget (see the phase-3 graphics issues).
- The map stays the ASCII grid for now: this decision is about how the grid city is drawn, not about replacing it with real streets.
