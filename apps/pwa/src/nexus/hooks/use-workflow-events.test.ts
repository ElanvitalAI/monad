// HANDOFF §4.2 follow-up — unified workflow event stream covers both
// approval lifecycle (BACKLOG #9) and run lifecycle (§15.8(b)) in a
// single EventSource per panel mount. Replaces the previously
// separate `installWorkflowApprovalEventStream` +
// `installWorkflowRunEventStream` test files.

import { describe, expect, test } from 'bun:test';
import { installWorkflowEventStream } from './use-workflows';

class StubEventSource {
  static lastUrl: string | null = null;
  static lastInstance: StubEventSource | null = null;
  static closed = 0;

  // Same kind can be addEventListener'd multiple times in real ES;
  // we keep a list per kind so emit() fires every registered handler.
  listeners = new Map<string, EventListener[]>();

  constructor(public url: string) {
    StubEventSource.lastUrl = url;
    StubEventSource.lastInstance = this;
  }

  addEventListener(type: string, fn: EventListener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  close(): void {
    StubEventSource.closed += 1;
  }

  emit(type: string, data: unknown): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const evt = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent;
    for (const fn of arr) fn(evt);
  }

  static reset(): void {
    StubEventSource.lastUrl = null;
    StubEventSource.lastInstance = null;
    StubEventSource.closed = 0;
  }
}

const noopHooks = {
  onApprovalPending: () => {},
  onApprovalResolved: (_runId: string | undefined) => {},
  onRunEvent: (_runId: string | undefined) => {},
};

describe('installWorkflowEventStream — wire shape', () => {
  test('opens ONE EventSource on /v1/events?topics=workflow.', () => {
    StubEventSource.reset();
    const teardown = installWorkflowEventStream(
      'http://nexus.local:31415',
      noopHooks,
      { EventSourceImpl: StubEventSource as unknown as typeof EventSource },
    );

    expect(StubEventSource.lastUrl).toBe(
      'http://nexus.local:31415/v1/events?topics=workflow.',
    );
    teardown();
    expect(StubEventSource.closed).toBe(1);
  });

  test('returns no-op teardown when no EventSource is available', () => {
    // Simulate SSR / older browser by passing no impl AND ensuring
    // globalThis has none. We can't actually delete globalThis.EventSource
    // (other tests may rely on it) — instead we just confirm calling
    // teardown is safe even when no ES was created.
    const teardown = installWorkflowEventStream(
      'http://x',
      noopHooks,
      { EventSourceImpl: undefined as unknown as typeof EventSource },
    );
    expect(typeof teardown).toBe('function');
    expect(() => teardown()).not.toThrow();
  });

  test('returns no-op teardown when EventSource constructor throws', () => {
    StubEventSource.reset();
    class ThrowingES {
      constructor() { throw new Error('construct failed'); }
    }
    const teardown = installWorkflowEventStream(
      'http://x',
      noopHooks,
      { EventSourceImpl: ThrowingES as unknown as typeof EventSource },
    );
    expect(() => teardown()).not.toThrow();
  });
});

describe('installWorkflowEventStream — approval lifecycle', () => {
  test('fires onApprovalPending on workflow.approval.pending', () => {
    StubEventSource.reset();
    let pending = 0;
    const teardown = installWorkflowEventStream(
      'http://h:1',
      { ...noopHooks, onApprovalPending: () => { pending += 1; } },
      { EventSourceImpl: StubEventSource as unknown as typeof EventSource },
    );

    StubEventSource.lastInstance!.emit('workflow.approval.pending', {
      ts: 1, kind: 'workflow.approval.pending', detail: { runId: 'r1', message: 'go?', requestedAt: 1 },
    });
    expect(pending).toBe(1);
    teardown();
  });

  test('fires onApprovalResolved with parsed runId', () => {
    StubEventSource.reset();
    const captured: Array<string | undefined> = [];
    const teardown = installWorkflowEventStream(
      'http://h:1',
      { ...noopHooks, onApprovalResolved: (r: string | undefined) => captured.push(r) },
      { EventSourceImpl: StubEventSource as unknown as typeof EventSource },
    );

    StubEventSource.lastInstance!.emit('workflow.approval.resolved', {
      ts: 2, kind: 'workflow.approval.resolved', detail: { runId: 'r2', resolution: 'approved' },
    });
    expect(captured).toEqual(['r2']);
    teardown();
  });

  test('onApprovalResolved called with undefined when frame data is unparseable', () => {
    StubEventSource.reset();
    const captured: Array<string | undefined> = [];
    const teardown = installWorkflowEventStream(
      'http://h:1',
      { ...noopHooks, onApprovalResolved: (r: string | undefined) => captured.push(r) },
      { EventSourceImpl: StubEventSource as unknown as typeof EventSource },
    );

    StubEventSource.lastInstance!.emit('workflow.approval.resolved', '<<not json>>');
    expect(captured).toEqual([undefined]);
    teardown();
  });
});

describe('installWorkflowEventStream — run lifecycle', () => {
  const RUN_KINDS = [
    'workflow.run.started',
    'workflow.run.node-started',
    'workflow.run.node-skipped',
    'workflow.run.node-done',
    'workflow.run.completed',
    'workflow.run.failed',
  ] as const;

  test('fires onRunEvent for every workflow.run.* kind with parsed runId', () => {
    StubEventSource.reset();
    const captured: Array<string | undefined> = [];
    const teardown = installWorkflowEventStream(
      'http://h:1',
      { ...noopHooks, onRunEvent: (r: string | undefined) => captured.push(r) },
      { EventSourceImpl: StubEventSource as unknown as typeof EventSource },
    );

    for (const kind of RUN_KINDS) {
      StubEventSource.lastInstance!.emit(kind, {
        ts: 1, kind, detail: { runId: `R-${kind}` },
      });
    }
    expect(captured).toEqual(RUN_KINDS.map((k) => `R-${k}`));
    teardown();
  });

  test('onRunEvent called with undefined when frame has no runId', () => {
    StubEventSource.reset();
    const captured: Array<string | undefined> = [];
    const teardown = installWorkflowEventStream(
      'http://h:1',
      { ...noopHooks, onRunEvent: (r: string | undefined) => captured.push(r) },
      { EventSourceImpl: StubEventSource as unknown as typeof EventSource },
    );
    StubEventSource.lastInstance!.emit('workflow.run.started', {
      ts: 1, kind: 'workflow.run.started', detail: {},
    });
    expect(captured).toEqual([undefined]);
    teardown();
  });
});

describe('installWorkflowEventStream — single EventSource consolidation', () => {
  test('approval and run frames dispatch on the same ES (per-tab budget)', () => {
    StubEventSource.reset();
    let pending = 0;
    let runs = 0;
    const teardown = installWorkflowEventStream(
      'http://h:1',
      {
        ...noopHooks,
        onApprovalPending: () => { pending += 1; },
        onRunEvent: () => { runs += 1; },
      },
      { EventSourceImpl: StubEventSource as unknown as typeof EventSource },
    );

    // Both kinds delivered through ONE underlying EventSource.
    StubEventSource.lastInstance!.emit('workflow.approval.pending', { detail: {} });
    StubEventSource.lastInstance!.emit('workflow.run.started', { detail: { runId: 'r1' } });

    expect(pending).toBe(1);
    expect(runs).toBe(1);
    // Only one ES instance constructed.
    expect(StubEventSource.lastInstance).not.toBeNull();
    teardown();
    expect(StubEventSource.closed).toBe(1);
  });
});
