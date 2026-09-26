// M1 PR 1 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
// Feedback Envelope substrate tests.
//
// Core invariants under test:
//  1. envelopeVersion fix at 1 · parse rejects v2/missing.
//  2. SeqTracker monotonic per-blockId, isolated across blockIds.
//  3. GapDetector distinguishes ok / duplicate / gap (drop count).
//  4. makeEnvelope auto-fills asciiFallback=[] · seq · emittedAt.
//  5. serialize→parse round-trip preserves all fields incl payload narrowing.
//  6. isFeedbackEnvelope rejects wire-level invalid (missing fields · bad kind/phase).
//  7. blockId helpers (message-block.ts) interoperate as merge keys.
//  8. forget()/clear() resets seq state for re-use.

import { describe, expect, test } from 'bun:test';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  createGapDetector,
  createSeqTracker,
  FEEDBACK_KINDS,
  isFeedbackEnvelope,
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
  type FeedbackEnvelope,
  type FeedbackKind,
  type ToolDiffPayload,
  type ToolProgressPayload,
  type ToolSearchHitPayload,
  type AgentStatusPayload,
  type AgentThinkingPayload,
  type AgentPlanPayload,
  type DebugLinePayload,
  type HudSegmentPayload,
} from '../src/feedback/envelope.js';
import {
  makeToolCallBlockId,
  makePlanBlockId,
} from '../src/conv-substrate/message-block.js';

// ── helpers ──────────────────────────────────────────────────────────

interface FeedbackEnvelopeVectors {
  kinds: string[];
}

const feedbackEnvelopeVectorsPath = join(import.meta.dir, '..', 'elanous-feedback-envelope-vectors.json');
const canonicalFeedbackEnvelopeVectorsPath = realpathSync(feedbackEnvelopeVectorsPath);
const feedbackEnvelopeVectors = JSON.parse(
  readFileSync(feedbackEnvelopeVectorsPath, 'utf8'),
) as FeedbackEnvelopeVectors;

const fixedClock = (t = 1_700_000_000_000): (() => number) => () => t;

const sampleProgress: ToolProgressPayload = {
  stream: 'stdout',
  lines: ['hello', 'world'],
  bytesSoFar: 11,
};

const sampleDiff: ToolDiffPayload = {
  filePath: 'src/x.ts',
  language: 'typescript',
  hunks: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [
        { kind: 'del', text: 'foo' },
        { kind: 'add', text: 'bar' },
      ],
    },
  ],
};

const sampleSearch: ToolSearchHitPayload = {
  query: 'foo',
  hits: [{ filePath: 'a.ts', line: 5, snippet: 'foo()' }],
  accumCount: 1,
};

// ── SeqTracker ───────────────────────────────────────────────────────

describe('createSeqTracker · per-blockId monotonic', () => {
  test('monotonic 1, 2, 3 for one blockId', () => {
    const t = createSeqTracker();
    expect(t.next('b1')).toBe(1);
    expect(t.next('b1')).toBe(2);
    expect(t.next('b1')).toBe(3);
    expect(t.peek('b1')).toBe(3);
  });

  test('peek returns 0 before any next() call', () => {
    const t = createSeqTracker();
    expect(t.peek('b1')).toBe(0);
  });

  test('different blockIds have independent counters', () => {
    const t = createSeqTracker();
    t.next('a');
    t.next('a');
    expect(t.next('b')).toBe(1);
    expect(t.peek('a')).toBe(2);
    expect(t.peek('b')).toBe(1);
  });

  test('forget() drops one blockId state · re-issue restarts at 1', () => {
    const t = createSeqTracker();
    t.next('a');
    t.next('a');
    t.forget('a');
    expect(t.peek('a')).toBe(0);
    expect(t.next('a')).toBe(1);
  });

  test('clear() drops all blockId state', () => {
    const t = createSeqTracker();
    t.next('a');
    t.next('b');
    t.clear();
    expect(t.peek('a')).toBe(0);
    expect(t.peek('b')).toBe(0);
  });
});

// ── GapDetector ──────────────────────────────────────────────────────

describe('createGapDetector · ok / duplicate / gap', () => {
  test('first envelope (seq=1) is ok', () => {
    const d = createGapDetector();
    expect(d.observe('b1', 1)).toEqual({ status: 'ok', prev: 0, current: 1 });
  });

  test('contiguous sequence is ok', () => {
    const d = createGapDetector();
    d.observe('b1', 1);
    expect(d.observe('b1', 2)).toEqual({ status: 'ok', prev: 1, current: 2 });
    expect(d.observe('b1', 3)).toEqual({ status: 'ok', prev: 2, current: 3 });
  });

  test('lower or equal seq is duplicate · prev not advanced', () => {
    const d = createGapDetector();
    d.observe('b1', 1);
    d.observe('b1', 2);
    expect(d.observe('b1', 2)).toEqual({ status: 'duplicate', prev: 2, current: 2 });
    expect(d.observe('b1', 1)).toEqual({ status: 'duplicate', prev: 2, current: 1 });
  });

  test('gap reports missing count · prev advances to current', () => {
    const d = createGapDetector();
    d.observe('b1', 1);
    const result = d.observe('b1', 5);
    expect(result).toEqual({ status: 'gap', prev: 1, current: 5, missing: 3 });
    // 다음 contiguous 는 ok
    expect(d.observe('b1', 6)).toEqual({ status: 'ok', prev: 5, current: 6 });
  });

  test('first observed seq > 1 is also gap (envelope drop at session start)', () => {
    const d = createGapDetector();
    expect(d.observe('b1', 3)).toEqual({ status: 'gap', prev: 0, current: 3, missing: 2 });
  });

  test('per-blockId isolation', () => {
    const d = createGapDetector();
    d.observe('a', 1);
    d.observe('a', 2);
    expect(d.observe('b', 1)).toEqual({ status: 'ok', prev: 0, current: 1 });
  });

  test('forget + clear resets', () => {
    const d = createGapDetector();
    d.observe('a', 1);
    d.forget('a');
    expect(d.observe('a', 1)).toEqual({ status: 'ok', prev: 0, current: 1 });
    d.clear();
    expect(d.observe('a', 1)).toEqual({ status: 'ok', prev: 0, current: 1 });
  });
});

// ── makeEnvelope factory ─────────────────────────────────────────────

describe('makeEnvelope · auto fields + seq integration', () => {
  test('auto-fills emittedAt · seq · asciiFallback default []', () => {
    const tracker = createSeqTracker();
    const env = makeEnvelope(
      {
        kind: 'agent.status',
        sessionId: 's1',
        blockId: 'sys:agent:1',
        phase: 'start',
        payload: { agentId: 'a1', status: 'running' } satisfies AgentStatusPayload,
        now: fixedClock(),
      },
      tracker,
    );
    expect(env.envelopeVersion).toBe(1);
    expect(env.seq).toBe(1);
    expect(env.emittedAt).toBe(1_700_000_000_000);
    expect(env.asciiFallback).toEqual([]);
    expect(env.parentToolCallId).toBeUndefined();
  });

  test('seq increments per blockId across calls', () => {
    const tracker = createSeqTracker();
    const blockId = makeToolCallBlockId('s1', 'tc-1');
    const first = makeEnvelope(
      {
        kind: 'tool.progress',
        sessionId: 's1',
        blockId,
        parentToolCallId: 'tc-1',
        phase: 'start',
        payload: sampleProgress,
      },
      tracker,
    );
    const second = makeEnvelope(
      {
        kind: 'tool.progress',
        sessionId: 's1',
        blockId,
        parentToolCallId: 'tc-1',
        phase: 'delta',
        payload: sampleProgress,
      },
      tracker,
    );
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
  });

  test('asciiFallback explicit override is preserved', () => {
    const tracker = createSeqTracker();
    const env = makeEnvelope(
      {
        kind: 'debug.line',
        sessionId: 's1',
        blockId: 'sys:dbg:1',
        phase: 'delta',
        payload: {
          category: 'chat.picker',
          event: 'dispatch',
          loggedAt: 100,
        } satisfies DebugLinePayload,
        asciiFallback: ['[chat.picker] dispatch'],
      },
      tracker,
    );
    expect(env.asciiFallback).toEqual(['[chat.picker] dispatch']);
  });
});

// ── Serialize / parse round-trip ─────────────────────────────────────

describe('serializeEnvelope / parseEnvelope · round-trip', () => {
  test('all kinds round-trip · seq · emittedAt · asciiFallback preserved', () => {
    const tracker = createSeqTracker();
    const cases: FeedbackEnvelope[] = [
      makeEnvelope(
        {
          kind: 'tool.progress',
          sessionId: 's1',
          blockId: 'b-prog',
          phase: 'delta',
          payload: sampleProgress,
          parentToolCallId: 'tc-1',
          asciiFallback: ['$ ls', 'a.ts'],
        },
        tracker,
      ),
      makeEnvelope(
        {
          kind: 'tool.diff',
          sessionId: 's1',
          blockId: 'b-diff',
          phase: 'end',
          payload: sampleDiff,
        },
        tracker,
      ),
      makeEnvelope(
        {
          kind: 'tool.search-hit',
          sessionId: 's1',
          blockId: 'b-search',
          phase: 'delta',
          payload: sampleSearch,
        },
        tracker,
      ),
      makeEnvelope(
        {
          kind: 'agent.thinking',
          sessionId: 's1',
          blockId: 'b-think',
          phase: 'update',
          payload: { msg: 'reading', metrics: { elapsedMs: 120 } } satisfies AgentThinkingPayload,
        },
        tracker,
      ),
      makeEnvelope(
        {
          kind: 'agent.plan',
          sessionId: 's1',
          blockId: makePlanBlockId('s1', 'plan-7'),
          phase: 'update',
          payload: {
            ref: 'plan-7',
            steps: [
              { text: 'one', status: 'done' },
              { text: 'two', status: 'in-progress' },
            ],
            activeIndex: 1,
          } satisfies AgentPlanPayload,
        },
        tracker,
      ),
      makeEnvelope(
        {
          kind: 'hud.segment',
          sessionId: 's1',
          blockId: 's1:hud:reasoning',
          phase: 'update',
          payload: {
            key: 'reasoning',
            value: 'diag',
            priority: 4,
            tone: 'info',
            glyph: '◑',
          } satisfies HudSegmentPayload,
        },
        tracker,
      ),
    ];
    for (const env of cases) {
      const wire = serializeEnvelope(env);
      const parsed = parseEnvelope(wire);
      expect(parsed).toEqual(env);
      // narrowing 후 payload 필드 접근이 type-safe — runtime 검증
      expect(parsed.kind).toBe(env.kind);
      expect(parsed.seq).toBe(env.seq);
      expect(parsed.emittedAt).toBe(env.emittedAt);
    }
  });

  test('parse rejects invalid JSON', () => {
    expect(() => parseEnvelope('not json')).toThrow(/invalid JSON/);
  });

  test('parse rejects wrong envelopeVersion', () => {
    const malformed = JSON.stringify({
      envelopeVersion: 2,
      sessionId: 's1',
      blockId: 'b',
      kind: 'agent.status',
      phase: 'start',
      emittedAt: 1,
      seq: 1,
      payload: {},
      asciiFallback: [],
    });
    expect(() => parseEnvelope(malformed)).toThrow(/schema mismatch/);
  });

  test('parse rejects unknown kind', () => {
    const malformed = JSON.stringify({
      envelopeVersion: 1,
      sessionId: 's1',
      blockId: 'b',
      kind: 'mystery.kind',
      phase: 'start',
      emittedAt: 1,
      seq: 1,
      payload: {},
      asciiFallback: [],
    });
    expect(() => parseEnvelope(malformed)).toThrow(/schema mismatch/);
  });

  test('parse rejects missing required field', () => {
    const malformed = JSON.stringify({
      envelopeVersion: 1,
      sessionId: 's1',
      blockId: 'b',
      kind: 'agent.status',
      // phase missing
      emittedAt: 1,
      seq: 1,
      payload: {},
      asciiFallback: [],
    });
    expect(() => parseEnvelope(malformed)).toThrow(/schema mismatch/);
  });

  test('parse rejects bad seq (negative)', () => {
    const malformed = JSON.stringify({
      envelopeVersion: 1,
      sessionId: 's1',
      blockId: 'b',
      kind: 'agent.status',
      phase: 'start',
      emittedAt: 1,
      seq: -1,
      payload: { agentId: 'a', status: 'running' },
      asciiFallback: [],
    });
    expect(() => parseEnvelope(malformed)).toThrow(/schema mismatch/);
  });
});

// ── isFeedbackEnvelope guard ─────────────────────────────────────────

describe('isFeedbackEnvelope · run-time validation', () => {
  test('accepts well-formed object', () => {
    const tracker = createSeqTracker();
    const env = makeEnvelope(
      {
        kind: 'agent.status',
        sessionId: 's1',
        blockId: 'b1',
        phase: 'start',
        payload: { agentId: 'a', status: 'running' } satisfies AgentStatusPayload,
      },
      tracker,
    );
    expect(isFeedbackEnvelope(env)).toBe(true);
  });

  test('rejects null / undefined / primitives', () => {
    expect(isFeedbackEnvelope(null)).toBe(false);
    expect(isFeedbackEnvelope(undefined)).toBe(false);
    expect(isFeedbackEnvelope(0)).toBe(false);
    expect(isFeedbackEnvelope('x')).toBe(false);
    expect(isFeedbackEnvelope([])).toBe(false);
  });

  test('rejects bad phase', () => {
    expect(
      isFeedbackEnvelope({
        envelopeVersion: 1,
        sessionId: 's',
        blockId: 'b',
        kind: 'agent.status',
        phase: 'midway',
        emittedAt: 1,
        seq: 1,
        payload: {},
        asciiFallback: [],
      }),
    ).toBe(false);
  });

  test('rejects missing asciiFallback array', () => {
    expect(
      isFeedbackEnvelope({
        envelopeVersion: 1,
        sessionId: 's',
        blockId: 'b',
        kind: 'agent.status',
        phase: 'start',
        emittedAt: 1,
        seq: 1,
        payload: {},
      }),
    ).toBe(false);
  });

  test('rejects empty sessionId / blockId', () => {
    expect(
      isFeedbackEnvelope({
        envelopeVersion: 1,
        sessionId: '',
        blockId: 'b',
        kind: 'agent.status',
        phase: 'start',
        emittedAt: 1,
        seq: 1,
        payload: {},
        asciiFallback: [],
      }),
    ).toBe(false);
  });
});

// ── Cross-substrate merge key compat ─────────────────────────────────

describe('blockId helpers interop with message-block.ts', () => {
  test('makeToolCallBlockId produces same id used as envelope blockId', () => {
    const tracker = createSeqTracker();
    const blockId = makeToolCallBlockId('s-7', 'tc-99');
    const env = makeEnvelope(
      {
        kind: 'tool.progress',
        sessionId: 's-7',
        blockId,
        parentToolCallId: 'tc-99',
        phase: 'start',
        payload: sampleProgress,
      },
      tracker,
    );
    expect(env.blockId).toBe('s-7:tool:tc-99');
  });

  test('makePlanBlockId same flow', () => {
    const tracker = createSeqTracker();
    const blockId = makePlanBlockId('s-7', 'plan-A');
    const env = makeEnvelope(
      {
        kind: 'agent.plan',
        sessionId: 's-7',
        blockId,
        phase: 'start',
        payload: { ref: 'plan-A', steps: [] } satisfies AgentPlanPayload,
      },
      tracker,
    );
    expect(env.blockId).toBe('s-7:plan:plan-A');
  });
});

// ── FEEDBACK_KINDS coverage gate ─────────────────────────────────────

describe('FEEDBACK_KINDS · exhaustive union coverage', () => {
  test('exports every kind exactly once and matches the shared vocabulary bidirectionally', () => {
    type MissingFeedbackKind = Exclude<FeedbackKind, (typeof FEEDBACK_KINDS)[number]>;
    const exhaustive: MissingFeedbackKind extends never ? true : false = true;
    const sharedKinds = new Set(feedbackEnvelopeVectors.kinds);
    const daemonKinds = new Set<string>(FEEDBACK_KINDS);

    expect(realpathSync(feedbackEnvelopeVectorsPath)).toBe(canonicalFeedbackEnvelopeVectorsPath);
    expect(exhaustive).toBe(true);
    expect(FEEDBACK_KINDS.length).toBeGreaterThan(0);
    expect(new Set(FEEDBACK_KINDS).size).toBe(FEEDBACK_KINDS.length);
    expect([...sharedKinds].filter((kind) => !daemonKinds.has(kind))).toEqual([]);
    expect([...daemonKinds].filter((kind) => !sharedKinds.has(kind))).toEqual([]);
  });

  test('hud.segment envelope passes isFeedbackEnvelope validation', () => {
    const tracker = createSeqTracker();
    const env = makeEnvelope(
      {
        kind: 'hud.segment',
        sessionId: 's1',
        blockId: 's1:hud:ssh-remote',
        phase: 'update',
        payload: {
          key: 'ssh-remote',
          value: 'server-1',
          priority: 2,
        } satisfies HudSegmentPayload,
      },
      tracker,
    );
    expect(isFeedbackEnvelope(env)).toBe(true);
    expect(env.kind).toBe('hud.segment');
  });
});
