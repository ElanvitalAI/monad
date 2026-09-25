// Tracks the per-session prompt activity that production wires
// into the intent ranker's IntentContext. See src/intent-prediction/
// turn-tracker.ts for the why.

import { describe, expect, test } from 'bun:test';

import { createTurnTracker } from '../src/intent-prediction/turn-tracker.js';

describe('createTurnTracker — read / lifecycle', () => {
  test('read before any prompt returns null', () => {
    const t = createTurnTracker();
    expect(t.read('s1')).toBeNull();
    expect(t.size()).toBe(0);
  });

  test('recordPrompt → read returns summary + idleMs=0 + first-turn defaults', () => {
    let clock = 1_000_000;
    const t = createTurnTracker({ now: () => clock });
    t.recordPrompt('s1', 'hello');
    expect(t.read('s1')).toEqual({
      lastTurnSummary: 'hello',
      idleMs: 0,
      lastErr: '',
      fileEditCount: 0,
      progressPct: 0.1,
    });
  });

  test('idleMs grows as time advances', () => {
    let clock = 1_000_000;
    const t = createTurnTracker({ now: () => clock });
    t.recordPrompt('s1', 'hello');
    clock += 5_000;
    expect(t.read('s1')?.idleMs).toBe(5_000);
    clock += 60_000;
    expect(t.read('s1')?.idleMs).toBe(65_000);
  });

  test('idleMs clamps at 0 when clock goes backwards (test seam edge)', () => {
    let clock = 1_000_000;
    const t = createTurnTracker({ now: () => clock });
    t.recordPrompt('s1', 'hi');
    clock -= 1_000;
    expect(t.read('s1')?.idleMs).toBe(0);
  });

  test('recordPrompt overwrites prior summary + resets idleMs', () => {
    let clock = 1_000_000;
    const t = createTurnTracker({ now: () => clock });
    t.recordPrompt('s1', 'first');
    clock += 10_000;
    t.recordPrompt('s1', 'second');
    expect(t.read('s1')?.lastTurnSummary).toBe('second');
    expect(t.read('s1')?.idleMs).toBe(0);
    clock += 2_000;
    expect(t.read('s1')?.idleMs).toBe(2_000);
  });

  test('long prompts truncate to 240 chars', () => {
    const t = createTurnTracker();
    const long = 'x'.repeat(500);
    t.recordPrompt('s1', long);
    const r = t.read('s1');
    expect(r?.lastTurnSummary.length).toBe(240);
    expect(r?.lastTurnSummary).toBe('x'.repeat(240));
  });

  test('multi-session entries are isolated', () => {
    let clock = 1_000_000;
    const t = createTurnTracker({ now: () => clock });
    t.recordPrompt('s1', 'a');
    clock += 5_000;
    t.recordPrompt('s2', 'b');
    expect(t.read('s1')?.idleMs).toBe(5_000);
    expect(t.read('s2')?.idleMs).toBe(0);
    expect(t.size()).toBe(2);
  });

  test('forget drops the entry · subsequent read returns null', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'a');
    t.recordPrompt('s2', 'b');
    expect(t.size()).toBe(2);
    t.forget('s1');
    expect(t.read('s1')).toBeNull();
    expect(t.read('s2')?.lastTurnSummary).toBe('b');
    expect(t.size()).toBe(1);
  });

  test('forget unknown id is a no-op', () => {
    const t = createTurnTracker();
    expect(() => t.forget('never-seen')).not.toThrow();
    expect(t.size()).toBe(0);
  });
});

describe('createTurnTracker — lastErr signal', () => {
  test('lastErr defaults to empty string after first prompt', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hello');
    expect(t.read('s1')?.lastErr).toBe('');
  });

  test('recordError sets lastErr · read reflects it', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hi');
    t.recordError('s1', 'connection refused');
    expect(t.read('s1')?.lastErr).toBe('connection refused');
  });

  test('recordError truncates to 240 chars', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hi');
    t.recordError('s1', 'x'.repeat(500));
    expect(t.read('s1')?.lastErr.length).toBe(240);
  });

  test('next recordPrompt clears the error gate', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'first');
    t.recordError('s1', 'boom');
    expect(t.read('s1')?.lastErr).toBe('boom');
    t.recordPrompt('s1', 'second');
    expect(t.read('s1')?.lastErr).toBe('');
  });

  test('recordError on unknown session is a no-op', () => {
    const t = createTurnTracker();
    expect(() => t.recordError('never', 'oops')).not.toThrow();
    expect(t.read('never')).toBeNull();
  });
});

describe('createTurnTracker — fileEditCount signal', () => {
  test('fileEditCount starts at 0', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hi');
    expect(t.read('s1')?.fileEditCount).toBe(0);
  });

  test('recordToolUse(Edit) increments', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hi');
    t.recordToolUse('s1', 'Edit');
    expect(t.read('s1')?.fileEditCount).toBe(1);
    t.recordToolUse('s1', 'Edit');
    expect(t.read('s1')?.fileEditCount).toBe(2);
  });

  test('recordToolUse covers Write / MultiEdit / case-insensitive', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hi');
    t.recordToolUse('s1', 'Write');
    t.recordToolUse('s1', 'MultiEdit');
    t.recordToolUse('s1', 'edit');
    t.recordToolUse('s1', 'WRITE');
    expect(t.read('s1')?.fileEditCount).toBe(4);
  });

  test('non-edit tools do NOT increment (Read/Grep/Glob/Bash)', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hi');
    t.recordToolUse('s1', 'Read');
    t.recordToolUse('s1', 'Grep');
    t.recordToolUse('s1', 'Glob');
    t.recordToolUse('s1', 'Bash');
    expect(t.read('s1')?.fileEditCount).toBe(0);
  });

  test('count persists across recordPrompt (running total per session)', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'first');
    t.recordToolUse('s1', 'Edit');
    t.recordToolUse('s1', 'Write');
    t.recordPrompt('s1', 'second');
    expect(t.read('s1')?.fileEditCount).toBe(2);
  });

  test('forget resets the count', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hi');
    t.recordToolUse('s1', 'Edit');
    t.forget('s1');
    t.recordPrompt('s1', 'restart');
    expect(t.read('s1')?.fileEditCount).toBe(0);
  });

  test('recordToolUse on unknown session is a no-op', () => {
    const t = createTurnTracker();
    expect(() => t.recordToolUse('never', 'Edit')).not.toThrow();
  });
});

describe('createTurnTracker — progressPct derivation', () => {
  test('first turn = 0.1', () => {
    const t = createTurnTracker();
    t.recordPrompt('s1', 'hi');
    expect(t.read('s1')?.progressPct).toBeCloseTo(0.1, 5);
  });

  test('5 turns = 0.5', () => {
    const t = createTurnTracker();
    for (let i = 0; i < 5; i += 1) t.recordPrompt('s1', `${i}`);
    expect(t.read('s1')?.progressPct).toBeCloseTo(0.5, 5);
  });

  test('10 turns = 1.0 (capped)', () => {
    const t = createTurnTracker();
    for (let i = 0; i < 10; i += 1) t.recordPrompt('s1', `${i}`);
    expect(t.read('s1')?.progressPct).toBe(1);
  });

  test('15 turns stays clamped at 1.0', () => {
    const t = createTurnTracker();
    for (let i = 0; i < 15; i += 1) t.recordPrompt('s1', `${i}`);
    expect(t.read('s1')?.progressPct).toBe(1);
  });

  test('forget resets progress', () => {
    const t = createTurnTracker();
    for (let i = 0; i < 3; i += 1) t.recordPrompt('s1', `${i}`);
    expect(t.read('s1')?.progressPct).toBeCloseTo(0.3, 5);
    t.forget('s1');
    t.recordPrompt('s1', 'restart');
    expect(t.read('s1')?.progressPct).toBeCloseTo(0.1, 5);
  });
});
