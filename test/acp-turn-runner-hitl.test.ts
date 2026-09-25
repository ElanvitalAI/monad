// runAcpTurn · surface-scoped HITL wiring.
//
// Proves that a delegated ACP turn routes the sub-agent's permission
// (and clarifying-question) requests back to the SURFACE channel the
// caller passed. Each test opts into per-edit approval; without that
// opt-in, permissions are autonomously approved by contract.
//
// With `acp.editApproval` enabled, a channel's Reject answer must deny.
// No-surface-channel cases intentionally remain auto-approved: turn-runner
// bypasses HITL at src/acp/turn-runner.ts:90-92 when no channel exists.
//
// We stub the agent-manager singleton so `getAgent` captures the
// approvers runAcpTurn installs, and the stub `prompt` invokes the
// captured permission/question approver with a request whose sessionId
// matches the turn's session — mirroring what a real subprocess does
// over ACP `session/request_permission`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  runAcpTurn,
  _resetTurnRunnerCachesForTests,
} from '../src/acp/turn-runner';
import { _resetAcpSessionStoreForTests } from '../src/acp/session-store.js';
import { _resetAcpAgentManagerForTests } from '../src/acp/agent-manager.js';
import type {
  AcpPermissionApprover,
  AcpQuestionApprover,
} from '../src/acp/client.js';
import type { ConfirmChannel, ConfirmRequest, HitlAnswer } from '../src/hitl/confirm.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetMonadConfigDir, setMonadConfigDir } from '../src/monad-config-dir.js';
import { resetUserConfig } from '../src/user-config.js';

let testConfigDir: string | null = null;

interface Captured {
  permissionApprover?: AcpPermissionApprover;
  questionApprover?: AcpQuestionApprover;
}

/** Stub agent: ephemeral (no loadSession), mints a fixed session id,
 *  and on prompt() drives whatever approver getAgent captured — so the
 *  test can observe the full registry → approver → channel round-trip. */
function installStubAgent(opts: {
  captured: Captured;
  sessionId: string;
  onPrompt: (permApprover: AcpPermissionApprover | undefined, sessionId: string) => Promise<void>;
}): void {
  _resetAcpAgentManagerForTests();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/acp/agent-manager.js') as {
    globalAcpAgentManager: () => Record<string, unknown>;
  };
  const live = mod.globalAcpAgentManager();
  const stub = {
    getCapabilities: () => ({ loadSession: false }),
    newSession: async () => opts.sessionId,
    loadSession: async () => { /* unused (ephemeral) */ },
    async prompt(sessionId: unknown) {
      await opts.onPrompt(opts.captured.permissionApprover, String(sessionId));
      return { stopReason: 'end_turn' };
    },
    cancel: async () => { /* noop */ },
  };
  live['getAgent'] = async (
    _backendId: string,
    o?: { permissionApprover?: AcpPermissionApprover; questionApprover?: AcpQuestionApprover },
  ) => {
    opts.captured.permissionApprover = o?.permissionApprover;
    opts.captured.questionApprover = o?.questionApprover;
    return stub as unknown;
  };
  live['drop'] = () => { /* noop */ };
}

/** A surface ConfirmChannel that records prompts and answers with a
 *  fixed decision (simulating the user's tap). */
function fakeChannel(answer: HitlAnswer): { channel: ConfirmChannel; seen: ConfirmRequest[] } {
  const seen: ConfirmRequest[] = [];
  return {
    seen,
    channel: {
      name: 'telegram',
      async request(req: ConfirmRequest): Promise<HitlAnswer | null> {
        seen.push(req);
        return answer;
      },
      cancel() { /* noop */ },
    },
  };
}

beforeEach(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), 'turn-runner-hitl-'));
  setMonadConfigDir(testConfigDir);
  writeFileSync(join(testConfigDir, 'config.json'), JSON.stringify({ acp: { editApproval: true } }));
  resetUserConfig();
  _resetTurnRunnerCachesForTests();
  _resetAcpSessionStoreForTests();
});

afterEach(() => {
  _resetTurnRunnerCachesForTests();
  _resetAcpSessionStoreForTests();
  resetUserConfig();
  resetMonadConfigDir();
  if (testConfigDir) {
    try { rmSync(testConfigDir, { recursive: true, force: true }); } catch { /* noop */ }
    testConfigDir = null;
  }
});

describe('runAcpTurn · surface-scoped HITL', () => {
  test('permission request routes to the passed surface channel and its answer flows back', async () => {
    const captured: Captured = {};
    const { channel, seen } = fakeChannel(true);
    let approvedResult: boolean | undefined;

    installStubAgent({
      captured,
      sessionId: 'sess-approve',
      onPrompt: async (perm, sessionId) => {
        approvedResult = await perm!({
          backendId: 'claude',
          sessionId,
          title: 'edit src/foo.ts',
          options: [],
        });
      },
    });

    const r = await runAcpTurn({
      backendId: 'claude',
      promptText: 'add a feature',
      chatId: 1,
      hitlConfirmChannels: [channel],
    });

    expect(r.stopReason).toBe('end_turn');
    // The delegated agent's permission prompt reached the surface channel…
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toContain('edit src/foo.ts');
    // …and the user's Approve tap flowed back to the subprocess.
    expect(approvedResult).toBe(true);
  });

  test('a Reject tap denies the permission', async () => {
    const captured: Captured = {};
    const { channel } = fakeChannel(false);
    let approvedResult: boolean | undefined;

    installStubAgent({
      captured,
      sessionId: 'sess-reject',
      onPrompt: async (perm, sessionId) => {
        approvedResult = await perm!({ backendId: 'claude', sessionId, title: 'rm -rf', options: [] });
      },
    });

    await runAcpTurn({
      backendId: 'claude',
      promptText: 'clean up',
      chatId: 2,
      hitlConfirmChannels: [channel],
    });
    expect(approvedResult).toBe(false);
  });

  test('no surface channel ⇒ permission auto-approved despite edit oversight opt-in', async () => {
    const captured: Captured = {};
    let approvedResult: boolean | undefined;

    installStubAgent({
      captured,
      sessionId: 'sess-none',
      onPrompt: async (perm, sessionId) => {
        approvedResult = await perm!({ backendId: 'claude', sessionId, title: 'edit', options: [] });
      },
    });

    await runAcpTurn({
      backendId: 'claude',
      promptText: 'go',
      chatId: 3,
      // no hitlConfirmChannels
    });
    expect(approvedResult).toBe(true);
  });

  test('registry is cleared after the turn — a later unattended turn on the same session auto-approves', async () => {
    const captured: Captured = {};
    const { channel, seen } = fakeChannel(true);

    // Turn 1 — with a channel (approves).
    let firstResult: boolean | undefined;
    installStubAgent({
      captured,
      sessionId: 'sess-shared',
      onPrompt: async (perm, sessionId) => {
        firstResult = await perm!({ backendId: 'claude', sessionId, title: 't1', options: [] });
      },
    });
    await runAcpTurn({ backendId: 'claude', promptText: 'a', chatId: 9, hitlConfirmChannels: [channel] });
    expect(firstResult).toBe(true);
    expect(seen).toHaveLength(1);

    // Turn 2 — same session id, NO channel: the registry entry must have
    // been torn down rather than reusing turn 1's channel. The runner
    // deliberately auto-approves no-channel edits,
    // even with editApproval enabled (src/acp/turn-runner.ts:90-92).
    let secondResult: boolean | undefined;
    installStubAgent({
      captured,
      sessionId: 'sess-shared',
      onPrompt: async (perm, sessionId) => {
        secondResult = await perm!({ backendId: 'claude', sessionId, title: 't2', options: [] });
      },
    });
    await runAcpTurn({ backendId: 'claude', promptText: 'b', chatId: 9 });
    expect(secondResult).toBe(true);
    // `runAcpTurn`'s finally must delete the turn-one registry entry:
    // reusing it would make this unattended permission call `channel.request`.
    expect(seen).toHaveLength(1);
  });
});
