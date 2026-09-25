// Showroom v2 · inject-context D4 ACP target tests.
//
// Covers PLAN §D6 — `injectCapture()` widened to accept both PTY and
// ACP transports. Exercises:
//   - ACP-only target inject succeeds (round-trips through send())
//   - mixed PTY+ACP target succeeds
//   - unknown transport kind (e.g. 'websocket') still rejected
//   - audit + agent-graph edge written for ACP path

import { describe, test, expect } from 'bun:test';
import {
  injectCapture,
  InjectError,
} from '../src/capture/inject-context.js';
import { AgentGraph } from '../src/agent/agent-graph.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';
import type { SnapshotResult } from '../src/capture/providers/types.js';
import type { ConfirmOpts, ConfirmResult } from '../src/hitl/confirm.js';
import type { ControlAuditEvent } from '../src/control-audit-log.js';

function makeSession(
  id: string,
  transports: { kind: string; id: string; label?: string }[],
  onSend?: (m: string) => void,
): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: 'monad' },
    // Cast through unknown — the EmbodiedAgentSession.transports type
    // only allows known kinds; the cast is intentional so we can test
    // the rejection path for unknown transport kinds.
    transports: transports as never,
    state: () => ({ status: 'running' as const }),
    async send(m) { onSend?.(m); },
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() {},
  };
}

function fakeSnap(body = 'pane content'): SnapshotResult {
  return {
    sourceId: 'vw-pane:1/p1',
    format: 'text',
    body,
    bytes: body.length,
    dims: { cols: 80, rows: 24 },
    capturedAt: 1_700_000_000_000,
    warnings: [],
  };
}

function makeDeps(target: EmbodiedAgentSession) {
  const audits: ControlAuditEvent[] = [];
  const approverReqs: ConfirmOpts[] = [];
  const graph = new AgentGraph();
  return {
    deps: {
      registry: { async snapshot() { return fakeSnap(); } },
      lookupSession: (id: string) =>
        id === target.id ? { session: target } : undefined,
      approver: async (req: ConfirmOpts): Promise<ConfirmResult> => {
        approverReqs.push(req);
        return { answer: true, channel: 'terminal', elapsedMs: 1 };
      },
      graph,
      audit: (ev: ControlAuditEvent) => { audits.push(ev); },
    },
    audits, approverReqs, graph,
  };
}

describe('injectCapture · D4 widening — ACP target', () => {
  test('ACP-only target inject succeeds', async () => {
    let captured: string | undefined;
    const target = makeSession('t-acp', [
      { kind: 'acp', id: 'acp-1' },
    ], (m) => { captured = m; });
    const { deps, audits, approverReqs, graph } = makeDeps(target);

    const r = await injectCapture(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't-acp', as: 'user-message' },
      deps,
    );

    expect(r.denied).toBeUndefined();
    expect(r.injectedBytes).toBeGreaterThan(0);
    expect(captured).toBeDefined();
    expect(approverReqs.length).toBe(1);

    // audit recorded with ok=true
    const ok = audits.find((a) => a.action === 'capture_inject' && a.ok);
    expect(ok).toBeDefined();

    // agent-graph edge recorded
    expect(r.edge).toBeDefined();
    expect(r.edge?.kind).toBe('inject');
    void graph;  // graph mutation observed via r.edge
  });

  test('mixed transport (pty + acp) target succeeds', async () => {
    let captured: string | undefined;
    const target = makeSession('t-mix', [
      { kind: 'pty', id: 'pty-1', label: 'mix-pty' },
      { kind: 'acp', id: 'acp-1' },
    ], (m) => { captured = m; });
    const { deps } = makeDeps(target);

    const r = await injectCapture(
      { sourceId: 'vw-pane:1/p1', targetSessionId: 't-mix', as: 'system-note' },
      deps,
    );
    expect(r.denied).toBeUndefined();
    expect(captured).toContain('[Context');
  });
});

describe('injectCapture · D4 — unsupported transport rejection', () => {
  test('only websocket transport → target-dead', async () => {
    const target = makeSession('t-ws', [
      { kind: 'websocket', id: 'ws-1' },
    ]);
    const { deps } = makeDeps(target);
    try {
      await injectCapture(
        { sourceId: 'vw-pane:1/p1', targetSessionId: 't-ws', as: 'user-message' },
        deps,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InjectError);
      expect((err as InjectError).code).toBe('target-dead');
      const msg = (err as InjectError).message;
      expect(msg).toMatch(/no injectable transport/);
      expect(msg).toMatch(/\[pty, acp\]/);
      expect(msg).toMatch(/\[websocket\]/);
    }
  });

  test('empty transports → target-dead with (none) seen', async () => {
    const target = makeSession('t-empty', []);
    const { deps } = makeDeps(target);
    try {
      await injectCapture(
        { sourceId: 'vw-pane:1/p1', targetSessionId: 't-empty', as: 'user-message' },
        deps,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as InjectError).code).toBe('target-dead');
      expect((err as InjectError).message).toMatch(/\(none\)/);
    }
  });
});
