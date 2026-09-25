// ── PFC-S2 T2: Conductor ↔ EnterAutoMode + ACTIVE.md integration ──

import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readActiveMd, renderActiveMd, writeActiveMd } from '../src/auto-research/active-md';
import {
  buildLoopPromptSnapshot,
  renderLoopPromptInjection,
  type LoopPromptContext,
} from '../src/auto-research/loop-prompt';
import { BudgetMeter } from '../src/auto-research/budget-meter';
import { ExperimentLedger } from '../src/auto-research/experiment-ledger';
import type { ObsidianVault } from '../src/auto-research/obsidian-bridge';
import { dispatchEnterAutoMode } from '../src/auto-research/auto-mode/tool-enter';
import { resetAutoModeForTest, getAutoModeState } from '../src/auto-research/auto-mode/session';

function scratch(): { vault: ObsidianVault; goalRoot: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cond-int-'));
  const goalRoot = join(dir, 'goals', 'sample');
  mkdirSync(join(goalRoot, 'knowledge'), { recursive: true });
  writeFileSync(join(goalRoot, 'ACTIVE.md'), '');
  writeFileSync(join(goalRoot, 'plan.md'), '# Plan');
  writeFileSync(join(goalRoot, 'budget.json'), JSON.stringify({ spec: {} }));
  return { vault: { root: dir, isSimulated: true, label: 't' }, goalRoot };
}

function scratchCtx(): LoopPromptContext {
  const { vault, goalRoot } = scratch();
  return {
    vault,
    goalSlug: 'sample',
    goalRoot,
    budget: new BudgetMeter({ tokens: 1000 }),
    ledger: new ExperimentLedger(goalRoot),
    termination: {
      kind: 'and',
      rules: [{ kind: 'all_questions_answered', queuePath: 'question-queue.md' }],
    },
  };
}

beforeEach(() => {
  resetAutoModeForTest();
});

describe('active-md.ts — read/write round-trip', () => {
  test('writeActiveMd + readActiveMd round-trip preserves fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'active-'));
    writeActiveMd(dir, {
      goalSlug: 'q3-dram',
      goalKind: 'research',
      intake: { raw: 'Q3 DRAM 전망 분석', channel: 'chat' },
      classifier: 'heuristic',
      confidence: 0.82,
      classifiedAt: 1700000000000,
      routedAdapter: 'research',
    });
    const r = readActiveMd(dir);
    expect(r).not.toBeNull();
    expect(r!.goalSlug).toBe('q3-dram');
    expect(r!.goalKind).toBe('research');
    expect(r!.intake.raw).toBe('Q3 DRAM 전망 분석');
    expect(r!.classifier).toBe('heuristic');
    expect(r!.routedAdapter).toBe('research');
  });

  test('readActiveMd returns null when file absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'active-none-'));
    expect(readActiveMd(dir)).toBeNull();
  });

  test('renderActiveMd includes body preview', () => {
    const out = renderActiveMd({
      goalSlug: 'x',
      goalKind: 'coding',
      intake: { raw: 'slack webhook handler 만들어줘' },
      classifier: 'heuristic',
      confidence: 0.75,
      classifiedAt: Date.now(),
      routedAdapter: 'coding-stub',
      pendingTracks: ['TOX-2', 'AXON-P1'],
    });
    expect(out).toContain('goalKind: coding');
    expect(out).toContain('routedAdapter: coding-stub');
    expect(out).toContain('pendingTracks:');
    expect(out).toContain('slack webhook handler');
  });
});

describe('loop-prompt — ## Goal Kind section', () => {
  test('no goalKindBlock → no section rendered', async () => {
    const ctx = scratchCtx();
    const snap = await buildLoopPromptSnapshot(ctx);
    const out = renderLoopPromptInjection(snap);
    expect(out.includes('## Goal Kind')).toBe(false);
  });

  test('goalKindBlock provided → section appears above Loop State', async () => {
    const ctx = scratchCtx();
    ctx.goalKindBlock = 'goalKind: **coding** (classifier: heuristic, confidence: 0.80)';
    const snap = await buildLoopPromptSnapshot(ctx);
    const out = renderLoopPromptInjection(snap);
    expect(out).toContain('## Goal Kind');
    expect(out).toContain('goalKind: **coding**');
    const kindIdx = out.indexOf('## Goal Kind');
    const loopIdx = out.indexOf('# Research Loop State');
    expect(kindIdx).toBeGreaterThanOrEqual(0);
    expect(kindIdx).toBeLessThan(loopIdx);
  });

  test('andon + goalKind both rendered → andon first, goalKind second', async () => {
    const ctx = scratchCtx();
    ctx.andonPreamble = '🔴 ANDON';
    ctx.goalKindBlock = 'goalKind: research';
    const snap = await buildLoopPromptSnapshot(ctx);
    const out = renderLoopPromptInjection(snap);
    const andonIdx = out.indexOf('## Andon');
    const kindIdx = out.indexOf('## Goal Kind');
    expect(andonIdx).toBeLessThan(kindIdx);
  });
});

describe('EnterAutoMode — PFC-S2 classification path', () => {
  test('intake provided → classifies + writes ACTIVE.md + goal_kind in result', async () => {
    const { vault, goalRoot: _gr } = scratch();
    // EnterAutoMode resolves path via resolveGoalPaths(vault, goalSlug); scratch()
    // already built goals/sample under vault.root — reuse that slug.
    const r = await dispatchEnterAutoMode(
      {
        goal_slug: 'sample',
        intake: 'Slack webhook 받아서 notification-store 에 push 하는 handler 구현해줘',
      },
      { vault },
    );
    expect(r.goal_kind).toBe('coding');
    expect(r.conductor?.classify.classifier).toBe('heuristic');
    expect(r.conductor?.adapter.adapter).toBe('coding-stub');
    // ACTIVE.md 이 재작성됐는지 확인.
    const goalPath = join(vault.root, 'goals', 'sample');
    const active = readActiveMd(goalPath);
    expect(active).not.toBeNull();
    expect(active!.goalKind).toBe('coding');
    // state 에도 기록.
    expect(getAutoModeState().goalKind).toBe('coding');
  });

  test('goal_kind override bypasses classifier', async () => {
    const { vault } = scratch();
    const r = await dispatchEnterAutoMode(
      {
        goal_slug: 'sample',
        intake: '분석해줘', // heuristic 은 research
        goal_kind: 'monitoring',
      },
      { vault },
    );
    expect(r.goal_kind).toBe('monitoring');
    expect(r.notices?.some((n) => n.includes('overridden'))).toBe(true);
  });

  test('no intake, no ACTIVE.md → defaults to research (backward compat)', async () => {
    const { vault } = scratch();
    const r = await dispatchEnterAutoMode({ goal_slug: 'sample' }, { vault });
    expect(r.goal_kind).toBe('research');
    expect(r.conductor).toBeUndefined();
  });

  test('existing ACTIVE.md restored on re-enter without intake', async () => {
    const { vault } = scratch();
    const goalPath = join(vault.root, 'goals', 'sample');
    writeActiveMd(goalPath, {
      goalSlug: 'sample',
      goalKind: 'analysis',
      intake: { raw: '어느 구조가 좋은지 평가' },
      classifier: 'heuristic',
      confidence: 0.7,
      classifiedAt: Date.now(),
      routedAdapter: 'analysis-stub',
    });
    resetAutoModeForTest();
    const r = await dispatchEnterAutoMode({ goal_slug: 'sample' }, { vault });
    expect(r.goal_kind).toBe('analysis');
    expect(r.loop_prompt).toContain('## Goal Kind');
    expect(r.loop_prompt).toContain('analysis');
  });

  test('loop_prompt contains goalKind block when classification ran', async () => {
    const { vault } = scratch();
    const r = await dispatchEnterAutoMode(
      {
        goal_slug: 'sample',
        intake: 'DRAM Q3 가격 전망 분석 + executive summary',
      },
      { vault },
    );
    expect(r.loop_prompt).toContain('## Goal Kind');
    expect(r.loop_prompt).toContain('research');
  });
});
