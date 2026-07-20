import { describe, expect, it } from 'vitest';
import { elapsedSeconds, formatElapsed } from './RunningTimer.js';

describe('formatElapsed', () => {
  it('formats sub-minute elapsed time in seconds', () => {
    expect(formatElapsed(0)).toBe('0 秒');
    expect(formatElapsed(19.9)).toBe('19 秒');
  });

  it('formats minute elapsed time without an ambiguous unit jump', () => {
    expect(formatElapsed(60)).toBe('1:00');
    expect(formatElapsed(125)).toBe('2:05');
  });

  it('clamps invalid negative elapsed time to zero', () => {
    expect(formatElapsed(-3)).toBe('0 秒');
  });
});

describe('elapsedSeconds', () => {
  it('keeps one run anchored to its shared start time across component remounts', () => {
    expect(elapsedSeconds(10_000, 16_800)).toBe(6);
    expect(elapsedSeconds(10_000, 25_100)).toBe(15);
  });
});
