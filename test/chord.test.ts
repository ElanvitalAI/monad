// ── Prefix chord state tests (Phase O6) ──

import { describe, test, expect } from 'bun:test';
import { createChord, armChord, disarmChord, isChordArmed } from '../src/chord.js';

describe('chord state', () => {
  test('starts disarmed', () => {
    const s = createChord();
    expect(isChordArmed(s)).toBe(false);
    expect(s.timer).toBeNull();
  });

  test('armChord flips the flag and schedules a timeout', async () => {
    const s = createChord();
    let expired = false;
    armChord(s, () => { expired = true; }, 30);
    expect(isChordArmed(s)).toBe(true);
    expect(s.timer).not.toBeNull();
    await new Promise(r => setTimeout(r, 60));
    expect(isChordArmed(s)).toBe(false);
    expect(expired).toBe(true);
  });

  test('disarmChord cancels the pending timeout', async () => {
    const s = createChord();
    let expired = false;
    armChord(s, () => { expired = true; }, 30);
    disarmChord(s);
    await new Promise(r => setTimeout(r, 60));
    expect(isChordArmed(s)).toBe(false);
    expect(expired).toBe(false);
  });

  test('re-arming clears the prior timer instead of firing twice', async () => {
    const s = createChord();
    let count = 0;
    armChord(s, () => { count += 1; }, 30);
    armChord(s, () => { count += 1; }, 30);
    await new Promise(r => setTimeout(r, 60));
    expect(count).toBe(1);
  });

  test('armedAt records the wall-clock at arm time', () => {
    const s = createChord();
    const before = Date.now();
    armChord(s, () => {}, 30);
    expect(s.armedAt).toBeGreaterThanOrEqual(before);
    expect(s.armedAt).toBeLessThanOrEqual(Date.now());
    disarmChord(s);
  });

  test('disarm is safe when not armed', () => {
    const s = createChord();
    expect(() => disarmChord(s)).not.toThrow();
    expect(isChordArmed(s)).toBe(false);
  });
});
