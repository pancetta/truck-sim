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
const valid = { version: 2, money: 1234, rankPoints: 40, distance: 5678.9, upgrades: { motor: 2 }, owned: ['red', 'dice'], equipped: { paint: 'red', gimmick: 'dice' } };
// The same progress as saved by version 1, before the distance counter.
const { distance, ...v1Fields } = valid;
const v1 = { ...v1Fields, version: 1 };

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

  test('a version 1 save loads as version 2 with all its progress kept and no distance yet', () => {
    expect(stored(v1)).toEqual({ ...valid, distance: 0 });
    // the same pruning as for a current save
    expect(stored({ ...v1, upgrades: { motor: 2, turbo: 9 }, equipped: { paint: 'blue', gimmick: 'dice' } }))
      .toEqual({ ...valid, distance: 0, equipped: { gimmick: 'dice' } });
  });

  test('an invalid version 1 save loads a fresh profile', () => {
    for (const bad of [{ ...v1, money: -5 }, { ...v1, rankPoints: '40' }, { ...v1, upgrades: { motor: 4 } }, { ...v1, owned: 'red' }]) {
      expect(stored(bad), JSON.stringify(bad)).toEqual(fresh);
    }
  });

  test('an unknown version loads a fresh profile', () => {
    for (const version of [0, 3, '2', undefined]) expect(stored({ ...valid, version }), String(version)).toEqual(fresh);
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
