// Goal-judge prompt + parse tests — Plan-Mode UX P1.2.
//
// Real-wiring per CLAUDE.md isolation rule. No mocks at module level.
// Tests focus on PURE functions (buildJudgeMessages, parseJudgeResponse,
// applyConfidenceGuard) — the network-call wrapper `judgeGoalTurn`
// has its own integration test that needs a live provider, kept out
// of the default suite.

import { describe, expect, test } from 'bun:test';
import {
  applyConfidenceGuard,
  buildJudgeMessages,
  parseJudgeResponse,
} from '../src/goals/judge.js';
import {
  buildContinuationPrompt,
  buildGoalStatusSummary,
} from '../src/goals/continuation.js';
import type { Goal } from '../src/goals/types.js';

const sampleGoal: Goal = {
  id: 'g-test-1',
  objective: 'write 5 unit tests for src/foo.ts',
  mode: 'judge',
  status: 'active',
  createdAt: Date.now() - 30_000,
  updatedAt: Date.now(),
  budget: { maxTurns: 20, wallClockMaxMs: 30 * 60_000, tokenBudget: 200_000 },
  usage: { turnsUsed: 3, tokensUsed: 12_500, tokensMeasured: true, elapsedMs: 30_000 },
};

describe('goals/judge — buildJudgeMessages', () => {
  test('includes objective + last assistant turn', () => {
    const msgs = buildJudgeMessages({
      objective: 'add tests',
      lastAssistantTurn: 'I added 3 test cases.',
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[1]?.role).toBe('user');
    const body = msgs[1]?.content as string;
    expect(body).toContain('add tests');
    expect(body).toContain('I added 3 test cases.');
    expect(body).toContain('"verdict"');
  });

  test('plan body block when provided', () => {
    const msgs = buildJudgeMessages({
      objective: 'x',
      lastAssistantTurn: 'y',
      planBody: 'Step 1: install\nStep 2: configure',
    });
    const body = msgs[1]?.content as string;
    expect(body).toContain('Plan steps');
    expect(body).toContain('Step 1: install');
  });

  test('tool calls block when provided', () => {
    const msgs = buildJudgeMessages({
      objective: 'x',
      lastAssistantTurn: 'y',
      recentToolCalls: ['Edit(file.ts)', 'Bash(bun test)'],
    });
    const body = msgs[1]?.content as string;
    expect(body).toContain('Recent tool calls');
    expect(body).toContain('Edit(file.ts)');
    expect(body).toContain('Bash(bun test)');
  });

  test('truncates very long last turns to 8000 chars', () => {
    const longTurn = 'A'.repeat(20_000);
    const msgs = buildJudgeMessages({ objective: 'x', lastAssistantTurn: longTurn });
    const body = msgs[1]?.content as string;
    // 8000 limit + ~200 surrounding template chars
    expect(body.length).toBeLessThan(9_000);
  });
});

describe('goals/judge — parseJudgeResponse', () => {
  test('parses bare JSON', () => {
    const r = parseJudgeResponse('{"verdict":"done","summary":"all good","confidence":0.9}');
    expect(r?.verdict).toBe('done');
    expect(r?.summary).toBe('all good');
    expect(r?.confidence).toBe(0.9);
  });

  test('extracts JSON from markdown code fence', () => {
    const r = parseJudgeResponse('```json\n{"verdict":"continue","summary":"keep going","confidence":0.7}\n```');
    expect(r?.verdict).toBe('continue');
  });

  test('extracts JSON when surrounded by chatty text', () => {
    const raw = 'Looking at the response... {"verdict":"partial","summary":"halfway","confidence":0.6} done.';
    const r = parseJudgeResponse(raw);
    expect(r?.verdict).toBe('partial');
  });

  test('returns null on garbage', () => {
    expect(parseJudgeResponse('not json at all')).toBeNull();
    expect(parseJudgeResponse('{')).toBeNull();
    expect(parseJudgeResponse('')).toBeNull();
  });

  test('returns null on unknown verdict', () => {
    const r = parseJudgeResponse('{"verdict":"yolo","summary":"x","confidence":1}');
    expect(r).toBeNull();
  });

  test('clamps confidence to [0,1]', () => {
    expect(parseJudgeResponse('{"verdict":"done","summary":"x","confidence":2}')?.confidence).toBe(1);
    expect(parseJudgeResponse('{"verdict":"done","summary":"x","confidence":-0.5}')?.confidence).toBe(0);
  });

  test('coerces string confidence', () => {
    const r = parseJudgeResponse('{"verdict":"done","summary":"x","confidence":"0.85"}');
    expect(r?.confidence).toBe(0.85);
  });

  test('uses 0.5 default when confidence missing/non-numeric', () => {
    const r = parseJudgeResponse('{"verdict":"continue","summary":"x"}');
    expect(r?.confidence).toBe(0.5);
  });

  test('handles lowercase normalization on verdict', () => {
    expect(parseJudgeResponse('{"verdict":"DONE","summary":"x","confidence":0.9}')?.verdict).toBe('done');
  });

  test('emits placeholder summary when missing', () => {
    const r = parseJudgeResponse('{"verdict":"continue","summary":"","confidence":0.7}');
    expect(r?.summary).toContain('no summary');
  });
});

describe('goals/judge — applyConfidenceGuard', () => {
  test('downgrades low-confidence done → partial', () => {
    const r = applyConfidenceGuard({ verdict: 'done', summary: 'maybe', confidence: 0.3 });
    expect(r.verdict).toBe('partial');
    expect(r.summary).toContain('low-conf done');
  });

  test('preserves high-confidence done', () => {
    const r = applyConfidenceGuard({ verdict: 'done', summary: 'yes', confidence: 0.9 });
    expect(r.verdict).toBe('done');
  });

  test('preserves continue at any confidence', () => {
    expect(applyConfidenceGuard({ verdict: 'continue', summary: 'x', confidence: 0.1 }).verdict).toBe('continue');
    expect(applyConfidenceGuard({ verdict: 'continue', summary: 'x', confidence: 0.99 }).verdict).toBe('continue');
  });
});

describe('goals/continuation — prompts', () => {
  test('builds continuation with judge summary + turn count', () => {
    const p = buildContinuationPrompt({
      goal: sampleGoal,
      judgeSummary: 'two of five tests written',
      hint: 'continue',
    });
    expect(p).toContain('auto-turn 4/20');
    expect(p).toContain('write 5 unit tests');
    expect(p).toContain('two of five tests written');
    expect(p).toContain('Continue making progress');
  });

  test('partial hint is stronger than continue', () => {
    const p = buildContinuationPrompt({ goal: sampleGoal, hint: 'partial' });
    expect(p).toContain('Wrap up');
  });

  test('first turn (no judgeSummary) shows placeholder', () => {
    const p = buildContinuationPrompt({ goal: sampleGoal, hint: 'continue' });
    expect(p).toContain('first auto-turn');
  });

  test('status summary has turn count + elapsed + verdict', () => {
    const summary = buildGoalStatusSummary({
      ...sampleGoal,
      lastVerdict: 'partial',
    });
    expect(summary).toContain('🎯');
    expect(summary).toContain('3/20');
    expect(summary).toContain('last:partial');
  });

  test('status summary omits verdict when none yet', () => {
    const summary = buildGoalStatusSummary(sampleGoal);
    expect(summary).not.toContain('last:');
  });
});
