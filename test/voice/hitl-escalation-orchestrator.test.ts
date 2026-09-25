// ── M2 (Phase 4 Bundle 3) — hitl-escalation-orchestrator tests ──

import { describe, expect, test } from 'bun:test';
import {
  createHitlEscalation,
} from '../../src/voice/hitl-escalation-orchestrator';

describe('createHitlEscalation — happy path', () => {
  test('exact option match → answered', async () => {
    const spoken: string[] = [];
    const hitl = createHitlEscalation({
      speak: async (s) => { spoken.push(s); },
      awaitUserResponse: async () => ({ transcript: 'apply', confidence: 1 }),
    });
    const r = await hitl.askUser({
      question: '이 fix 를 적용?',
      options: ['apply', 'rollback'],
    });
    expect(r.outcome).toBe('answered');
    expect(r.response?.decision).toBe('apply');
    expect(spoken[0]).toContain('apply');
    expect(spoken[0]).toContain('rollback');
  });

  test('substring contains → answered with lower confidence', async () => {
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async () => ({ transcript: 'I think apply makes sense' }),
    });
    const r = await hitl.askUser({
      question: 'q',
      options: ['apply', 'rollback'],
    });
    expect(r.outcome).toBe('answered');
    expect(r.response?.decision).toBe('apply');
    expect(r.response?.confidence).toBe(0.7);
  });

  test('"yes" → maps to apply when present', async () => {
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async () => ({ transcript: 'yes' }),
    });
    const r = await hitl.askUser({
      question: 'q',
      options: ['apply', 'rollback'],
    });
    expect(r.outcome).toBe('answered');
    expect(r.response?.decision).toBe('apply');
  });

  test('"네" 한국어 yes → maps to apply', async () => {
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async () => ({ transcript: '네' }),
    });
    const r = await hitl.askUser({
      question: 'q',
      options: ['apply', 'rollback'],
    });
    expect(r.response?.decision).toBe('apply');
  });

  test('custom matchOption honored', async () => {
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async () => ({ transcript: 'whatever' }),
      matchOption: () => ({ decision: 'override', confidence: 0.9 }),
    });
    const r = await hitl.askUser({
      question: 'q',
      options: ['a', 'b'],
    });
    expect(r.response?.decision).toBe('override');
  });
});

describe('createHitlEscalation — failure modes', () => {
  test('TTS throws → tts-failed', async () => {
    const hitl = createHitlEscalation({
      speak: async () => { throw new Error('audio dead'); },
      awaitUserResponse: async () => ({ transcript: 'apply' }),
    });
    const r = await hitl.askUser({ question: 'q', options: ['a'] });
    expect(r.outcome).toBe('tts-failed');
  });

  test('user response null → timeout', async () => {
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async () => null,
    });
    const r = await hitl.askUser({ question: 'q', options: ['a'] });
    expect(r.outcome).toBe('timeout');
  });

  test('unmatched response → unclear', async () => {
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async () => ({ transcript: 'banana' }),
    });
    const r = await hitl.askUser({
      question: 'q',
      options: ['apply', 'rollback'],
    });
    expect(r.outcome).toBe('unclear');
    expect(r.response?.decision).toBe('unclear');
    expect(r.response?.transcript).toBe('banana');
  });

  test('"cancel" → cancelled', async () => {
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async () => ({ transcript: 'cancel' }),
    });
    const r = await hitl.askUser({ question: 'q', options: ['apply'] });
    expect(r.outcome).toBe('cancelled');
  });

  test('"취소" Korean cancel → cancelled', async () => {
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async () => ({ transcript: '취소' }),
    });
    const r = await hitl.askUser({ question: 'q', options: ['apply'] });
    expect(r.outcome).toBe('cancelled');
  });
});

describe('createHitlEscalation — urgency', () => {
  test('urgent uses urgentResponseBudgetMs', async () => {
    let receivedBudget = 0;
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async ({ budgetMs }) => {
        receivedBudget = budgetMs;
        return { transcript: 'apply' };
      },
      responseBudgetMs: 100,
      urgentResponseBudgetMs: 5000,
    });
    await hitl.askUser({ question: 'q', options: ['apply'], urgency: 'urgent' });
    expect(receivedBudget).toBe(5000);
  });

  test('non-urgent uses responseBudgetMs', async () => {
    let receivedBudget = 0;
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: async ({ budgetMs }) => {
        receivedBudget = budgetMs;
        return { transcript: 'apply' };
      },
      responseBudgetMs: 100,
    });
    await hitl.askUser({ question: 'q', options: ['apply'] });
    expect(receivedBudget).toBe(100);
  });
});

describe('createHitlEscalation — diagnostics', () => {
  test('inFlight tracks active prompts', async () => {
    let resolveResp: (() => void) | null = null;
    const respPromise = new Promise<{ transcript: string }>((r) => {
      resolveResp = () => r({ transcript: 'apply' });
    });
    const hitl = createHitlEscalation({
      speak: async () => {},
      awaitUserResponse: () => respPromise,
      newPromptId: () => 'p1',
    });
    const askPromise = hitl.askUser({ question: 'q', options: ['apply'] });
    await new Promise((r) => setTimeout(r, 10));
    expect(hitl.inFlight()).toEqual(['p1']);
    resolveResp!();
    await askPromise;
    expect(hitl.inFlight()).toEqual([]);
  });
});
