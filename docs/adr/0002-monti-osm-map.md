# The Monti OSM map replaces the grid city

The city has been a fictional 59 × 59 grid of 14 m tiles. Spec #59 moves the game onto the real streets of Rione Monti in Rome, from the OpenStreetMap extract the Monti prototype (branch `prototype/monti-look`) used: about 1 km square, with curved streets, junctions of three to six arms, narrow one-ways and 700 real building outlines. A map builder turns the OSM data into the road graph (#60) that the Sim, the autopilot and the renderer already use; the grid city stays the default behind a dev flag (`?map=monti`) until the switch (#67), and then goes away.

This supersedes ADR 0001's consequence that "the map stays the ASCII grid", and spec #36's out-of-scope line about real OSM streets.

The originality rules still hold: a real place is allowed, real businesses are not, so docks and other places get made-up names (#64). The map data is © OpenStreetMap contributors under the Open Database License; `CREDITS.md` credits it, and the processed files under `public/maps/` stay under the ODbL.

## Considered options

- **Keep the grid and make it look more real**: cheap, but every street stays straight and every junction four-way, which is what the owner wants to leave behind.
- **A hand-drawn fictional city with curves**: no licence to honour, but a lot of level design for something less convincing than a real district.
- **Fetch OSM data at runtime**: always current, but needs a network service at play time and makes the map change under the tests. The extract is fixed and goes through the asset pipeline instead.

## Consequences

- Road widths come from the road class (tables), not from OSM, so narrow real streets get wider and building outlines are cut back to leave the road and its pavements clear. The road is never narrowed.
- The map has no tiles. Code that still reads tiles (traffic, junction hints, dock bays, the grid look) keeps working on the grid and is moved onto the graph ticket by ticket (#61–#66).
- The download grows by the map data (about 2 MB, most of it the skyline ring), inside the 12 MB budget.
