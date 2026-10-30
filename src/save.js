// Persistence of the profile (spec #12, "Save module"): one slot per browser. Takes a storage object of the
// localStorage shape (getItem/setItem/removeItem) instead of touching localStorage, so tests can pass a fake.
import { freshProfile, tankOf } from './sim/sim.js';

const KEY = 'truck-sim.save';
const MAP_KEY = 'truck-sim.map'; // the start screen's map choice, apart from the Profile, so a reset keeps it

export function createSave(storage, tables) {
  // Always a valid profile: anything missing, corrupt, wrong-typed, out of range or from another version
  // gives a fresh one; ids the tables don't know are dropped.
  let newer = false; // whether the stored save is from a newer build; save() leaves it alone
  let found = false; // whether load() found a Save this build loads (the start screen's Weiterspielen)
  function load() {
    try {
      const data = JSON.parse(storage.getItem(KEY));
      // A newer build's save (this build running from a cache after it): play fresh, but never write over it.
      newer = data?.version > freshProfile().version;
      const profile = validate(data);
      found = profile !== null;
      return profile ?? freshProfile();
    } catch {
      return freshProfile();
    }
  }

  function validate(data) {
    // Migrations first, chained, then the checks for the current version; any other starts fresh (v1 and v2 were the
    // grid city's, #67). Fuel over the (upgraded) tank is cut back to a full one. v3 → v4 (#48) adds a full tank, a
    // rested driver, the clock at its start and no time played; v4 → v5 (#81) turns rank points into Stars, one per
    // 10 points rounded down, which keeps the Tier (tables.rank); v5 → v6 (#88) makes the truck, with its upgrades, the
    // first owned Vehicle and the current one; v6 → v7 (#86) starts Reputation empty; v7 → v8 (#87) starts Story progress
    // empty; v8 → v9 (#96) brings no trailer. A trailer level out of range starts fresh; one hitched to another Vehicle than
    // the truck, or not bought, is unhitched. Vehicles the tables don't know are dropped (driving the truck again). Reputation and Story progress are kept
    // for every map, spot and chain, also those this build doesn't know, as a map that comes later keeps its own.
    const fresh = freshProfile();
    if (isObject(data) && data.version === 3) {
      const { fuel, energy, timeOfDay, timePlayed } = fresh;
      data = { ...data, version: 4, fuel, energy, timeOfDay, timePlayed };
    }
    if (isObject(data) && data.version === 4) {
      const { rankPoints, ...rest } = data;
      data = { ...rest, version: 5, stars: isAmount(rankPoints) ? Math.floor(rankPoints / 10) : null };
    }
    if (isObject(data) && data.version === 5) {
      const { upgrades, ...rest } = data;
      data = { ...rest, version: 6, vehicle: 'truck', vehicles: { truck: upgrades } };
    }
    if (isObject(data) && data.version === 6) data = { ...data, version: 7, reputation: {} };
    if (isObject(data) && data.version === 7) data = { ...data, version: 8, stories: {} };
    if (isObject(data) && data.version === 8) data = { ...data, version: 9, trailer: { level: 0, hitched: false } };
    if (!isObject(data) || data.version !== fresh.version) return null;
    const { money, stars, distance, vehicle, vehicles, owned, equipped, fuel, energy, timeOfDay, timePlayed, reputation, stories, trailer } = data;
    if (!isAmount(money) || !isStars(stars) || !isAmount(distance)) return null;
    if (!isAmount(fuel) || !isAmount(timePlayed)) return null;
    if (!(isAmount(energy) && energy <= 1) || !(isAmount(timeOfDay) && timeOfDay < 24 * 60)) return null;
    if (!isObject(vehicles) || !Object.values(vehicles).every(isObject) || !isObject(equipped)) return null;
    if (!Array.isArray(owned) || !owned.every((id) => typeof id === 'string')) return null;
    if (!isObject(reputation) || !Object.values(reputation).every((m) => isObject(m) && Object.values(m).every(isStars))) return null;
    const isStory = (x) => isObject(x) && typeof x.client === 'string' && isStars(x.step);
    if (!isObject(stories) || !Object.values(stories).every((m) => isObject(m) && Object.values(m).every(isStory))) return null;
    if (!isObject(trailer) || !isStars(trailer.level) || trailer.level > tables.trailer.levels.length || typeof trailer.hitched !== 'boolean') return null;

    const inRange = ([id, level]) => Number.isInteger(level) && level >= 0 && level <= tables.upgrades[id].levels.length;
    const fleet = { truck: {}, ...vehicles };
    const bought = {};
    for (const [id, upgrades] of Object.entries(fleet).filter(([id]) => Object.hasOwn(tables.fleet, id))) {
      const levels = Object.entries(upgrades).filter(([u]) => Object.hasOwn(tables.upgrades, u));
      if (!levels.every(inRange)) return null;
      bought[id] = Object.fromEntries(levels);
    }
    const current = Object.hasOwn(bought, vehicle) ? vehicle : 'truck';
    const kept = [...new Set(owned)].filter((id) => Object.hasOwn(tables.visuals, id));
    const worn = Object.entries(equipped).filter(([slot, id]) => kept.includes(id) && tables.visuals[id].slot === slot);
    return {
      version: data.version,
      money,
      stars,
      distance,
      vehicle: current,
      vehicles: bought,
      owned: kept,
      equipped: Object.fromEntries(worn),
      fuel: Math.min(fuel, tankOf({ vehicle: current, vehicles: bought }, tables)),
      energy,
      timeOfDay,
      timePlayed,
      reputation,
      stories,
      trailer: { level: trailer.level, hitched: trailer.hitched && trailer.level > 0 && current === 'truck' },
    };
  }

  let written = null; // the last written profile, with the values that change every step rounded (see save())
  let cleared = false; // reset() ran: the page reloads, and the frames before it must not write the old profile back

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
    if (newer || cleared || key === written) return;
    written = key;
    try {
      storage.setItem(KEY, JSON.stringify(profile));
    } catch {
      // nothing to do; the next change tries again
    }
  }

  // Every caller reloads the page after it, which starts a fresh Profile with a new save module.
  function reset() {
    cleared = true;
    try {
      storage.removeItem(KEY);
    } catch {
      // same as save: an unreadable storage has nothing to clear
    }
  }

  // The chosen map's id (tables.maps): the remembered one while the tables have it open, else the first open one.
  function map() {
    const open = Object.keys(tables.maps).filter((id) => tables.maps[id].open);
    try {
      const chosen = storage.getItem(MAP_KEY);
      if (open.includes(chosen)) return chosen;
    } catch {
      // unreadable storage: the first open map
    }
    return open[0];
  }

  function chooseMap(id) {
    try {
      storage.setItem(MAP_KEY, id);
    } catch {
      // as save(): the choice just isn't remembered
    }
  }

  return {
    load,
    save,
    reset,
    map,
    chooseMap,
    get found() {
      return found;
    },
  };
}

const isObject = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const isAmount = (x) => Number.isFinite(x) && x >= 0;
const isStars = (x) => Number.isInteger(x) && x >= 0;
