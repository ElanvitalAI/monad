import { describe, expect, test } from 'bun:test';
import { classifyReworkBudgetShadow } from './classify-shadow.js';
import { parseReworkBudgetDecision } from './rework-policy.js';
import { REWORK_BUDGET_VERDICTS, type ReworkBudgetVerdict } from './run-outcome.js';
import { defaultSeams } from './seams.js';

describe('classifyReworkBudgetShadow', () => {
  test('agrees with the legacy parser', async () => {
    const raw = 'BUDGET: EXTEND\nREASON: the remaining fix is narrow';
    const legacy = parseReworkBudgetDecision(raw);
    const result = await classifyReworkBudgetShadow(raw, async () => 'EXTEND');

    expect(result).toMatchObject({ picked: legacy?.verdict, ok: true });
  });

  test('reports a disagreement with the legacy parser', async () => {
    const raw = 'BUDGET: EXTEND\nREASON: the remaining fix is narrow';
    const legacy = parseReworkBudgetDecision(raw);
    const result = await classifyReworkBudgetShadow(raw, async () => 'SUFFICIENT');

    expect(result).toMatchObject({ picked: 'SUFFICIENT', ok: true });
    expect(result.picked).not.toBe(legacy?.verdict);
  });

  test('returns unknown rather than throwing when callLLM throws', async () => {
    const result = await classifyReworkBudgetShadow('BUDGET: EXTEND', async () => {
      throw new Error('classifier unavailable');
    });

    expect(result).toMatchObject({ picked: 'unknown', ok: false, error: 'classifier unavailable' });
  });

  test('resolves a chatty LLM response to a class', async () => {
    const result = await classifyReworkBudgetShadow('BUDGET: SUFFICIENT', async () => {
      return 'I would select "SUFFICIENT" because the remaining item is non-blocking.';
    });

    expect(result).toMatchObject({ picked: 'SUFFICIENT', ok: true });
  });

  test('can pick CONTRACT-CONFLICT when the classifier answers it', async () => {
    const result = await classifyReworkBudgetShadow(
      'BUDGET: CONTRACT-CONFLICT\nREASON: two criteria cannot hold together',
      async () => 'CONTRACT-CONFLICT',
    );

    expect(result).toMatchObject({ picked: 'CONTRACT-CONFLICT', ok: true });
  });

  test('still picks EXTEND when the classifier answers EXTEND', async () => {
    const result = await classifyReworkBudgetShadow('BUDGET: EXTEND', async () => 'EXTEND');

    expect(result).toMatchObject({ picked: 'EXTEND', ok: true });
  });

  test('selectable class count equals the canonical verdict count', async () => {
    const selectable = new Set<ReworkBudgetVerdict>();
    for (const verdict of REWORK_BUDGET_VERDICTS) {
      const result = await classifyReworkBudgetShadow(`BUDGET: ${verdict}`, async () => verdict);
      if (result.picked !== 'unknown') selectable.add(result.picked);
    }

    expect(selectable.size).toBe(REWORK_BUDGET_VERDICTS.length);
    expect([...selectable].sort()).toEqual([...REWORK_BUDGET_VERDICTS].sort());
  });

  test('keeps a value outside the canonical verdicts as unknown', async () => {
    const result = await classifyReworkBudgetShadow('BUDGET: MAYBE', async () => 'MAYBE');

    expect(result).toMatchObject({ picked: 'unknown', ok: true });
  });

  test('wires separate production and shadow callers to the injected LLM', async () => {
    const prompts: string[] = [];
    const seams = defaultSeams({
      llmReview: async (prompt) => {
        prompts.push(prompt);
        return 'EXTEND';
      },
    });

    const production = await seams.judgmentCallLLM?.({ prompt: 'production judgment' });
    const shadow = await seams.classifyCallLLM?.({ prompt: 'shadow classification' });

    expect(production).toBe('EXTEND');
    expect(shadow).toBe('EXTEND');
    expect(prompts).toEqual(['production judgment', 'shadow classification']);
  });
});
