import { expect, test } from 'vitest';
import { clockText, kmText, playedText, starsText } from './hud.js';
import { strings } from './strings.js';

test('the HUD and cluster texts: whole km, the clock as hh:mm, the time played as h:mm', () => {
  expect(kmText(12345678.9, strings)).toBe('12.345 km');
  expect([0, 8 * 60 + 5.9, 24 * 60 - 0.1].map(clockText)).toEqual(['00:00', '08:05', '23:59']);
  expect(playedText(59, strings)).toBe('Spielzeit 0:00\u00a0h');
  expect(playedText(26 * 3600 + 7 * 60 + 59, strings)).toBe('Spielzeit 26:07\u00a0h');
  expect(starsText({ stars: 37, next: 50 })).toBe('★ 37/50');
  expect(starsText({ stars: 420, next: null })).toBe('★ 420');
});
