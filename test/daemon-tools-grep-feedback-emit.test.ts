// M5 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — Grep
// FeedbackEnvelope emit semantics.
//
// Verifies the wire contract that <SearchHitList> on the PWA depends on:
//  1. emitFeedback is opt-in — no envelopes when ctx omits it.
//  2. phase=start fires before any match (empty hits + accumCount=0).
//  3. phase=delta fires every SEARCH_HIT_COALESCE matches.
//  4. phase=end fires on close with the final hit list + truncated flag.
//  5. blockId is stable across all phases of one dispatch.
//  6. parentToolCallId is populated when ctx.toolCallId is provided.
//  7. seq is monotonic across the dispatch.
//  8. emitFeedback errors swallow — dispatch still resolves.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { dispatchGrep } from '../src/boot/daemon-tools/grep.js';
import type { DaemonToolDispatchCtx } from '../src/boot/daemon-tools/types.js';
import type { FeedbackEnvelope } from '../src/feedback/envelope.js';

// ── helpers ──────────────────────────────────────────────────────────

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(joinPath(tmpdir(), 'monad-grep-fb-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<DaemonToolDispatchCtx> = {}): DaemonToolDispatchCtx {
  return {
    cwd,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeCollector(): {
  envelopes: FeedbackEnvelope[];
  emit: (env: FeedbackEnvelope) => void;
} {
  const envelopes: FeedbackEnvelope[] = [];
  return { envelopes, emit: (env) => envelopes.push(env) };
}

// ── opt-in semantics ─────────────────────────────────────────────────

describe('dispatchGrep · emitFeedback opt-in', () => {
  test('emits zero envelopes when ctx.emitFeedback is absent', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'foo\nbar\nfoo bar\n');
    const result = await dispatchGrep(
      { pattern: 'foo' },
      makeCtx(),
    );
    expect(result.matches.length).toBeGreaterThan(0);
    // No collector to assert on — the absence of a crash + correct
    // grep result is itself the no-envelope path proof.
  });

  test('emits zero envelopes when ctx.emitFeedback is present but sessionId is not', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'foo\n');
    const { envelopes, emit } = makeCollector();
    await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({ emitFeedback: emit /* no sessionId */ }),
    );
    expect(envelopes).toEqual([]);
  });
});

// ── envelope lifecycle ───────────────────────────────────────────────

describe('dispatchGrep · envelope lifecycle', () => {
  test('phase=start fires with empty hits + accumCount=0', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'foo\n');
    const { envelopes, emit } = makeCollector();
    await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    expect(envelopes[0]!.phase).toBe('start');
    expect(envelopes[0]!.kind).toBe('tool.search-hit');
    const startPayload = envelopes[0]!.payload as {
      query: string;
      hits: unknown[];
      accumCount: number;
    };
    expect(startPayload.query).toBe('foo');
    expect(startPayload.hits).toEqual([]);
    expect(startPayload.accumCount).toBe(0);
  });

  test('phase=end fires on close with the final match list', async () => {
    writeFileSync(
      joinPath(cwd, 'a.txt'),
      Array.from({ length: 12 }, (_, i) => `foo ${i}`).join('\n') + '\n',
    );
    const { envelopes, emit } = makeCollector();
    const r = await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    const endEnv = envelopes.find((e) => e.phase === 'end');
    expect(endEnv).toBeDefined();
    const endPayload = endEnv!.payload as {
      query: string;
      hits: Array<{ filePath: string; line: number; snippet: string }>;
      accumCount: number;
      truncated?: boolean;
    };
    expect(endPayload.accumCount).toBe(r.matches.length);
    expect(endPayload.hits[0]!.snippet).toContain('foo');
  });

  test('end envelope carries truncated=true when max_results was hit', async () => {
    // ripgrep's `-m N` is per-file, so spread matches across multiple
    // files to push past the global cap held by dispatchGrep itself.
    for (let i = 0; i < 8; i += 1) {
      writeFileSync(
        joinPath(cwd, `f${i}.txt`),
        Array.from({ length: 3 }, (_, j) => `foo ${i}.${j}`).join('\n') + '\n',
      );
    }
    const { envelopes, emit } = makeCollector();
    const r = await dispatchGrep(
      { pattern: 'foo', max_results: 5 },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    expect(r.truncated).toBe(true);
    const endEnv = envelopes.find((e) => e.phase === 'end');
    expect((endEnv!.payload as { truncated?: boolean }).truncated).toBe(true);
  });

  test('blockId is stable across start + end', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'foo\n');
    const { envelopes, emit } = makeCollector();
    await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({ emitFeedback: emit, sessionId: 's-7' }),
    );
    const ids = new Set(envelopes.map((e) => e.blockId));
    expect(ids.size).toBe(1);
    expect(envelopes[0]!.blockId.startsWith('s-7:grep:')).toBe(true);
  });

  test('parentToolCallId populated from ctx.toolCallId', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'foo\n');
    const { envelopes, emit } = makeCollector();
    await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({ emitFeedback: emit, sessionId: 's-1', toolCallId: 'tc-42' }),
    );
    for (const env of envelopes) {
      expect(env.parentToolCallId).toBe('tc-42');
    }
    // blockId includes the toolCallId for correlation.
    expect(envelopes[0]!.blockId).toBe('s-1:grep:tc-42');
  });

  test('seq is monotonic across all emitted envelopes', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'foo\n');
    const { envelopes, emit } = makeCollector();
    await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    const seqs = envelopes.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }
  });
});

// ── coalesced delta emit ─────────────────────────────────────────────

describe('dispatchGrep · coalesced delta emits', () => {
  test('delta envelope fires after 5 matches accumulate', async () => {
    writeFileSync(
      joinPath(cwd, 'a.txt'),
      Array.from({ length: 7 }, (_, i) => `foo ${i}`).join('\n') + '\n',
    );
    const { envelopes, emit } = makeCollector();
    await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    const phases = envelopes.map((e) => e.phase);
    // Expected: start (0 matches) · delta (5 matches) · end (7 matches).
    expect(phases.filter((p) => p === 'start')).toHaveLength(1);
    expect(phases.filter((p) => p === 'delta').length).toBeGreaterThanOrEqual(1);
    expect(phases.filter((p) => p === 'end')).toHaveLength(1);
    // delta envelope's accumCount must equal 5 (the coalesce boundary).
    const firstDelta = envelopes.find((e) => e.phase === 'delta');
    expect((firstDelta!.payload as { accumCount: number }).accumCount).toBe(5);
  });

  test('few matches (< coalesce) produce no delta — only start + end', async () => {
    writeFileSync(
      joinPath(cwd, 'a.txt'),
      ['foo 1', 'foo 2', 'foo 3'].join('\n') + '\n',
    );
    const { envelopes, emit } = makeCollector();
    await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    expect(envelopes.map((e) => e.phase)).toEqual(['start', 'end']);
  });
});

// ── defensive: emitter throws ────────────────────────────────────────

describe('dispatchGrep · emitter resilience', () => {
  test('emitFeedback throwing does not crash dispatch', async () => {
    writeFileSync(joinPath(cwd, 'a.txt'), 'foo\n');
    let calls = 0;
    const result = await dispatchGrep(
      { pattern: 'foo' },
      makeCtx({
        emitFeedback: () => {
          calls += 1;
          throw new Error('wire down');
        },
        sessionId: 's-1',
      }),
    );
    expect(result.matches.length).toBeGreaterThan(0);
    // Emit was attempted (start + end at minimum).
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
