// Surface-unification ROADMAP §B1 (2026-05-11) — schema tests for the
// optional Schedule trigger fields (timezone · jitter_seconds · max_runs
// · enabled). v1 = author-facing; daemon-side cron-source migration
// picks them up in a follow-up. The schema must accept them while
// catching obviously-wrong shapes.

import { describe, expect, it } from 'bun:test';
import { validateWorkflow } from '../src/workflow-runtime/schema';

function base() {
  return {
    name: 'sched-extras',
    description: 'Schedule trigger schema extras smoke',
    version: 1,
    nodes: [
      {
        id: 'tick',
        scheduleTrigger: {
          type: 'cron',
          cron: '0 9 * * *',
        },
      },
    ],
  };
}

describe('ScheduleTriggerNode optional fields', () => {
  it('accepts a minimal cron trigger (no extras)', () => {
    const r = validateWorkflow(base());
    expect(r.ok).toBe(true);
  });

  it('accepts timezone as an IANA string', () => {
    const def = base();
    (def.nodes[0].scheduleTrigger as Record<string, unknown>)['timezone'] = 'Asia/Seoul';
    expect(validateWorkflow(def).ok).toBe(true);
  });

  it('rejects timezone that is not a string', () => {
    const def = base();
    (def.nodes[0].scheduleTrigger as Record<string, unknown>)['timezone'] = 9;
    const r = validateWorkflow(def);
    expect(r.ok).toBe(false);
    expect(r.issues.some((e: { path: string }) => e.path.includes('timezone'))).toBe(true);
  });

  it('accepts jitter_seconds = 0 and positive numbers', () => {
    for (const v of [0, 5, 60]) {
      const def = base();
      (def.nodes[0].scheduleTrigger as Record<string, unknown>)['jitter_seconds'] = v;
      expect(validateWorkflow(def).ok).toBe(true);
    }
  });

  it('rejects negative jitter_seconds', () => {
    const def = base();
    (def.nodes[0].scheduleTrigger as Record<string, unknown>)['jitter_seconds'] = -1;
    const r = validateWorkflow(def);
    expect(r.ok).toBe(false);
    expect(r.issues.some((e: { path: string }) => e.path.includes('jitter_seconds'))).toBe(true);
  });

  it('rejects max_runs that is not a positive integer', () => {
    for (const v of [0, -1, 1.5, 'unlimited']) {
      const def = base();
      (def.nodes[0].scheduleTrigger as Record<string, unknown>)['max_runs'] = v;
      const r = validateWorkflow(def);
      expect(r.ok).toBe(false);
    }
  });

  it('accepts max_runs as a positive integer', () => {
    const def = base();
    (def.nodes[0].scheduleTrigger as Record<string, unknown>)['max_runs'] = 30;
    expect(validateWorkflow(def).ok).toBe(true);
  });

  it('accepts enabled as boolean and rejects non-boolean', () => {
    const def1 = base();
    (def1.nodes[0].scheduleTrigger as Record<string, unknown>)['enabled'] = false;
    expect(validateWorkflow(def1).ok).toBe(true);

    const def2 = base();
    (def2.nodes[0].scheduleTrigger as Record<string, unknown>)['enabled'] = 'no';
    const r = validateWorkflow(def2);
    expect(r.ok).toBe(false);
    expect(r.issues.some((e: { path: string }) => e.path.includes('enabled'))).toBe(true);
  });
});
