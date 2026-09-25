// W9 Z4 · approval showroom N-lane opinions + aggregation + endpoint.

import { describe, expect, test } from 'bun:test';
import {
  runApprovalShowroom,
  type ApprovalLaneInput,
} from '../../src/showroom/approval-showroom';
import {
  handleApprovalShowroom,
  parseApprovalShowroomPath,
} from '../../src/nexus/api/approval-showroom';
import type { ShowroomLaneCallable } from '../../src/task-orchestrator/surfaces/showroom-surface';

const LANES: ApprovalLaneInput[] = [
  { role: 'plan', model: 'm-plan' },
  { role: 'review', model: 'm-review' },
  { role: 'reflect', model: 'm-reflect' },
];

function fakeCallable(answers: Record<string, string>): ShowroomLaneCallable {
  return async (input) => {
    const direct = answers[input.role] ?? answers[input.model] ?? answers['*'];
    return { text: direct ?? 'neutral: no opinion\nconfidence: 0.5', modelId: input.model };
  };
}

describe('runApprovalShowroom', () => {
  test('parses stance + confidence + first non-empty rationale per lane', async () => {
    const cb = fakeCallable({
      plan: 'pro: ship now\nconfidence: 0.9',
      review: 'con: needs more tests\nconfidence: 0.7',
      reflect: 'neutral: split decision\nconfidence: 0.4',
    });
    const r = await runApprovalShowroom(
      { runId: 'r-1', workflowName: 'wf', approvalMessage: 'merge?', lanes: LANES },
      { laneCallable: cb, now: () => 999 },
    );
    expect(r.opinions.length).toBe(3);
    const byRole = Object.fromEntries(r.opinions.map((o) => [o.role, o]));
    expect(byRole.plan!.stance).toBe('pro');
    expect(byRole.plan!.confidence).toBeCloseTo(0.9);
    expect(byRole.plan!.rationale).toBe('pro: ship now');
    expect(byRole.review!.stance).toBe('con');
    expect(byRole.reflect!.stance).toBe('neutral');
    expect(r.createdAt).toBe(999);
  });

  test('aggregates pro vs con weighted by confidence', async () => {
    const cb = fakeCallable({
      plan: 'pro: ok\nconfidence: 0.9',
      review: 'pro: good\nconfidence: 0.8',
      reflect: 'con: risk\nconfidence: 0.5',
    });
    const r = await runApprovalShowroom(
      { runId: 'r', workflowName: 'wf', approvalMessage: 'm', lanes: LANES },
      { laneCallable: cb },
    );
    expect(r.recommendation).toBe('pro');
    expect(r.proConDelta).toBeCloseTo(1.2);
  });

  test('within ±0.2 → neutral recommendation', async () => {
    const cb = fakeCallable({
      plan: 'pro: \nconfidence: 0.5',
      review: 'con: \nconfidence: 0.4',
      reflect: 'neutral: \nconfidence: 0.5',
    });
    const r = await runApprovalShowroom(
      { runId: 'r', workflowName: 'wf', approvalMessage: 'm', lanes: LANES },
      { laneCallable: cb },
    );
    expect(r.recommendation).toBe('neutral');
  });

  test('lane error is dropped, not propagated', async () => {
    const cb: ShowroomLaneCallable = async (input) => {
      if (input.role === 'review') throw new Error('boom');
      return { text: 'pro: ok\nconfidence: 0.7' };
    };
    const r = await runApprovalShowroom(
      { runId: 'r', workflowName: 'wf', approvalMessage: 'm', lanes: LANES },
      { laneCallable: cb },
    );
    expect(r.opinions.length).toBe(2);
  });

  test('confidence > 1 is treated as percentage', async () => {
    const cb = fakeCallable({ '*': 'pro: high\nconfidence: 80' });
    const r = await runApprovalShowroom(
      { runId: 'r', workflowName: 'wf', approvalMessage: 'm', lanes: [LANES[0]!] },
      { laneCallable: cb },
    );
    expect(r.opinions[0]!.confidence).toBeCloseTo(0.8);
  });

  test('Korean stance tokens recognised', async () => {
    const cb = fakeCallable({ plan: '찬성: 진행\nconfidence: 0.8' });
    const r = await runApprovalShowroom(
      { runId: 'r', workflowName: 'wf', approvalMessage: 'm', lanes: [LANES[0]!] },
      { laneCallable: cb },
    );
    expect(r.opinions[0]!.stance).toBe('pro');
  });
});

describe('approval-showroom endpoint', () => {
  test('parseApprovalShowroomPath round-trip', () => {
    expect(parseApprovalShowroomPath('/v1/runs/run-1/approval-showroom')).toBe('run-1');
    expect(parseApprovalShowroomPath('/v1/runs/abc/xyz')).toBeNull();
  });

  test('GET returns the report when run is resolvable', async () => {
    const cb = fakeCallable({ '*': 'pro: ok\nconfidence: 0.7' });
    const res = await handleApprovalShowroom(
      new Request('http://localhost/v1/runs/r-1/approval-showroom'),
      'r-1',
      {
        resolveRun: async () => ({ workflowName: 'wf', approvalMessage: 'merge?' }),
        showroomDeps: { laneCallable: cb },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { recommendation: string; opinions: unknown[] };
    expect(body.recommendation).toBe('pro');
    expect(body.opinions.length).toBe(3);
  });

  test('GET → 404 when run not resolved', async () => {
    const res = await handleApprovalShowroom(
      new Request('http://localhost/v1/runs/r-x/approval-showroom'),
      'r-x',
      { resolveRun: async () => null, showroomDeps: { laneCallable: async () => ({ text: 'x' }) } },
    );
    expect(res.status).toBe(404);
  });

  test('non-GET → 405', async () => {
    const res = await handleApprovalShowroom(
      new Request('http://localhost/v1/runs/r/approval-showroom', { method: 'POST' }),
      'r',
      {
        resolveRun: async () => ({ workflowName: 'wf', approvalMessage: 'm' }),
        showroomDeps: { laneCallable: async () => ({ text: 'x' }) },
      },
    );
    expect(res.status).toBe(405);
  });

  test('checkAuth gate', async () => {
    const res = await handleApprovalShowroom(
      new Request('http://localhost/v1/runs/r/approval-showroom'),
      'r',
      {
        resolveRun: async () => ({ workflowName: 'wf', approvalMessage: 'm' }),
        showroomDeps: { laneCallable: async () => ({ text: 'x' }) },
        checkAuth: () => false,
      },
    );
    expect(res.status).toBe(401);
  });

  test('auditWriter is invoked with the report (best-effort)', async () => {
    const written: unknown[] = [];
    const cb = fakeCallable({ '*': 'pro: ok\nconfidence: 0.7' });
    await handleApprovalShowroom(
      new Request('http://localhost/v1/runs/r/approval-showroom'),
      'r',
      {
        resolveRun: async () => ({ workflowName: 'wf', approvalMessage: 'm' }),
        showroomDeps: { laneCallable: cb },
        auditWriter: { write: async (r) => { written.push(r); } },
      },
    );
    expect(written.length).toBe(1);
  });
});
