// AXON P6 wrap-up B2 — Production AcxSessionCallable tests.
//
// The callable bridges the surface adapter to a live DualRoleManager:
//   - resolves session by id
//   - calls clientSessionSend with an onUpdate interceptor that
//     accumulates agent_message_chunk + agent_thought_chunk text
//   - shapes address as `acx:<namespaced-id>`
//   - maps thrown errors to ACX_UNKNOWN_SESSION / ACX_REENTRANCY /
//     ACX_PROMPT_FAILED / ACX_REFUSAL / SERVER_SESSION_NOT_DRIVEABLE
//
// Tests use a fake DualRoleManager (single recorded session) so the
// callable's behaviour is exercised without live AcpAgent spawning.

import { describe, expect, test } from 'bun:test';
import { createProductionAcxSessionCallable } from '../../src/task-orchestrator/surfaces/acx-session-callable.js';
import type { DualRoleManager } from '../../src/acp/dual-role-manager.js';

// ── Fake DualRoleManager ─────────────────────────────────────────────

interface FakeRecord {
  id: string;
  backendId?: string;
  backendSessionId?: string;
  cwd?: string;
}

interface FakeManagerOpts {
  records?: FakeRecord[];
  /** When set, clientSessionSend throws this Error before fanning out
   *  any agent updates. */
  throwOnSend?: Error;
  /** When set, the `onUpdate` callback is invoked with these values
   *  before the prompt resolves so accumulators see chunks. */
  emitUpdates?: unknown[];
  /** stopReason returned by the resolved prompt. */
  stopReason?: string;
  /** lastSeenAt returned by the resolved prompt. */
  lastSeenAt?: number;
}

function fakeManager(opts: FakeManagerOpts = {}): DualRoleManager {
  const records = new Map<string, FakeRecord>();
  for (const r of opts.records ?? []) records.set(r.id, r);
  return {
    clientSessionById(sessionId: string) {
      return records.get(sessionId);
    },
    async clientSessionSend(send: { sessionId: string; message: unknown; onUpdate?: (u: unknown) => void }) {
      if (!records.has(send.sessionId)) {
        const err = new Error(`UnknownSessionError: ${send.sessionId}`);
        err.name = 'UnknownSessionError';
        throw err;
      }
      if (opts.throwOnSend) throw opts.throwOnSend;
      // Replay any update chunks the test wants to feed.
      for (const u of opts.emitUpdates ?? []) {
        send.onUpdate?.(u);
      }
      return {
        stopReason: opts.stopReason ?? 'end_turn',
        sessionId: send.sessionId,
        lastSeenAt: opts.lastSeenAt ?? 1700000000_000,
      };
    },
  } as unknown as DualRoleManager;
}

const baseInput = {
  sessionId: 'acp-cli:claude:sess-42',
  agentBrand: 'claude-code' as const,
  prompt: 'hello',
};

// ── Tests ────────────────────────────────────────────────────────────

describe('createProductionAcxSessionCallable · happy path', () => {
  test('returns address shape "acx:<namespaced-id>"', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:claude:sess-42' }],
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const { address } = await callable(baseInput);
    expect(address).toBe('acx:acp-cli:claude:sess-42');
  });

  test('done resolves to status=completed when send resolves', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:claude:sess-42' }],
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const { done } = await callable(baseInput);
    const out = await done;
    expect(out.status).toBe('completed');
    expect(out.stopReason).toBe('end_turn');
    expect(out.lastSeenAt).toBe(1700000000_000);
  });

  test('output accumulates agent_message_chunk + agent_thought_chunk text', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:claude:sess-42' }],
      emitUpdates: [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello, ' } },
        { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '(thinking) ' } },
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world.' } },
        // Non-text update — ignored.
        { sessionUpdate: 'tool_call', toolCallId: 't1' },
      ],
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const { done } = await callable(baseInput);
    const out = await done;
    expect(out.output).toBe('Hello, (thinking) world.');
  });

  test('non-text content type → ignored', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:claude:sess-42' }],
      emitUpdates: [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'image', text: 'should-be-skipped' } },
      ],
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable(baseInput)).done;
    expect(out.output).toBe('');
  });

  test('modelId reflects the input model when supplied', async () => {
    const mgr = fakeManager({ records: [{ id: 'acp-cli:claude:sess-42' }] });
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable({ ...baseInput, model: 'claude-opus-4.7' })).done;
    expect(out.modelId).toBe('claude-opus-4.7');
  });

  test('durationMs is a non-negative finite number', async () => {
    const mgr = fakeManager({ records: [{ id: 'acp-cli:claude:sess-42' }] });
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable(baseInput)).done;
    expect(typeof out.durationMs).toBe('number');
    expect(Number.isFinite(out.durationMs)).toBe(true);
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('createProductionAcxSessionCallable · error mapping', () => {
  test('unknown session at lookup time → throws synchronously (no done)', async () => {
    const mgr = fakeManager({ records: [] });
    const callable = createProductionAcxSessionCallable(mgr);
    await expect(callable(baseInput)).rejects.toThrow(/ACX_UNKNOWN_SESSION/);
  });

  test('thrown UnknownSessionError → done.error.code = ACX_UNKNOWN_SESSION', async () => {
    // Resource exists at lookup but disappears mid-send (race) — the
    // fake manager throws UnknownSessionError from clientSessionSend.
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:claude:sess-42' }],
      throwOnSend: Object.assign(new Error('UnknownSessionError: gone'), { name: 'UnknownSessionError' }),
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable(baseInput)).done;
    expect(out.status).toBe('failed');
    expect(out.error?.code).toBe('ACX_UNKNOWN_SESSION');
  });

  test('thrown ReentrancyError → done.error.code = ACX_REENTRANCY', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:claude:sess-42' }],
      throwOnSend: Object.assign(new Error('hop cap exceeded'), { name: 'ReentrancyError' }),
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable(baseInput)).done;
    expect(out.error?.code).toBe('ACX_REENTRANCY');
  });

  test('refusal-like message → done.error.code = ACX_REFUSAL', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:claude:sess-42' }],
      throwOnSend: new Error('agent refused: harmful request'),
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable(baseInput)).done;
    expect(out.error?.code).toBe('ACX_REFUSAL');
  });

  test('not-driveable server session → done.error.code = SERVER_SESSION_NOT_DRIVEABLE', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-srv:elanous-session-7' }],
      throwOnSend: new Error('server session is not driveable'),
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable({ ...baseInput, sessionId: 'acp-srv:elanous-session-7' })).done;
    expect(out.error?.code).toBe('SERVER_SESSION_NOT_DRIVEABLE');
  });

  test('generic error → done.error.code = ACX_PROMPT_FAILED', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:claude:sess-42' }],
      throwOnSend: new Error('anything else'),
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable(baseInput)).done;
    expect(out.error?.code).toBe('ACX_PROMPT_FAILED');
  });

  test('output accumulator preserves any chunks received before the throw', async () => {
    // A prompt may surface partial agent text and then fail — the
    // callable should still return that text alongside the error.
    let onUpdate: ((u: unknown) => void) | undefined;
    const mgr = {
      clientSessionById() { return { id: 'acp-cli:claude:sess-42' }; },
      async clientSessionSend(send: { onUpdate?: (u: unknown) => void }) {
        onUpdate = send.onUpdate;
        send.onUpdate?.({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial ' } });
        send.onUpdate?.({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'reply' } });
        throw new Error('then it failed');
      },
    } as unknown as DualRoleManager;
    const callable = createProductionAcxSessionCallable(mgr);
    const out = await (await callable(baseInput)).done;
    expect(out.status).toBe('failed');
    expect(out.output).toBe('partial reply');
    expect(typeof onUpdate).toBe('function');
  });
});

describe('createProductionAcxSessionCallable · address shape variants', () => {
  test('client namespace passes through unchanged', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-cli:gemini-cli:sess-99' }],
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const { address } = await callable({ ...baseInput, sessionId: 'acp-cli:gemini-cli:sess-99' });
    expect(address).toBe('acx:acp-cli:gemini-cli:sess-99');
  });

  test('server namespace passes through unchanged', async () => {
    const mgr = fakeManager({
      records: [{ id: 'acp-srv:elanous-session-3' }],
    });
    const callable = createProductionAcxSessionCallable(mgr);
    const { address } = await callable({ ...baseInput, sessionId: 'acp-srv:elanous-session-3' });
    expect(address).toBe('acx:acp-srv:elanous-session-3');
  });
});
