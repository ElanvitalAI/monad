// M2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — ThinkingBridge
// unit tests.
//
// Invariants under test:
//  1. begin/end emit exactly once each; deltas coalesce at the configured
//     boundary; seq is monotonic across all three phases.
//  2. blockId is stable across all phases of a turn (sessionId:thinking:turnSeq).
//  3. tokenCount estimate = cumulativeChars / charsPerToken (floor).
//  4. Pre-begin observeTextDelta is dropped; post-end calls are dropped.
//  5. begin() twice → second is no-op (same turn).
//  6. dispose() blocks subsequent end() (no terminal envelope).
//  7. asciiFallback contains a single line with the expected glyph.
//  8. emit error is swallowed — bridge stays usable.

import { describe, expect, test } from 'bun:test';
import {
  createThinkingBridge,
  makeThinkingBlockId,
  type ThinkingBridgeOpts,
} from '../src/feedback/agent-bridge.js';
import type { FeedbackEnvelope } from '../src/feedback/envelope.js';

// ── helpers ──────────────────────────────────────────────────────────

interface TestRig {
  emitted: FeedbackEnvelope[];
  bridge: ReturnType<typeof createThinkingBridge>;
  blockId: string;
}

function rig(overrides?: Partial<ThinkingBridgeOpts>): TestRig {
  const emitted: FeedbackEnvelope[] = [];
  let t = 1_700_000_000_000;
  const advanceNow = (): number => {
    t += 100;
    return t;
  };
  const sessionId = overrides?.sessionId ?? 's-1';
  const turnSeq = overrides?.turnSeq ?? 1;
  const baseOpts: ThinkingBridgeOpts = {
    emit: (env) => emitted.push(env),
    sessionId,
    turnSeq,
    deltaCoalesceCount: 1,
    now: advanceNow,
  };
  const bridge = createThinkingBridge({ ...baseOpts, ...overrides });
  return { emitted, bridge, blockId: makeThinkingBlockId(sessionId, turnSeq) };
}

// ── lifecycle phases ─────────────────────────────────────────────────

describe('createThinkingBridge · lifecycle', () => {
  test('begin emits exactly one start envelope', () => {
    const { emitted, bridge, blockId } = rig();
    bridge.begin();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.phase).toBe('start');
    expect(emitted[0]!.kind).toBe('agent.thinking');
    expect(emitted[0]!.blockId).toBe(blockId);
    expect(emitted[0]!.seq).toBe(1);
  });

  test('begin → 3 deltas (coalesce=1) → end emits 5 envelopes', () => {
    const { emitted, bridge } = rig({ deltaCoalesceCount: 1 });
    bridge.begin();
    bridge.observeTextDelta('Hel');
    bridge.observeTextDelta('lo ');
    bridge.observeTextDelta('world');
    bridge.end();
    expect(emitted.map((e) => e.phase)).toEqual([
      'start',
      'delta',
      'delta',
      'delta',
      'end',
    ]);
    expect(emitted.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  test('coalesce=4 emits a delta only after every 4 observeTextDelta', () => {
    const { emitted, bridge } = rig({ deltaCoalesceCount: 4 });
    bridge.begin();
    for (let i = 0; i < 7; i++) bridge.observeTextDelta('x');
    bridge.end();
    // start + 1 delta (after #4) + end = 3 envelopes (the 7th delta
    // doesn't trigger because 7 % 4 !== 0; end() takes its place).
    expect(emitted.map((e) => e.phase)).toEqual(['start', 'delta', 'end']);
  });

  test('coalesce=8 with exactly 8 deltas emits one delta envelope', () => {
    const { emitted, bridge } = rig({ deltaCoalesceCount: 8 });
    bridge.begin();
    for (let i = 0; i < 8; i++) bridge.observeTextDelta('x');
    bridge.end();
    expect(emitted.map((e) => e.phase)).toEqual(['start', 'delta', 'end']);
  });
});

// ── blockId / seq stability ──────────────────────────────────────────

describe('createThinkingBridge · blockId & seq', () => {
  test('blockId is constant across phases (sessionId:thinking:turnSeq)', () => {
    const { emitted, bridge } = rig({ sessionId: 's-99', turnSeq: 42 });
    bridge.begin();
    bridge.observeTextDelta('a');
    bridge.end();
    for (const env of emitted) {
      expect(env.blockId).toBe('s-99:thinking:42');
      expect(env.sessionId).toBe('s-99');
    }
  });

  test('seq is monotonic across start/delta/end', () => {
    const { emitted, bridge } = rig({ deltaCoalesceCount: 1 });
    bridge.begin();
    bridge.observeTextDelta('a');
    bridge.observeTextDelta('b');
    bridge.end();
    expect(emitted.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });
});

// ── tokenCount estimate ──────────────────────────────────────────────

describe('createThinkingBridge · tokenCount metric', () => {
  test('tokenCount = floor(cumulativeChars / charsPerToken)', () => {
    const { emitted, bridge } = rig({ deltaCoalesceCount: 1, charsPerToken: 4 });
    bridge.begin();
    bridge.observeTextDelta('1234'); // 4 chars → 1 token
    bridge.observeTextDelta('5678'); // 8 cumulative → 2 tokens
    bridge.end();
    const tokens = emitted.map((e) =>
      (e.payload as { metrics?: { tokenCount: number } }).metrics?.tokenCount ?? 0,
    );
    // start: 0 cumulative, delta1: 1, delta2: 2, end: 2
    expect(tokens).toEqual([0, 1, 2, 2]);
  });

  test('elapsedMs grows monotonically', () => {
    let t = 1_000_000;
    const emitted: FeedbackEnvelope[] = [];
    const bridge = createThinkingBridge({
      emit: (env) => emitted.push(env),
      sessionId: 's',
      turnSeq: 1,
      deltaCoalesceCount: 1,
      now: () => {
        t += 50;
        return t;
      },
    });
    bridge.begin();
    bridge.observeTextDelta('x');
    bridge.end();
    const ms = emitted.map(
      (e) => (e.payload as { metrics?: { elapsedMs: number } }).metrics?.elapsedMs ?? 0,
    );
    // start's metrics capture now() once more after startedAt is set,
    // so elapsedMs is the per-tick advance — not zero. Monotonic
    // growth across phases is what callers actually rely on.
    expect(ms[0]).toBeGreaterThanOrEqual(0);
    expect(ms[1]).toBeGreaterThan(ms[0]!);
    expect(ms[2]).toBeGreaterThan(ms[1]!);
  });
});

// ── defensive lifecycle ──────────────────────────────────────────────

describe('createThinkingBridge · defensive behavior', () => {
  test('observeTextDelta before begin is dropped', () => {
    const { emitted, bridge } = rig();
    bridge.observeTextDelta('hello');
    bridge.observeTextDelta('world');
    expect(emitted).toHaveLength(0);
  });

  test('observeTextDelta after end is dropped', () => {
    const { emitted, bridge } = rig({ deltaCoalesceCount: 1 });
    bridge.begin();
    bridge.end();
    bridge.observeTextDelta('post');
    expect(emitted.map((e) => e.phase)).toEqual(['start', 'end']);
  });

  test('second begin is a no-op', () => {
    const { emitted, bridge } = rig();
    bridge.begin();
    bridge.begin('Reasoning');
    expect(emitted).toHaveLength(1);
    expect((emitted[0]!.payload as { msg?: string }).msg).toBe('Thinking');
  });

  test('end is idempotent', () => {
    const { emitted, bridge } = rig();
    bridge.begin();
    bridge.end();
    bridge.end();
    expect(emitted.filter((e) => e.phase === 'end')).toHaveLength(1);
  });

  test('dispose blocks subsequent end (no terminal envelope)', () => {
    const { emitted, bridge } = rig();
    bridge.begin();
    bridge.dispose();
    bridge.end();
    expect(emitted.map((e) => e.phase)).toEqual(['start']);
  });

  test('begin after dispose is a no-op', () => {
    const { emitted, bridge } = rig();
    bridge.dispose();
    bridge.begin();
    expect(emitted).toHaveLength(0);
  });

  test('emit error is swallowed; subsequent emits still flow', () => {
    let calls = 0;
    const bridge = createThinkingBridge({
      emit: () => {
        calls += 1;
        if (calls === 1) throw new Error('wire down');
      },
      sessionId: 's',
      turnSeq: 1,
      deltaCoalesceCount: 1,
    });
    expect(() => bridge.begin()).not.toThrow();
    expect(() => bridge.observeTextDelta('x')).not.toThrow();
    expect(() => bridge.end()).not.toThrow();
    expect(calls).toBe(3);
  });
});

// ── ASCII fallback ──────────────────────────────────────────────────

describe('createThinkingBridge · asciiFallback', () => {
  test('start envelope has ⏳ glyph + msg', () => {
    const { emitted, bridge } = rig();
    bridge.begin('Compacting');
    expect(emitted[0]!.asciiFallback).toEqual(['⏳ Compacting…']);
  });

  test('delta envelope has · glyph and metrics tail', () => {
    const { emitted, bridge } = rig({ deltaCoalesceCount: 1, charsPerToken: 4 });
    bridge.begin();
    bridge.observeTextDelta('1234567890'); // 10 chars / 4 = 2 tokens
    const delta = emitted.find((e) => e.phase === 'delta');
    expect(delta).toBeDefined();
    expect(delta!.asciiFallback).toHaveLength(1);
    expect(delta!.asciiFallback[0]).toContain('·');
    expect(delta!.asciiFallback[0]).toContain('2 tokens');
  });

  test('end envelope has ✓ glyph', () => {
    const { emitted, bridge } = rig();
    bridge.begin();
    bridge.end();
    const end = emitted.find((e) => e.phase === 'end');
    expect(end!.asciiFallback[0]).toContain('✓');
  });

  test('long token count formats in k notation', () => {
    const { emitted, bridge } = rig({ deltaCoalesceCount: 1, charsPerToken: 1 });
    bridge.begin();
    // 4500 chars → 4500 tokens → "4.5k tokens"
    bridge.observeTextDelta('x'.repeat(4500));
    const delta = emitted.find((e) => e.phase === 'delta');
    expect(delta!.asciiFallback[0]).toContain('4.5k tokens');
  });
});

// ── makeThinkingBlockId helper ──────────────────────────────────────

describe('makeThinkingBlockId', () => {
  test('produces sessionId:thinking:turnSeq pattern', () => {
    expect(makeThinkingBlockId('s-1', 7)).toBe('s-1:thinking:7');
    expect(makeThinkingBlockId('abcdef', 0)).toBe('abcdef:thinking:0');
  });
});
