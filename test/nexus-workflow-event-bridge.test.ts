// BACKLOG #9 / HANDOFF §4.2 — verify the workflow-approval ↔
// NexusEventBus bridge fans the right kinds when registerApproval /
// resolveApproval / rejectApproval fire.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { wireWorkflowApprovalEvents } from '../src/nexus/api/workflow-event-bridge.js';
import {
  registerApproval,
  resolveApproval,
  rejectApproval,
  setApprovalListener,
  setApprovalResolvedListener,
} from '../src/nexus/api/workflow-approvals.js';
import type { NexusEvent } from '../src/nexus/state/state.js';

let bus: NexusEventBus;
let teardown: (() => void) | undefined;

beforeEach(() => {
  bus = new NexusEventBus();
  teardown = wireWorkflowApprovalEvents(bus);
});

afterEach(() => {
  teardown?.();
  // Defensive — `wireWorkflowApprovalEvents`'s teardown nulls these,
  // but if a test installed its own listener, this restores baseline.
  setApprovalListener(null);
  setApprovalResolvedListener(null);
});

function collect(prefix: string): NexusEvent[] {
  const out: NexusEvent[] = [];
  bus.subscribe((ev) => out.push(ev), [prefix]);
  return out;
}

describe('wireWorkflowApprovalEvents (BACKLOG #9)', () => {
  it('publishes workflow.approval.pending when an approval is registered', async () => {
    const events = collect('workflow.');
    // Don't await — registerApproval blocks until /approve | /reject
    // resolves the deferred Promise. We just need the listener to fire.
    const promise = registerApproval('run-001', 'Please review changes');
    // Resolve so the test doesn't leak a dangling Promise.
    resolveApproval('run-001', 'OK');
    await promise;

    const pending = events.filter((e) => e.kind === 'workflow.approval.pending');
    expect(pending.length).toBe(1);
    expect(pending[0]!.detail).toMatchObject({
      runId: 'run-001',
      message: 'Please review changes',
    });
    expect(typeof (pending[0]!.detail as { requestedAt: number }).requestedAt).toBe('number');
  });

  it('publishes workflow.approval.resolved with decision=approved + response on POST /approve', async () => {
    const events = collect('workflow.');
    const promise = registerApproval('run-002', 'Ship it?');
    resolveApproval('run-002', 'LGTM');
    await promise;

    const resolved = events.filter((e) => e.kind === 'workflow.approval.resolved');
    expect(resolved.length).toBe(1);
    expect(resolved[0]!.detail).toMatchObject({
      runId: 'run-002',
      decision: 'approved',
      response: 'LGTM',
    });
  });

  it('publishes workflow.approval.resolved with decision=rejected on POST /reject', async () => {
    const events = collect('workflow.');
    const promise = registerApproval('run-003', 'Deploy?');
    rejectApproval('run-003', 'wrong env');

    await expect(promise).rejects.toThrow();

    const resolved = events.filter((e) => e.kind === 'workflow.approval.resolved');
    expect(resolved.length).toBe(1);
    expect(resolved[0]!.detail).toMatchObject({
      runId: 'run-003',
      decision: 'rejected',
    });
  });

  it('omits response field when /approve had no body', async () => {
    const events = collect('workflow.');
    const promise = registerApproval('run-004', 'continue?');
    resolveApproval('run-004', undefined);
    await promise;

    const resolved = events.filter((e) => e.kind === 'workflow.approval.resolved');
    expect(resolved.length).toBe(1);
    const detail = resolved[0]!.detail as Record<string, unknown>;
    expect(detail.runId).toBe('run-004');
    expect(detail.decision).toBe('approved');
    expect('response' in detail).toBe(false);
  });

  it('teardown detaches listeners — bus stops receiving after teardown', async () => {
    const events = collect('workflow.');
    teardown!();
    teardown = undefined;

    const promise = registerApproval('run-005', 'still routed?');
    resolveApproval('run-005', 'no');
    await promise;

    expect(events.length).toBe(0);
  });

  it('SSE topic prefix workflow. matches both kinds (subscriber filter)', async () => {
    const events = collect('workflow.');
    const otherEvents = collect('nexus.');

    const promise = registerApproval('run-006', 'topic-test');
    resolveApproval('run-006', undefined);
    await promise;

    expect(events.length).toBe(2); // pending + resolved
    expect(otherEvents.length).toBe(0); // no nexus.* leakage
  });
});
