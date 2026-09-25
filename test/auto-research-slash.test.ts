// ── PFC-S4 P6: /research slash resolver ──

import { describe, test, expect } from 'bun:test';
import { resolveResearchSlash } from '../src/auto-research/slash';

describe('PFC-S4 P6 — /research slash resolver', () => {
  test('start produces 3-command chain', () => {
    const out = resolveResearchSlash({
      action: 'start',
      goal_slug: 'samsung-2026',
      mission: 'Samsung attractiveness',
      budget: { tokens: 500_000, usd: 3 },
      max_turns: 10,
    });
    expect(out.kind).toBe('dispatch');
    expect(out.commands?.length).toBe(3);
    expect(out.commands?.[0]?.tool).toBe('research_plan');
    expect((out.commands?.[0]?.input as any).action).toBe('init');
    expect(out.commands?.[1]?.tool).toBe('budget');
    expect(out.commands?.[2]?.tool).toBe('enter_auto_mode');
    expect((out.commands?.[2]?.input as any).max_turns).toBe(10);
  });

  test('start without mission returns error', () => {
    const out = resolveResearchSlash({
      action: 'start',
      goal_slug: 's',
    });
    expect(out.kind).toBe('error');
    expect(out.message).toContain('mission is required');
  });

  test('start without goal_slug returns error', () => {
    const out = resolveResearchSlash({
      action: 'start',
      mission: 'x',
    });
    expect(out.kind).toBe('error');
    expect(out.message).toContain('goal_slug is required');
  });

  test('status produces read+budget+termination chain', () => {
    const out = resolveResearchSlash({
      action: 'status',
      goal_slug: 's',
    });
    expect(out.kind).toBe('dispatch');
    expect(out.commands?.map(c => c.tool)).toEqual([
      'research_plan',
      'budget',
      'termination_check',
    ]);
  });

  test('stop single exit_auto_mode command', () => {
    const out = resolveResearchSlash({
      action: 'stop',
      summary: 'final',
      reason: 'termination_met',
    });
    expect(out.commands?.length).toBe(1);
    expect(out.commands?.[0]?.tool).toBe('exit_auto_mode');
    expect((out.commands?.[0]?.input as any).reason).toBe('termination_met');
    expect((out.commands?.[0]?.input as any).summary).toBe('final');
  });

  test('stop without summary/reason defaults to manual', () => {
    const out = resolveResearchSlash({ action: 'stop' });
    expect((out.commands?.[0]?.input as any).reason).toBe('manual');
    expect((out.commands?.[0]?.input as any).summary).toBeUndefined();
  });

  test('tail single research_plan read', () => {
    const out = resolveResearchSlash({ action: 'tail', goal_slug: 's' });
    expect(out.commands?.length).toBe(1);
    expect(out.commands?.[0]?.tool).toBe('research_plan');
    expect((out.commands?.[0]?.input as any).action).toBe('read');
  });

  test('tail without goal_slug returns error', () => {
    const out = resolveResearchSlash({ action: 'tail' });
    expect(out.kind).toBe('error');
  });

  test('replan with plan updates plan.md', () => {
    const out = resolveResearchSlash({
      action: 'replan',
      goal_slug: 's',
      plan: '# new plan\n\nstep 1',
    });
    expect(out.commands?.[0]?.tool).toBe('research_plan');
    expect((out.commands?.[0]?.input as any).action).toBe('update_plan');
    expect((out.commands?.[0]?.input as any).plan).toContain('step 1');
  });

  test('replan without plan returns error', () => {
    const out = resolveResearchSlash({
      action: 'replan',
      goal_slug: 's',
    });
    expect(out.kind).toBe('error');
    expect(out.message).toContain('plan body is required');
  });

  test('unknown action returns error', () => {
    const out = resolveResearchSlash({ action: 'xxx' as any });
    expect(out.kind).toBe('error');
    expect(out.message).toContain('unknown action');
  });

  test('start with termination propagates override to enter', () => {
    const out = resolveResearchSlash({
      action: 'start',
      goal_slug: 's',
      mission: 'm',
      termination: {
        kind: 'summary_written',
        path: 'executive-summary.md',
        minChars: 200,
      },
    });
    const enter = out.commands?.[2];
    expect((enter?.input as any).termination_override).toBeDefined();
  });

  test('start message includes max_turns default when omitted', () => {
    const out = resolveResearchSlash({
      action: 'start',
      goal_slug: 's',
      mission: 'm',
    });
    expect(out.message).toContain('20 turns');
  });
});
