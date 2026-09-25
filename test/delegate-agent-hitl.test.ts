// delegate_code_agent · surface-scoped HITL.
//
// Surface channels route edit permissions to a human only when
// `acp.editApproval` opts into per-edit oversight. Otherwise delegation
// remains unattended and auto-approved.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchDelegateAgent } from '../src/boot/daemon-tools/delegate-agent';
import { resetMonadConfigDir, setMonadConfigDir } from '../src/monad-config-dir';
import { resetUserConfig } from '../src/user-config';
import {
  __setDualRoleManagerForTest,
  type DualRoleManager,
} from '../src/acp/dual-role-manager';
import type { ConfirmChannel, ConfirmRequest, HitlAnswer } from '../src/hitl/confirm';

function fakeChannel(answer: HitlAnswer): { channel: ConfirmChannel; seen: ConfirmRequest[] } {
  const seen: ConfirmRequest[] = [];
  return {
    seen,
    channel: {
      name: 'telegram',
      async request(req: ConfirmRequest): Promise<HitlAnswer | null> { seen.push(req); return answer; },
      cancel() { /* noop */ },
    },
  };
}

/** Fake DualRoleManager: capture the create opts, and on send invoke the
 *  captured permissionApprover with a synthetic permission request —
 *  simulating the sub-agent asking to edit a file mid-turn. */
function installFakeDrm(): { createOpts: () => any; approverAnswer: () => boolean | undefined } {
  let createOpts: any = null;
  let approverAnswer: boolean | undefined;
  const fake = {
    async clientSessionCreate(opts: any) { createOpts = opts; return { id: 'sub-1' }; },
    async clientSessionSend(_opts: any) {
      if (typeof createOpts?.permissionApprover === 'function') {
        approverAnswer = await createOpts.permissionApprover({
          backendId: 'claude',
          sessionId: 'sub-1',
          title: 'edit src/foo.ts',
          options: [],
        });
      }
      return { stopReason: 'end_turn' };
    },
  };
  __setDualRoleManagerForTest(fake as unknown as DualRoleManager);
  return { createOpts: () => createOpts, approverAnswer: () => approverAnswer };
}

const baseCtx = { cwd: process.cwd(), signal: new AbortController().signal };

let testConfigDir: string | null = null;

function setEditApproval(editApproval: boolean): void {
  if (!testConfigDir) throw new Error('test config directory not initialized');
  writeFileSync(join(testConfigDir, 'config.json'), JSON.stringify({ acp: { editApproval } }));
  resetUserConfig();
}

beforeEach(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), 'delegate-agent-hitl-'));
  setMonadConfigDir(testConfigDir);
  setEditApproval(true);
});

afterEach(() => {
  __setDualRoleManagerForTest(null);
  resetUserConfig();
  resetMonadConfigDir();
  if (testConfigDir) {
    rmSync(testConfigDir, { recursive: true, force: true });
    testConfigDir = null;
  }
});

describe('dispatchDelegateAgent · surface HITL', () => {
  test('with surface channels → interactive (permissionMode default, approves via chat)', async () => {
    const drm = installFakeDrm();
    const { channel, seen } = fakeChannel(true);

    const res = await dispatchDelegateAgent(
      { backend: 'claude', task: 'implement a feature' },
      { ...baseCtx, surfaceHitlChannels: [channel] },
    ) as Record<string, unknown>;

    expect(drm.createOpts().permissionMode).toBe('default');
    // The sub-agent's permission prompt reached the surface channel…
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toContain('edit src/foo.ts');
    // …and the user's Approve tap flowed back.
    expect(drm.approverAnswer()).toBe(true);
    expect(res.stopReason).toBe('end_turn');
  });

  test('surface channel rejects → permission denied', async () => {
    const drm = installFakeDrm();
    const { channel } = fakeChannel(false);
    await dispatchDelegateAgent(
      { backend: 'claude', task: 'rm stuff' },
      { ...baseCtx, surfaceHitlChannels: [channel] },
    );
    expect(drm.approverAnswer()).toBe(false);
  });

  test('surface channels without editApproval → unattended auto-approve (permissionMode auto)', async () => {
    setEditApproval(false);
    const drm = installFakeDrm();
    await dispatchDelegateAgent(
      { backend: 'claude', task: 'self-improving PR draft' },
      { ...baseCtx, surfaceHitlChannels: [fakeChannel(true).channel] },
    );
    expect(drm.createOpts().permissionMode).toBe('auto');
    // Auto-approver grants without per-edit oversight.
    expect(drm.approverAnswer()).toBe(true);
  });

  test('no surface channels → unattended auto-approve (permissionMode auto)', async () => {
    const drm = installFakeDrm();
    await dispatchDelegateAgent(
      { backend: 'claude', task: 'self-improving PR draft' },
      { ...baseCtx },
    );
    expect(drm.createOpts().permissionMode).toBe('auto');
    // Auto-approver grants without any channel.
    expect(drm.approverAnswer()).toBe(true);
  });

  test('rejects unknown backend before creating a session', async () => {
    installFakeDrm();
    const res = await dispatchDelegateAgent(
      { backend: 'not-a-backend', task: 'x' },
      { ...baseCtx },
    ) as Record<string, unknown>;
    expect(typeof res.error).toBe('string');
  });
});
