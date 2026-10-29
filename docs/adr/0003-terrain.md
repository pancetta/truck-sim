# Maps have terrain

The Monti spec (#59) kept the ground flat ("flat ground, tunnels closed"). Spec #103 replaces that: a map has terrain, real ground heights, and everything on it (the truck, the traffic, the people, the streets and the buildings) comes to stand on it, ticket by ticket (#104–#109). Rione Monti runs from about 21 m by the Fori to about 53 m on the Esquiline, with grades of 2–3 % on Via Cavour and up to about 12 %.

The heights come from TINITALY 1.1 (INGV), a 10 m bare-earth DEM under CC BY 4.0 (`docs/research/terrain-dem.md`). `npm run maps` fetches the map's box once through INGV's WCS, keeps the raw grid in `data/dem/`, and resamples it into the game's frame as a height grid next to the map's other files; the map exposes `heightAt(x, z)` and `slopeAt`. The credit goes on the loading screen and in `CREDITS.md`.

The terrain belongs to the map, not to Monti: a map without a height grid, such as the tests' inline fixtures, is flat at 0.

## Considered options

- **Keep the ground flat**: the cheapest, but the owner wants the hills, which are what make Monti Monti.
- **A global elevation model (Copernicus GLO-30, SRTM, EU-DEM)**: easy to fetch, but they are surface models that include the roofs, 7–22 m too high on Monti's hills, so they would put rooftops into the road.
- **The national LiDAR or the Lazio 5 m DTM**: sharper, but the LiDAR doesn't cover Monti and the DTM can't be fetched by script.

## Consequences

- Heights are in m above sea level, so Monti's ground lies 16–57 m above the flat fixtures' 0.
- TINITALY comes from contour lines and is smooth: it has no stairs or retaining walls, and differs from the LiDAR by up to about 5 m. Street-scale breaks would have to come from OpenStreetMap.
- Every flat-ground assumption has to go: the prototype (`prototype/monti-terrain`) found a hill start the truck can't make, about 5× the road and kerb triangles once draped, and doors floating or sunk by up to 1 m.
- The download grows by the height grid, about 110 KB, inside the 12 MB budget.
