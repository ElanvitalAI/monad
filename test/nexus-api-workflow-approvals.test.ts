// Archon-port follow-up §5.1 (2026-05-08) — approval registry +
// REST handlers.

import { afterEach, describe, expect, it } from 'bun:test';
import {
  _resetApprovalsForTest,
  listPendingApprovals,
  registerApproval,
  rejectApproval,
  resolveApproval,
  setApprovalListener,
  setApprovalResolvedListener,
} from '../src/nexus/api/workflow-approvals.js';
import {
  handleWorkflowApprovalApprove,
  handleWorkflowApprovalReject,
  handleWorkflowApprovalsPending,
} from '../src/nexus/api/workflows.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';

const opts: MetaApiOpts = { noAuth: true };

afterEach(() => {
  _resetApprovalsForTest();
});

const reqGet = (path: string): Request =>
  new Request(`http://localhost${path}`, {
    method: 'GET',
    headers: { 'sec-fetch-site': 'same-origin' },
  });

const reqPost = (path: string, body?: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

describe('approval registry — registerApproval + resolve', () => {
  it('blocks until resolveApproval fires + delivers the response body', async () => {
    const promise = registerApproval('wf-001', 'Continue?');
    expect(listPendingApprovals()).toHaveLength(1);

    queueMicrotask(() => resolveApproval('wf-001', 'looks good'));
    const response = await promise;
    expect(response).toBe('looks good');
    expect(listPendingApprovals()).toHaveLength(0);
  });

  it('returns undefined when resolve has no body', async () => {
    const promise = registerApproval('wf-002', 'OK?');
    queueMicrotask(() => resolveApproval('wf-002', undefined));
    expect(await promise).toBeUndefined();
  });

  it('rejectApproval throws inside the executor', async () => {
    const promise = registerApproval('wf-003', 'Risk?');
    queueMicrotask(() => rejectApproval('wf-003', 'aborted by user'));
    await expect(promise).rejects.toThrow(/aborted by user/);
  });

  it('resolveApproval returns false when no entry exists', () => {
    expect(resolveApproval('not-pending', 'whatever')).toBe(false);
  });

  it('superseding the same runId rejects the older Promise', async () => {
    const first = registerApproval('wf-004', 'first');
    // Second call with the same runId should reject the first Promise.
    const second = registerApproval('wf-004', 'second');
    await expect(first).rejects.toThrow(/superseded/);
    queueMicrotask(() => resolveApproval('wf-004', 'final'));
    expect(await second).toBe('final');
  });

  it('listeners observe request + resolve', async () => {
    const requested: string[] = [];
    const resolved: Array<{ runId: string; decision: string }> = [];
    setApprovalListener((s) => requested.push(s.runId));
    setApprovalResolvedListener((runId, decision) => resolved.push({ runId, decision }));

    const p1 = registerApproval('wf-005', 'A?');
    const p2 = registerApproval('wf-006', 'B?');
    queueMicrotask(() => {
      resolveApproval('wf-005', 'yes');
      rejectApproval('wf-006', 'no');
    });
    await Promise.allSettled([p1, p2]);

    expect(requested).toEqual(['wf-005', 'wf-006']);
    expect(resolved).toEqual([
      { runId: 'wf-005', decision: 'approved' },
      { runId: 'wf-006', decision: 'rejected' },
    ]);
  });
});

describe('REST — GET /v1/workflows/runs/pending', () => {
  it('returns empty list when no approvals pending', async () => {
    const res = handleWorkflowApprovalsPending(reqGet('/v1/workflows/runs/pending'), opts);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: [] });
  });

  it('lists pending entries with runId + message + requestedAt', async () => {
    const promise = registerApproval('wf-007', 'Approve to deploy');
    const res = handleWorkflowApprovalsPending(reqGet('/v1/workflows/runs/pending'), opts);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: Array<{ runId: string; message: string; requestedAt: number }> };
    expect(body.pending).toHaveLength(1);
    expect(body.pending[0]?.runId).toBe('wf-007');
    expect(body.pending[0]?.message).toBe('Approve to deploy');
    expect(typeof body.pending[0]?.requestedAt).toBe('number');
    // Cleanup
    queueMicrotask(() => resolveApproval('wf-007', undefined));
    await promise;
  });
});

describe('REST — POST /v1/workflows/runs/:runId/approve', () => {
  it('resolves the deferred Promise + returns 200', async () => {
    const promise = registerApproval('wf-008', 'Continue?');
    const res = await handleWorkflowApprovalApprove(
      reqPost('/v1/workflows/runs/wf-008/approve', { response: 'all good' }),
      'wf-008',
      opts,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; runId: string; decision: string };
    expect(body.ok).toBe(true);
    expect(body.runId).toBe('wf-008');
    expect(body.decision).toBe('approved');
    expect(await promise).toBe('all good');
  });

  it('approve without a response body resolves with undefined', async () => {
    const promise = registerApproval('wf-009', 'OK?');
    await handleWorkflowApprovalApprove(
      reqPost('/v1/workflows/runs/wf-009/approve'),
      'wf-009',
      opts,
    );
    expect(await promise).toBeUndefined();
  });

  it('returns 404 when there is no pending approval for the runId', async () => {
    const res = await handleWorkflowApprovalApprove(
      reqPost('/v1/workflows/runs/no-such-run/approve'),
      'no-such-run',
      opts,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_pending');
  });
});

describe('REST — POST /v1/workflows/runs/:runId/reject', () => {
  it('rejects the deferred Promise with the supplied reason', async () => {
    const promise = registerApproval('wf-010', 'Risky');
    const res = await handleWorkflowApprovalReject(
      reqPost('/v1/workflows/runs/wf-010/reject', { reason: 'too risky' }),
      'wf-010',
      opts,
    );
    expect(res.status).toBe(200);
    await expect(promise).rejects.toThrow(/too risky/);
  });

  it('returns 404 when no pending approval matches the runId', async () => {
    const res = await handleWorkflowApprovalReject(
      reqPost('/v1/workflows/runs/no-such/reject'),
      'no-such',
      opts,
    );
    expect(res.status).toBe(404);
  });
});
