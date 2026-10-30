import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { creditsFrom, howToArt, onTap } from './start.js';
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

test('a tap acts on its release on the button it pressed, once; its click is dropped, a keyboard click acts (#115)', () => {
  // shortcut: a fake DOM, the page's capturing listeners before the element's, no bubbling between elements.
  const listeners = (target) => (target.on = {}) && Object.assign(target, { addEventListener: (type, fn) => (target.on[type] ??= []).push(fn) });
  const document = listeners({});
  const overlay = Object.assign(listeners({}), { ownerDocument: document });
  const go = { closest: (sel) => (sel === 'button:enabled' ? go : null) };
  const locked = { closest: () => null }; // a disabled map card
  const page = { closest: () => null }; // outside the overlay, e.g. the game under it once it's gone
  const acted = [];
  onTap(overlay, (b) => acted.push(b));
  const fire = (type, target, inOverlay = true) => {
    let stopped = false;
    const e = { type, target, button: 0, stopPropagation: () => (stopped = true), preventDefault: () => {} };
    for (const fn of document.on[type] ?? []) fn(e);
    if (inOverlay && !stopped) for (const fn of overlay.on[type] ?? []) fn(e);
    return !stopped;
  };

  fire('pointerdown', go);
  fire('pointerup', go);
  expect(acted).toEqual([go]);
  expect(fire('click', page, false)).toBe(false); // the tap's click, landing under the gone overlay
  fire('click', go); // a keyboard's click
  expect(acted).toEqual([go, go]);

  fire('pointerdown', go);
  fire('pointerup', locked); // let go elsewhere
  fire('pointerdown', locked);
  fire('pointerup', locked);
  expect(acted).toHaveLength(2);

  fire('pointerdown', go);
  fire('pointerup', go); // its click never comes
  expect(fire('pointerdown', page, false)).toBe(true);
  expect(fire('click', page, false)).toBe(true); // so the next tap's click isn't dropped
  expect(acted).toHaveLength(3);
});
