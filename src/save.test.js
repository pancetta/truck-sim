import { describe, expect, test } from 'vitest';
import { createSave } from './save.js';
import { createSim } from './sim/sim.js';
import * as baseTables from './tables.js';

// Test visual items, so the save rules have known ids to keep and unknown ones to drop; the upgrades are the
// real ones (motor has 3 levels).
const tables = {
  ...baseTables,
  visuals: { red: { slot: 'paint' }, blue: { slot: 'paint' }, dice: { slot: 'gimmick' } },
};
const fresh = createSim(tables).state.profile;
const KEY = 'truck-sim.save';

// Fake storage with the localStorage shape.
function fakeStorage(items = {}) {
  return {
    items,
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => (items[k] = String(v)),
    removeItem: (k) => delete items[k],
  };
}

const stored = (data) => createSave(fakeStorage({ [KEY]: JSON.stringify(data) }), tables).load();
const valid = { version: 3, money: 1234, rankPoints: 40, distance: 5678.9, upgrades: { motor: 2 }, owned: ['red', 'dice'], equipped: { paint: 'red', gimmick: 'dice' } };
// The same progress as saved by the grid city's versions: 1, before the distance counter, and 2 (#67: no migration).
const { distance, ...v1Fields } = valid;
const v1 = { ...v1Fields, version: 1 };
const v2 = { ...valid, version: 2 };

describe('save module', () => {
  test('load → change → save → load round-trips', () => {
    const storage = fakeStorage();
    const save = createSave(storage, tables);
    const profile = save.load();
    profile.money = 980;
    profile.upgrades.motor = 1;
    save.save(profile);
    expect(createSave(storage, tables).load()).toEqual(profile);
    expect(stored(valid)).toEqual(valid);
  });

  test('missing, corrupt or wrong-typed data loads a fresh profile', () => {
    expect(createSave(fakeStorage(), tables).load()).toEqual(fresh);
    expect(createSave(fakeStorage({ [KEY]: '{not json' }), tables).load()).toEqual(fresh);
    for (const bad of [null, 42, 'x', [], { ...valid, money: '1234' }, { ...valid, money: -5 }, { ...valid, money: NaN },
      { ...valid, rankPoints: null }, { ...valid, upgrades: [] }, { ...valid, upgrades: { motor: 4 } },
      { ...valid, upgrades: { motor: 1.5 } }, { ...valid, owned: 'red' }, { ...valid, owned: [3] }, { ...valid, equipped: null },
      { ...valid, distance: -1 }, { ...valid, distance: '12' }, { ...valid, distance: Infinity }, v1Fields]) {
      expect(stored(bad), JSON.stringify(bad)).toEqual(fresh);
    }
  });

  test('a storage that throws on read loads a fresh profile', () => {
    const storage = { getItem: () => { throw new Error('denied'); } };
    expect(createSave(storage, tables).load()).toEqual(fresh);
  });

  test('a version 1 or 2 save (the grid city) loads as a fresh profile of the current version', () => {
    expect(fresh.version).toBe(3);
    expect(stored(v1)).toEqual(fresh);
    expect(stored(v2)).toEqual(fresh);
  });

  test('an unknown version loads a fresh profile', () => {
    for (const version of [0, 4, '3', undefined]) expect(stored({ ...valid, version }), String(version)).toEqual(fresh);
    expect(stored({ money: 1234 })).toEqual(fresh);
  });

  test('unknown ids are dropped, and so is an equipped item not owned or in the wrong slot', () => {
    const profile = stored({
      ...valid,
      upgrades: { motor: 2, turbo: 9 },
      owned: ['red', 'gold', 'dice'],
      equipped: { paint: 'blue', gimmick: 'red', roof: 'gold' },
    });
    expect(profile).toEqual({ ...valid, equipped: {} });
  });

  test('save writes only when the profile changed, counting the distance in whole 100 m', () => {
    const storage = fakeStorage();
    const writes = [];
    const save = createSave({ ...storage, setItem: (k, v) => writes.push(JSON.parse(v)) }, tables);
    const profile = structuredClone(valid); // distance 5678.9

    save.save(profile);
    save.save(profile);
    profile.distance = 5699.9;
    save.save(profile); // same 100 m: skipped
    profile.money += 10;
    save.save(profile); // a payment: written with the exact distance
    profile.distance = 5700.1;
    save.save(profile); // the next 100 m
    expect(writes.map((p) => [p.money, p.distance])).toEqual([[1234, 5678.9], [1244, 5699.9], [1244, 5700.1]]);

    save.reset();
    save.save(profile); // after a reset the same profile is written again
    expect(writes).toHaveLength(4);
  });

  test("the game's own visual items, bought through the Sim, survive a save", () => {
    const sim = createSim(baseTables, undefined, Math.random, { ...fresh, money: 5000 });
    sim.buyVisual('paintBlue');
    sim.buyVisual('gimmickDice');
    sim.equipVisual('gimmickNone'); // owned, but the stock item is worn
    const storage = fakeStorage();
    createSave(storage, baseTables).save(sim.state.profile);

    expect(createSave(storage, baseTables).load()).toEqual(sim.state.profile);
    expect(sim.state.profile).toMatchObject({ owned: ['paintBlue', 'gimmickDice'], equipped: { paint: 'paintBlue' } });
  });

  test('save never throws, even when setItem does (full storage, private mode)', () => {
    const storage = { ...fakeStorage(), setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => createSave(storage, tables).save(valid)).not.toThrow();
  });

  test('reset clears the save', () => {
    const storage = fakeStorage();
    const save = createSave(storage, tables);
    save.save(valid);
    save.reset();
    expect(storage.items).toEqual({});
    expect(save.load()).toEqual(fresh);
  });
});
