import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { creditsFrom, howToArt } from './start.js';
import { strings } from './strings.js';
import * as tables from './tables.js';

test('the credits are every row of the markdown tables, without the header, the rule or the files', () => {
  const md = [
    '# Credits',
    'Some prose | with a bar.',
    '| Asset | Files | Source | Licence |',
    '|---|---|---|---|',
    '| Sky by A. Painter | `public/sky.ktx2` | https://example.org/sky | CC0 1.0 |',
    '<!-- a comment -->',
    '| Name | Files | Source | Licence |',
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

test('every map card has its name and line', () => {
  for (const id of Object.keys(tables.maps)) expect(strings.maps[id], id).toMatchObject({ name: expect.any(String), line: expect.any(String) });
});

test('every how-to page has its title, text and drawing; every tutorial step its text', () => {
  expect(Object.keys(howToArt(strings))).toEqual(Object.keys(strings.start.howToPages));
  for (const page of Object.values(strings.start.howToPages)) expect(page).toMatchObject({ title: expect.any(String), text: expect.arrayContaining([expect.any(String)]) });
  expect(Object.keys(strings.tutorial.steps)).toEqual(tables.tutorial.steps);
  expect(tables.tutorial.steps.filter((id) => strings.tutorial.steps[id].next)).toEqual(tables.tutorial.waits); // their buttons' labels
});
