import { describe, expect, test } from 'bun:test';
import { costForUsageDetailed } from './costs.js';
import { estimateLlmCost } from '../budget/llm-cost.js';
import { BUILTIN_CATALOG } from '../intelligence-map/model-catalog.js';
import { findClaudeModel } from '../anthropic/models.js';
import { findCodexModel } from '../codex/models.js';
import { findGrokModel } from '../grok/models.js';
import { findGeminiModel } from '../gemini/models.js';

// BACKLOG C9 — 단가표는 «하나»다.
describe('one price table (BACKLOG C9)', () => {
  test('status-bar cost delegates to the canonical estimator (no own table, no default guess)', () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    for (const m of ['claude-opus-4-8', 'claude-opus-5-5', 'gpt-6-sol', 'gemini-3.8-flash', 'grok-4.7']) {
      const est = estimateLlmCost({ model: m, ...u });
      expect(costForUsageDetailed(m, u)).toEqual({ usd: est.kind === 'unknown' ? 0 : est.usd, known: est.kind !== 'unknown' });
    }
    expect(costForUsageDetailed('claude-opus-4-8', u).usd).toBe(30);   // 공식 $5/$25 — 옛 표는 $15/$75(=90)였다
    expect(costForUsageDetailed('totally-unknown-model', u)).toEqual({ usd: 0, known: false });   // 기본가로 «아는 척»하지 않는다
  });
  test('hand catalogs and the intelligence-map catalog agree wherever both price the same model', () => {
    const diffs: string[] = [];
    for (const e of BUILTIN_CATALOG.models) {
      const h = findCodexModel(e.id) ?? findGrokModel(e.id) ?? findGeminiModel(e.id) ?? findClaudeModel(e.id);
      if (!h?.pricingUsd) continue;
      if (h.pricingUsd.inputPerM !== e.inputPerMtok || h.pricingUsd.outputPerM !== e.outputPerMtok) diffs.push(`${e.id} hand ${h.pricingUsd.inputPerM}/${h.pricingUsd.outputPerM} ≠ catalog ${e.inputPerMtok}/${e.outputPerMtok}`);
    }
    expect(diffs).toEqual([]);
  });
});
