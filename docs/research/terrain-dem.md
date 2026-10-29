# Terrain elevation data for Rione Monti

Question: which open elevation data, preferably a bare-earth DTM, should the game use for the Monti extract (bbox S 41.892, W 12.487, N 41.8985, E 12.4975, about 870 m × 720 m)?
All sources were accessed on 2026-10-29.

## Observed facts

### Candidates

| Source | Res. | Model | Vertical accuracy | Licence / attribution | Small-bbox access | Format |
|---|---|---|---|---|---|---|
| **TINITALY 1.1** (INGV) | 10 m | Built from regional-map contour lines and spot heights. The paper calls it a DEM "of the natural landforms of Italy" [T2]. | Overall RMSE "less than 3.5 m", from more than 200,000 control points [T2] | CC BY 4.0, with a fixed citation (Tarquini et al. 2023, doi:10.13127/tinitaly/1.1) [T1][T3] | Open WCS 2.0.1, no account. Coverage `TINItaly_1_1__tinitaly_dem`, native EPSG:32632, 10 m grid [T4]. Zip tiles are also offered [T5]. | GeoTIFF, Esri ASCII grid (`text/plain`), PNG [T4] |
| Copernicus GLO-30 / GLO-90 | 30 / 90 m | **DSM**: "including buildings, infrastructure and vegetation" [C1] | < 4 m absolute (LE90) [C1] | Free licence: reproduction, distribution and adaptation are allowed. A fixed © DLR/Airbus notice, a "produced using Copernicus WorldDEM" line and a liability sentence are required [C2]. | AWS `copernicus-dem-30m` / `-90m`, "No AWS account required" [C3]. Open-Meteo serves GLO-90 points without a key [C4]. | Cloud-optimised GeoTIFF |
| Copernicus EEA-10 | 10 m | DSM | (as above) | "Access … is limited to a specific subset of users" (public authorities, EU projects). The general public can view it but not download it [C1]. | Not available to us | — |
| SRTM GL1 v3 | 30 m | Radar interferometry. The NASA page does not say whether it is bare earth [S1]; in practice C-band radar returns from roofs. | Not stated on the product page [S1] | "openly shared, without restriction" [S1]. Tilezen credit: "SRTM data courtesy of the U.S. Geological Survey" [M1] | NASA Earthdata or mirrors | HGT |
| AWS Terrain Tiles (Mapzen) | Up to about 30 m here | A mosaic. Above z9 the land rows list SRTM, and EU-DEM appears only at z9 [M2]. | Inherits from its sources | A multi-source attribution list [M1] | `elevation-tiles-prod`, no account [M3]. Terrarium decode: `(R*256+G+B/256)-32768` [M4]. | PNG / GeoTIFF tiles |
| EU-DEM v1.1 | 25 m | SRTM + ASTER fusion, so surface-biased | ±7 m RMSE [O1] | Copernicus terms; no longer downloadable from copernicus.eu [O1] | Open Topo Data API, no key | — |
| MASE national LiDAR, Lazio (2013) | 1 m / 2 m | Separate DTM, DSM-first and DSM-last layers [L1] | Not checked | WMS AccessConstraints: "Nessuna condizione applicata" [L1]. Sister regional records are CC BY 4.0 [L2]. | WMS only (images and GetFeatureInfo) | — |
| Regione Lazio DTM 5 m (CTRN 2002–03) | 5 m | Photogrammetric DTM [R2] | Not stated | CC BY 4.0 [R1] | Per-province DXF folder behind a JavaScript file browser [R1]. Not scriptable as checked. | DXF |
| OpenTopography | Hosts COP30, SRTM, EU_DTM and others [P2] | — | — | Depends on the dataset | "API Key required" (tested) [P1]. Free tier: 50 calls/day for non-academic users [P2]. | GeoTIFF |
| EU_DTM (OpenGeoHub) | 30 m | Machine-learned bare earth, trained on GEDI and ICESat-2 ground points [P3] | Not given on the page [P3] | Not stated on the OpenTopography page [P3] | Through OpenTopography, so a key is needed | GeoTIFF |

### Coverage and quality checks over Monti

- **The national LiDAR does not cover Monti.**
  - A GetMap of the Lazio layers shows coverage only along the Tiber and Aniene corridor.
  - GetFeatureInfo on `EL.LIDAR.LAZIO.1x1.DTM` across a 6 × 5 point grid of the bbox returned values only in the westernmost column (lon about 12.4871). Every other point returned `NoData` [L1].
- **TINITALY covers the whole bbox.** A native 10 m WCS subset (`subset=E(789000,790500)&subset=N(4643400,4644800)`) returned 150 × 140 cells with no NoData, ranging from 18.5 to 56.8 m [T4].
  - An EPSG:4326 subset instead returned 510 NoData edge cells, so request the native grid.
- **TINITALY against the LiDAR DTM** on the five covered west-edge points: 44.2/46.0, 38.8/39.2, 33.8/31.0, 26.3/21.0, 20.8/22.8 m.

### Point elevations (m)

Coordinates are hand-picked approximations. The Open Topo Data and Open-Meteo values come from their public APIs, queried without a key [O2][C4].

| Point (lat, lon) | TINITALY | Open-Meteo (GLO-90) | EU-DEM | SRTM | Mapzen |
|---|---|---|---|---|---|
| Santa Maria Maggiore (41.8977, 12.4985)\* | 51.4 | 50 | 67.6 | 73 | 73 |
| Piazza del Viminale (41.8995, 12.4945)\* | 50.6 | 56 | 68.1 | 60 | 60 |
| Upper Via Panisperna (41.8965, 12.4925) | 34.9 | 50 | 50.0 | 47 | 47 |
| Suburra / Cavour metro (41.8945, 12.4925) | 30.5 | 43 | 46.4 | 50 | 50 |
| Piazza Madonna dei Monti (41.8949, 12.4903) | 30.5 | 37 | 41.0 | 38 | 38 |
| San Pietro in Vincoli (41.8937, 12.4931) | 46.5 | 44 | 55.0 | 61 | 61 |
| Lower Via Cavour (41.8935, 12.4880) | 25.7 | 28 | 28.5 | 28 | 28 |
| Via dei Fori Imperiali (41.8935, 12.4875) | 25.8 | 28 | 24.6 | 25 | 25 |

\* Just outside the bbox: Santa Maria Maggiore lies about 80 m east of the east edge, and the Viminale about 100 m north of the north edge.

Sampled on a 41 × 41 grid inside the bbox, TINITALY runs from **20.8 m** (south-west corner, the Fori and lower Via Cavour) to **52.6 m** (north-east corner, the Esquiline).

## Inferences

- **Surface models overstate the hills.** On the hills SRTM and EU-DEM read 7–22 m above TINITALY (Santa Maria Maggiore +16 to +22 m). The gap matches building height in a 5–6 storey quarter, so the surface models would put rooftops into the road.
- **GLO-90 is only a smoothed DSM.** Its 90 m cells average roofs and streets: close to TINITALY on the hilltops, 6–15 m high in the valley.
- **The Mapzen tiles here are SRTM.** At all eight points the Open Topo Data `mapzen` values equal `srtm30m`, which agrees with the zoom table [M2].
- **TINITALY is in effect bare earth in Monti.** Its input is contour lines from regional maps [T2], and its profile is smooth with no building spikes. It is the only open source that is both bare earth and gap-free here.
- **TINITALY is not precise.** Contours smooth out walls and steps, and it differs from the LiDAR by up to about 5 m.
- **CC BY 4.0 fits the game.** It allows redistributing a processed grid in a public repo and download alongside ODbL OSM data, as long as the credit and a change note go in CREDITS.md and on the loading screen.

## Recommendation

**Use TINITALY 1.1.**

1. Fetch once, offline, with one WCS GetCoverage call: `https://tinitaly.pi.ingv.it/TINItaly_1_1/wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=TINItaly_1_1__tinitaly_dem&format=text/plain&subset=E(789000,790500)&subset=N(4643400,4644800)`. No account is needed.
2. Resample the grid into the game's equirectangular frame around [41.89525, 12.49225] with a UTM 32N inverse, and commit the small grid.
3. Credit it in CREDITS.md and on the loading screen: "Elevation: TINITALY 1.1, Tarquini et al. (2023), INGV, doi:10.13127/tinitaly/1.1, CC BY 4.0. Resampled."

**Fallback: Copernicus GLO-30** from the public AWS bucket, with the licence's two notices and its liability sentence. It is a DSM, so either smooth it heavily or offset it with OSM building footprints. Avoid SRTM, EU-DEM and Mapzen, which are surface-biased and add nothing over GLO-30.

## Open questions

- **Should the game use the LiDAR at all?** The LiDAR could be used to check or correct the Tiber-side edge, but it covers only a sliver of the bbox and is served only as WMS.
- **Does the Lazio 5 m DTM cover central Rome, and how good is it there?** It might beat TINITALY, but the DXF folder could not be listed by script. A manual download would settle it.
- **What licence does EU_DTM / GEDTM30 carry?** The licence is unverified, and access needs an OpenTopography key. A 30 m machine-learned DTM is unlikely to beat 10 m TINITALY.
- **Is TINITALY sharp enough?** No open DTM here gives street-scale breaks such as stairs and walls; those would come from OSM (`highway=steps`, `barrier=retaining_wall`).

## Sources

- [T1] TINITALY home: https://tinitaly.pi.ingv.it/
- [T2] Tarquini et al. 2007, Annals of Geophysics: https://www.annalsofgeophysics.eu/index.php/annals/article/view/4424
- [T3] Accompanying notes 1.1: https://tinitaly.pi.ingv.it/Tinitaly_1_1_AccompanyingNotes.pdf
- [T4] WCS (GetCapabilities, DescribeCoverage and GetCoverage, all run): https://tinitaly.pi.ingv.it/TINItaly_1_1/wcs?service=WCS&request=GetCapabilities
- [T5] Download area: https://tinitaly.pi.ingv.it/Download_Area1_1.html
- [C1] Copernicus DEM collection: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- [C2] Licences PDF (GLO-30-F / GLO-90-F, Art. 4 and 6): https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf
- [C3] AWS registry entry: https://registry.opendata.aws/copernicus-dem/
- [C4] Open-Meteo Elevation API: https://open-meteo.com/en/docs/elevation-api (queried `https://api.open-meteo.com/v1/elevation?...`)
- [S1] NASA SRTMGL1 v003: https://www.earthdata.nasa.gov/data/catalog/lpcloud-srtmgl1-003
- [M1] Tilezen attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- [M2] Tilezen data sources: https://github.com/tilezen/joerd/blob/master/docs/data-sources.md
- [M3] AWS Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
- [M4] Tilezen formats: https://github.com/tilezen/joerd/blob/master/docs/formats.md
- [O1] Open Topo Data EU-DEM: https://www.opentopodata.org/datasets/eudem/
- [O2] Open Topo Data API (queried `https://api.opentopodata.org/v1/{eudem25m,srtm30m,aster30m,mapzen}`)
- [L1] MASE Lazio LiDAR WMS: https://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/servizi-LiDAR/LIDAR_LAZIO.map&service=WMS&request=GetCapabilities
- [L2] Sister record (Sicily, CC BY 4.0): https://inspire-geoportal.ec.europa.eu/srv/api/records/m_amte:299FN3:8740c0d0-8f32-4e85-9856-42f8b88853da
- [R1] dati.lazio.it, DTM 5 m Roma: https://dati.lazio.it/en/dataset/carta-tecnica-regionale-2002-2003-5k-roma/resource/df8dea52-9982-4429-883d-dafa0e361ab6
- [R2] EEA catalogue entry: https://cis2.eea.europa.eu/data/940/
- [P1] OpenTopography `globaldem` (tested without a key): https://portal.opentopography.org/API/globaldem
- [P2] OpenTopography developers: https://opentopography.org/developers
- [P3] EU_DTM announcement: https://opentopography.org/news/new-30m-digital-terrain-model-covering-continental-europe-now-available
