// AXON P5 — verify loop-prompt renders the optional axonTermination
// section when provided and stays untouched when omitted.

import { describe, it, expect } from 'bun:test';
import {
  renderLoopPromptInjection,
  type LoopPromptSnapshot,
  type AxonTerminationSnapshot,
} from '../../src/auto-research/loop-prompt.ts';

const baseSnap: LoopPromptSnapshot = {
  plan: 'Do X.',
  queuePending: [],
  recentWins: [],
  budget: {
    limits: {},
    spent: { tokens: 0, usd: 0, turns: 0, elapsedMs: 0 },
    pctRatio: {},
    warning: [],
    tripped: [],
  } as unknown as LoopPromptSnapshot['budget'],
  budgetLine: '(budget unlimited)',
  nowNote: null,
  termination: { shouldTerminate: false, satisfied: [], unsatisfied: [] },
};

describe('renderLoopPromptInjection — axonTermination section', () => {
  it('omits the section when axonTermination is missing', () => {
    const out = renderLoopPromptInjection(baseSnap);
    expect(out).not.toContain('Axon Termination');
  });

  it('renders a dedicated section when axonTermination is provided', () => {
    const axon: AxonTerminationSnapshot = {
      shouldTerminate: true,
      confidence: 'high',
      satisfiedCount: 7,
      reason: 'AnnounceCompletion + 6 structural factors satisfied — safe to terminate.',
      prompt: '**Termination decision: TERMINATE** (high, 7/7)\n  [x] factor a\n  [x] factor b',
    };
    const snap: LoopPromptSnapshot = { ...baseSnap, axonTermination: axon };
    const out = renderLoopPromptInjection(snap);
    expect(out).toContain('## Axon Termination (turn-level)');
    expect(out).toContain('TERMINATE');
    expect(out).toContain('factor a');
  });

  it('keeps the section when the decision is CONTINUE', () => {
    const axon: AxonTerminationSnapshot = {
      shouldTerminate: false,
      confidence: 'medium',
      satisfiedCount: 3,
      reason: 'close to done',
      prompt: '**Termination decision: CONTINUE** (medium, 3/7)',
    };
    const snap: LoopPromptSnapshot = { ...baseSnap, axonTermination: axon };
    const out = renderLoopPromptInjection(snap);
    expect(out).toContain('## Axon Termination (turn-level)');
    expect(out).toContain('CONTINUE');
  });
});
