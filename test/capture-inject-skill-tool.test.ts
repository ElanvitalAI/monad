// H6 P7 · InjectCaptureToContext LLM tool dispatcher tests.

import { describe, test, expect } from 'bun:test';
import {
  buildInjectCaptureToContextTool,
  dispatchInjectCaptureToContext,
} from '../src/skills/tools/capture-inject.js';
import type {
  InjectDeps,
  InjectMode,
} from '../src/capture/inject-context.js';
import { AgentGraph } from '../src/agent/agent-graph.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';
import type { SnapshotResult } from '../src/capture/providers/types.js';
import type { ConfirmOpts, ConfirmResult } from '../src/hitl/confirm.js';
import type { ControlAuditEvent } from '../src/control-audit-log.js';

function makeSession(id: string, opts: {
  status?: 'running' | 'done' | 'error' | 'waiting' | 'pending';
  brand?: string;
} = {}): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: opts.brand ?? 'stub' },
    transports: [{ kind: 'pty', id: `pty-${id}`, label: `${opts.brand ?? 'stub'}-pty` }],
    state: () => ({ status: opts.status ?? 'running' }),
    async send() {},
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() {},
  };
}

function fakeSnap(partial: Partial<SnapshotResult> = {}): SnapshotResult {
  return {
    sourceId: partial.sourceId ?? 'vw-pane:1/p1',
    format: partial.format ?? 'text',
    body: partial.body ?? 'stub-body',
    bytes: partial.bytes ?? 9,
    dims: { cols: 80, rows: 24 },
    capturedAt: 1_700_000_000_000,
    warnings: partial.warnings ?? [],
    ...(partial.sourceSummary !== undefined ? { sourceSummary: partial.sourceSummary } : {}),
  };
}

function makeDeps(opts: {
  snap?: SnapshotResult | Error;
  sessions?: Record<string, EmbodiedAgentSession>;
  approverAnswer?: boolean;
} = {}): InjectDeps {
  const audits: ControlAuditEvent[] = [];
  return {
    registry: {
      snapshot: async () => {
        if (opts.snap instanceof Error) throw opts.snap;
        return opts.snap ?? fakeSnap();
      },
    },
    lookupSession: (id) => {
      const s = opts.sessions?.[id];
      return s ? { session: s } : undefined;
    },
    approver: async (_req: ConfirmOpts): Promise<ConfirmResult> => ({
      answer: opts.approverAnswer ?? true,
      channel: 'terminal',
      elapsedMs: 1,
    }),
    graph: new AgentGraph(),
    audit: (ev) => audits.push(ev),
  };
}

describe('buildInjectCaptureToContextTool', () => {
  test('spec name + required params', () => {
    const spec = buildInjectCaptureToContextTool();
    expect(spec.name).toBe('InjectCaptureToContext');
    expect(spec.parameters.required).toEqual(['sourceId', 'targetSessionId', 'as']);
    const asEnum = (spec.parameters.properties as Record<string, { enum?: string[] }>).as.enum;
    expect(asEnum).toEqual(['user-message', 'system-note', 'attached-block']);
  });
});

describe('dispatchInjectCaptureToContext · input validation', () => {
  test('missing sourceId → isError', async () => {
    const r = await dispatchInjectCaptureToContext(
      { targetSessionId: 't1', as: 'attached-block' },
      makeDeps(),
    );
    expect(r.isError).toBe(true);
    expect(r.output).toContain('sourceId required');
  });

  test('missing targetSessionId → isError', async () => {
    const r = await dispatchInjectCaptureToContext(
      { sourceId: 'vw-pane:1/p1', as: 'attached-block' },
      makeDeps(),
    );
    expect(r.isError).toBe(true);
    expect(r.output).toContain('targetSessionId required');
  });

  test('invalid as → isError with enum list', async () => {
    const r = await dispatchInjectCaptureToContext(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'bogus' },
      makeDeps(),
    );
    expect(r.isError).toBe(true);
    expect(r.output).toContain('user-message');
  });
});

describe('dispatchInjectCaptureToContext · success metadata', () => {
  test('happy path → output + metadata · no isError', async () => {
    const target = makeSession('t1', { brand: 'claude' });
    const r = await dispatchInjectCaptureToContext(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'attached-block' },
      makeDeps({ sessions: { t1: target } }),
    );
    expect(r.isError).toBeUndefined();
    expect(r.output).toContain('injected vw-pane:1/p1 into t1');
    expect(r.metadata.sourceId).toBe('vw-pane:1/p1');
    expect(r.metadata.targetSessionId).toBe('t1');
    expect(r.metadata.as).toBe('attached-block');
    expect(r.metadata.injectedBytes).toBeGreaterThan(0);
    expect(r.metadata.approvedVia).toBe('terminal');
    expect(r.metadata.denied).toBeUndefined();
  });

  test('denied path · isError unset · metadata.denied=true · warnings include approver-denied', async () => {
    const target = makeSession('t1');
    const r = await dispatchInjectCaptureToContext(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'system-note' },
      makeDeps({ sessions: { t1: target }, approverAnswer: false }),
    );
    expect(r.isError).toBeUndefined();
    expect(r.metadata.denied).toBe(true);
    expect(r.metadata.warnings).toContain('approver-denied');
    expect(r.output).toContain('approver denied');
  });
});

describe('dispatchInjectCaptureToContext · error paths', () => {
  test('target-missing InjectError → isError with target info', async () => {
    const r = await dispatchInjectCaptureToContext(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 'ghost', as: 'user-message' },
      makeDeps({ sessions: {} }),
    );
    expect(r.isError).toBe(true);
    expect(r.output).toContain('target session');
  });

  test('source-missing InjectError → isError', async () => {
    const target = makeSession('t1');
    const r = await dispatchInjectCaptureToContext(
      { sourceId: 'bogus:none', targetSessionId: 't1', as: 'user-message' },
      makeDeps({
        sessions: { t1: target },
        snap: new Error('UnknownCaptureSourceError: no provider'),
      }),
    );
    expect(r.isError).toBe(true);
    expect(r.output).toContain('snapshot failed');
  });

  test('fromSessionId passes through to injectCapture (smoke)', async () => {
    const target = makeSession('t1');
    const r = await dispatchInjectCaptureToContext(
      {
        sourceId: 'vw-pane:1/p1',
        targetSessionId: 't1',
        as: 'user-message',
        fromSessionId: '  source-1  ',
      },
      makeDeps({ sessions: { t1: target } }),
    );
    // Happy path · just verifying the options plumbing doesn't reject trimmed input.
    expect(r.isError).toBeUndefined();
    expect(r.metadata.sourceId).toBe('vw-pane:1/p1');
  });

  test('at: number parameter is plumbed (smoke · warning is provider-side)', async () => {
    const target = makeSession('t1');
    const r = await dispatchInjectCaptureToContext(
      {
        sourceId: 'vw-pane:1/p1',
        targetSessionId: 't1',
        as: 'attached-block',
        at: 1_700_000_000_000,
      },
      makeDeps({ sessions: { t1: target } }),
    );
    expect(r.isError).toBeUndefined();
  });
});
