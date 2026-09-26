// ⭐P2 (capture substrate) — tui-observe reducer contract. The pure half
// of the PWA live TUI mirror: folds ACP `agent_thought_chunk` texts into a
// surfaceId → latest-frame map, dropping stale/non-frame envelopes.

import { describe, expect, it } from 'bun:test';

import {
  applyTuiFrameEnvelope,
  emptyTuiObserveState,
  listObserveSurfaces,
  pruneStaleSurfaces,
  stripAnsi,
} from './tui-observe';

function frameEnvelope(terminalId: string, frame: string, instance: string, at: number): string {
  return [
    `[elanous/term/terminalFrame] ${terminalId}`,
    JSON.stringify({ terminalId, frame, instance, at }),
    `<<elanous-term-end ${terminalId}>>`,
  ].join('\n');
}

describe('applyTuiFrameEnvelope', () => {
  it('collects a terminalFrame into the state (composite key · stamps receivedAt)', () => {
    const s = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:1', 'screen-a', 'test:x', 100), 5000);
    expect(s.get('test:x\x00tui:1')).toEqual({ key: 'test:x\x00tui:1', surfaceId: 'tui:1', frame: 'screen-a', instance: 'test:x', at: 100, receivedAt: 5000 });
  });

  it('replaces the frame when a newer `at` arrives (full-screen snapshot semantics)', () => {
    let s = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:1', 'old', 'i', 100), 1000);
    s = applyTuiFrameEnvelope(s, frameEnvelope('tui:1', 'new', 'i', 200), 2000);
    expect(s.get('i\x00tui:1')!.frame).toBe('new');
    expect(s.get('i\x00tui:1')!.receivedAt).toBe(2000);
  });

  it('ignores STRICTLY older `at` (out-of-order) — no re-render', () => {
    const s1 = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:1', 'cur', 'i', 200), 1000);
    const s2 = applyTuiFrameEnvelope(s1, frameEnvelope('tui:1', 'stale', 'i', 150), 2000);
    expect(s2).toBe(s1); // same reference → React skips re-render
    expect(s2.get('i\x00tui:1')!.frame).toBe('cur');
  });

  it('refreshes receivedAt on a same-`at` re-send (liveness — static screen not wrongly pruned)', () => {
    const s1 = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:1', 'x', 'i', 200), 1000);
    const s2 = applyTuiFrameEnvelope(s1, frameEnvelope('tui:1', 'x', 'i', 200), 9000);
    expect(s2).not.toBe(s1);
    expect(s2.get('i\x00tui:1')!.receivedAt).toBe(9000);
  });

  it('does NOT collide same PID across different instances (composite key)', () => {
    let s = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:100', 'PROD', 'prod', 500), 1000);
    // Same surfaceId, DIFFERENT instance, LOWER daemon `at` — must NOT
    // overwrite or be dropped as "stale" (independent surface).
    s = applyTuiFrameEnvelope(s, frameEnvelope('tui:100', 'TEST', 'test:a', 10), 1000);
    expect(s.size).toBe(2);
    expect(s.get('prod\x00tui:100')!.frame).toBe('PROD');
    expect(s.get('test:a\x00tui:100')!.frame).toBe('TEST');
  });

  it('returns the same reference for non-frame envelopes', () => {
    const out = '[elanous/term/terminalOutput] t\n{"terminalId":"t","data":"x"}\n<<elanous-term-end t>>';
    expect(applyTuiFrameEnvelope(emptyTuiObserveState, out)).toBe(emptyTuiObserveState);
  });

  it('returns the same reference for garbage / non-envelope text', () => {
    expect(applyTuiFrameEnvelope(emptyTuiObserveState, 'just some agent thought')).toBe(emptyTuiObserveState);
  });

  it('tracks multiple surfaces + orders by local receivedAt (clock-skew safe · key tie-break)', () => {
    // tui:1 has a HIGHER daemon `at` but was received EARLIER; tui:2 was
    // received later → tui:2 sorts first (local clock wins over daemon clock).
    let s = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:1', 'a', 'i', 9999), 1000);
    s = applyTuiFrameEnvelope(s, frameEnvelope('tui:2', 'b', 'j', 100), 2000);
    expect(s.size).toBe(2);
    expect(listObserveSurfaces(s).map((x) => x.surfaceId)).toEqual(['tui:2', 'tui:1']);
  });

  it('orders equal-receivedAt surfaces deterministically by key (tie-breaker)', () => {
    let s = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:b', 'x', 'i', 100), 3000);
    s = applyTuiFrameEnvelope(s, frameEnvelope('tui:a', 'y', 'i', 100), 3000);
    // Same receivedAt → key.localeCompare tie-break → 'i\x00tui:a' before 'i\x00tui:b'.
    expect(listObserveSurfaces(s).map((x) => x.key)).toEqual(['i\x00tui:a', 'i\x00tui:b']);
  });
});

describe('stripAnsi', () => {
  it('strips simple SGR color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m plain')).toBe('red plain');
  });

  it('strips colon-form SGR params (24-bit color)', () => {
    expect(stripAnsi('\x1b[38:2:255:0:0mR\x1b[0m')).toBe('R');
  });

  it('strips OSC sequences (ESC] … BEL/ST) without leaving the body — regex ordering', () => {
    expect(stripAnsi('\x1b]0;window title\x07visible')).toBe('visible');
    expect(stripAnsi('\x1b]8;;https://x\x1b\\link')).toBe('link');
  });

  it('leaves plain text (incl. box-drawing) untouched', () => {
    expect(stripAnsi('┌─ elanous ─┐\n│ hi │')).toBe('┌─ elanous ─┐\n│ hi │');
  });
});

describe('pruneStaleSurfaces', () => {
  it('drops surfaces idle beyond the TTL (dead TUI — no exit signal)', () => {
    let s = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:dead', 'x', 'i', 100), 1_000);
    s = applyTuiFrameEnvelope(s, frameEnvelope('tui:live', 'y', 'i', 100), 30_000);
    // now=40s, ttl=15s → tui:dead (received 1s) expired, tui:live (30s) kept.
    const pruned = pruneStaleSurfaces(s, 40_000, 15_000);
    expect([...pruned.keys()]).toEqual(['i\x00tui:live']);
  });

  it('returns the same reference when nothing has expired (no re-render)', () => {
    const s = applyTuiFrameEnvelope(emptyTuiObserveState, frameEnvelope('tui:1', 'x', 'i', 100), 10_000);
    expect(pruneStaleSurfaces(s, 12_000, 15_000)).toBe(s);
  });
});
