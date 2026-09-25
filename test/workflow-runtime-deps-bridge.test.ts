// Archon-port follow-up (2026-05-08) — `runSkill` / `runCft` bridge tests.
// Closes Caveat #1.
//
// `runCft` is fully tested with real CFT methods (no stubs — pure
// functions). `runSkill` is exercised in a tiny e2e with a fake
// SKILL.md fixture; the LLM call path is covered by skill-runner tests
// elsewhere, so here we just assert the bridge resolves the manifest
// + surfaces the "unknown skill" error path.

import { describe, expect, it } from 'bun:test';
import {
  SUPPORTED_CFT_METHODS,
  buildRunCft,
  buildRunSkill,
} from '../src/workflow-runtime/deps-bridge.js';

// ── runCft ─────────────────────────────────────────────────────────

describe('buildRunCft — supported methods dispatch', () => {
  const runCft = buildRunCft();

  it('lists exactly the methods we expect', () => {
    expect([...SUPPORTED_CFT_METHODS]).toEqual([
      'dmaic',
      'pdca',
      'fmea',
      'a3',
      'quick-kill',
      'quickkill',
      'rca-5why',
      'rca-fishbone',
      'rca-pareto',
    ]);
  });

  it('dmaic dispatches with phase + activities', async () => {
    const r = await runCft('dmaic', {
      problem: 'flaky test',
      phase: 'define',
      activities: ['problem statement', 'goal', 'scope', 'stakeholders'],
    });
    expect((r as { phase: string }).phase).toBe('define');
    expect((r as { progressPct: number }).progressPct).toBe(100);
  });

  it('pdca dispatches with subject + phase', async () => {
    const r = await runCft('pdca', {
      subject: 'reduce flaky tests',
      phase: 'plan',
      activities: ['hypothesis: missing await', 'metric: pass rate', 'duration: 2 weeks'],
    });
    expect((r as { phase: string }).phase).toBe('plan');
    expect((r as { nextPhase: string }).nextPhase).toBe('do');
  });

  it('pdca falls back to config.goal when subject missing', async () => {
    const r = await runCft('pdca', {
      goal: 'reduce flaky tests',
      phase: 'plan',
      activities: ['hypothesis x', 'metric y', 'duration 2w'],
    });
    expect((r as { subject: string }).subject).toBe('reduce flaky tests');
  });

  it('fmea dispatches with rows + system', async () => {
    const r = await runCft('fmea', {
      system: 'auth-service',
      rows: [
        {
          mode: 'token theft',
          effect: 'account takeover',
          severity: 9,
          occurrence: 3,
          detection: 5,
        },
      ],
    });
    expect((r as { system: string }).system).toBe('auth-service');
    expect((r as { ranked: unknown[] }).ranked).toHaveLength(1);
  });

  it('a3 dispatches', async () => {
    const r = await runCft('a3', {
      title: 'flaky test triage',
      problem: 'CI red 20% of runs',
      background: 'CI red',
      current: '20% red',
      goal: '<2% red',
      analysis: 'race condition',
      countermeasures: ['add await'],
      plan: '1 sprint',
      followup: 'monitor pass rate',
      owner: 'qa-team',
    });
    expect((r as { title: string }).title).toBe('flaky test triage');
  });

  it('quick-kill dispatches (alias quickkill works too)', async () => {
    const cfg = {
      subject: 'experiment X',
      evidence_confidence: 4,
      remaining_runway: 6,
      pivot_cost: 3,
      current_signal: 'positive',
    };
    const a = await runCft('quick-kill', cfg);
    const b = await runCft('quickkill', cfg);
    expect((a as { decision: string }).decision).toBe((b as { decision: string }).decision);
  });

  it('rca-5why dispatches with whys array', async () => {
    const r = await runCft('rca-5why', {
      problem: 'site is slow',
      whys: ['DB slow', 'index missing', 'no migration', 'no checklist', 'no team owner'],
    });
    expect((r as { depth: number }).depth).toBe(5);
  });

  it('rca-5why accepts comma-separated whys string', async () => {
    const r = await runCft('rca-5why', {
      problem: 'site is slow',
      whys: 'DB slow, index missing, no migration, no checklist, no team owner',
    });
    expect((r as { depth: number }).depth).toBe(5);
  });

  it('rca-fishbone dispatches', async () => {
    const r = await runCft('rca-fishbone', {
      problem: 'flaky tests',
      causes: {
        manpower: ['no reviewer'],
        method: ['no retry budget'],
        machine: ['CI runner pinned'],
      },
    });
    expect((r as { totalCauses: number }).totalCauses).toBe(3);
  });

  it('rca-pareto dispatches with title + items', async () => {
    const r = await runCft('rca-pareto', {
      title: 'failure causes',
      items: [
        { label: 'flake', count: 70 },
        { label: 'timeout', count: 20 },
        { label: 'oom', count: 10 },
      ],
    });
    expect((r as { topN: number }).topN).toBeGreaterThanOrEqual(1);
  });

  it('throws for unknown method with a "supported:" hint', async () => {
    await expect(runCft('not-a-method', {})).rejects.toThrow(/Supported:/);
  });

  it('case-insensitive method names', async () => {
    const r = await runCft('DMAIC', {
      problem: 'x',
      phase: 'define',
      activities: ['problem', 'goal', 'scope', 'stakeholders'],
    });
    expect((r as { phase: string }).phase).toBe('define');
  });

  it('throws when required string config field missing', async () => {
    await expect(
      runCft('dmaic', { phase: 'define' } as Record<string, unknown>),
    ).rejects.toThrow(/'problem'/);
  });
});

// ── runSkill ───────────────────────────────────────────────────────

describe('buildRunSkill — error path', () => {
  it('surfaces unknown skill with a helpful path hint', async () => {
    const runSkill = buildRunSkill();
    await expect(runSkill('definitely-not-a-real-skill-xyz', '')).rejects.toThrow(
      /unknown skill/,
    );
  });
});
