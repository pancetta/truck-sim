import { describe, it, expect } from 'vitest';
import { figureOf, stepGait, PIECES } from './people.js';
import { pedestrians } from './tables.js';

describe('People: figures (#101)', () => {
  const figures = Array.from({ length: 2000 }, (_, id) => figureOf(id, pedestrians));

  it('gives each build about its share, the same look for the same id', () => {
    for (const [name, build] of Object.entries(pedestrians.figures)) {
      const share = figures.filter((f) => f.build === name).length / figures.length;
      expect(share, name).toBeCloseTo(build.share, 1);
    }
    expect(figureOf(7, pedestrians)).toEqual(figures[7]);
  });

  it('draws kids small and older people stooped, from their build, with steps to match', () => {
    for (const f of figures) {
      const build = pedestrians.figures[f.build];
      expect(f.scale).toBeCloseTo(build.scale * (pedestrians.height / 1.75), 6);
      expect(f.lean).toBe(build.lean);
      // A step as long as the build's legs swing, so the feet don't slide.
      expect(f.step).toBeCloseTo(pedestrians.step * build.scale * build.stride, 6);
    }
    const scale = (name) => figures.find((f) => f.build === name).scale;
    expect(scale('kid')).toBeLessThan(0.75 * scale('man'));
  });

  it('wears one of its build\'s outfits, with every outfit seen', () => {
    for (const [name, build] of Object.entries(pedestrians.figures)) {
      const masks = build.wear.map((w) => w.split(' ').filter(Boolean).reduce((m, piece) => m | PIECES[piece], 0));
      const worn = new Set(figures.filter((f) => f.build === name).map((f) => f.wear));
      expect([...worn].every((m) => masks.includes(m)), name).toBe(true);
      expect(worn.size, name).toBe(new Set(masks).size);
    }
  });

  it('knows every piece an outfit names', () => {
    for (const build of Object.values(pedestrians.figures)) {
      for (const piece of build.wear.join(' ').split(' ').filter(Boolean)) expect(PIECES, piece).toHaveProperty(piece);
    }
  });
});

describe('People: walk cycle (#101)', () => {
  // `seconds` at 60 fps moving at `speed` m/s along z, from the gait `g`.
  const run = (g, speed, seconds) => {
    for (let i = 0; i < seconds * 60; i++) stepGait(g, g.x, g.z + speed / 60, 1 / 60, pedestrians.step, pedestrians.speed);
    return g;
  };

  it('takes a step every `step` m walked (the phase kept within a turn), at full stride at walking pace', () => {
    const g = run({ x: 0, z: 0, phase: 0, stride: 0 }, pedestrians.speed, 2);
    expect(g.phase).toBeCloseTo(((Math.PI * pedestrians.speed * 2) / pedestrians.step) % (2 * Math.PI), 4);
    expect(g.stride).toBeCloseTo(1, 1);
  });

  it('stands still: the stride settles to nothing and the legs stop', () => {
    const g = run(run({ x: 0, z: 0, phase: 0, stride: 0 }, pedestrians.speed, 1), 0, 1);
    const phase = g.phase;
    expect(g.stride).toBeLessThan(0.01);
    expect(run(g, 0, 1).phase).toBe(phase);
  });

  it('steps quicker and longer jumping aside, but no longer than a stretched stride', () => {
    const walk = run({ x: 0, z: 0, phase: 0, stride: 0 }, pedestrians.speed, 0.2);
    const jump = run({ x: 0, z: 0, phase: 0, stride: 0 }, pedestrians.jump, 0.2);
    expect(jump.phase).toBeGreaterThan(2.5 * walk.phase);
    expect(jump.stride).toBeGreaterThan(walk.stride);
    expect(jump.stride).toBeLessThanOrEqual(1.4);
  });

  it('keeps a full stride where the frames come quicker than the Sim steps (120 Hz: one moves every other frame)', () => {
    const g = { x: 0, z: 0, phase: 0, stride: 0 };
    for (let i = 0; i < 240; i++) stepGait(g, 0, g.z + (i % 2 ? (2 * pedestrians.speed) / 120 : 0), 1 / 120, pedestrians.step, pedestrians.speed);
    expect(g.stride).toBeCloseTo(1, 1);
  });

  it('starts afresh where one appears somewhere else, with no stride from the jump', () => {
    const g = run({ x: 0, z: 0, phase: 0, stride: 0 }, 0, 0.1);
    stepGait(g, 50, 80, 1 / 60, pedestrians.step, pedestrians.speed);
    expect(g).toMatchObject({ x: 50, z: 80, phase: 0, stride: 0 });
  });
});
