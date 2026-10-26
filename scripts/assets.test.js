import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assets, budget, MAPS, outputs } from './assets.config.js';
import { buildings, ground, lighting, streets } from '../src/tables.js';

// Every file under `dir`, relative to it, leaving out dotfiles such as Finder's .DS_Store (gitignored, never served).
const files = (dir) => readdirSync(dir, { recursive: true }).filter((f) => !/(^|\/)\./.test(f) && statSync(join(dir, f)).isFile());

describe('asset budget', () => {
  it('keeps everything under public/ within the download budget', () => {
    const bytes = files('public').reduce((sum, f) => sum + statSync(join('public', f)).size, 0);
    expect(bytes).toBeLessThanOrEqual(budget.bytes);
  });

  // Catches an asset listed but not run through npm run assets, a texture dropped in by hand, or one left behind
  // when its asset left the list. public/models also holds the kit models, so only the listed ones are checked there.
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

  it('serves the Basis transcoder of the installed three, which its KTX2Loader expects', () => {
    for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
      expect(readFileSync(join('public/basis', f)).equals(readFileSync(join('node_modules/three/examples/jsm/libs/basis', f))), f).toBe(true);
    }
  });
});
