// ROADMAP Tier 2 W4 (2026-05-11) — pure helper unit tests for the
// last-run status overlay. Mirrors the W3 split (mutations + layout)
// where the React surface stays a thin shell over testable functions.

import { describe, expect, it } from 'bun:test';
import type { WorkflowRunEvent, WorkflowRunSummary } from '@/nexus/client';
import {
  DELIVERY_ICON,
  extractNodeStatuses,
  getDeliveryIcon,
  pickLatestRun,
  STATUS_TONE,
  type NodeRunStatus,
} from './run-status-helpers';

function ev(partial: Partial<WorkflowRunEvent> & { type: string }): WorkflowRunEvent {
  return partial as WorkflowRunEvent;
}

describe('extractNodeStatuses', () => {
  it('returns empty map for empty events', () => {
    expect(extractNodeStatuses([])).toEqual({});
  });

  it('ignores events without a nodeId', () => {
    const events = [
      ev({ type: 'workflow_start' }),
      ev({ type: 'workflow_done', outputs: {} as never }),
    ];
    expect(extractNodeStatuses(events)).toEqual({});
  });

  it('marks node_start as running', () => {
    const out = extractNodeStatuses([ev({ type: 'node_start', nodeId: 'a' })]);
    expect(out.a).toEqual({ status: 'running' });
  });

  it('marks node_done with ok=true as done + durationMs', () => {
    const out = extractNodeStatuses([
      ev({ type: 'node_start', nodeId: 'a' }),
      ev({
        type: 'node_done',
        nodeId: 'a',
        result: { ok: true, output: 'hi', durationMs: 142 },
      }),
    ]);
    expect(out.a).toEqual({ status: 'done', durationMs: 142 });
  });

  it('marks node_done with ok=false as failed + error', () => {
    const out = extractNodeStatuses([
      ev({
        type: 'node_done',
        nodeId: 'b',
        result: { ok: false, output: null, error: 'boom', durationMs: 5 },
      }),
    ]);
    expect(out.b).toEqual({ status: 'failed', durationMs: 5, error: 'boom' });
  });

  it('marks node_skipped with reason', () => {
    const out = extractNodeStatuses([
      ev({ type: 'node_skipped', nodeId: 'c', reason: 'when=false' }),
    ]);
    expect(out.c).toEqual({ status: 'skipped', reason: 'when=false' });
  });

  it('terminal node_done overrides earlier node_start', () => {
    const out = extractNodeStatuses([
      ev({ type: 'node_start', nodeId: 'a' }),
      ev({
        type: 'node_done',
        nodeId: 'a',
        result: { ok: true, output: 1, durationMs: 10 },
      }),
    ]);
    expect(out.a.status).toBe('done');
  });

  it('handles multiple nodes independently', () => {
    const out = extractNodeStatuses([
      ev({ type: 'node_start', nodeId: 'a' }),
      ev({
        type: 'node_done',
        nodeId: 'a',
        result: { ok: true, output: 0, durationMs: 1 },
      }),
      ev({ type: 'node_start', nodeId: 'b' }),
      ev({
        type: 'node_done',
        nodeId: 'b',
        result: { ok: false, output: null, error: 'x', durationMs: 2 },
      }),
      ev({ type: 'node_skipped', nodeId: 'c', reason: 'unmet dep' }),
    ]);
    expect(out.a.status).toBe('done');
    expect(out.b.status).toBe('failed');
    expect(out.c.status).toBe('skipped');
  });

  it('keeps running when no terminal frame arrives (in-flight)', () => {
    const out = extractNodeStatuses([
      ev({ type: 'node_start', nodeId: 'a' }),
      ev({ type: 'node_start', nodeId: 'b' }),
    ]);
    expect(out.a.status).toBe('running');
    expect(out.b.status).toBe('running');
  });

  // Surface-unification §D1 (2026-05-11) — approval frames map to amber.
  it('marks approval_pending node as awaiting_approval', () => {
    const events = [
      ev({ type: 'node_start', nodeId: 'gate' }),
      ev({ type: 'approval_pending', nodeId: 'gate' }),
    ];
    expect(extractNodeStatuses(events)['gate']).toEqual({ status: 'awaiting_approval' });
  });

  it('approval_resolved clears the awaiting halo until next node_done', () => {
    const events = [
      ev({ type: 'approval_pending', nodeId: 'gate' }),
      ev({ type: 'approval_resolved', nodeId: 'gate' }),
    ];
    expect(extractNodeStatuses(events)['gate']).toBeUndefined();
  });

  it('node_done after approval_pending wins (terminal frame overrides)', () => {
    const events = [
      ev({ type: 'approval_pending', nodeId: 'gate' }),
      ev({ type: 'node_done', nodeId: 'gate', result: { ok: true, output: '', durationMs: 5 } }),
    ];
    expect(extractNodeStatuses(events)['gate']).toEqual({ status: 'done', durationMs: 5 });
  });

  it('node_done with missing result falls back to failed without error', () => {
    const out = extractNodeStatuses([
      ev({ type: 'node_done', nodeId: 'a' }),
    ]);
    expect(out.a.status).toBe('failed');
    expect(out.a.error).toBeUndefined();
  });
});

describe('pickLatestRun', () => {
  function summary(o: Partial<WorkflowRunSummary>): WorkflowRunSummary {
    return {
      runId: o.runId ?? 'r',
      workflowName: o.workflowName ?? 'wf',
      startedAt: o.startedAt ?? 0,
      status: o.status ?? 'done',
      ...o,
    } as WorkflowRunSummary;
  }

  it('returns null for empty list', () => {
    expect(pickLatestRun([], 'wf')).toBeNull();
  });

  it('returns null when no run matches name', () => {
    expect(
      pickLatestRun([summary({ workflowName: 'other' })], 'wf'),
    ).toBeNull();
  });

  it('returns single match', () => {
    const r = summary({ workflowName: 'wf', runId: 'r1', startedAt: 100 });
    expect(pickLatestRun([r], 'wf')?.runId).toBe('r1');
  });

  it('returns latest by startedAt across multiple matches', () => {
    const r1 = summary({ workflowName: 'wf', runId: 'r1', startedAt: 100 });
    const r2 = summary({ workflowName: 'wf', runId: 'r2', startedAt: 300 });
    const r3 = summary({ workflowName: 'wf', runId: 'r3', startedAt: 200 });
    expect(pickLatestRun([r1, r2, r3], 'wf')?.runId).toBe('r2');
  });

  it('filters non-matching names while picking', () => {
    const r1 = summary({ workflowName: 'wf', runId: 'r1', startedAt: 100 });
    const r2 = summary({ workflowName: 'other', runId: 'r2', startedAt: 999 });
    expect(pickLatestRun([r1, r2], 'wf')?.runId).toBe('r1');
  });
});

describe('STATUS_TONE', () => {
  it('has an entry for every NodeRunStatus', () => {
    const statuses: NodeRunStatus[] = ['running', 'done', 'failed', 'skipped', 'awaiting_approval'];
    for (const s of statuses) {
      expect(STATUS_TONE[s].dot).toMatch(/^#[0-9a-f]{6}$/i);
      expect(STATUS_TONE[s].label.length).toBeGreaterThan(0);
    }
  });
});

describe('DELIVERY_ICON / getDeliveryIcon', () => {
  it('returns null for undefined', () => {
    expect(getDeliveryIcon(undefined)).toBeNull();
  });

  it('returns null for unknown channel', () => {
    expect(getDeliveryIcon('weird-channel')).toBeNull();
  });

  it('returns icon for each known channel', () => {
    const known = ['all', 'modal', 'terminal', 'telegram', 'discord', 'pushcut'];
    for (const k of known) {
      expect(getDeliveryIcon(k)).toBe(DELIVERY_ICON[k]);
    }
  });
});
