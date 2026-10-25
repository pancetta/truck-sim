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
    // No migrations yet: other versions start fresh. Add one here when freshProfile's version goes up.
    if (!isObject(data) || data.version !== freshProfile().version) return null;
    const { money, rankPoints, upgrades, owned, equipped } = data;
    if (!isAmount(money) || !isAmount(rankPoints) || !isObject(upgrades) || !isObject(equipped)) return null;
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
      upgrades: Object.fromEntries(levels),
      owned: kept,
      equipped: Object.fromEntries(worn),
    };
  }

  // Never throws: a full storage or a private mode just means the game goes on unsaved.
  function save(profile) {
    try {
      storage.setItem(KEY, JSON.stringify(profile));
    } catch {
      // nothing to do; the next save tries again
    }
  }

  function reset() {
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
