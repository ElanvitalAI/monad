// ── PFC-S2 T3: Conductor end-to-end scenarios ──
//
// 5 scenario × 1 kind each (PFC-CONDUCTOR-FIRST-DOGFOOD.md §6.1):
//   E1 research  · E2 coding · E3 analysis · E4 monitoring · E5 refactor
// Each exercises EnterAutoMode(intake, goal_slug) → classification →
// ACTIVE.md write → loop_prompt containing ## Goal Kind section.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchEnterAutoMode } from '../src/auto-research/auto-mode/tool-enter';
import { resetAutoModeForTest } from '../src/auto-research/auto-mode/session';
import { readActiveMd } from '../src/auto-research/active-md';
import type { ObsidianVault } from '../src/auto-research/obsidian-bridge';

function fresh(slug: string): { vault: ObsidianVault; goalRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), `e2e-${slug}-`));
  const goalRoot = join(dir, 'goals', slug);
  mkdirSync(join(goalRoot, 'knowledge'), { recursive: true });
  writeFileSync(join(goalRoot, 'ACTIVE.md'), '');
  writeFileSync(join(goalRoot, 'plan.md'), '# Plan');
  writeFileSync(join(goalRoot, 'budget.json'), JSON.stringify({ spec: {} }));
  return { vault: { root: dir, isSimulated: true, label: 't' }, goalRoot };
}

beforeEach(() => resetAutoModeForTest());
afterEach(() => resetAutoModeForTest());

describe('PFC-S2 E2E — 5 goalKind scenarios', () => {
  test('E1 research — DRAM forecast', async () => {
    const { vault, goalRoot } = fresh('sample');
    const r = await dispatchEnterAutoMode(
      {
        goal_slug: 'sample',
        intake: 'Q3 DRAM 벤더별 가격 전망 분석해줘. executive summary 포함.',
      },
      { vault },
    );
    expect(r.goal_kind).toBe('research');
    expect(r.conductor?.adapter.status).toBe('routed');
    const active = readActiveMd(goalRoot);
    expect(active?.routedAdapter).toBe('research');
    expect(r.loop_prompt).toContain('## Goal Kind');
  });

  test('E2 coding — Slack handler', async () => {
    const { vault, goalRoot } = fresh('sample');
    const r = await dispatchEnterAutoMode(
      {
        goal_slug: 'sample',
        intake: 'Slack webhook 받아서 notification-store 에 push 하는 handler 구현해줘',
      },
      { vault },
    );
    expect(r.goal_kind).toBe('coding');
    expect(r.conductor?.adapter.status).toBe('stub');
    expect(r.conductor?.adapter.pendingTracks).toContain('TOX-2');
    const active = readActiveMd(goalRoot);
    expect(active?.routedAdapter).toBe('coding-stub');
  });

  test('E3 analysis — architecture decision', async () => {
    const { vault, goalRoot } = fresh('sample');
    const r = await dispatchEnterAutoMode(
      {
        goal_slug: 'sample',
        intake: 'mentor vs autonomous vs fused 중 어느 구조가 좋은지 평가 + 추천',
      },
      { vault },
    );
    expect(r.goal_kind).toBe('analysis');
    expect(r.conductor?.adapter.adapter).toBe('analysis-stub');
    const active = readActiveMd(goalRoot);
    expect(active?.goalKind).toBe('analysis');
  });

  test('E4 monitoring — daily check', async () => {
    const { vault, goalRoot } = fresh('sample');
    const r = await dispatchEnterAutoMode(
      {
        goal_slug: 'sample',
        intake: '매일 아침 9 시 DRAM 가격 체크하고 변동 3% 이상이면 Telegram alert',
      },
      { vault },
    );
    expect(r.goal_kind).toBe('monitoring');
    // Scheduler-retirement R1: monitoring adapter now suggests workflow synth.
    expect((r.conductor?.adapter.extra as any)?.suggestedTool).toBe('workflow.synth_from_intent');
    const active = readActiveMd(goalRoot);
    expect(active?.routedAdapter).toBe('monitoring-stub');
  });

  test('E5 refactor — dashboard split', async () => {
    const { vault, goalRoot } = fresh('sample');
    const r = await dispatchEnterAutoMode(
      {
        goal_slug: 'sample',
        intake: 'src/dashboard.ts 를 리팩터 해서 5 개 파일로 분리',
      },
      { vault },
    );
    expect(r.goal_kind).toBe('refactor');
    expect((r.conductor?.adapter.extra as any)?.baselineTestsRequired).toBe(true);
    const active = readActiveMd(goalRoot);
    expect(active?.goalKind).toBe('refactor');
  });
});

describe('PFC-S2 E2E — classify tool works without EnterAutoMode', () => {
  test('dispatchClassifyGoal standalone', async () => {
    const { dispatchClassifyGoal } = await import('../src/conductor/tools/classify-goal');
    const r = await dispatchClassifyGoal({
      intake: '매주 월요일 이슈 리뷰 자동 리스트',
    });
    expect(r.kind).toBe('monitoring');
    expect(r.routed_adapter).toBe('monitoring-stub');
  });
});
