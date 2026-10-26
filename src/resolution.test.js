import { expect, test } from 'vitest';
import { resolution as t } from './tables.js';
import { createResolution } from './resolution.js';

// Feeds `seconds` of frames of `ms` each; returns every ratio change.
function run(res, seconds, ms) {
  const changes = [];
  for (let i = 0; i < (seconds * 1000) / ms; i++) {
    const r = res.frame(ms);
    if (r) changes.push(r);
  }
  return changes;
}

test('starts at 1.5 on touch screens and at the screen ratio, capped at 2, elsewhere', () => {
  expect(createResolution(t, 2, true).ratio).toBe(1.5);
  expect(createResolution(t, 3, false).ratio).toBe(2);
  expect(createResolution(t, 1.5, false).ratio).toBe(1.5);
});

test('rises with headroom, falls to 1.25 under load and holds there', () => {
  const res = createResolution(t, 2, true);
  expect(run(res, 20, 16.7)).toEqual([1.75, 2]);
  expect(run(res, 20, 33.3)).toEqual([1.75, 1.5, 1.25]);
});

test('a step up that has to be taken back waits twice as long before the next try', () => {
  const res = createResolution(t, 2, true);
  const window = t.interval;
  run(res, window * t.upWindows, 16.7); // up to 1.75
  expect(run(res, window, 33.3)).toEqual([1.5]);
  expect(run(res, window * t.upWindows, 16.7)).toEqual([]);
  expect(run(res, window * t.upWindows, 16.7)).toEqual([1.75]);
});

test('a stall or pause in a smooth window does not step down', () => {
  const res = createResolution(t, 2, true);
  expect(res.frame(5000)).toBeNull();
  expect(run(res, t.interval, 16.7)).toEqual([]);
  expect(res.ratio).toBe(1.5);
});

test('never above the screen ratio', () => {
  const res = createResolution(t, 1, false);
  expect(res.ratio).toBe(1);
  expect(run(res, 60, 16.7)).toEqual([]);
  expect(run(res, 20, 33.3)).toEqual([]);
});
