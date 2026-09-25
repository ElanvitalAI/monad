// CV-3 Phase α — HITL Pushcut intercept · agent-cli REST approver wire.
//
// Validates the loop closed by `docs/PLAN-cv-3-hitl-pushcut-intercept-
// 2026-05-08.md` Phase α-1/α-2/α-3:
//
//   POST /v1/agent-cli/sessions
//      → handleAgentCliCreateSession
//      → globalDualRoleManager().clientSessionCreate({
//            permissionApprover, questionApprover  ← THIS PR
//        })
//
// PR #2009 already registered a Pushcut confirm channel into
// `registerDefaultConfirmChannels`, but until this PR no caller was
// actually triggering the channel race for agent CLI sessions.
//
// Test seam:
//   • `__setDualRoleManagerForTest(fake)` lets us capture the opts
//     handed to `clientSessionCreate` without spawning a real CLI.
//   • `_setAgentCliHitlApproversForTest({...})` injects deterministic
//     approver functions so we can assert they reach the manager.
//   • `_resetAgentCliHitlApproversForTest()` flips the lazy memoization
//     back so the next call exercises the factory path.
//   • `registerDefaultConfirmChannels([...])` lets us drive the channel
//     race the lazy factory uses; we plant a single fake "always-yes"
//     channel for the timeout-deny smoke.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  _resetAgentCliHitlApproversForTest,
  _setAgentCliHitlApproversForTest,
  handleAgentCliCreateSession,
} from '../src/nexus/api/agent-cli.js';
import type { MetaApiOpts } from '../src/nexus/api/meta-api.js';
import { __setDualRoleManagerForTest } from '../src/acp/dual-role-manager.js';
import {
  registerDefaultConfirmChannels,
  type ConfirmChannel,
  type HitlAnswer,
} from '../src/hitl/confirm.js';
import type { AcpPermissionApprover, AcpQuestionApprover } from '../src/acp/client.js';
import { createAcpPermissionApproverFromHitl } from '../src/hitl/hitl-acp-adapter.js';
import { setUserConfigOverlay } from '../src/user-config.js';

interface CapturedCreate {
  backendId: string;
  cwd: string;
  permissionApprover?: AcpPermissionApprover;
  questionApprover?: AcpQuestionApprover;
}

function makeCapturingFakeManager() {
  const captured: CapturedCreate[] = [];
  const records = new Map<string, { id: string; backendId: string; cwd: string }>();
  return {
    captured,
    async clientSessionCreate(o: CapturedCreate): Promise<{
      id: string;
      backendId: string;
      backendSessionId: string;
      cwd: string;
      createdAt: number;
    }> {
      captured.push(o);
      const rec = {
        id: `acp-cli:${o.backendId}:test-${captured.length}`,
        backendId: o.backendId,
        backendSessionId: `bk-${captured.length}`,
        cwd: o.cwd,
        createdAt: Date.now(),
      };
      records.set(rec.id, rec);
      return rec;
    },
  };
}

function makeFakeChannel(opts: {
  name?: string;
  answer?: HitlAnswer;
  delayMs?: number;
}): ConfirmChannel {
  let calls = 0;
  return {
    name: opts.name ?? 'fake-pushcut',
    async request() {
      calls += 1;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return opts.answer ?? null;
    },
    cancel() { /* noop */ },
    // expose for assertion via type-cast in the test
    get _calls() { return calls; },
  } as ConfirmChannel & { _calls: number };
}

const opts: MetaApiOpts = { noAuth: true };

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function enableEditApproval(): void {
  setUserConfigOverlay((config) => ({ ...config, acp: { ...config.acp, editApproval: true } }));
}

function useHitlPermissionApprover(): void {
  _setAgentCliHitlApproversForTest({
    permissionApprover: createAcpPermissionApproverFromHitl(),
  });
}

beforeEach(() => {
  setUserConfigOverlay(null);
  // Each test starts with a fresh, empty default channel set so a
  // confirm.race in one test cannot bleed into the next via the
  // module-scope `defaultChannels` array.
  registerDefaultConfirmChannels([]);
  _resetAgentCliHitlApproversForTest();
});

afterEach(() => {
  setUserConfigOverlay(null);
  __setDualRoleManagerForTest(null);
  registerDefaultConfirmChannels([]);
  _resetAgentCliHitlApproversForTest();
});

describe('Phase α — handleAgentCliCreateSession HITL approver wire', () => {
  test('passes BOTH approvers to clientSessionCreate (lazy factory path)', async () => {
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    expect(res.status).toBe(200);
    expect(fake.captured).toHaveLength(1);
    const captured = fake.captured[0]!;
    expect(typeof captured.permissionApprover).toBe('function');
    expect(typeof captured.questionApprover).toBe('function');
  });

  test('memoizes approvers across multiple session creates (same fn refs)', async () => {
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'claude' }),
      opts,
    );
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'gemini' }),
      opts,
    );
    expect(fake.captured).toHaveLength(3);
    const [a, b, c] = fake.captured;
    expect(a!.permissionApprover).toBe(b!.permissionApprover);
    expect(b!.permissionApprover).toBe(c!.permissionApprover);
    expect(a!.questionApprover).toBe(b!.questionApprover);
    expect(b!.questionApprover).toBe(c!.questionApprover);
  });

  test('all three SUPPORTED_BACKENDS receive the wire (codex/claude/gemini)', async () => {
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    for (const backend of ['codex-app-server', 'claude', 'gemini']) {
      const res = await handleAgentCliCreateSession(
        postJson('http://localhost/v1/agent-cli/sessions', { backend }),
        opts,
      );
      expect(res.status).toBe(200);
    }
    expect(fake.captured.map((c) => c.backendId)).toEqual([
      'codex-app-server', 'claude', 'gemini',
    ]);
    for (const c of fake.captured) {
      expect(typeof c.permissionApprover).toBe('function');
      expect(typeof c.questionApprover).toBe('function');
    }
  });

  test('400 invalid-backend SKIPS the wire (no manager call · no approver build)', async () => {
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    const res = await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'totally-fake' }),
      opts,
    );
    expect(res.status).toBe(400);
    expect(fake.captured).toHaveLength(0);
  });

  test('test seam: _setAgentCliHitlApproversForTest injects custom approvers', async () => {
    const sentinelPerm: AcpPermissionApprover = async () => true;
    const sentinelQuestion: AcpQuestionApprover = async () => ({ answers: {} });
    _setAgentCliHitlApproversForTest({
      permissionApprover: sentinelPerm,
      questionApprover: sentinelQuestion,
    });
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    expect(fake.captured[0]!.permissionApprover).toBe(sentinelPerm);
    expect(fake.captured[0]!.questionApprover).toBe(sentinelQuestion);
  });

  test('test seam: _resetAgentCliHitlApproversForTest forces fresh factory build', async () => {
    const sentinelPerm: AcpPermissionApprover = async () => true;
    _setAgentCliHitlApproversForTest({ permissionApprover: sentinelPerm });
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    expect(fake.captured[0]!.permissionApprover).toBe(sentinelPerm);
    _resetAgentCliHitlApproversForTest();
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'claude' }),
      opts,
    );
    // Factory rebuild — fresh function, NOT the sentinel.
    expect(fake.captured[1]!.permissionApprover).not.toBe(sentinelPerm);
    expect(typeof fake.captured[1]!.permissionApprover).toBe('function');
  });
});

describe('Phase α — permission approver autonomy and opt-in confirm routing', () => {
  test('without acp.editApproval bypasses registered confirm channels and resolves true', async () => {
    const noChannel = makeFakeChannel({ name: 'pushcut', answer: false });
    registerDefaultConfirmChannels([noChannel]);
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    const ok = await fake.captured[0]!.permissionApprover!({
      backendId: 'codex-app-server',
      sessionId: 'bk-1',
      title: 'run bash ls /etc',
    } as never);
    expect(ok).toBe(true);
    expect((noChannel as ConfirmChannel & { _calls: number })._calls).toBe(0);
  });

  test('with acp.editApproval routes through a registered confirm channel and resolves true', async () => {
    enableEditApproval();
    useHitlPermissionApprover();
    const yesChannel = makeFakeChannel({ name: 'pushcut', answer: true });
    registerDefaultConfirmChannels([yesChannel]);
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    const approver = fake.captured[0]!.permissionApprover!;
    const ok = await approver({
      backendId: 'codex-app-server',
      sessionId: 'bk-1',
      title: 'run bash ls /etc',
    } as never);
    expect(ok).toBe(true);
    expect((yesChannel as ConfirmChannel & { _calls: number })._calls).toBe(1);
  });

  test('with acp.editApproval denies when every channel returns null (deny-on-timeout / fail-closed)', async () => {
    enableEditApproval();
    useHitlPermissionApprover();
    // No channels registered → every request resolves to "all-failed"
    // → onTimeout fallback fires → deny per D3=A.
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    const approver = fake.captured[0]!.permissionApprover!;
    const ok = await approver({
      backendId: 'codex-app-server',
      sessionId: 'bk-1',
      title: 'edit /etc/hosts',
    } as never);
    expect(ok).toBe(false);
  });

  test('with acp.editApproval denies when a registered channel returns explicit false', async () => {
    enableEditApproval();
    useHitlPermissionApprover();
    const noChannel = makeFakeChannel({ name: 'pushcut', answer: false });
    registerDefaultConfirmChannels([noChannel]);
    const fake = makeCapturingFakeManager();
    __setDualRoleManagerForTest(fake as never);
    await handleAgentCliCreateSession(
      postJson('http://localhost/v1/agent-cli/sessions', { backend: 'codex-app-server' }),
      opts,
    );
    const approver = fake.captured[0]!.permissionApprover!;
    const ok = await approver({
      backendId: 'codex-app-server',
      sessionId: 'bk-1',
      title: 'rm -rf node_modules',
    } as never);
    expect(ok).toBe(false);
    expect((noChannel as ConfirmChannel & { _calls: number })._calls).toBe(1);
  });
});
