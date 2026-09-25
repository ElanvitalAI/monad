// H6 P7 · injectCapture main flow tests (with stubs).

import { describe, test, expect } from 'bun:test';
import {
  injectCapture,
  InjectError,
  wrapBody,
  buildApprovalRequest,
  type InjectDeps,
  type InjectMode,
} from '../src/capture/inject-context.js';
import { AgentGraph } from '../src/agent/agent-graph.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';
import type { SnapshotResult } from '../src/capture/providers/types.js';
import type { ConfirmOpts, ConfirmResult } from '../src/hitl/confirm.js';
import type { ControlAuditEvent } from '../src/control-audit-log.js';
import { createControlSignalBus } from '../src/input/control-signal.js';

// ─── Stubs ─────────────────────────────────────────────────────────

function makeSession(
  id: string,
  opts: {
    withPty?: boolean;
    status?: 'running' | 'done' | 'error' | 'waiting' | 'pending';
    onSend?: (m: string) => void;
    sendThrows?: Error;
    brand?: string;
  } = {},
): EmbodiedAgentSession {
  const transports = opts.withPty === false
    ? [{ kind: 'acp' as const, id: `acp-${id}` }]
    : [{ kind: 'pty' as const, id: `pty-${id}`, label: `${opts.brand ?? 'stub'}-pty` }];
  return {
    id,
    launchSpec: { brand: opts.brand ?? 'stub' },
    transports,
    state: () => ({ status: opts.status ?? 'running' }),
    async send(m) {
      if (opts.sendThrows) throw opts.sendThrows;
      opts.onSend?.(m);
    },
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() {},
  };
}

function fakeSnapshot(partial: Partial<SnapshotResult> = {}): SnapshotResult {
  return {
    sourceId: partial.sourceId ?? 'vw-pane:1/p12',
    format: partial.format ?? 'text',
    body: partial.body ?? 'pane content',
    bytes: partial.bytes ?? (partial.body?.length ?? 'pane content'.length),
    dims: partial.dims ?? { cols: 80, rows: 24 },
    capturedAt: partial.capturedAt ?? 1_700_000_000_000,
    warnings: partial.warnings ?? [],
    ...(partial.bodyBase64 !== undefined ? { bodyBase64: partial.bodyBase64 } : {}),
    ...(partial.sourceSummary !== undefined ? { sourceSummary: partial.sourceSummary } : {}),
    ...(partial.sourceRef !== undefined ? { sourceRef: partial.sourceRef } : {}),
  };
}

interface FakeRegistry {
  snapshot(id: string, opts?: { at?: number }): Promise<SnapshotResult>;
}

function fakeRegistry(result: SnapshotResult | Error): FakeRegistry {
  return {
    async snapshot() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function makeDeps(opts: {
  snap?: SnapshotResult | Error;
  sessions?: Record<string, EmbodiedAgentSession>;
  approverAnswer?: boolean;
  approverChannel?: ConfirmResult['channel'];
  graph?: AgentGraph;
  captureAudit?: ControlAuditEvent[];
  approverCalls?: ConfirmOpts[];
  now?: () => number;
}): InjectDeps & { graph: AgentGraph; audits: ControlAuditEvent[]; approverReqs: ConfirmOpts[] } {
  const graph = opts.graph ?? new AgentGraph();
  const audits: ControlAuditEvent[] = opts.captureAudit ?? [];
  const approverReqs: ConfirmOpts[] = opts.approverCalls ?? [];
  return {
    registry: fakeRegistry(opts.snap ?? fakeSnapshot()),
    lookupSession: (id) => {
      const s = opts.sessions?.[id];
      return s ? { session: s } : undefined;
    },
    approver: async (req: ConfirmOpts): Promise<ConfirmResult> => {
      approverReqs.push(req);
      return {
        answer: opts.approverAnswer ?? true,
        channel: opts.approverChannel ?? 'terminal',
        elapsedMs: 1,
      };
    },
    graph,
    audit: (ev) => { audits.push(ev); },
    ...(opts.now ? { now: opts.now } : {}),
    audits,
    approverReqs,
  } as never;
}

// ─── Tests · wrapBody pure transform ─────────────────────────────

describe('wrapBody', () => {
  test('user-message passes raw body with trailing newline', () => {
    const snap = fakeSnapshot({ body: 'hello\nworld' });
    const out = wrapBody(snap, 'user-message');
    expect(out).toBe('hello\nworld\n');
  });

  test('system-note wraps in [Context]…[/Context] marker', () => {
    const snap = fakeSnapshot({ body: 'inner', sourceSummary: 'codex-pty' });
    const out = wrapBody(snap, 'system-note');
    expect(out).toContain('[Context from monad-agent · source=codex-pty]');
    expect(out).toContain('inner');
    expect(out).toContain('[/Context]');
  });

  test('attached-block wraps as XML-ish with sourceId + capturedAt', () => {
    const snap = fakeSnapshot({
      body: 'xml body',
      sourceId: 'vw-pane:1/p7',
      capturedAt: 1_700_000_000_000,
      sourceSummary: 'pane-7',
    });
    const out = wrapBody(snap, 'attached-block');
    expect(out).toContain('<context source="vw-pane:1/p7"');
    expect(out).toContain('label="pane-7"');
    expect(out).toContain('capturedAt="2023-11-14T22:13:20.000Z"');
    expect(out).toContain('xml body');
    expect(out).toContain('</context>');
  });

  test('PNG body goes through base64 fenced block with dims on attached-block', () => {
    const snap = fakeSnapshot({
      format: 'png',
      body: '',
      bodyBase64: 'AAAA',
      bytes: 3,
      dims: { cols: 100, rows: 40 },
    });
    const out = wrapBody(snap, 'attached-block');
    expect(out).toContain('```base64\nAAAA\n```');
    expect(out).toContain('dims="100x40"');
  });
});

// ─── Tests · approver request composition ────────────────────────

describe('buildApprovalRequest', () => {
  test('preview first 500 chars with overflow hint', () => {
    const body = 'x'.repeat(700);
    const snap = fakeSnapshot({ body, bytes: 700 });
    const req = buildApprovalRequest(snap, 'attached-block', {
      id: 'emb-claude-pty-1', brand: 'claude', label: 'claude-pty',
    });
    expect(req.detail).toContain('… (200 more chars)');
    expect(req.prompt).toContain('claude[emb-claude-pty-1]');
  });

  test('warnings prepended with ⚠️', () => {
    const snap = fakeSnapshot({ warnings: ['observer-missing', 'source-empty'] });
    const req = buildApprovalRequest(snap, 'system-note', {
      id: 't1', brand: 'codex', label: 'codex-pty',
    });
    expect(req.detail).toContain('⚠️');
    expect(req.detail).toContain('observer-missing');
  });

  test('PNG preview shows dims placeholder instead of body', () => {
    const snap = fakeSnapshot({
      format: 'png', body: '', bodyBase64: 'x'.repeat(2000),
      bytes: 1500, dims: { cols: 80, rows: 24 },
    });
    const req = buildApprovalRequest(snap, 'attached-block', {
      id: 't1', brand: 'claude', label: 'claude-pty',
    });
    expect(req.detail).toContain('[PNG · 1500B · 80x24]');
  });
});

// ─── Tests · injectCapture main pipeline ─────────────────────────

describe('injectCapture · happy path', () => {
  test('approve + send + edge + audit ok', async () => {
    let sent = '';
    const target = makeSession('t1', { onSend: (m) => { sent = m; }, brand: 'claude' });
    const deps = makeDeps({ sessions: { t1: target } });
    const result = await injectCapture(
      { sourceId: 'vw-pane:1/p12', targetSessionId: 't1', as: 'attached-block' },
      deps,
    );
    expect(result.denied).toBeUndefined();
    expect(sent).toContain('<context source="vw-pane:1/p12"');
    expect(sent).toContain('pane content');
    expect(result.injectedBytes).toBe(sent.length);
    expect(result.approvedVia).toBe('terminal');
    expect(result.edge).toBeDefined();
    expect(result.edge!.kind).toBe('inject');
    expect(deps.audits).toHaveLength(1);
    expect(deps.audits[0]!.action).toBe('capture_inject');
    expect(deps.audits[0]!.ok).toBe(true);
    expect(deps.audits[0]!.detail!.as).toBe('attached-block');
  });

  test('edge meta carries sourceId + sourceType + bytes + approvedVia', async () => {
    const target = makeSession('t1');
    const deps = makeDeps({
      sessions: { t1: target },
      snap: fakeSnapshot({
        sourceRef: {
          kind: 'browser',
          provider: 'cdp',
          capabilities: ['observe', 'verify'],
        },
      }),
    });
    const result = await injectCapture(
      { sourceId: 'agent-session:emb-codex-pty-1', targetSessionId: 't1', as: 'system-note' },
      deps,
    );
    const meta = result.edge!.meta as Record<string, unknown>;
    expect(meta.sourceId).toBe('agent-session:emb-codex-pty-1');
    expect(meta.sourceType).toBe('agent-session');
    expect(meta.as).toBe('system-note');
    expect(typeof meta.bytes).toBe('number');
    expect(meta.approvedVia).toBe('terminal');
    expect(meta.sourceRef).toEqual({
      kind: 'browser',
      provider: 'cdp',
      capabilities: ['observe', 'verify'],
    });
  });

  test('skipApprover test seam bypasses approver · approvedVia="bypassed"', async () => {
    const target = makeSession('t1');
    const deps = makeDeps({ sessions: { t1: target } });
    const result = await injectCapture(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'user-message', skipApprover: true },
      deps,
    );
    expect(result.approvedVia).toBe('bypassed');
    expect(deps.approverReqs).toHaveLength(0);
  });

  test('provider warnings propagate to result + audit detail', async () => {
    const target = makeSession('t1');
    const snap = fakeSnapshot({ warnings: ['observer-missing'] });
    const deps = makeDeps({ sessions: { t1: target }, snap });
    const result = await injectCapture(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'user-message' },
      deps,
    );
    expect(result.warnings).toEqual(['observer-missing']);
    expect(deps.audits[0]!.detail!.warnings).toEqual(['observer-missing']);
  });

  test('custom fromSessionId recorded as graph edge source', async () => {
    const target = makeSession('t1');
    const deps = makeDeps({ sessions: { t1: target } });
    const result = await injectCapture(
      {
        sourceId: 'vw-pane:1/p1',
        targetSessionId: 't1',
        as: 'attached-block',
        fromSessionId: 'source-agent-1',
      },
      deps,
    );
    expect(result.edge!.from).toBe('source-agent-1');
  });
});

describe('injectCapture · HITL denial paths', () => {
  test('approver returns false · denied=true · no edge · audit ok=false', async () => {
    const target = makeSession('t1');
    const deps = makeDeps({ sessions: { t1: target }, approverAnswer: false });
    const result = await injectCapture(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'attached-block' },
      deps,
    );
    expect(result.denied).toBe(true);
    expect(result.edge).toBeUndefined();
    expect(result.warnings).toContain('approver-denied');
    expect(deps.audits[0]!.ok).toBe(false);
    expect(deps.audits[0]!.detail!.rejectionReason).toBe('user-denied');
  });

  test('approver channel="timeout" → warnings includes approver-timeout · rejectionReason=approver-timeout', async () => {
    const target = makeSession('t1');
    const deps = makeDeps({
      sessions: { t1: target },
      approverAnswer: false,
      approverChannel: 'timeout',
    });
    const result = await injectCapture(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'system-note' },
      deps,
    );
    expect(result.denied).toBe(true);
    expect(result.warnings).toContain('approver-timeout');
    expect(deps.audits[0]!.detail!.rejectionReason).toBe('approver-timeout');
  });
});

describe('injectCapture · error taxonomy', () => {
  test('invalid as throws InjectError("invalid-mode")', async () => {
    const target = makeSession('t1');
    const deps = makeDeps({ sessions: { t1: target } });
    try {
      await injectCapture(
        { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'bogus' as InjectMode },
        deps,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InjectError);
      expect((err as InjectError).code).toBe('invalid-mode');
    }
  });

  test('target-missing throws · audit ok=false', async () => {
    const deps = makeDeps({ sessions: {} });
    try {
      await injectCapture(
        { sourceId: 'vw-pane:1/p1', targetSessionId: 'ghost', as: 'user-message' },
        deps,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as InjectError).code).toBe('target-missing');
    }
    expect(deps.audits[0]!.ok).toBe(false);
    expect(deps.audits[0]!.detail!.rejectionReason).toBe('target-missing');
  });

  test('target with done status throws target-dead', async () => {
    const target = makeSession('t1', { status: 'done' });
    const deps = makeDeps({ sessions: { t1: target } });
    try {
      await injectCapture(
        { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'user-message' },
        deps,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as InjectError).code).toBe('target-dead');
    }
  });

  test('ACP-only target now SUCCEEDS · D4 (Bundle 2 · 2026-04-28)', async () => {
    // Pre-D4 this threw 'target-dead' with "no PTY transport" — after
    // showroom v2 (PR · 2026-04-28) ACP transports are first-class
    // inject targets so the same setup must succeed end-to-end.
    let captured: string | undefined;
    const target = makeSession('t1', {
      withPty: false,
      onSend: (m) => { captured = m; },
    });
    const deps = makeDeps({ sessions: { t1: target } });
    const r = await injectCapture(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'user-message' },
      deps,
    );
    expect(r.denied).toBeUndefined();
    expect(captured).toBeDefined();
    expect(r.injectedBytes).toBeGreaterThan(0);
  });

  test('source-missing · registry throws · audit ok=false · no approver call', async () => {
    const target = makeSession('t1');
    const deps = makeDeps({
      sessions: { t1: target },
      snap: new Error('UnknownCaptureSourceError: no provider'),
    });
    try {
      await injectCapture(
        { sourceId: 'bogus:none', targetSessionId: 't1', as: 'user-message' },
        deps,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as InjectError).code).toBe('source-missing');
    }
    expect(deps.approverReqs).toHaveLength(0);
    expect(deps.audits[0]!.ok).toBe(false);
    expect(deps.audits[0]!.detail!.rejectionReason).toBe('source-missing');
  });

  test('send-failed · approver yes but send() throws · audit ok=false with error message', async () => {
    const target = makeSession('t1', { sendThrows: new Error('EPIPE: broken') });
    const deps = makeDeps({ sessions: { t1: target } });
    try {
      await injectCapture(
        { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'user-message' },
        deps,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as InjectError).code).toBe('send-failed');
      expect((err as InjectError).message).toContain('EPIPE');
    }
    expect(deps.audits[0]!.ok).toBe(false);
    expect(deps.audits[0]!.detail!.rejectionReason).toBe('send-failed');
  });

  test('recent capture-inject-stop quick-pass preempts before snapshot or approver', async () => {
    const target = makeSession('t1');
    const signalBus = createControlSignalBus(() => new Date().toISOString());
    signalBus.emit({
      kind: 'capture-inject-stop',
      urgency: 'quick-pass',
      source: 'system',
      scope: { sessionId: 't1' },
    });
    const deps = makeDeps({
      sessions: { t1: target },
      snap: new Error('snapshot should not run'),
    });
    try {
      await injectCapture(
        { sourceId: 'vw-pane:1/p1', targetSessionId: 't1', as: 'user-message' },
        { ...deps, signalBus },
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as InjectError).code).toBe('preempted');
      expect((err as InjectError).message).toContain('capture-inject-stop');
    }
    expect(deps.approverReqs).toHaveLength(0);
    expect(deps.audits[0]!.ok).toBe(false);
    expect(deps.audits[0]!.detail!.rejectionReason).toBe('preempted');
  });
});
