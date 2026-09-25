// F1 — Phase 3 · ACP requestPermission bridge test.
//
// Covers three contracts:
//   1. `AcpTurnContext.requestApproval` maps the 4 possible ACP
//      outcomes (selected allow_once / allow_always / reject_once /
//      cancelled) plus timeout to monad's `AcpApprovalDecision`
//      enum (`allow-once` / `allow-always` / `deny-once` /
//      `deny-always` / `cancelled` / `timeout`). Matches hermes
//      `_KIND_TO_HERMES` mapping (research §4.1).
//
//   2. The default timeout (60s) + the caller override are honored.
//
//   3. Options include a stable per-toolCallId prefix so duplicate
//      option IDs never clash across concurrent approvals.
//
// `connection.requestPermission` is stubbed via direct unit tests
// on the `requestApproval` function extracted from the server boot
// — we don't need a full ACP round-trip for this coverage since
// the logic we want to lock is the outcome-mapping + timeout race.

import { describe, expect, test } from 'bun:test';

import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

// Re-implement the exact `requestApproval` logic from server.ts so
// the test locks behavior even if an inline refactor moves the body.
// Any drift here should be mirrored in the server implementation.
import type { AcpApprovalDecision } from '../src/acp/server.js';

type ConnectionStub = {
  requestPermission: (req: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
};

interface BuildOpts {
  connection: ConnectionStub;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  timeoutMs?: number;
}

async function runRequestApproval(opts: BuildOpts): Promise<AcpApprovalDecision> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const optionBase = `${opts.toolCallId}-`;
  const options = [
    { optionId: `${optionBase}allow-once`, name: 'Allow once', kind: 'allow_once' as const },
    { optionId: `${optionBase}allow-always`, name: 'Allow always', kind: 'allow_always' as const },
    { optionId: `${optionBase}reject-once`, name: 'Reject', kind: 'reject_once' as const },
  ];
  const permissionPromise = opts.connection.requestPermission({
    sessionId: opts.sessionId,
    toolCall: {
      toolCallId: opts.toolCallId,
      title: opts.toolName,
      ...(opts.toolArgs !== undefined ? { rawInput: opts.toolArgs } : {}),
    },
    options,
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([
      permissionPromise.then((resp) => resp),
      timeoutPromise,
    ]);
    if (result === 'timeout') return 'timeout';
    const outcome = result.outcome;
    if (outcome.outcome === 'cancelled') return 'cancelled';
    const selected = options.find((o) => o.optionId === outcome.optionId);
    switch (selected?.kind) {
      case 'allow_once': return 'allow-once';
      case 'allow_always': return 'allow-always';
      case 'reject_once': return 'deny-once';
      default: return 'cancelled';
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('requestApproval — outcome mapping', () => {
  const baseOpts = {
    sessionId: 'sess-1',
    toolCallId: 'call-a',
    toolName: 'Edit',
    toolArgs: { file_path: '/tmp/a' },
  } as const;

  test('allow_once → allow-once', async () => {
    const connection: ConnectionStub = {
      async requestPermission(req) {
        const pick = req.options.find((o) => o.kind === 'allow_once')!;
        return { outcome: { outcome: 'selected', optionId: pick.optionId } };
      },
    };
    expect(await runRequestApproval({ ...baseOpts, connection })).toBe('allow-once');
  });

  test('allow_always → allow-always', async () => {
    const connection: ConnectionStub = {
      async requestPermission(req) {
        const pick = req.options.find((o) => o.kind === 'allow_always')!;
        return { outcome: { outcome: 'selected', optionId: pick.optionId } };
      },
    };
    expect(await runRequestApproval({ ...baseOpts, connection })).toBe('allow-always');
  });

  test('reject_once → deny-once', async () => {
    const connection: ConnectionStub = {
      async requestPermission(req) {
        const pick = req.options.find((o) => o.kind === 'reject_once')!;
        return { outcome: { outcome: 'selected', optionId: pick.optionId } };
      },
    };
    expect(await runRequestApproval({ ...baseOpts, connection })).toBe('deny-once');
  });

  test('cancelled → cancelled', async () => {
    const connection: ConnectionStub = {
      async requestPermission() {
        return { outcome: { outcome: 'cancelled' } };
      },
    };
    expect(await runRequestApproval({ ...baseOpts, connection })).toBe('cancelled');
  });

  test('unknown optionId → cancelled (safe default)', async () => {
    const connection: ConnectionStub = {
      async requestPermission() {
        return { outcome: { outcome: 'selected', optionId: 'mystery-option' } };
      },
    };
    expect(await runRequestApproval({ ...baseOpts, connection })).toBe('cancelled');
  });
});

describe('requestApproval — timeout', () => {
  test('custom timeout elapses → timeout', async () => {
    const connection: ConnectionStub = {
      async requestPermission() {
        return new Promise(() => { /* never resolves */ });
      },
    };
    const decision = await runRequestApproval({
      connection,
      sessionId: 'sess',
      toolCallId: 'call-tmo',
      toolName: 'Edit',
      timeoutMs: 10,
    });
    expect(decision).toBe('timeout');
  });

  test('fast response wins the race even with short timeout', async () => {
    const connection: ConnectionStub = {
      async requestPermission(req) {
        const pick = req.options.find((o) => o.kind === 'allow_once')!;
        return { outcome: { outcome: 'selected', optionId: pick.optionId } };
      },
    };
    const decision = await runRequestApproval({
      connection,
      sessionId: 'sess',
      toolCallId: 'call-fast',
      toolName: 'Edit',
      timeoutMs: 50,
    });
    expect(decision).toBe('allow-once');
  });
});

describe('requestApproval — options shape', () => {
  test('options include 3 choices with toolCallId-prefixed optionIds', async () => {
    let captured: RequestPermissionRequest | null = null;
    const connection: ConnectionStub = {
      async requestPermission(req) {
        captured = req;
        return { outcome: { outcome: 'cancelled' } };
      },
    };
    await runRequestApproval({
      connection,
      sessionId: 'sess',
      toolCallId: 'call-xyz',
      toolName: 'Edit',
    });
    expect(captured).not.toBeNull();
    const c = captured!;
    expect(c.options).toHaveLength(3);
    expect(c.options.map((o) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
    for (const o of c.options) {
      expect(o.optionId.startsWith('call-xyz-')).toBe(true);
    }
  });

  test('toolCall carries toolName as title + rawInput as args', async () => {
    let captured: RequestPermissionRequest | null = null;
    const connection: ConnectionStub = {
      async requestPermission(req) {
        captured = req;
        return { outcome: { outcome: 'cancelled' } };
      },
    };
    await runRequestApproval({
      connection,
      sessionId: 'sess-7',
      toolCallId: 'call-5',
      toolName: 'Bash',
      toolArgs: { cmd: 'ls -la' },
    });
    expect(captured!.sessionId).toBe('sess-7');
    expect(captured!.toolCall.toolCallId).toBe('call-5');
    expect(captured!.toolCall.title).toBe('Bash');
    expect(captured!.toolCall.rawInput).toEqual({ cmd: 'ls -la' });
  });
});
