import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { creditsFrom } from './start.js';

test('the credits are every row of the markdown tables, without the header, the rule or the files', () => {
  const md = [
    '# Credits',
    'Some prose | with a bar.',
    '| Asset | Files | Source | Licence |',
    '|---|---|---|---|',
    '| Sky by A. Painter | `public/sky.ktx2` | https://example.org/sky | CC0 1.0 |',
    '<!-- a comment -->',
    '| Asset | Files | Source | Licence |',
    '|---|---|---|---|',
    '| Map data © Someone | `public/maps/x.json` | https://example.org/map | ODbL 1.0 |',
  ].join('\n');
  expect(creditsFrom(md)).toEqual([
    { asset: 'Sky by A. Painter', source: 'https://example.org/sky', licence: 'CC0 1.0' },
    { asset: 'Map data © Someone', source: 'https://example.org/map', licence: 'ODbL 1.0' },
  ]);
});

test("CREDITS.md's credits include the map data and the elevation, whose licences ask for them", () => {
  const credits = creditsFrom(readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8'));
  expect(credits).toContainEqual({ asset: 'Map data © OpenStreetMap contributors', source: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0' });
  expect(credits.find((c) => c.asset.startsWith('Elevation: TINITALY 1.1'))?.licence).toBe('CC BY 4.0');
  expect(credits.find((c) => c.asset.startsWith('Car Kit 3.1'))?.licence).toBe('CC0 1.0');
});
