// FU8 PR #7 (FU-I7a.2 · 2026-05-12) — prompt-format helper +
// integration smoke for the 3 Phase 1 LLM prompts.
//
// Goals:
//   1. Helper produces the same response-format header for every
//      consumer so future schema tightenings stay one-touch.
//   2. The 3 phase prompt builders (decompose · categorize ·
//      goal-align) all carry the same `RESPONSE_FORMAT_RULES` lines
//      via the helper — guard against drift.
//   3. The decompose prompt carries the FU-I7a.2 worked example so
//      a regression that drops it is loud.

import { describe, expect, test } from 'bun:test';

import {
  RESPONSE_FORMAT_RULES,
  buildResponseFormatHeader,
} from '../../src/intake-plane/prompt-format';
import { buildDecomposeMemoPrompt } from '../../src/intake-plane/decompose';
import { buildCategorizePrompt } from '../../src/intake-plane/categorize';
import { buildGoalAlignPrompt } from '../../src/intake-plane/goal-align';
import type { EnrichedDecomposition } from '../../src/intake-plane/enrich';
import type { CategorizeResult } from '../../src/intake-plane/categorize';

describe('buildResponseFormatHeader', () => {
  test('emits the strict format rules + fenced JSON shape block', () => {
    const lines = buildResponseFormatHeader('{ "ok": true }');
    expect(lines[0]).toContain('출력 규칙');
    for (const rule of RESPONSE_FORMAT_RULES) {
      expect(lines).toContain(rule);
    }
    expect(lines).toContain('```json');
    expect(lines).toContain('{ "ok": true }');
    // Fence must close to keep downstream parsers happy.
    expect(lines[lines.length - 1]).toBe('```');
  });

  test('every rule is non-empty and mentions a normative directive', () => {
    expect(RESPONSE_FORMAT_RULES.length).toBeGreaterThan(0);
    for (const r of RESPONSE_FORMAT_RULES) {
      expect(r.length).toBeGreaterThan(8);
      expect(r.startsWith('- ')).toBe(true);
    }
  });
});

describe('Phase 1 prompts share the response-format header', () => {
  function sampleDecomposition(): EnrichedDecomposition {
    return {
      rationale: 'sample',
      fallback: false,
      missions: [
        {
          id: 'm-1',
          title: 'Test mission',
          intent: 'Test intent',
          tasks: [
            {
              id: 't-1',
              title: 'Test task',
              intent: 'Test task intent',
              urls: [],
              keywords: [],
              refs: [],
              invariants: [],
              decisionSignals: [],
              confidence: 'high',
              context: { enrichments: [] },
            },
          ],
        },
      ],
    };
  }

  test('decompose prompt carries every shared rule + the fenced shape', () => {
    const prompt = buildDecomposeMemoPrompt({ rawText: 'sample memo' });
    for (const rule of RESPONSE_FORMAT_RULES) {
      expect(prompt).toContain(rule);
    }
    expect(prompt).toContain('출력 규칙');
    expect(prompt).toContain('```json');
  });

  test('categorize prompt carries the same shared rules', () => {
    const prompt = buildCategorizePrompt(sampleDecomposition());
    for (const rule of RESPONSE_FORMAT_RULES) {
      expect(prompt).toContain(rule);
    }
  });

  test('goal-align prompt carries the same shared rules', () => {
    const cat: CategorizeResult = {
      categorizations: {
        'm-1/t-1': {
          taskKey: 'm-1/t-1',
          category: 'research',
          workflowEligible: true,
          confidence: 'high',
        },
      },
      fallback: false,
    };
    const prompt = buildGoalAlignPrompt({
      decomposition: sampleDecomposition(),
      categorize: cat,
    });
    for (const rule of RESPONSE_FORMAT_RULES) {
      expect(prompt).toContain(rule);
    }
  });
});

describe('decompose prompt · FU-I7a.2 worked example', () => {
  test('carries the WORKED EXAMPLE block (regression guard)', () => {
    const prompt = buildDecomposeMemoPrompt({ rawText: 'sample memo' });
    expect(prompt).toContain('WORKED EXAMPLE');
    // The example's mission title is a stable substring that lets
    // future PRs detect a "lost example" regression cheaply.
    expect(prompt).toContain('기술 학습 — diagram + video');
    expect(prompt).toContain('이번 주말 개인 일정');
  });

  test('refinement path still includes the worked example', () => {
    const prompt = buildDecomposeMemoPrompt({
      rawText: 'sample memo',
      refinementHint: 'P0 만 남기세요',
      priorDecomposition: { missions: [] },
    });
    expect(prompt).toContain('WORKED EXAMPLE');
    expect(prompt).toContain('USER REFINEMENT HINT:');
  });
});

describe('categorize prompt · FU8 follow-up #2 worked example', () => {
  function sampleDecomposition(): EnrichedDecomposition {
    return {
      rationale: 'sample',
      fallback: false,
      missions: [
        {
          id: 'm-1',
          title: 'Test mission',
          intent: 'Test intent',
          tasks: [
            {
              id: 't-1',
              title: 'Test task',
              intent: 'Test task intent',
              urls: [],
              keywords: [],
              refs: [],
              invariants: [],
              decisionSignals: [],
              confidence: 'high',
              context: { enrichments: [] },
            },
          ],
        },
      ],
    };
  }

  test('carries the categorize WORKED EXAMPLE block', () => {
    const prompt = buildCategorizePrompt(sampleDecomposition());
    expect(prompt).toContain('WORKED EXAMPLE');
    // Three archetype tasks: URL+plan / pure code / user-cognition.
    expect(prompt).toContain('Mermaid live-render plan');
    expect(prompt).toContain('kitty graphics 프로토콜');
    expect(prompt).toContain('이번 주 회고 미팅');
    // The expected response covers the closed-set category
    // mapping for each archetype.
    expect(prompt).toContain('"category": "research-and-plan"');
    expect(prompt).toContain('"category": "dev-feature"');
    expect(prompt).toContain('"category": "cognitive"');
  });
});

describe('goal-align prompt · FU8 follow-up #2 worked example', () => {
  function sampleInput() {
    const decomposition: EnrichedDecomposition = {
      rationale: 'sample',
      fallback: false,
      missions: [
        {
          id: 'm-1',
          title: 'Test mission',
          intent: 'Test intent',
          tasks: [
            {
              id: 't-1',
              title: 'Test task',
              intent: 'Test task intent',
              urls: [],
              keywords: [],
              refs: [],
              invariants: [],
              decisionSignals: [],
              confidence: 'high',
              context: { enrichments: [] },
            },
          ],
        },
      ],
    };
    const categorize: CategorizeResult = {
      categorizations: {
        'm-1/t-1': {
          taskKey: 'm-1/t-1',
          category: 'research',
          workflowEligible: true,
          confidence: 'high',
        },
      },
      fallback: false,
    };
    return { decomposition, categorize };
  }

  test('carries the goal-align WORKED EXAMPLE block', () => {
    const prompt = buildGoalAlignPrompt(sampleInput());
    expect(prompt).toContain('WORKED EXAMPLE');
    // Two-task example covering override + dependency.
    expect(prompt).toContain('PR #2424 변경점 흡수');
    expect(prompt).toContain('후속 PR 작성');
    // Example response shows priority override + dependency edge.
    expect(prompt).toContain('"priority": "high"');
    expect(prompt).toContain('"from": "m-1/t-1"');
    expect(prompt).toContain('"to": "m-1/t-2"');
  });
});
