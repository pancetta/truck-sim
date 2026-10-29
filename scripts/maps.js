// npm run maps (also run by npm run assets): turns the OSM extracts listed in assets.config.js `maps` into the files
// the game loads under public/maps/. Ways keep their node ids (shared nodes join streets) and their points in metres;
// nodes keep only their point. Elements with none of the `keep` tags are left out. A file with a `reach` is a list of
// buildings already in metres ({ r: [[x, z]], ... }): those with a corner inside the map or none within `reach` m of
// it are left out. A file with a `dem` is the map's height grid (heightGrid): its source is the raw elevation file,
// fetched from the `dem` URL when missing. Commit what it writes, and the raw files.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { camera } from '../src/tables.js';
import { maps } from './assets.config.js';

const [lat0, lon0] = maps.origin;
const M_LAT = 110574; // m per degree of latitude
const M_LON = 111320 * Math.cos((lat0 * Math.PI) / 180); // m per degree of longitude there
const round = (v) => Math.round(v * 10) / 10; // to 0.1 m
export const xz = (lat, lon) => [round((lon - lon0) * M_LON), round(-(lat - lat0) * M_LAT)];

const [south, west, north, east] = maps.bbox;
const [minX, maxZ] = xz(south, west);
const [maxX, minZ] = xz(north, east);
const outside = (x, z) => Math.hypot(Math.max(minX - x, 0, x - maxX), Math.max(minZ - z, 0, z - maxZ)); // m from the map

// Each listed file as { out (under public/), json (its text) }.
export async function makeMaps() {
  const made = [];
  for (const { source, out, keep, reach, dem } of maps.files) {
    if (dem) {
      made.push({ out, json: JSON.stringify(await heightGrid(source, dem)) });
      continue;
    }
    const data = JSON.parse(await readFile(source, 'utf8'));
    let trimmed = data;
    if (reach) trimmed = data.filter(({ r }) => !r.some(([x, z]) => x > minX && x < maxX && z > minZ && z < maxZ) && r.some(([x, z]) => outside(x, z) < reach));
    if (keep) {
      const ways = [];
      const nodes = [];
      for (const e of data.elements) {
        const kind = Object.keys(keep).find((k) => e.tags?.[k] !== undefined);
        if (!kind) continue;
        const tags = Object.fromEntries(keep[kind].filter((k) => e.tags[k] !== undefined).map((k) => [k, e.tags[k]]));
        if (e.type === 'node') {
          const [x, z] = xz(e.lat, e.lon);
          nodes.push({ x, z, tags });
        } else if (e.type === 'way') ways.push({ id: e.id, tags, ...(kind === 'highway' && { nodes: e.nodes }), points: e.geometry.map((p) => xz(p.lat, p.lon)) });
      }
      trimmed = { bounds: { minX, minZ, maxX, maxZ }, ...(ways.length && { ways }), ...(nodes.length && { nodes }) };
    }
    made.push({ out, json: JSON.stringify(trimmed) });
  }
  return made;
}

// [easting, northing] in UTM zone 32N (EPSG:32632, WGS84) of [lat, lon] in degrees (Snyder, Map Projections: A
// Working Manual, 1987, pp. 61, 63).
function utm32(lat, lon) {
  const [a, f, k0] = [6378137, 1 / 298.257223563, 0.9996];
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const p = (lat * Math.PI) / 180;
  const [s, c, t] = [Math.sin(p), Math.cos(p), Math.tan(p)];
  const N = a / Math.sqrt(1 - e2 * s * s);
  const [T, C, A] = [t * t, ep2 * c * c, (((lon - 9) * Math.PI) / 180) * c];
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  const E = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120);
  const n = k0 * (M + N * t * (A ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [500000 + E, n];
}

const GRID = 10; // m between the height grid's points, the DEM's own spacing

// The map's height grid from a DEM in UTM 32N as an Esri ASCII grid (TINITALY 1.1; docs/research/terrain-dem.md),
// fetched from `url` into `source` once: ground heights in m above sea level, to 0.1 m, every GRID m in the game's frame
// over the map and camera.fog's far end round it (nothing further is drawn), as terrain.js reads it:
// { minX, minZ, cell, nx, nz, h }, h row by row from minZ (z, then x).
async function heightGrid(source, url) {
  if (!existsSync(source)) {
    const res = await fetch(url);
    assert(res.ok, `${url}: ${res.status}`);
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, await res.text());
  }
  const lines = (await readFile(source, 'utf8')).trim().split('\n');
  const head = Object.fromEntries(lines.slice(0, 6).map((l) => l.trim().split(/\s+/)).map(([k, v]) => [k.toLowerCase(), Number(v)]));
  const { ncols, nrows, xllcorner: E0, yllcorner: N0, cellsize: cs, nodata_value: nodata } = head;
  const rows = lines.slice(6).map((l) => l.trim().split(/\s+/).map(Number)); // north first
  assert(rows.length === nrows && rows.every((r) => r.length === ncols && r.every((v) => Number.isFinite(v) && v !== nodata)), `${source}: not a whole DEM (delete it to fetch it again)`);

  // Bilinear between the DEM's cell centres; a point outside them means the DEM is too small for the map.
  const height = (x, z) => {
    const [E, N] = utm32(lat0 - z / M_LAT, lon0 + x / M_LON);
    const [c, r] = [(E - E0) / cs - 0.5, nrows - 0.5 - (N - N0) / cs];
    assert(c >= 0 && c < ncols - 1 && r >= 0 && r < nrows - 1, `${source} doesn't reach (${x}, ${z})`);
    const [c0, r0] = [Math.floor(c), Math.floor(r)];
    const [u, v] = [c - c0, r - r0];
    return (rows[r0][c0] * (1 - u) + rows[r0][c0 + 1] * u) * (1 - v) + (rows[r0 + 1][c0] * (1 - u) + rows[r0 + 1][c0 + 1] * u) * v;
  };
  const far = camera.fog[1];
  const [gx, gz] = [Math.floor((minX - far) / GRID) * GRID, Math.floor((minZ - far) / GRID) * GRID];
  const nx = Math.ceil((maxX + far - gx) / GRID) + 1;
  const nz = Math.ceil((maxZ + far - gz) / GRID) + 1;
  const h = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h.push(round(height(gx + i * GRID, gz + j * GRID)));
  return { minX: gx, minZ: gz, cell: GRID, nx, nz, h };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { out, json } of await makeMaps()) {
    await mkdir(dirname(join('public', out)), { recursive: true });
    await writeFile(join('public', out), json);
    console.log(`${out}: ${(json.length / 1024).toFixed(0)} KB`);
  }
}
