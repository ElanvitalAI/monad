// ── PFC-S2 T3: ClassifyGoal LLM tool ──

import { describe, expect, test } from 'bun:test';
import {
  buildClassifyGoalTool,
  dispatchClassifyGoal,
} from '../src/conductor/tools/classify-goal';

describe('ClassifyGoal tool', () => {
  test('spec shape — required intake + enum constraints', () => {
    const spec = buildClassifyGoalTool();
    expect(spec.name).toBe('ClassifyGoal');
    expect(spec.parameters.required).toEqual(['intake']);
    expect(spec.parameters.properties.force_kind.enum).toEqual([
      'research', 'coding', 'analysis', 'monitoring', 'refactor',
    ]);
  });

  test('happy path — research classification', async () => {
    const r = await dispatchClassifyGoal({
      intake: 'DRAM Q3 시장 전망 분석해서 executive summary',
    });
    expect(r.kind).toBe('research');
    expect(r.classifier).toBe('heuristic');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.routed_adapter).toBe('research');
    expect(r.output).toContain('research');
  });

  test('coding intake → stub adapter with pending tracks', async () => {
    const r = await dispatchClassifyGoal({
      intake: 'Slack webhook 받아서 push 하는 handler 구현해줘',
    });
    expect(r.kind).toBe('coding');
    expect(r.routed_adapter).toBe('coding-stub');
    expect(r.pending_tracks).toContain('TOX-2');
    expect(r.hint).toBeDefined();
  });

  test('force_kind override', async () => {
    const r = await dispatchClassifyGoal({
      intake: 'whatever',
      force_kind: 'monitoring',
    });
    expect(r.kind).toBe('monitoring');
    expect(r.classifier).toBe('user-override');
    expect(r.confidence).toBe(1);
  });

  test('empty intake throws', async () => {
    await expect(
      dispatchClassifyGoal({ intake: '' }),
    ).rejects.toThrow(/intake is required/);
  });

  test('whitespace-only intake throws', async () => {
    await expect(
      dispatchClassifyGoal({ intake: '   ' }),
    ).rejects.toThrow();
  });

  test('low-signal intake → fallback with notices', async () => {
    const r = await dispatchClassifyGoal({
      intake: '음 그거',
    });
    expect(r.classifier).toBe('fallback');
    expect(r.notices).toBeDefined();
    expect(r.notices!.length).toBeGreaterThan(0);
  });

  test('channel + priority fields preserved (informational)', async () => {
    // Doesn't affect classification but survives the dispatch;
    // ensures schema accepts extra metadata without rejection.
    const r = await dispatchClassifyGoal({
      intake: '매일 아침 9 시 체크 cron 등록',
      channel: 'scheduler',
      priority: 'normal',
    });
    expect(r.kind).toBe('monitoring');
  });
});
