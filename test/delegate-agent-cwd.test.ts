// delegate_code_agent · cwd tilde expansion.
//
// The delegate cwd comes straight from the LLM tool call, which routinely
// emits `~/…` paths. `spawn` doesn't expand `~`, so a literal-tilde cwd
// made the ACP sub-process fail to start (ENOENT) — surfacing as a
// misleading "codex app-server stdin drain timeout". These tests pin that
// dispatchDelegateAgent expands `~` before it reaches session-create.

// 2026-07-12 followup: the LLM also names TARGET dirs that don't exist
// yet ("/tmp/x에 만들어줘" → cwd:/tmp/x); a missing cwd made posix_spawn
// die with a misleading binary-ENOENT delivered as an async 'error'
// event that killed the whole messenger process. dispatchDelegateAgent
// now mkdirs the requested cwd; AcpAgent.start() rejects cleanly on a
// still-missing cwd.

import { describe, test, expect, afterEach } from 'bun:test';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dispatchDelegateAgent } from '../src/boot/daemon-tools/delegate-agent';
import { AcpAgent } from '../src/acp/client';
import { __setDualRoleManagerForTest, type DualRoleManager } from '../src/acp/dual-role-manager';

const HOME = process.env.HOME || homedir() || '';

/** Fake DRM that records the cwd passed to clientSessionCreate. */
function installDrmCapturingCwd(): { created: Array<{ cwd?: string }> } {
  const created: Array<{ cwd?: string }> = [];
  const fake = {
    async clientSessionCreate(opts: { cwd?: string }) { created.push({ cwd: opts.cwd }); return { id: 'sub-1' }; },
    async clientSessionSetGoal() { return null; },
    async clientSessionGetGoal() { return null; },
    async clientSessionSend() { return { stopReason: 'end_turn' }; },
  };
  __setDualRoleManagerForTest(fake as unknown as DualRoleManager);
  return { created };
}

const baseCtx = { cwd: '/default/ctx/cwd', signal: new AbortController().signal };

afterEach(() => { __setDualRoleManagerForTest(null); });

describe('dispatchDelegateAgent · cwd tilde expansion', () => {
  test('~/path expands to $HOME/path before session-create', async () => {
    const { created } = installDrmCapturingCwd();
    await dispatchDelegateAgent({ backend: 'claude', task: 'x', cwd: '~/source/demo/monad-agent' }, { ...baseCtx });
    expect(created[0]!.cwd).toBe(`${HOME}/source/demo/monad-agent`);
    expect(created[0]!.cwd!.startsWith('~')).toBe(false);
  });

  test('bare ~ expands to $HOME', async () => {
    const { created } = installDrmCapturingCwd();
    await dispatchDelegateAgent({ backend: 'claude', task: 'x', cwd: '~' }, { ...baseCtx });
    expect(created[0]!.cwd).toBe(HOME);
  });

  test('absolute path passes through unchanged', async () => {
    const { created } = installDrmCapturingCwd();
    await dispatchDelegateAgent({ backend: 'claude', task: 'x', cwd: '/Users/example/source/demo/monad-agent' }, { ...baseCtx });
    expect(created[0]!.cwd).toBe('/Users/example/source/demo/monad-agent');
  });

  test('no cwd → falls back to ctx.cwd', async () => {
    const { created } = installDrmCapturingCwd();
    await dispatchDelegateAgent({ backend: 'claude', task: 'x' }, { ...baseCtx });
    expect(created[0]!.cwd).toBe('/default/ctx/cwd');
  });

  test('nonexistent target cwd is materialized before session-create', async () => {
    const root = mkdtempSync(join(tmpdir(), 'delegate-cwd-'));
    try {
      const target = join(root, 'not-yet', 'nested');
      expect(existsSync(target)).toBe(false);
      const { created } = installDrmCapturingCwd();
      await dispatchDelegateAgent({ backend: 'claude', task: 'x', cwd: target }, { ...baseCtx });
      expect(created[0]!.cwd).toBe(target);
      expect(existsSync(target)).toBe(true); // "/tmp/x에 만들어줘" intent honored
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('AcpAgent.start · spawn guards', () => {
  test('missing cwd rejects with the real cause (not a binary ENOENT crash)', async () => {
    const agent = new AcpAgent({ backendId: 'claude', cwd: '/nope/definitely/missing' });
    await expect(agent.start()).rejects.toThrow(/cwd does not exist/);
  });
});
