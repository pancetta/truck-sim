import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assets, budget, outputs } from './assets.config.js';

// Every file under `dir`, relative to it.
const files = (dir) => readdirSync(dir, { recursive: true }).filter((f) => statSync(join(dir, f)).isFile());

describe('asset budget', () => {
  it('keeps everything under public/ within the download budget', () => {
    const bytes = files('public').reduce((sum, f) => sum + statSync(join('public', f)).size, 0);
    expect(bytes).toBeLessThanOrEqual(budget.bytes);
  });

  // Catches an asset listed but not run through npm run assets, a texture dropped in by hand, or one left behind
  // when its asset left the list. public/models also holds the kit models, so only the listed ones are checked there.
  it('serves what npm run assets made from the asset list, and no other textures', () => {
    const made = assets.flatMap(outputs);
    expect(made.filter((f) => !existsSync(join('public', f)))).toEqual([]);
    expect(files('public/textures').map((f) => `textures/${f}`).sort()).toEqual(made.filter((f) => f.startsWith('textures/')).sort());
  });

  it('serves the Basis transcoder of the installed three, which its KTX2Loader expects', () => {
    for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
      expect(readFileSync(join('public/basis', f)).equals(readFileSync(join('node_modules/three/examples/jsm/libs/basis', f))), f).toBe(true);
    }
  });
});
