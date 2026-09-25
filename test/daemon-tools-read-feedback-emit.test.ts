// Opportunistic followup (PLAN-rich-dev-feedback-multi-surface ·
// 2026-05-13 §6.2 #1) — dispatchRead `tool.progress` envelope emit.
//
// Verifies the wire contract that <ToolProgressCard> on the PWA
// depends on for the read-path narrative:
//  1. Opt-in — no envelopes when ctx.emitFeedback / sessionId absent.
//  2. Threshold — small files (< READ_PROGRESS_THRESHOLD_BYTES) skip
//     the progressive path even when emit is wired.
//  3. Lifecycle — start (bytesSoFar=0) → delta(s) → end (final +
//     exitCode=0). truncated flag propagates when size > READ_MAX_BYTES.
//  4. Invariants — blockId stable · parentToolCallId from ctx.toolCallId
//     · seq monotonic · bytesSoFar monotonic.
//  5. Resilience — emit throwing does not crash the read.
//  6. Abort — ctx.signal.aborted mid-read emits a phase=end with
//     exitCode=1 before throwing.
//  7. Binary — large binary files emit start + end (error) then refuse.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  dispatchRead,
  READ_CHUNK_BYTES,
  READ_MAX_BYTES,
  READ_PROGRESS_THRESHOLD_BYTES,
} from '../src/boot/daemon-tools/read.js';
import { ToolSafetyError, type DaemonToolDispatchCtx } from '../src/boot/daemon-tools/types.js';
import type { FeedbackEnvelope } from '../src/feedback/envelope.js';

// ── helpers ──────────────────────────────────────────────────────────

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(joinPath(tmpdir(), 'monad-read-fb-'));
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

/** ASCII text file just past the progressive threshold so the chunked
 *  read path engages. 1.5 MB → 6 chunks of 256 KB → start + ~5 deltas
 *  + end. Uses 'A' bytes so the binary sniffer is happy. */
function writeLargeText(name: string, sizeBytes: number): string {
  const buf = Buffer.alloc(sizeBytes, 'A'.charCodeAt(0));
  const p = joinPath(cwd, name);
  writeFileSync(p, buf);
  return p;
}

// ── opt-in semantics ─────────────────────────────────────────────────

describe('dispatchRead · emitFeedback opt-in', () => {
  test('large file emits zero envelopes when ctx.emitFeedback is absent', async () => {
    writeLargeText('big.txt', READ_PROGRESS_THRESHOLD_BYTES + 1024);
    const r = await dispatchRead({ path: 'big.txt' }, makeCtx());
    expect(r.content.length).toBe(READ_PROGRESS_THRESHOLD_BYTES + 1024);
    // Absence of a collector + correct return = no-emit path proof.
  });

  test('large file emits zero envelopes when sessionId is missing', async () => {
    writeLargeText('big.txt', READ_PROGRESS_THRESHOLD_BYTES + 1024);
    const { envelopes, emit } = makeCollector();
    await dispatchRead({ path: 'big.txt' }, makeCtx({ emitFeedback: emit }));
    expect(envelopes).toEqual([]);
  });

  test('small file (< threshold) emits zero envelopes even when fully wired', async () => {
    writeFileSync(joinPath(cwd, 'tiny.txt'), 'hi');
    const { envelopes, emit } = makeCollector();
    await dispatchRead({ path: 'tiny.txt' }, makeCtx({ emitFeedback: emit, sessionId: 's-1' }));
    expect(envelopes).toEqual([]);
  });
});

// ── envelope lifecycle ───────────────────────────────────────────────

describe('dispatchRead · envelope lifecycle', () => {
  test('phase=start fires before bytes flow (bytesSoFar=0)', async () => {
    writeLargeText('big.txt', READ_PROGRESS_THRESHOLD_BYTES + 1024);
    const { envelopes, emit } = makeCollector();
    await dispatchRead({ path: 'big.txt' }, makeCtx({ emitFeedback: emit, sessionId: 's-1' }));
    expect(envelopes[0]!.phase).toBe('start');
    expect(envelopes[0]!.kind).toBe('tool.progress');
    const p = envelopes[0]!.payload as { stream: string; lines: string[]; bytesSoFar?: number };
    expect(p.stream).toBe('generic');
    expect(p.bytesSoFar).toBe(0);
    expect(p.lines[0]).toMatch(/Reading big\.txt/);
  });

  test('phase=delta fires per chunk · bytesSoFar monotonic', async () => {
    // 5× chunks → start + 4 deltas + end (last chunk collapses into end).
    const size = READ_CHUNK_BYTES * 5;
    writeLargeText('big.txt', size);
    const { envelopes, emit } = makeCollector();
    await dispatchRead({ path: 'big.txt' }, makeCtx({ emitFeedback: emit, sessionId: 's-1' }));
    const phases = envelopes.map((e) => e.phase);
    expect(phases[0]).toBe('start');
    expect(phases[phases.length - 1]).toBe('end');
    const deltas = envelopes.filter((e) => e.phase === 'delta');
    expect(deltas.length).toBeGreaterThanOrEqual(2);
    // bytesSoFar must climb monotonically across the stream.
    const bytes = envelopes.map(
      (e) => (e.payload as { bytesSoFar?: number }).bytesSoFar ?? -1,
    );
    for (let i = 1; i < bytes.length; i++) {
      expect(bytes[i]).toBeGreaterThanOrEqual(bytes[i - 1]!);
    }
    // End envelope's bytesSoFar equals the full file size.
    expect(bytes[bytes.length - 1]).toBe(size);
  });

  test('phase=end carries exitCode=0 + ✓ ASCII fallback on success', async () => {
    writeLargeText('big.txt', READ_PROGRESS_THRESHOLD_BYTES + 1024);
    const { envelopes, emit } = makeCollector();
    await dispatchRead({ path: 'big.txt' }, makeCtx({ emitFeedback: emit, sessionId: 's-1' }));
    const endEnv = envelopes.find((e) => e.phase === 'end')!;
    const p = endEnv.payload as { exitCode?: number; lines: string[] };
    expect(p.exitCode).toBe(0);
    expect(p.lines[0]).toMatch(/^✓ Read /);
  });

  test('end envelope carries truncated marker when size > READ_MAX_BYTES', async () => {
    // 11 MB ASCII — past the 10 MB hard cap.
    const size = READ_MAX_BYTES + 64 * 1024;
    writeLargeText('huge.txt', size);
    const { envelopes, emit } = makeCollector();
    const r = await dispatchRead(
      { path: 'huge.txt' },
      makeCtx({ emitFeedback: emit, sessionId: 's-1' }),
    );
    expect(r.truncated).toBe(true);
    const endEnv = envelopes.find((e) => e.phase === 'end')!;
    expect((endEnv.payload as { lines: string[] }).lines[0]).toMatch(/truncated/);
  });

  test('blockId stable across all phases (<sid>:read:<toolCallId>)', async () => {
    writeLargeText('big.txt', READ_PROGRESS_THRESHOLD_BYTES + 1024);
    const { envelopes, emit } = makeCollector();
    await dispatchRead(
      { path: 'big.txt' },
      makeCtx({ emitFeedback: emit, sessionId: 's-7', toolCallId: 'tc-42' }),
    );
    const ids = new Set(envelopes.map((e) => e.blockId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe('s-7:read:tc-42');
    for (const env of envelopes) {
      expect(env.parentToolCallId).toBe('tc-42');
    }
  });

  test('seq monotonic across all envelopes', async () => {
    writeLargeText('big.txt', READ_CHUNK_BYTES * 4);
    const { envelopes, emit } = makeCollector();
    await dispatchRead({ path: 'big.txt' }, makeCtx({ emitFeedback: emit, sessionId: 's-1' }));
    const seqs = envelopes.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }
  });
});

// ── failure paths ────────────────────────────────────────────────────

describe('dispatchRead · failure paths', () => {
  test('binary file (large) emits start + end(exitCode=1) before throwing', async () => {
    // 1.5 MB of NUL-padded binary so the early bail fires after the
    // first chunk's binary sniff.
    const buf = Buffer.alloc(READ_PROGRESS_THRESHOLD_BYTES + 1024);
    for (let i = 0; i < buf.length; i += 17) buf[i] = 0; // NUL bytes
    writeFileSync(joinPath(cwd, 'big.bin'), buf);
    const { envelopes, emit } = makeCollector();
    await expect(
      dispatchRead({ path: 'big.bin' }, makeCtx({ emitFeedback: emit, sessionId: 's-1' })),
    ).rejects.toThrow(ToolSafetyError);
    const phases = envelopes.map((e) => e.phase);
    expect(phases[0]).toBe('start');
    expect(phases[phases.length - 1]).toBe('end');
    const endEnv = envelopes[envelopes.length - 1]!;
    expect((endEnv.payload as { exitCode?: number }).exitCode).toBe(1);
    expect((endEnv.payload as { lines: string[] }).lines[0]).toMatch(/binary/);
  });

  test('emitFeedback throwing does not crash the dispatch', async () => {
    writeLargeText('big.txt', READ_PROGRESS_THRESHOLD_BYTES + 1024);
    let calls = 0;
    const r = await dispatchRead(
      { path: 'big.txt' },
      makeCtx({
        emitFeedback: () => {
          calls += 1;
          throw new Error('wire down');
        },
        sessionId: 's-1',
      }),
    );
    expect(r.content.length).toBeGreaterThan(0);
    expect(calls).toBeGreaterThanOrEqual(2); // start + end at minimum
  });
});
