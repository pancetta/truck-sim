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
const valid = {
  version: 9,
  money: 1234,
  stars: 4,
  distance: 5678.9,
  vehicle: 'truck',
  vehicles: { truck: { motor: 2 } },
  owned: ['red', 'dice'],
  equipped: { paint: 'red', gimmick: 'dice' },
  fuel: 123.4,
  energy: 0.42,
  timeOfDay: 1300.5,
  timePlayed: 3600.25,
  reputation: { monti: { B: 9, J: 0 }, laterMap: { A: 3 } }, // a map that comes later keeps its own
  // Mid-chain on this map, and a chain this build doesn't know on a map that comes later.
  stories: { monti: { geburtstag: { client: 'B', step: 2 } }, laterMap: { laterChain: { client: 'A', step: 0 } } },
  trailer: { level: 2, hitched: true },
};
// The same progress as saved by the earlier versions: 8, before the trailer (#96), 7, before Story chains (#87), 6, before Reputation (#86), 5, with
// the truck's upgrades before Vehicles (#88), 4, with rank points before Stars (#81), 3, before fuel, energy and the
// clock (#48), and the grid city's 1, before the distance counter, and 2 (#67: no migration). Migrated, they come with no
// trailer, before v8 with no Story progress, and before v7 with no Reputation.
const { trailer, ...v9Fields } = valid;
const v8 = { ...v9Fields, version: 8 };
const noTrailer = { level: 0, hitched: false };
const { stories, ...v8Fields } = v8;
const v7 = { ...v8Fields, version: 7 };
const { reputation, ...v7Fields } = v7;
const v6 = { ...v7Fields, version: 6 };
const migrated = { ...valid, reputation: {}, stories: {}, trailer: noTrailer };
const { vehicle, vehicles, ...v6Fields } = v6;
const v5 = { ...v6Fields, upgrades: { motor: 2 }, version: 5 };
const { stars, ...v5Fields } = v5;
const v4 = { ...v5Fields, rankPoints: 47, version: 4 };
const { distance, fuel, energy, timeOfDay, timePlayed, ...v1Fields } = v4;
const v3 = { ...v1Fields, distance, version: 3 };
const v1 = { ...v1Fields, version: 1 };
const v2 = { ...v3, version: 2 };

describe('save module', () => {
  test('load → change → save → load round-trips', () => {
    const storage = fakeStorage();
    const save = createSave(storage, tables);
    const profile = save.load();
    profile.money = 980;
    profile.vehicles.truck.motor = 1;
    profile.vehicles.van = { brakes: 3 };
    profile.vehicle = 'van';
    profile.fuel = 99;
    profile.reputation.monti = { C: 15 };
    profile.stories.monti = { espressomat: { client: 'K', step: 3 } };
    save.save(profile);
    expect(createSave(storage, tables).load()).toEqual(profile);
    profile.vehicle = 'truck';
    profile.trailer = { level: 3, hitched: true };
    save.save(profile);
    expect(createSave(storage, tables).load()).toEqual(profile);
    expect(stored(valid)).toEqual(valid);
  });

  test('missing, corrupt or wrong-typed data loads a fresh profile', () => {
    expect(createSave(fakeStorage(), tables).load()).toEqual(fresh);
    expect(createSave(fakeStorage({ [KEY]: '{not json' }), tables).load()).toEqual(fresh);
    for (const bad of [null, 42, 'x', [], { ...valid, money: '1234' }, { ...valid, money: -5 }, { ...valid, money: NaN },
      { ...valid, stars: null }, { ...valid, stars: 1.5 }, { ...valid, stars: -1 }, { ...v4, rankPoints: null },
      { ...v4, rankPoints: '40' }, { ...v5, upgrades: [] }, { ...v5, upgrades: { motor: 4 } }, { ...valid, vehicles: [] },
      { ...valid, vehicles: { truck: { motor: 4 } } }, { ...valid, vehicles: { truck: {}, van: { motor: 1.5 } } },
      { ...valid, vehicles: { truck: {}, van: null } }, { ...valid, reputation: null }, { ...valid, reputation: { monti: [] } },
      { ...valid, reputation: { monti: { B: -1 } } }, { ...valid, reputation: { monti: { B: 2.5 } } }, { ...valid, reputation: { monti: { B: '3' } } },
      { ...v7Fields, version: 7 }, { ...v8Fields, version: 8 }, { ...v9Fields, version: 9 }, { ...valid, trailer: null },
      { ...valid, trailer: { level: 4, hitched: false } }, { ...valid, trailer: { level: -1, hitched: false } },
      { ...valid, trailer: { level: 1.5, hitched: false } }, { ...valid, trailer: { level: 1, hitched: 'yes' } }, { ...valid, stories: null }, { ...valid, stories: { monti: [] } },
      { ...valid, stories: { monti: { geburtstag: 2 } } }, { ...valid, stories: { monti: { geburtstag: { client: 'B', step: -1 } } } },
      { ...valid, stories: { monti: { geburtstag: { client: 'B', step: 1.5 } } } }, { ...valid, stories: { monti: { geburtstag: { step: 1 } } } },
      { ...valid, owned: 'red' }, { ...valid, owned: [3] }, { ...valid, equipped: null },
      { ...valid, distance: -1 }, { ...valid, distance: '12' }, { ...valid, distance: Infinity }, v1Fields,
      { ...valid, fuel: -1 }, { ...valid, fuel: '400' }, { ...valid, fuel: undefined }, { ...valid, energy: 1.01 },
      { ...valid, energy: -0.1 }, { ...valid, energy: null }, { ...valid, timeOfDay: 1440 }, { ...valid, timeOfDay: -1 },
      { ...valid, timeOfDay: NaN }, { ...valid, timePlayed: -1 }, { ...valid, timePlayed: Infinity }, { ...v3, money: -5 }]) {
      expect(stored(bad), JSON.stringify(bad)).toEqual(fresh);
    }
  });

  test('a storage that throws on read loads a fresh profile', () => {
    const storage = { getItem: () => { throw new Error('denied'); } };
    expect(createSave(storage, tables).load()).toEqual(fresh);
  });

  test('a version 8 save loads as version 9, with all progress kept and no trailer', () => {
    expect(fresh.version).toBe(9);
    expect(stored(v8)).toEqual({ ...valid, trailer: noTrailer });
  });

  test('a version 7 save goes through both steps, with no Story progress and no trailer', () => {
    expect(stored(v7)).toEqual({ ...valid, stories: {}, trailer: noTrailer });
  });

  test('a trailer hitched to another Vehicle than the truck, or not bought, is unhitched', () => {
    expect(stored({ ...valid, vehicle: 'van', vehicles: { truck: {}, van: {} } }).trailer).toEqual({ level: 2, hitched: false });
    expect(stored({ ...valid, trailer: { level: 0, hitched: true } }).trailer).toEqual(noTrailer);
  });

  test('a version 6 save goes through every step, with no Reputation, no Story progress and no trailer', () => {
    expect(stored(v6)).toEqual(migrated);
  });

  test('a version 5 save goes through every step: the truck, with its upgrades, is the one owned Vehicle and the current one', () => {
    expect(stored(v5)).toEqual(migrated);
  });

  test('a version 4 save goes through every step, with all progress kept and a Star for every 10 rank points, rounded down', () => {
    expect(stored(v4)).toEqual(migrated); // 47 points: 4 Stars
  });

  // Past the top one's next Tier (in Stars) they move up into the new Tiers, as a player who earned that many Stars would.
  test('a migrated player keeps their Tier, at and either side of every old threshold', () => {
    const before = [0, 60, 200, 500, 1000]; // the rank points each Tier needed in version 4
    const top = baseTables.rank.tiers[before.length].stars * 10 - 1;
    for (const rankPoints of [0, 9, 59, 60, 61, 199, 200, 499, 500, 999, 1000, 1009, top]) {
      const profile = stored({ ...v4, rankPoints });
      expect(createSim(tables, undefined, Math.random, profile).state.rank.tier, `${rankPoints} points`).toBe(before.findLastIndex((p) => rankPoints >= p));
    }
  });

  test('a version 3 save goes through every step: a full tank, a rested driver, 08:00, no time played, and Stars', () => {
    expect(stored(v3)).toEqual({ ...migrated, fuel: baseTables.fleet.truck.tank, energy: 1, timeOfDay: 8 * 60, timePlayed: 0 });
  });

  test('a version 1 or 2 save (the grid city) loads as a fresh profile of the current version', () => {
    expect(stored(v1)).toEqual(fresh);
    expect(stored(v2)).toEqual(fresh);
  });

  test("a newer version's save loads a fresh profile and is never overwritten (an old cached build after a new one)", () => {
    const newer = JSON.stringify({ ...valid, version: 10 });
    const storage = fakeStorage({ [KEY]: newer });
    const save = createSave(storage, tables);
    const profile = save.load();
    expect(profile).toEqual(fresh);
    save.save({ ...profile, money: 10 });
    expect(storage.items[KEY]).toBe(newer);

    save.reset(); // Spielstand zurücksetzen: the player starts over on purpose
    save.save(profile);
    expect(JSON.parse(storage.items[KEY])).toEqual(fresh);
  });

  test('an unknown version loads a fresh profile', () => {
    for (const version of [0, 10, '9', undefined]) expect(stored({ ...valid, version }), String(version)).toEqual(fresh);
    expect(stored({ money: 1234 })).toEqual(fresh);
  });

  test('fuel over the tank is cut back to a full tank', () => {
    expect(stored({ ...valid, fuel: baseTables.fleet.truck.tank + 50 })).toEqual({ ...valid, fuel: baseTables.fleet.truck.tank });
    const upgraded = { ...valid, vehicles: { truck: { tank: 2 } }, fuel: 10000 };
    expect(stored(upgraded).fuel).toBe(baseTables.fleet.truck.tank * baseTables.upgrades.tank.levels[1].factor);
    expect(stored({ ...valid, vehicles: { truck: { tank: 2 }, van: {} }, vehicle: 'van', fuel: 10000 }).fuel).toBe(baseTables.fleet.van.tank); // the current one's
  });

  test('unknown ids are dropped, and so is an equipped item not owned or in the wrong slot', () => {
    const profile = stored({
      ...valid,
      vehicles: { truck: { motor: 2, turbo: 9 }, rocket: { motor: 1 } },
      owned: ['red', 'gold', 'dice'],
      equipped: { paint: 'blue', gimmick: 'red', roof: 'gold' },
    });
    expect(profile).toEqual({ ...valid, equipped: {} });
  });

  test('the truck is always owned, and a current Vehicle the tables no longer have gives way to it', () => {
    expect(stored({ ...valid, vehicles: { van: { motor: 1 } }, vehicle: 'van' })).toEqual({ ...valid, vehicles: { truck: {}, van: { motor: 1 } }, vehicle: 'van', fuel: 123.4, trailer: { level: 2, hitched: false } });
    expect(stored({ ...valid, vehicle: 'rocket' })).toEqual(valid);
    expect(stored({ ...valid, vehicle: 'van' })).toEqual(valid); // not owned
  });

  test('save writes only when the profile changed, counting the distance in whole 100 m and the clock in 15 minutes', () => {
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

    // The same for the values that change every step: fuel in whole litres, energy in whole percent, the time of day
    // in 15 game minutes (1300.5 is in 1290..1305) and the time played in whole minutes (3600.25 is in its 60th).
    Object.assign(profile, { fuel: 123.01, energy: 0.4201, timeOfDay: 1304.9, timePlayed: 3659.9 });
    save.save(profile); // skipped
    expect(writes).toHaveLength(3);
    for (const change of [{ fuel: 122.9 }, { energy: 0.419 }, { timeOfDay: 1305 }, { timePlayed: 3660 }]) {
      save.save(Object.assign(profile, change));
      expect(writes.at(-1), JSON.stringify(change)).toEqual(profile);
    }
    expect(writes).toHaveLength(7);

    save.reset();
    save.save(profile); // after a reset the same profile is written again
    expect(writes).toHaveLength(8);
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

  test('load says whether it found a Save, so the start screen offers Weiterspielen only then', () => {
    const found = (storage) => {
      const save = createSave(storage, tables);
      save.load();
      return save.found;
    };
    expect(found(fakeStorage())).toBe(false);
    expect(found(fakeStorage({ [KEY]: '{not json' }))).toBe(false);
    expect(found(fakeStorage({ [KEY]: JSON.stringify({ ...valid, money: -5 }) }))).toBe(false);
    expect(found(fakeStorage({ [KEY]: JSON.stringify({ ...valid, version: 10 }) }))).toBe(false); // a newer build's: played fresh
    expect(found(fakeStorage({ [KEY]: JSON.stringify(valid) }))).toBe(true);
    expect(found(fakeStorage({ [KEY]: JSON.stringify(v8) }))).toBe(true); // migrated
  });

  test('after a reset (Neues Spiel) the next launch finds no Save, loads a fresh Profile and keeps the chosen map', () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify(valid) });
    const save = createSave(storage, tables);
    save.load();
    save.chooseMap('monti');
    save.reset();
    const next = createSave(storage, tables);
    expect(next.load()).toEqual(fresh);
    expect(next.found).toBe(false);
    expect(next.map()).toBe('monti');
  });

  test('the chosen map is remembered; one the tables lock or lack gives the first open map', () => {
    const maps = { soon: { open: false }, monti: { open: true }, later: { open: true } };
    const storage = fakeStorage();
    expect(createSave(storage, { ...tables, maps }).map()).toBe('monti');
    createSave(storage, { ...tables, maps }).chooseMap('later');
    expect(createSave(storage, { ...tables, maps }).map()).toBe('later');
    for (const id of ['soon', 'gone']) {
      createSave(storage, { ...tables, maps }).chooseMap(id);
      expect(createSave(storage, { ...tables, maps }).map(), id).toBe('monti');
    }
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    createSave(throwing, { ...tables, maps }).chooseMap('later'); // never throws
    expect(createSave(throwing, { ...tables, maps }).map()).toBe('monti');
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
