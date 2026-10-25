import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

// The Sim must stay headless so it runs in Node and can be swapped out (spec #1).
test('Sim modules use neither Three.js nor DOM APIs', () => {
  const dir = new URL('./', import.meta.url);
  const sources = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

  for (const file of sources) {
    const code = readFileSync(new URL(file, dir), 'utf8');
    expect(code, file).not.toMatch(/['"]three['"/]/);
    expect(code, file).not.toMatch(/\b(document|window|navigator)\b/);
    // Nothing outside src/sim/ except the tables, which are plain data.
    expect(code, file).not.toMatch(/['"](\.\.\/)+(?!tables\.js['"])[^'"]*['"]/);
  }
});
