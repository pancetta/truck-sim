import { describe, expect, test } from 'vitest';
import * as tables from '../tables.js';
import { strings } from '../strings.js';
import { createSave } from '../save.js';
import { build, createSim, deliver, lane, monti, seeded, way, withSpots } from './fixtures.js';
import { freshProfile } from './sim.js';

// Story chains (#87): a Client at the top Reputation starts its Kind's chain, whose steps are offered first, one by one,
// to places of their Kinds on whatever map, and whose last step pays the reward.

const top = tables.reputation.levels.at(-1).stars;
const chainOf = (id) => tables.stories.find((c) => c.id === id);
const memory = () => {
  const items = {};
  return { getItem: (k) => items[k] ?? null, setItem: (k, v) => (items[k] = v), removeItem: (k) => delete items[k] };
};

describe('the chains', () => {
  test('three, each of 3–5 steps from a Kind that takes orders, with German lines for its start, every offer and every thank-you', () => {
    expect(tables.stories).toHaveLength(3);
    expect(new Set(tables.stories.map((c) => c.client)).size).toBe(3); // one per Kind, so each starts on its own
    const dreirad = tables.fleet.dreirad.maxCargo;
    for (const { id, client, steps, reward } of tables.stories) {
      const text = strings.stories[id];
      expect(steps.length, id).toBeGreaterThanOrEqual(3);
      expect(steps.length, id).toBeLessThanOrEqual(5);
      expect(strings.thanks[client], id).toBeTruthy();
      expect(text.title && text.intro, id).toBeTruthy();
      expect(text.steps).toHaveLength(steps.length);
      for (const [i, step] of steps.entries()) {
        expect(text.steps[i].offer && text.steps[i].thanks, `${id} ${i}`).toBeTruthy();
        expect(strings.spotKinds[step.to], `${id} ${i}`).toBeTruthy();
        expect([undefined, 'express', 'round'], `${id} ${i}`).toContain(step.type);
        expect(step.cargo.weight, `${id} ${i}`).toBeLessThanOrEqual(dreirad);
        if (step.cargo.kind) expect(tables.orders.kinds[step.cargo.kind], `${id} ${i}`).toBeTruthy();
      }
      expect(reward.money > 0 && reward.stars > 0, id).toBe(true);
      if (reward.visual) expect(tables.visuals[reward.visual], id).toBeTruthy();
    }
  });

  test("on Monti, every step of every chain is offered first, from the chain's Client to places of the step's Kind", () => {
    const m = monti();
    for (const { id, client, steps } of tables.stories) {
      const from = m.spots.find((s) => s.kind === client && !s.pose.edge.pedestrian);
      for (const [i, step] of steps.entries()) {
        const sim = createSim(tables, m, seeded(i), { ...freshProfile(), stars: 200, stories: { [m.id]: { [id]: { client: from.id, step: i } } } });
        const [offer] = sim.requestOffers();
        expect(offer, `${id} ${i}`).toMatchObject({ story: { chain: id, step: i }, pickup: from.id, cargo: step.cargo, type: step.type ?? expect.any(String) });
        for (const d of offer.drops) expect(m.spots.find((s) => s.id === d.spot).kind, `${id} ${i}`).toBe(step.to);
        if (step.type === 'round') expect(offer.drops.length, `${id} ${i}`).toBeGreaterThan(1);
      }
    }
  });
});

describe('a chain on a map of other places', () => {
  // The lane, as a map of its own whose places are a bakery and a florist (lane() gives its spots no Kind).
  const vicolo = () => {
    const { t, map } = lane({ ...tables, osm: { ...tables.osm, id: 'vicolo' } });
    Object.assign(map.spots.find((s) => s.id === 'A'), { kind: 'bakery' });
    Object.assign(map.spots.find((s) => s.id === 'B'), { kind: 'florist' });
    return { t, map };
  };

  test('starts at the top Reputation, advances step by step, survives a save mid-chain and pays its reward at the end', () => {
    const { t, map } = vicolo();
    const chain = chainOf('geburtstag');
    let sim = createSim(t, map, seeded(1), { ...freshProfile(), reputation: { vicolo: { A: top - 1 } } });
    expect(sim.requestOffers().some((o) => o.story)).toBe(false);

    deliver(sim); // a plain order brings A, the bakery, to the top
    expect(sim.state.lastStory).toEqual({ chain: 'geburtstag', step: 0 });
    expect(sim.state.profile.stories).toEqual({ vicolo: { geburtstag: { client: 'A', step: 0 } } });

    for (const [i, step] of chain.steps.entries()) {
      if (i === 2) {
        // Saved and loaded halfway, the chain goes on where it was.
        const storage = memory();
        createSave(storage, t).save(sim.state.profile);
        const profile = createSave(storage, t).load();
        expect(profile.stories).toEqual({ vicolo: { geburtstag: { client: 'A', step: 2 } } });
        sim = createSim(t, map, seeded(2), profile);
      }
      const { money, stars } = sim.state.profile;
      // No shop, café or other bakery here: each step drops off at B, a round at it alone.
      const offer = deliver(sim);
      expect(offer).toMatchObject({ story: { chain: 'geburtstag', step: i }, pickup: 'A', dropoff: 'B', cargo: step.cargo, type: step.type ?? 'normal' });
      expect(offer.drops).toHaveLength(1);
      expect(sim.state.lastStory).toEqual({ chain: 'geburtstag', step: i + 1 });
      expect(sim.state.profile.stories.vicolo.geburtstag.step).toBe(i + 1);
      const { lines, stars: earned, amount } = sim.state.lastPayment;
      const last = i === chain.steps.length - 1;
      expect(lines.find((l) => l.label === 'story')?.amount).toBe(last ? chain.reward.money : undefined);
      expect(sim.state.profile.money).toBe(money + amount);
      expect(sim.state.profile.stars).toBe(stars + earned.filter((s) => !s.reasons.length).length + (last ? chain.reward.stars : 0));
    }

    // Done: no more steps, and the bakery's next order starts nothing again.
    expect(sim.requestOffers().some((o) => o.story)).toBe(false);
    const done = sim.state.lastStory;
    deliver(sim);
    expect(sim.state.lastStory).toBe(done);
    expect(sim.state.profile.stories).toEqual({ vicolo: { geburtstag: { client: 'A', step: chain.steps.length } } });
  });

  test('a step keeps the place its lines speak of: the Client never calls to move its drop-off', () => {
    const { t, map } = vicolo();
    const calls = { ...t, surprises: { ...t.surprises, closed: 0, dropoff: 1 } };
    const sim = createSim(calls, map, seeded(1), { ...freshProfile(), stories: { vicolo: { geburtstag: { client: 'A', step: 1 } } } });
    const [story, plain] = sim.requestOffers();
    sim.acceptOrder(story.id);
    expect(sim.state.order).toMatchObject({ story: { chain: 'geburtstag', step: 1 }, surprise: null });
    const other = createSim(calls, map, seeded(1), freshProfile());
    other.acceptOrder(other.requestOffers()[0].id);
    expect(other.state.order.surprise?.kind).toBe('dropoff');
    expect(plain.story).toBeUndefined();
  });

  test("the last step's Visual item is the player's to wear", () => {
    const { t, map } = vicolo();
    const chain = chainOf('espressomat');
    const shop = { ...t, stories: [{ ...chain, client: 'bakery' }] }; // the workshop's chain, from the bakery
    const sim = createSim(shop, map, seeded(1), { ...freshProfile(), stories: { vicolo: { espressomat: { client: 'A', step: chain.steps.length - 1 } } } });
    expect(sim.owns(chain.reward.visual)).toBe(false);
    deliver(sim);
    expect(sim.owns(chain.reward.visual)).toBe(true);
  });

  test('a step goes to places of its Kind where the map has them, a round to as many of them as it has', () => {
    const road = way('residential', [[0, -150], [0, 150]], { name: 'Strada Lunga' });
    const spot = (id, kind, at) => ({ id, kind, name: `Bottega ${id}`, street: 'Strada Lunga', way: road.id, at, side: 'right' });
    const t = withSpots([spot('W', 'workshop', 20), spot('X', 'cafe', 80), spot('Y', 'shop', 140), spot('Z', 'shop', 200), spot('V', 'bakery', 260)]);
    const t2 = { ...t, osm: { ...t.osm, id: 'strada' } };
    const map = build([road], t2);
    const chain = chainOf('espressomat');
    const kindOf = (id) => map.spots.find((s) => s.id === id).kind;
    for (const [i, step] of chain.steps.entries()) {
      for (let seed = 1; seed <= 5; seed++) {
        const sim = createSim(t2, map, seeded(seed), { ...freshProfile(), stars: 200, stories: { strada: { espressomat: { client: 'W', step: i } } } });
        const [offer] = sim.requestOffers();
        expect(offer.story).toEqual({ chain: 'espressomat', step: i });
        expect(offer.drops.map((d) => kindOf(d.spot)), `step ${i}`).toEqual(offer.drops.map(() => step.to));
        if (step.type === 'round') expect(offer.drops).toHaveLength(2); // both shops, whatever the round's count
      }
    }
  });
});
