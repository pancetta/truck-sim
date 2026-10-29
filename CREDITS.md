# Credits

Third-party assets used by Truck Sim. The kit model (the truck) is recoloured to the game's own palette
(`palette` and `kitColours` in `src/tables.js`) and drawn flat-shaded; its texture is
only read to pick each face's colour and is never shown. The sky, ground, wall and roof textures are
shown as they are (`lighting`, `ground` and `buildings` in `src/tables.js`), compressed to KTX2.

| Asset | Files | Source | Licence |
|---|---|---|---|
| Car Kit 3.1 by Kenney (the truck only) | `public/models/cars/` | https://kenney.nl/assets/car-kit | CC0 1.0 |

The sky, textures and models below are downloaded and processed by `npm run assets` (`scripts/assets.js`), which
writes this list from `scripts/assets.config.js` and Poly Haven's own records; don't edit it by hand.

<!-- assets:start -->
| Asset | Files | Source | Licence |
|---|---|---|---|
| Kloofendal 48d Partly Cloudy (Pure Sky) (hdri) by Greg Zaal, Jarod Guest | `public/textures/kloofendal_48d_partly_cloudy_puresky_1k.ktx2`, `public/textures/kloofendal_48d_partly_cloudy_puresky_2k.ktx2` | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 1.0 |
| Asphalt 02 (texture) by Rob Tuytel | `public/textures/asphalt_02_Diffuse.ktx2`, `public/textures/asphalt_02_nor_gl.ktx2`, `public/textures/asphalt_02_arm.ktx2` | https://polyhaven.com/a/asphalt_02 | CC0 1.0 |
| Cobblestone Square (texture) by Rob Tuytel | `public/textures/cobblestone_square_Diffuse.ktx2`, `public/textures/cobblestone_square_nor_gl.ktx2`, `public/textures/cobblestone_square_arm.ktx2` | https://polyhaven.com/a/cobblestone_square | CC0 1.0 |
| Painted Plaster Wall (texture) by Amal Kumar | `public/textures/painted_plaster_wall_Diffuse.ktx2`, `public/textures/painted_plaster_wall_nor_gl.ktx2`, `public/textures/painted_plaster_wall_arm.ktx2` | https://polyhaven.com/a/painted_plaster_wall | CC0 1.0 |
| Worn Plaster Wall (texture) by Dimitrios Savva | `public/textures/worn_plaster_wall_Diffuse.ktx2`, `public/textures/worn_plaster_wall_nor_gl.ktx2`, `public/textures/worn_plaster_wall_arm.ktx2` | https://polyhaven.com/a/worn_plaster_wall | CC0 1.0 |
| Red Brick 03 (texture) by Rob Tuytel | `public/textures/red_brick_03_Diffuse.ktx2`, `public/textures/red_brick_03_nor_gl.ktx2`, `public/textures/red_brick_03_arm.ktx2` | https://polyhaven.com/a/red_brick_03 | CC0 1.0 |
| Clay Roof Tiles 02 (texture) by Amal Kumar | `public/textures/clay_roof_tiles_02_Diffuse.ktx2`, `public/textures/clay_roof_tiles_02_nor_gl.ktx2`, `public/textures/clay_roof_tiles_02_arm.ktx2` | https://polyhaven.com/a/clay_roof_tiles_02 | CC0 1.0 |
| Covered Car (model) by MP | `public/models/covered_car.glb`, `public/models/covered_car_far.glb` | https://polyhaven.com/a/covered_car | CC0 1.0 |
| Floor Pavement (texture) by Dario Barresi, Charlotte Baglioni | `public/textures/floor_pavement_Diffuse.ktx2`, `public/textures/floor_pavement_nor_gl.ktx2`, `public/textures/floor_pavement_arm.ktx2` | https://polyhaven.com/a/floor_pavement | CC0 1.0 |
| Street Lamp 02 (model) by Josh Dean | `public/models/street_lamp_02.glb`, `public/models/street_lamp_02_far.glb` | https://polyhaven.com/a/street_lamp_02 | CC0 1.0 |
| Jacaranda Tree (tree) by Rob Tuytel, Rico Cilliers | `public/textures/jacaranda_tree.ktx2` | https://polyhaven.com/a/jacaranda_tree | CC0 1.0 |
| Tree Small 02 (tree) by Rico Cilliers | `public/textures/tree_small_02.ktx2` | https://polyhaven.com/a/tree_small_02 | CC0 1.0 |
| Searsia Lucida (tree) by James Ray Cock, Jenelle van Heerden | `public/textures/searsia_lucida.ktx2` | https://polyhaven.com/a/searsia_lucida | CC0 1.0 |
<!-- assets:end -->

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/. The kit's own `License.txt`
sits next to its model. Only the model the game loads is kept, not the whole kit. The
Poly Haven textures are the diffuse (`_Diffuse`), OpenGL normal (`_nor_gl`) and packed
ambient occlusion / roughness / metalness (`_arm`) maps.

## Map data

The Monti map's streets, buildings, street furniture and skyline come from OpenStreetMap: © OpenStreetMap contributors,
https://www.openstreetmap.org/copyright. The raw Overpass extracts are in `data/osm/`; `npm run maps` (`scripts/maps.js`)
trims and projects them into `public/maps/monti.json`, `public/maps/monti-furniture.json` and
`public/maps/monti-ring.json`. That processed map data stays under the Open Database License (ODbL 1.0,
https://opendatacommons.org/licenses/odbl/1-0/), like the extracts it comes from.

The map's ground heights come from TINITALY 1.1: Elevation: TINITALY 1.1, Tarquini et al. (2023), INGV,
doi:10.13127/tinitaly/1.1, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Resampled. The raw grid from INGV's
WCS (https://tinitaly.pi.ingv.it/) is in `data/dem/`; `npm run maps` resamples it from UTM 32N into the game's frame,
every 10 m and rounded to 0.1 m, in `public/maps/monti-terrain.json`.

`public/basis/` is three.js's copy of the Basis Universal transcoder (Apache 2.0, https://github.com/BinomialLLC/basis_universal), served for its KTX2 loader.

Everything else (code, the generated cars and their number plate, cab interior, dashboard, the truck's visual items,
palette, the procedural buildings and their painted window, door, shutter and sign pictures, and the skyline ring's
painted window picture) is the project's own.
