import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

// The Sim must stay headless so it runs in Node and can be swapped out (spec #1).
test('Sim modules use neither Three.js nor DOM APIs', () => {
  const simDir = new URL('./', import.meta.url);
  const tables = new URL('../tables.js', simDir).href;
  const sources = readdirSync(simDir, { recursive: true }).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

  for (const file of sources) {
    const fileUrl = new URL(file, simDir);
    const code = readFileSync(fileUrl, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    // Only relative imports that stay in src/sim/, plus the tables (plain data).
    // shortcut: plain regexes, so a `//` inside a string or a DOM word inside a string can
    // fool them; switch to a real parser if that ever bites.
    for (const [, , spec] of code.matchAll(/\b(?:from|import)\s*\(?\s*(['"`])([^'"`]+)\1/g)) {
      const target = spec.startsWith('.') ? new URL(spec, fileUrl).href : spec;
      expect(target === tables || target.startsWith(simDir.href), `${file} imports ${spec}`).toBe(true);
    }
    expect(code, file).not.toMatch(/\b(document|window|navigator)\b/);
  }
});
