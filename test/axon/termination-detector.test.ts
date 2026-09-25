// AXON P5 — termination-detector unit tests.
//
// The detector is a pure function. Every case specifies the seven
// factors explicitly so the test doubles as a spec.

import { describe, it, expect } from 'bun:test';
import {
  evaluateTermination,
  formatTerminationForPrompt,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
  type TerminationInput,
} from '../../src/axon/termination-detector.js';

/** All seven factors satisfied — the "canonical terminate" shape. */
function allSatisfied(overrides: Partial<TerminationInput> = {}): TerminationInput {
  return {
    stopReason: 'end_turn',
    pendingToolCalls: 0,
    recentToolResultHashes: ['h', 'h', 'h'],
    clarifyingQuestionsAnswered: true,
    goalTerminationMet: true,
    budget: { okToStop: true },
    announceCompletion: true,
    ...overrides,
  };
}

describe('evaluateTermination — thresholds', () => {
  it('returns shouldTerminate=true at 7/7 with high confidence', () => {
    const d = evaluateTermination(allSatisfied());
    expect(d.shouldTerminate).toBe(true);
    expect(d.confidence).toBe('high');
    expect(d.satisfiedCount).toBe(7);
  });

  it('returns shouldTerminate=true at 5/7 (high threshold) without AnnounceCompletion', () => {
    const d = evaluateTermination({
      stopReason: 'end_turn',
      pendingToolCalls: 0,
      recentToolResultHashes: ['h', 'h', 'h'],
      clarifyingQuestionsAnswered: true,
      goalTerminationMet: true,
      // budget missing, announce missing — 5/7
    });
    expect(d.shouldTerminate).toBe(true);
    expect(d.confidence).toBe('high');
    expect(d.satisfiedCount).toBe(5);
  });

  it('keeps looping at 4/7 without AnnounceCompletion (below high threshold)', () => {
    const d = evaluateTermination({
      stopReason: 'end_turn',
      pendingToolCalls: 0,
      recentToolResultHashes: ['h', 'h', 'h'],
      clarifyingQuestionsAnswered: true,
      // goalTerminationMet missing, budget missing, announce missing — 4/7
    });
    expect(d.shouldTerminate).toBe(false);
    expect(d.confidence).toBe('medium');
    expect(d.satisfiedCount).toBe(4);
    expect(d.reason).toContain('close to done');
  });

  it('returns low confidence at ≤2/7 satisfied', () => {
    // Empty input: factor 2 (no-pending-tool-calls) defaults to
    // satisfied because `pendingToolCalls ?? 0` means "no pending
    // count reported ⇒ no pending work". Everything else is
    // unsatisfied ⇒ 1/7 total.
    const d = evaluateTermination({
      pendingToolCalls: 1,       // block the default-satisfied path
      stopReason: 'max_tokens',  // factor 1 unsatisfied
    });
    expect(d.shouldTerminate).toBe(false);
    expect(d.confidence).toBe('low');
    expect(d.satisfiedCount).toBe(0);
  });
});

describe('evaluateTermination — AnnounceCompletion escape hatch', () => {
  it('AnnounceCompletion alone (1/7 satisfied) still terminates with medium confidence', () => {
    const d = evaluateTermination({ announceCompletion: true });
    expect(d.shouldTerminate).toBe(true);
    expect(d.confidence).toBe('medium');
    expect(d.reason).toContain('AnnounceCompletion');
  });

  it('AnnounceCompletion + high structural support gives high confidence', () => {
    const d = evaluateTermination(allSatisfied());
    expect(d.shouldTerminate).toBe(true);
    expect(d.confidence).toBe('high');
    expect(d.reason).toContain('structural factors satisfied');
  });
});

describe('evaluateTermination — per-factor details', () => {
  it('factor 1 fails when stopReason is not end_turn', () => {
    const d = evaluateTermination({ stopReason: 'max_tokens' });
    const f = d.factors.find(x => x.id === 'stop-reason-end-turn')!;
    expect(f.satisfied).toBe(false);
    expect(f.note).toBe('stopReason=max_tokens');
  });

  it('factor 2 fails with a pending tool call', () => {
    const d = evaluateTermination({ pendingToolCalls: 2 });
    const f = d.factors.find(x => x.id === 'no-pending-tool-calls')!;
    expect(f.satisfied).toBe(false);
    expect(f.note).toBe('2 pending');
  });

  it('factor 3 satisfied when last N hashes are identical', () => {
    const d = evaluateTermination({ recentToolResultHashes: ['x', 'x', 'x'] });
    const f = d.factors.find(x => x.id === 'idempotent-recent-turns')!;
    expect(f.satisfied).toBe(true);
  });

  it('factor 3 unsatisfied when hashes differ', () => {
    const d = evaluateTermination({ recentToolResultHashes: ['a', 'b', 'c'] });
    const f = d.factors.find(x => x.id === 'idempotent-recent-turns')!;
    expect(f.satisfied).toBe(false);
    expect(f.note).toContain('still changing');
  });

  it('factor 3 respects a custom run length', () => {
    const d = evaluateTermination({
      recentToolResultHashes: ['h', 'h'],
      idempotentRunMin: 2,
    });
    const f = d.factors.find(x => x.id === 'idempotent-recent-turns')!;
    expect(f.satisfied).toBe(true);
  });

  it('factor 4 still satisfied when explicitly marked false', () => {
    const d = evaluateTermination({ clarifyingQuestionsAnswered: false });
    const f = d.factors.find(x => x.id === 'clarifying-questions-answered')!;
    expect(f.satisfied).toBe(false);
    expect(f.note).toBe('pending');
  });

  it('factor 6 satisfied by budget.exhausted', () => {
    const d = evaluateTermination({ budget: { exhausted: true } });
    const f = d.factors.find(x => x.id === 'budget-done')!;
    expect(f.satisfied).toBe(true);
    expect(f.note).toBe('exhausted');
  });

  it('factor 6 satisfied by budget.okToStop', () => {
    const d = evaluateTermination({ budget: { okToStop: true } });
    const f = d.factors.find(x => x.id === 'budget-done')!;
    expect(f.satisfied).toBe(true);
  });

  it('factor 7 fires on announceCompletion=true', () => {
    const d = evaluateTermination({ announceCompletion: true });
    const f = d.factors.find(x => x.id === 'announce-completion')!;
    expect(f.satisfied).toBe(true);
  });
});

describe('formatTerminationForPrompt', () => {
  it('renders a checkbox list with TERMINATE header', () => {
    const d = evaluateTermination(allSatisfied());
    const text = formatTerminationForPrompt(d);
    expect(text).toContain('TERMINATE');
    expect(text).toContain('(high confidence, 7/7)');
    for (const f of d.factors) {
      expect(text).toContain(f.label);
    }
  });

  it('renders a CONTINUE header when not terminating', () => {
    const d = evaluateTermination({ pendingToolCalls: 1, stopReason: 'max_tokens' });
    const text = formatTerminationForPrompt(d);
    expect(text).toContain('CONTINUE');
    expect(text).toContain('0/7');
  });
});

describe('constants', () => {
  it('exposes threshold constants used by the detector', () => {
    expect(HIGH_CONFIDENCE_THRESHOLD).toBe(5);
    expect(MEDIUM_CONFIDENCE_THRESHOLD).toBe(3);
  });
});
