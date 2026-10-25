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
    // Migrations, oldest first, then the checks for the current version; any other version starts fresh.
    if (isObject(data) && data.version === 1) data = { ...data, version: 2, distance: 0 }; // v2 added the odometer
    if (!isObject(data) || data.version !== freshProfile().version) return null;
    const { money, rankPoints, distance, upgrades, owned, equipped } = data;
    if (!isAmount(money) || !isAmount(rankPoints) || !isAmount(distance)) return null;
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
    };
  }

  let written = null; // the last written profile, with its distance in whole 100 m

  // Call it as often as you like: it writes only when the profile changed, but counts the distance in
  // whole 100 m, so driving writes every 100 m instead of every step (a reload loses less than that).
  // Never throws: a full storage or a private mode just means the game goes on unsaved.
  function save(profile) {
    const key = JSON.stringify({ ...profile, distance: Math.floor(profile.distance / 100) });
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
