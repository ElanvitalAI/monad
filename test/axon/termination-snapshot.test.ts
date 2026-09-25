// AXON F2 — buildAxonTerminationSnapshot unit tests.
//
// Verifies the pure helper that bridges auto-mode's turn-level state
// to the P5 termination detector + AxonTerminationSnapshot payload
// that loop-prompt consumes.
//
// Note on counts: `pendingToolCalls` defaults to 0 in the detector
// (factor 2 satisfied by default — "no pending tool calls" is the
// safe baseline). The fixtures below account for that baseline.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildAxonTerminationSnapshot,
  type BuildAxonTerminationSnapshotInput,
} from '../../src/axon/termination-snapshot.js';
import { announcementStore } from '../../src/axon/announcement-store.js';

function fakeStore(last: { goalSlug?: string } | null): { getLast(): { goalSlug?: string } | null } {
  return { getLast: () => last };
}

afterEach(() => {
  announcementStore.__clear();
});

describe('buildAxonTerminationSnapshot', () => {
  test('bare-minimum input ⇒ CONTINUE + low confidence', () => {
    const snap = buildAxonTerminationSnapshot({
      goalSlug: 'my-goal',
      announcementStore: fakeStore(null),
    });
    expect(snap.shouldTerminate).toBe(false);
    expect(snap.confidence).toBe('low');
    // Only factor 2 (no pending tool calls) is satisfied by the detector's
    // default — everything else unsatisfied.
    expect(snap.satisfiedCount).toBe(1);
    expect(snap.prompt).toContain('CONTINUE');
    expect(snap.prompt).toContain('1/7');
  });

  test('goalTermination + budgetExhausted + clarifyingAnswered ⇒ 4 satisfied, medium', () => {
    const snap = buildAxonTerminationSnapshot({
      goalSlug: 'g',
      goalTerminationMet: true,
      budgetExhausted: true,
      clarifyingQuestionsAnswered: true,
      announcementStore: fakeStore(null),
    });
    expect(snap.shouldTerminate).toBe(false);
    // f2 (default) + f4 + f5 + f6 = 4/7.
    expect(snap.satisfiedCount).toBe(4);
    expect(snap.confidence).toBe('medium');
    expect(snap.prompt).toContain('CONTINUE');
  });

  test('AnnounceCompletion scoped to this goal flips shouldTerminate=true', () => {
    const snap = buildAxonTerminationSnapshot({
      goalSlug: 'my-goal',
      goalTerminationMet: true,
      clarifyingQuestionsAnswered: true,
      announcementStore: fakeStore({ goalSlug: 'my-goal' }),
    });
    expect(snap.shouldTerminate).toBe(true);
    // f2 (default) + f4 + f5 + f7 = 4/7; announce wins.
    expect(snap.satisfiedCount).toBe(4);
    expect(snap.confidence).toBe('medium');
    expect(snap.prompt).toContain('TERMINATE');
    expect(snap.prompt).toContain('AnnounceCompletion');
  });

  test('AnnounceCompletion scoped to a DIFFERENT goal is ignored', () => {
    const snap = buildAxonTerminationSnapshot({
      goalSlug: 'my-goal',
      goalTerminationMet: true,
      clarifyingQuestionsAnswered: true,
      budgetExhausted: true,
      announcementStore: fakeStore({ goalSlug: 'some-other-goal' }),
    });
    expect(snap.shouldTerminate).toBe(false);
    // f2 (default) + f4 + f5 + f6 — announce filtered out.
    expect(snap.satisfiedCount).toBe(4);
  });

  test('AnnounceCompletion with NO goalSlug on the record counts (legacy compat)', () => {
    const snap = buildAxonTerminationSnapshot({
      goalSlug: 'my-goal',
      announcementStore: fakeStore({}),  // no goalSlug field
    });
    expect(snap.shouldTerminate).toBe(true);
    // f2 default + f7 announce = 2/7.
    expect(snap.satisfiedCount).toBe(2);
  });

  test('per-turn factors (stopReason + idempotent) push to high confidence', () => {
    const hash = 'abc123';
    const input: BuildAxonTerminationSnapshotInput = {
      goalSlug: 'g',
      stopReason: 'end_turn',
      pendingToolCalls: 0,
      recentToolResultHashes: [hash, hash, hash, hash],
      clarifyingQuestionsAnswered: true,
      goalTerminationMet: true,
      announcementStore: fakeStore(null),
    };
    const snap = buildAxonTerminationSnapshot(input);
    // factors 1, 2, 3, 4, 5 satisfied = 5/7 ⇒ high + terminate.
    expect(snap.satisfiedCount).toBe(5);
    expect(snap.confidence).toBe('high');
    expect(snap.shouldTerminate).toBe(true);
    expect(snap.prompt).toContain('TERMINATE');
  });

  test('pendingToolCalls > 0 unsatisfies factor 2', () => {
    const snap = buildAxonTerminationSnapshot({
      goalSlug: 'g',
      pendingToolCalls: 2,
      announcementStore: fakeStore(null),
    });
    // factor 2 fails because 2 pending — no factors satisfied.
    expect(snap.satisfiedCount).toBe(0);
    expect(snap.confidence).toBe('low');
    expect(snap.prompt).toContain('2 pending');
  });

  test('prompt output is the full formatTerminationForPrompt render', () => {
    const snap = buildAxonTerminationSnapshot({
      goalSlug: 'g',
      announcementStore: fakeStore(null),
    });
    // Contains the checklist header + every factor line.
    expect(snap.prompt).toContain('Termination decision:');
    expect(snap.prompt).toContain('stopReason=end_turn');
    expect(snap.prompt).toContain('tool_use blocks awaiting tool_result');
    expect(snap.prompt).toContain('clarifying questions');
    expect(snap.prompt).toContain('Budget exhausted');
  });

  test('uses module-level announcementStore by default', () => {
    announcementStore.__clear();
    announcementStore.record({ summary: 'done', outcome: 'success', goalSlug: 'default-goal' });
    const snap = buildAxonTerminationSnapshot({ goalSlug: 'default-goal' });
    // f2 default + f7 = 2/7, terminate via announce.
    expect(snap.satisfiedCount).toBe(2);
    expect(snap.shouldTerminate).toBe(true);
  });

  test('module-level announce for a DIFFERENT goal ignored in default path', () => {
    announcementStore.__clear();
    announcementStore.record({ summary: 'old', outcome: 'partial', goalSlug: 'stale-goal' });
    const snap = buildAxonTerminationSnapshot({ goalSlug: 'active-goal' });
    // Only f2 default = 1/7; announce gated off by goal mismatch.
    expect(snap.satisfiedCount).toBe(1);
    expect(snap.shouldTerminate).toBe(false);
  });
});
