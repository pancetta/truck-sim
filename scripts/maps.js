// npm run maps (also run by npm run assets): turns the OSM extracts listed in assets.config.js `maps` into the files
// the game loads under public/maps/. Ways keep their node ids (shared nodes join streets) and their points in metres;
// nodes keep only their point. Elements with none of the `keep` tags are left out. A file with a `reach` is a list of
// buildings already in metres ({ r: [[x, z]], ... }): those with a corner inside the map or none within `reach` m of
// it are left out. Commit what it writes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  for (const { source, out, keep, reach } of maps.files) {
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { out, json } of await makeMaps()) {
    await mkdir(dirname(join('public', out)), { recursive: true });
    await writeFile(join('public', out), json);
    console.log(`${out}: ${(json.length / 1024).toFixed(0)} KB`);
  }
}
