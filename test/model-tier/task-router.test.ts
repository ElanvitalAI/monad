// PLAN-model-intelligence-router-2026-07-10 · Phase B1 tests.
//
// Covers the hybrid C router: heuristic clear cases, the ambiguous-middle
// escalation to the LLM, and the fallback-on-failure guarantee.

import { describe, it, expect } from 'bun:test';
import {
  classifyTierHeuristic,
  parseTierClassifyReply,
  routeTier,
  type RouterInput,
} from '../../src/model-tier/task-router.js';
import type { LlmRunner } from '../../src/model-tier/preset-suggest-llm.js';

describe('classifyTierHeuristic', () => {
  it('routes bulk/extract asks to budget with high confidence', () => {
    const r = classifyTierHeuristic({ text: '이 기사 요약해줘' });
    expect(r.tier).toBe('budget');
    expect(r.source).toBe('heuristic');
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('routes trivially short no-signal input to budget', () => {
    const r = classifyTierHeuristic({ text: 'hi' });
    expect(r.tier).toBe('budget');
  });

  it('routes strong reasoning cues to best', () => {
    const r = classifyTierHeuristic({
      text: '이 아키텍처 결정의 근거를 분석해서 판단해줘',
    });
    expect(r.tier).toBe('best');
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('escalates a single reasoning cue + tools + length to best', () => {
    const r = classifyTierHeuristic({
      text: 'debug '.padEnd(4100, 'x'),
      toolCount: 8,
      sizeHint: 4100,
    });
    expect(r.tier).toBe('best');
  });

  it('marks the muddled middle as low-confidence balanced', () => {
    const r = classifyTierHeuristic({
      text: 'Can you help me put together a plan for the offsite agenda next month',
    });
    // "plan" is not a hard keyword; ordinary prose → balanced, low conf.
    expect(r.tier).toBe('balanced');
    expect(r.confidence).toBeLessThan(0.6);
  });
});

describe('parseTierClassifyReply', () => {
  it('parses a clean JSON reply', () => {
    const r = parseTierClassifyReply('{"tier":"loaded","confidence":0.9,"reason":"deep"}');
    expect(r?.tier).toBe('loaded');
    expect(r?.source).toBe('llm');
    expect(r?.confidence).toBeCloseTo(0.9);
  });

  it('tolerates fences and leading prose', () => {
    const r = parseTierClassifyReply('Sure!\n```json\n{"tier":"better"}\n```');
    expect(r?.tier).toBe('better');
    expect(r?.confidence).toBe(0.7); // default when omitted
  });

  it('rejects an invalid tier', () => {
    expect(parseTierClassifyReply('{"tier":"turbo"}')).toBeNull();
  });

  it('rejects non-JSON', () => {
    expect(parseTierClassifyReply('no json here')).toBeNull();
  });
});

describe('routeTier (hybrid)', () => {
  const input: RouterInput = {
    text: 'Can you help me put together a plan for the offsite agenda next month',
  };

  it('returns the heuristic without an LLM when no runner is supplied', async () => {
    const r = await routeTier(input);
    expect(r.source).toBe('heuristic');
  });

  it('skips the LLM when the heuristic is already confident', async () => {
    let called = false;
    const runner: LlmRunner = async () => { called = true; return '{"tier":"loaded"}'; };
    const r = await routeTier({ text: '요약해줘' }, runner);
    expect(called).toBe(false);
    expect(r.tier).toBe('budget');
  });

  it('escalates to the LLM on an ambiguous heuristic', async () => {
    const runner: LlmRunner = async () => '{"tier":"best","confidence":0.8,"reason":"hard"}';
    const r = await routeTier(input, runner);
    expect(r.source).toBe('llm');
    expect(r.tier).toBe('best');
  });

  it('falls back to the heuristic when the LLM throws', async () => {
    const runner: LlmRunner = async () => { throw new Error('boom'); };
    const r = await routeTier(input, runner);
    expect(r.source).toBe('fallback');
    expect(r.tier).toBe('balanced');
  });

  it('falls back when the LLM returns garbage', async () => {
    const runner: LlmRunner = async () => 'not json';
    const r = await routeTier(input, runner);
    expect(r.source).toBe('fallback');
  });
});
