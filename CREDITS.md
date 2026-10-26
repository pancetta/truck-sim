# Credits

Third-party assets used by Truck Sim. The kit models are recoloured to the game's own palette
(`palette` and `kitColours` in `src/tables.js`) and drawn flat-shaded; their textures are
only read to pick each face's colour and are never shown. The sky and ground textures are
shown as they are (`lighting` and `ground` in `src/tables.js`).

| Asset | Files | Source | Licence |
|---|---|---|---|
| City Kit (Roads) 2.2 by Kenney | `public/models/roads/` | https://kenney.nl/assets/city-kit-roads | CC0 1.0 |
| City Kit (Commercial) 2.1 by Kenney | `public/models/commercial/` | https://kenney.nl/assets/city-kit-commercial | CC0 1.0 |
| Car Kit 3.1 by Kenney | `public/models/cars/` | https://kenney.nl/assets/car-kit | CC0 1.0 |
| Kloofendal 48d Partly Cloudy (Pure Sky) HDRI, 2k, by Poly Haven | `public/textures/kloofendal_48d_partly_cloudy_puresky_2k.hdr` | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 1.0 |
| Asphalt 02 texture, 1k, by Poly Haven | `public/textures/asphalt_02_*.jpg` | https://polyhaven.com/a/asphalt_02 | CC0 1.0 |
| Cobblestone Square texture, 1k, by Poly Haven | `public/textures/cobblestone_square_*.jpg` | https://polyhaven.com/a/cobblestone_square | CC0 1.0 |

CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/. Each kit's own `License.txt`
sits next to its models. Only the models the game loads are kept, not the whole kits. The
Poly Haven textures are the diffuse (`_Diffuse`), OpenGL normal (`_nor_gl`) and packed
ambient occlusion / roughness / metalness (`_arm`) maps, renamed as the prototype on
branch `prototype/monti-look` kept them.

Everything else (code, cab interior, dashboard, the truck's visual items, palette, city map) is the project's own.
