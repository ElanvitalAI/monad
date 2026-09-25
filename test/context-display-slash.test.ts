// ── Wave 1 · /context slash + format ──

import { afterEach, describe, expect, test } from 'bun:test';
import {
  buildContextSlashCommand,
  clearTelemetryForTest,
  formatContextSummary,
  recordLlmCall,
} from '../src/context-display';
import { resolveModelAlias } from '../src/intelligence-map/model-alias';
import { BUILTIN_CATALOG } from '../src/intelligence-map/model-catalog';

const activeModelId = resolveModelAlias('opus');
const activeModel = BUILTIN_CATALOG.models.find((model) => model.id === activeModelId);
if (!activeModel) throw new Error(`Missing canonical Opus catalog entry: ${activeModelId}`);
const reservedOutputTokens = activeModel.reservedOutputTokens ?? 0;
const expectedInputBudget = activeModel.contextWindow - reservedOutputTokens;

afterEach(() => {
  clearTelemetryForTest();
});

describe('Wave 1 · /context slash + formatter', () => {
  test('empty buffer renders the "no calls" placeholder', () => {
    const summary = formatContextSummary({});
    expect(summary.lines.some(l => l.includes('no LLM calls captured'))).toBe(true);
    expect(summary.payload.latest).toBeNull();
    expect(summary.payload.session.callCount).toBe(0);
  });

  test('latest call is surfaced with token breakdown', () => {
    recordLlmCall({
      ts: Date.now() - 1000,
      provider: 'anthropic',
      model: activeModel.id,
      inputTokens: 5000,
      outputTokens: 800,
      cacheReadInputTokens: 2000,
      cacheCreationInputTokens: 0,
    });
    const summary = formatContextSummary({});
    const text = summary.lines.join('\n');
    expect(text).toContain(`anthropic/${activeModel.id}`);
    expect(text).toContain('in 5.0K');
    expect(text).toContain('cache-r 2.0K');
    expect(summary.payload.latest?.inputTokens).toBe(5000);
  });

  test('ctx % computed from contextWindow − reservedOutputTokens', () => {
    const inputTokens = Math.floor(expectedInputBudget / 4);
    const cacheReadInputTokens = 0;
    const expectedCtxPct = Math.round((inputTokens + cacheReadInputTokens) / expectedInputBudget * 100);
    recordLlmCall({
      ts: Date.now(),
      provider: 'anthropic',
      model: activeModel.id,
      inputTokens,
      outputTokens: 1000,
      cacheReadInputTokens,
      cacheCreationInputTokens: 0,
    });
    const summary = formatContextSummary({});
    expect(summary.payload.contextWindow).toBe(activeModel.contextWindow);
    expect(summary.payload.reservedOutputTokens).toBe(activeModel.reservedOutputTokens);
    expect(summary.payload.inputBudget).toBe(expectedInputBudget);
    expect(summary.payload.ctxPct).toBe(expectedCtxPct);
    expect(summary.lines.some(l => l.includes(`${expectedCtxPct}%`))).toBe(true);
    expect(buildContextSlashCommand().render()).toContain(`${expectedCtxPct}%`);
  });

  test('cache-read tokens count toward ctx %', () => {
    const cacheReadInputTokens = Math.ceil(expectedInputBudget / 2);
    const inputTokens = expectedInputBudget - cacheReadInputTokens;
    expect(inputTokens).toBeGreaterThan(0);
    expect(inputTokens).toBeLessThan(expectedInputBudget);
    recordLlmCall({
      ts: Date.now(),
      provider: 'anthropic',
      model: activeModel.id,
      inputTokens,
      outputTokens: 500,
      cacheReadInputTokens,
      cacheCreationInputTokens: 0,
    });
    const summary = formatContextSummary({});
    expect(summary.payload.ctxPct).toBe(100);
    expect(buildContextSlashCommand().render()).toContain('100%');
  });

  test('ctx % omitted when active model not in catalog', () => {
    recordLlmCall({
      ts: Date.now(),
      provider: 'unknown',
      model: 'phantom-model-not-in-catalog',
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    const summary = formatContextSummary({});
    expect(summary.payload.ctxPct).toBeUndefined();
    expect(summary.payload.contextWindow).toBeUndefined();
  });

  test('explicit activeModelId overrides telemetry-derived model', () => {
    recordLlmCall({
      ts: Date.now(),
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    const summary = formatContextSummary({ activeModelId: activeModel.id });
    expect(summary.payload.activeModel?.id).toBe(activeModel.id);
    expect(summary.payload.contextWindow).toBe(activeModel.contextWindow);
  });

  test('multi-provider session emits per-provider breakdown', () => {
    recordLlmCall({
      ts: 1, provider: 'anthropic', model: activeModel.id,
      inputTokens: 1000, outputTokens: 200,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    });
    recordLlmCall({
      ts: 2, provider: 'openai', model: 'gpt-4o',
      inputTokens: 500, outputTokens: 100,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    });
    const summary = formatContextSummary({});
    const text = summary.lines.join('\n');
    expect(text).toContain('per provider');
    expect(text).toContain('anthropic');
    expect(text).toContain('openai');
  });

  test('cache hit rate computed from cumulative reads', () => {
    recordLlmCall({
      ts: 1, provider: 'anthropic', model: activeModel.id,
      inputTokens: 250, outputTokens: 100,
      cacheReadInputTokens: 750, cacheCreationInputTokens: 0,
    });
    const summary = formatContextSummary({});
    // 750 / (250 + 750) = 75%
    expect(summary.lines.some(l => l.includes('cache hit rate: 75%'))).toBe(true);
  });

  test('buildContextSlashCommand exposes name + aliases', () => {
    const cmd = buildContextSlashCommand();
    expect(cmd.name).toBe('context');
    expect(cmd.aliases).toContain('ctx');
    expect(cmd.description).toContain('context');
    const out = cmd.render();
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
