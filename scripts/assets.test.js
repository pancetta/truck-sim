import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assets, budget, maps, MAPS, outputs } from './assets.config.js';
import { makeMaps, xz } from './maps.js';
import { buildings, ground, lighting, osm, streets } from '../src/tables.js';

// Every file under `dir`, relative to it, leaving out dotfiles such as Finder's .DS_Store (gitignored, never served).
const files = (dir) => readdirSync(dir, { recursive: true }).filter((f) => !/(^|\/)\./.test(f) && statSync(join(dir, f)).isFile());

describe('asset budget', () => {
  it('keeps everything under public/ within the download budget', () => {
    const bytes = files('public').reduce((sum, f) => sum + statSync(join('public', f)).size, 0);
    expect(bytes).toBeLessThanOrEqual(budget.bytes);
  });

  // Catches an asset listed but not run through npm run assets, a texture dropped in by hand, or one left behind
  // when its asset left the list. public/models also holds the truck's kit model, so only the listed ones are checked
  // there.
  it('serves what npm run assets made from the asset list, credited, and no other textures', () => {
    const made = assets.flatMap(outputs);
    expect(made.filter((f) => !existsSync(join('public', f)))).toEqual([]);
    expect(files('public/textures').map((f) => `textures/${f}`).sort()).toEqual(made.filter((f) => f.startsWith('textures/')).sort());
    const credits = readFileSync('CREDITS.md', 'utf8');
    expect(made.filter((f) => !credits.includes(`public/${f}`))).toEqual([]);
  });

  // The renderer builds these names itself (renderer.js loadSky and groundMaterial, streets.js); a missing one loads
  // as a 404.
  it('makes every texture and model the renderer loads', () => {
    const made = assets.flatMap(outputs);
    const maps = (texture) => Object.keys(MAPS).map((map) => `${texture}_${map}.ktx2`);
    const loaded = [lighting.sky, lighting.skyFirst, ...[...Object.values(ground), ...buildings.walls, buildings.roof, streets.pavement].flatMap(({ texture }) => maps(texture)), ...streets.trees.map((t) => `${t.picture}.ktx2`)];
    expect(loaded.filter((f) => !made.includes(`textures/${f}`))).toEqual([]);
    expect(made).toContain(`models/${streets.lantern.model}.glb`);
  });

  // The map builder loads tables.osm.file; the other two are for the look (#65, #66).
  it('serves the map files npm run maps made from the OSM extracts, credited, among them the one the map builder loads', () => {
    const made = maps.files.map((f) => f.out);
    expect(made.filter((f) => !existsSync(join('public', f)))).toEqual([]);
    expect(made).toContain(osm.file);
    const credits = readFileSync('CREDITS.md', 'utf8');
    expect(made.filter((f) => !credits.includes(`public/${f}`))).toEqual([]);
  });

  // Catches a hand-edited map file, one left stale after the extracts or the trimming changed, or a broken script.
  it('serves exactly what npm run maps makes from data/osm/, projected round the extract\'s origin', async () => {
    for (const { out, json } of await makeMaps()) expect(json === readFileSync(join('public', out), 'utf8'), out).toBe(true);
    expect(xz(...maps.origin).map(Math.abs)).toEqual([0, 0]);
    expect(xz(maps.origin[0] + 0.001, maps.origin[1])[1]).toBe(-110.6); // north is -z, 0.001° about 111 m
  });

  it('serves the Basis transcoder of the installed three, which its KTX2Loader expects', () => {
    for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
      expect(readFileSync(join('public/basis', f)).equals(readFileSync(join('node_modules/three/examples/jsm/libs/basis', f))), f).toBe(true);
    }
  });
});
