// Persistence of the profile (spec #12, "Save module"): one slot per browser. Takes a storage object of the
// localStorage shape (getItem/setItem/removeItem) instead of touching localStorage, so tests can pass a fake.
import { freshProfile } from './sim/sim.js';

const KEY = 'truck-sim.save';

export function createSave(storage, tables) {
  // Always a valid profile: anything missing, corrupt, wrong-typed, out of range or from another version
  // gives a fresh one; ids the tables don't know are dropped.
  function load() {
    try {
      return validate(JSON.parse(storage.getItem(KEY))) ?? freshProfile();
    } catch {
      return freshProfile();
    }
  }

  function validate(data) {
    // Migrations first, then the checks for the current version; any other starts fresh (v1 and v2 were the grid
    // city's, #67). v3 → v4 (#48) adds a full tank, a rested driver, the clock at its start and no time played.
    const fresh = freshProfile();
    if (isObject(data) && data.version === 3) {
      const { fuel, energy, timeOfDay, timePlayed } = fresh;
      data = { ...data, version: 4, fuel, energy, timeOfDay, timePlayed };
    }
    if (!isObject(data) || data.version !== fresh.version) return null;
    const { money, rankPoints, distance, upgrades, owned, equipped, fuel, energy, timeOfDay, timePlayed } = data;
    if (!isAmount(money) || !isAmount(rankPoints) || !isAmount(distance)) return null;
    if (!isAmount(fuel) || !isAmount(timePlayed)) return null;
    if (!(isAmount(energy) && energy <= 1) || !(isAmount(timeOfDay) && timeOfDay < 24 * 60)) return null;
    if (!isObject(upgrades) || !isObject(equipped)) return null;
    if (!Array.isArray(owned) || !owned.every((id) => typeof id === 'string')) return null;

    const levels = Object.entries(upgrades).filter(([id]) => Object.hasOwn(tables.upgrades, id));
    const inRange = ([id, level]) => Number.isInteger(level) && level >= 0 && level <= tables.upgrades[id].levels.length;
    if (!levels.every(inRange)) return null;
    const kept = [...new Set(owned)].filter((id) => Object.hasOwn(tables.visuals, id));
    const worn = Object.entries(equipped).filter(([slot, id]) => kept.includes(id) && tables.visuals[id].slot === slot);
    return {
      version: data.version,
      money,
      rankPoints,
      distance,
      upgrades: Object.fromEntries(levels),
      owned: kept,
      equipped: Object.fromEntries(worn),
      fuel,
      energy,
      timeOfDay,
      timePlayed,
    };
  }

  let written = null; // the last written profile, with the values that change every step rounded (see save())

  // Call it as often as you like: it writes only when the profile changed, but counts the distance in
  // whole 100 m, fuel in whole litres, energy in whole percent, the time of day in 15 game minutes and the time
  // played in whole minutes, so a running game writes every 15 s or so instead of every step (a reload loses
  // less than that). Never throws: a full storage or a private mode just means the game goes on unsaved.
  function save(profile) {
    const key = JSON.stringify({
      ...profile,
      distance: Math.floor(profile.distance / 100),
      fuel: Math.floor(profile.fuel),
      energy: Math.floor(profile.energy * 100),
      timeOfDay: Math.floor(profile.timeOfDay / 15),
      timePlayed: Math.floor(profile.timePlayed / 60),
    });
    if (key === written) return;
    written = key;
    try {
      storage.setItem(KEY, JSON.stringify(profile));
    } catch {
      // nothing to do; the next change tries again
    }
  }

  function reset() {
    written = null;
    try {
      storage.removeItem(KEY);
    } catch {
      // same as save: an unreadable storage has nothing to clear
    }
  }

  return { load, save, reset };
}

const isObject = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const isAmount = (x) => Number.isFinite(x) && x >= 0;
