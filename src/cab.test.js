import { describe, it, expect } from 'vitest';
import { dialAngle } from './cab.js';

describe('Cab: dial needles', () => {
  const sweep = (240 * Math.PI) / 180;

  it('sweeps clockwise from lower left through the top, pinned at both ends', () => {
    expect(dialAngle(0, 120, sweep)).toBeCloseTo(sweep / 2);
    expect(dialAngle(60, 120, sweep)).toBeCloseTo(0); // half scale points straight up
    expect(dialAngle(120, 120, sweep)).toBeCloseTo(-sweep / 2);
    expect(dialAngle(-5, 120, sweep)).toBeCloseTo(sweep / 2);
    expect(dialAngle(500, 120, sweep)).toBeCloseTo(-sweep / 2);
  });
});
