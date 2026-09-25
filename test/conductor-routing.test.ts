// ── PFC-S2 P1: Conductor routing + adapters + dispatch ──

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ADAPTERS,
  selectAdapter,
} from '../src/conductor/routing';
import { dispatchGoalKind } from '../src/conductor/dispatch';
import type { GoalKind } from '../src/conductor/types';

describe('selectAdapter', () => {
  test('returns default adapter per kind', () => {
    for (const kind of ['research', 'coding', 'analysis', 'monitoring', 'refactor'] as const) {
      const a = selectAdapter(kind);
      expect(typeof a).toBe('function');
    }
  });

  test('override via deps.adapters takes precedence', async () => {
    const custom = async () => ({
      kind: 'research' as GoalKind,
      status: 'routed' as const,
      adapter: 'test-custom',
    });
    const a = selectAdapter('research', { adapters: { research: custom } });
    const r = await a({
      goalSlug: 'x',
      intake: { raw: '' },
      classify: {
        kind: 'research',
        confidence: 1,
        classifier: 'user-override',
        keywordHits: { research: 0, coding: 0, analysis: 0, monitoring: 0, refactor: 0 },
        scores: { research: 0, coding: 0, analysis: 0, monitoring: 0, refactor: 0 },
      },
    });
    expect(r.adapter).toBe('test-custom');
  });

  test('unknown kind throws (defensive; should be unreachable in normal flow)', () => {
    expect(() => selectAdapter('unknown' as any)).toThrow(/unknown goalKind/);
  });
});

describe('dispatchGoalKind — end-to-end per kind', () => {
  test('research intake → research adapter routed', async () => {
    const r = await dispatchGoalKind({
      goalSlug: 'q3-dram',
      intake: { raw: 'Q3 DRAM 벤더별 가격 전망 분석해줘. executive summary 포함.' },
    });
    expect(r.classify.kind).toBe('research');
    expect(r.adapter.status).toBe('routed');
    expect(r.adapter.adapter).toBe('research');
  });

  test('coding intake → coding adapter stub with pending tracks', async () => {
    const r = await dispatchGoalKind({
      goalSlug: 'slack-handler',
      intake: { raw: 'Slack webhook 받아서 push 하는 handler 를 구현해줘' },
    });
    expect(r.classify.kind).toBe('coding');
    expect(r.adapter.status).toBe('stub');
    expect(r.adapter.pendingTracks).toContain('TOX-2');
    expect(r.adapter.pendingTracks).toContain('AXON-P1');
  });

  test('analysis intake → analysis adapter stub with Skill hint', async () => {
    const r = await dispatchGoalKind({
      goalSlug: 'arch-decision',
      intake: { raw: 'mentor vs autonomous 중 어느 구조가 좋은지 평가 추천' },
    });
    expect(r.classify.kind).toBe('analysis');
    expect(r.adapter.status).toBe('stub');
    expect(r.adapter.pendingTracks).toContain('Skill');
    expect((r.adapter.extra as any)?.suggestedSkills).toContain('stochastic-multi-agent-consensus');
  });

  test('monitoring intake → monitoring adapter with workflow-synth hint (scheduler retirement R1)', async () => {
    const r = await dispatchGoalKind({
      goalSlug: 'dram-daily',
      intake: { raw: '매일 아침 9 시 DRAM 가격 체크하고 이상치면 alert' },
    });
    expect(r.classify.kind).toBe('monitoring');
    expect(r.adapter.pendingTracks).toContain('workflow-runtime');
    expect((r.adapter.extra as any)?.suggestedTool).toBe('workflow.synth_from_intent');
  });

  test('refactor intake → refactor adapter stub', async () => {
    const r = await dispatchGoalKind({
      goalSlug: 'dashboard-split',
      intake: { raw: 'src/dashboard.ts 를 리팩터 해서 5 개 파일로 분리' },
    });
    expect(r.classify.kind).toBe('refactor');
    expect(r.adapter.pendingTracks).toContain('TOX-2');
    expect((r.adapter.extra as any)?.baselineTestsRequired).toBe(true);
  });

  test('force_kind bypasses classifier', async () => {
    const r = await dispatchGoalKind({
      goalSlug: 'manual-override',
      intake: { raw: 'whatever' },
      force_kind: 'coding',
    });
    expect(r.classify.classifier).toBe('user-override');
    expect(r.classify.kind).toBe('coding');
    expect(r.adapter.adapter).toBe('coding-stub');
  });

  test('DEFAULT_ADAPTERS has entries for all 5 kinds', () => {
    const kinds: GoalKind[] = ['research', 'coding', 'analysis', 'monitoring', 'refactor'];
    for (const k of kinds) {
      expect(DEFAULT_ADAPTERS[k]).toBeDefined();
    }
  });
});
