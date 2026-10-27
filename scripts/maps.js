// npm run maps (also run by npm run assets): turns the OSM extracts listed in assets.config.js `maps` into the files
// the game loads under public/maps/. Ways keep their node ids (shared nodes join streets) and their points in metres;
// nodes keep only their point. Elements with none of the `keep` tags are left out. Commit what it writes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { maps } from './assets.config.js';

const [lat0, lon0] = maps.origin;
const M_LAT = 110574; // m per degree of latitude
const M_LON = 111320 * Math.cos((lat0 * Math.PI) / 180); // m per degree of longitude there
const round = (v) => Math.round(v * 10) / 10; // to 0.1 m
const xz = (lat, lon) => [round((lon - lon0) * M_LON), round(-(lat - lat0) * M_LAT)];

const [south, west, north, east] = maps.bbox;
const [minX, maxZ] = xz(south, west);
const [maxX, minZ] = xz(north, east);

for (const { source, out, keep } of maps.files) {
  const data = JSON.parse(await readFile(source, 'utf8'));
  let trimmed = data;
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
  await mkdir(dirname(join('public', out)), { recursive: true });
  await writeFile(join('public', out), JSON.stringify(trimmed));
  console.log(`${out}: ${(JSON.stringify(trimmed).length / 1024).toFixed(0)} KB`);
}
