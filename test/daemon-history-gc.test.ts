// MVP cleanup C12 — DaemonSessionHistory GC + summary tests.
//
// Validate the new lastTurnAt tracking + gc() + summary() introduced
// in C10/C12. The GC is wired as a 1h interval in `monad serve`; here
// we test the underlying primitive directly so the timer logic in
// index.ts can stay un-touched (it just calls history.gc(ttl)).

import { describe, expect, test } from 'bun:test';

import { DaemonSessionHistory } from '../src/boot/daemon-runtime.js';
import {
  appendAssistantMessages,
  appendUserAndBuildMessages,
} from '../src/boot/daemon-history-helper.js';

describe('DaemonSessionHistory.summary()', () => {
  test('returns id + msgCount + lastTurnAt sorted by recency', async () => {
    const h = new DaemonSessionHistory();
    appendUserAndBuildMessages(h, 's1', 'q1');
    appendAssistantMessages(h, 's1', [{ role: 'assistant', content: 'a1' }]);
    // Brief delay so lastTurnAt of s2 is strictly later.
    await new Promise((r) => setTimeout(r, 5));
    appendUserAndBuildMessages(h, 's2', 'q2');
    appendAssistantMessages(h, 's2', [{ role: 'assistant', content: 'a2' }]);

    const summary = h.summary();
    expect(summary).toHaveLength(2);
    // s2 is the most recent → first.
    expect(summary[0]!.id).toBe('s2');
    expect(summary[1]!.id).toBe('s1');
    expect(summary[0]!.msgCount).toBe(2); // user + assistant
    expect(summary[0]!.lastTurnAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('empty history yields empty summary', () => {
    const h = new DaemonSessionHistory();
    expect(h.summary()).toEqual([]);
  });
});

describe('DaemonSessionHistory.has()', () => {
  test('true after first append, false after forget', () => {
    const h = new DaemonSessionHistory();
    expect(h.has('x')).toBe(false);
    appendUserAndBuildMessages(h, 'x', 'q');
    expect(h.has('x')).toBe(true);
    h.forget('x');
    expect(h.has('x')).toBe(false);
  });
});

describe('DaemonSessionHistory.gc()', () => {
  test('drops sessions older than maxAgeMs; keeps recent ones', async () => {
    const h = new DaemonSessionHistory();
    appendUserAndBuildMessages(h, 'old', 'q');
    appendAssistantMessages(h, 'old', [{ role: 'assistant', content: 'a' }]);

    // Wait so the 'old' session ages.
    await new Promise((r) => setTimeout(r, 50));

    appendUserAndBuildMessages(h, 'new', 'q');

    // GC anything older than 30ms — 'old' should be gone, 'new' kept.
    const removed = h.gc(30);
    expect(removed).toBe(1);
    expect(h.has('old')).toBe(false);
    expect(h.has('new')).toBe(true);
  });

  test('returns 0 when nothing is stale', () => {
    const h = new DaemonSessionHistory();
    appendUserAndBuildMessages(h, 's1', 'q');
    expect(h.gc(60_000)).toBe(0);
    expect(h.has('s1')).toBe(true);
  });

  test('forget() clears lastTurnAt too (no zombie entries)', () => {
    const h = new DaemonSessionHistory();
    appendUserAndBuildMessages(h, 's1', 'q');
    h.forget('s1');
    // After forget, gc with 0 ttl should not throw or report removals.
    expect(h.gc(0)).toBe(0);
  });
});
