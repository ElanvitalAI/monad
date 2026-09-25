// ── EnterWorktree / ExitWorktree runtime tests (GT4) ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  enterWorktreeRuntime,
  exitWorktreeRuntime,
  setWorktreeRuntimeDeps,
} from '../src/tool-runtime/git-worktree-runtimes';
import {
  __resetSessionWorkingDir,
  getSessionCwd,
  initSessionWorkingDir,
  setSessionCwd,
} from '../src/session/working-dir';
import {
  worktreeParentDir,
  clearWorktreeSession,
  loadWorktreeSession,
} from '../src/git-fs/worktree';
import { __resetGitFsCache } from '../src/git-fs';
import { getUserConfig, setUserConfigOverlay } from '../src/user-config';

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd, stdio: 'pipe',
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

const SID = 'test-' + String(process.pid);

describe('EnterWorktree / ExitWorktree runtimes', () => {
  let repo: string;
  let worktreeRootDir: string;
  let parentCleanupPath: string | null = null;

  beforeEach(() => {
    __resetSessionWorkingDir();
    __resetGitFsCache();
    setWorktreeRuntimeDeps({ sessionId: () => SID });
    clearWorktreeSession(SID);
    repo = mkdtempSync(join(tmpdir(), 'gt4-repo-'));
    // ⛔⭐⭐ worktree 뿌리를 «임시 디렉터리로» 덮는다 — 안 덮으면 EnterWorktree 가 실제
    //    `~/.monad/worktrees/` 아래에 worktree 를 만들고 사용자 디렉터리에 잔존물을 남긴다(리뷰 must-fix ②).
    //    ⚠️ 그리고 종전 `parentCleanupPath` 는 `worktreeParentDir(repo)` 를 «뿌리 인자 없이» 계산해
    //    옛 형제 경로를 가리켰다 — 즉 ***정리가 실제 생성 자리를 안 지우고 있었다.***
    worktreeRootDir = mkdtempSync(join(tmpdir(), 'gt4-wtroot-'));
    setUserConfigOverlay((c) => ({
      ...c,
      tools: { ...c.tools, selfImplement: { ...c.tools.selfImplement, worktreeRoot: worktreeRootDir } },
    }));
    runGit(repo, ['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'a.txt'), 'hi');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-q', '-m', 'init']);
    initSessionWorkingDir(repo);
    // ⭐ 프로덕션이 실제로 쓰는 뿌리와 «같은 인자»로 계산한다(위 결손의 수리).
    parentCleanupPath = worktreeParentDir(repo, getUserConfig().tools.selfImplement.worktreeRoot);
  });

  afterEach(() => {
    __resetSessionWorkingDir();
    __resetGitFsCache();
    setWorktreeRuntimeDeps(null);
    clearWorktreeSession(SID);
    try { rmSync(repo, { recursive: true, force: true }); } catch {}
    if (parentCleanupPath && existsSync(parentCleanupPath)) {
      try { rmSync(parentCleanupPath, { recursive: true, force: true }); } catch {}
    }
    try { rmSync(worktreeRootDir, { recursive: true, force: true }); } catch {}
    setUserConfigOverlay(null);
  });

  test('EnterWorktree creates worktree + branch + flips SWD', async () => {
    const r = await enterWorktreeRuntime.run({ name: 'feat-x' }, { surface: 'dashboard' });
    expect(r.branch).toBe('feat-x');
    expect(r.path).toContain('.worktrees');
    expect(existsSync(r.path)).toBe(true);
    expect(getSessionCwd()).toBe(resolve(r.path));
    // Persisted session state
    const s = loadWorktreeSession(SID);
    expect(s).not.toBeNull();
    expect(s!.branch).toBe('feat-x');
    expect(s!.previousCwd).toBe(resolve(repo));
  });

  test('EnterWorktree records agent ownership provenance in the created worktree', async () => {
    const r = await enterWorktreeRuntime.run({ name: 'feat-provenance' }, { surface: 'dashboard' });

    expect(runGit(r.path, ['config', '--get', 'extensions.worktreeConfig']).trim()).toBe('true');
    expect(runGit(r.path, ['config', '--worktree', '--get', 'monad.harness.owner']).trim()).toBe(`agent:${SID}`);
    expect(runGit(r.path, ['config', '--worktree', '--get', 'monad.harness.command']).trim()).toBe('monad enter_worktree');
    expect(runGit(r.path, ['config', '--worktree', '--get', 'monad.harness.createdAt']).trim()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.provenanceError).toBeUndefined();
  });

  test('EnterWorktree retains its workspace and reports a provenance failure', async () => {
    setWorktreeRuntimeDeps({
      sessionId: () => SID,
      recordWorktreeProvenance: () => { throw new Error('provenance unavailable'); },
    });

    const r = await enterWorktreeRuntime.run({ name: 'feat-provenance-failure' }, { surface: 'dashboard' });

    expect(existsSync(r.path)).toBe(true);
    expect(getSessionCwd()).toBe(resolve(r.path));
    expect(r.provenanceError).toBe('provenance unavailable');
    expect(r.output).toContain('ownership recording failed: provenance unavailable');
  });

  test('EnterWorktree rejects invalid branch names', async () => {
    await expect(
      enterWorktreeRuntime.run({ name: '-invalid' }, { surface: 'dashboard' }),
    ).rejects.toThrow();
    await expect(
      enterWorktreeRuntime.run({ name: 'has space' }, { surface: 'dashboard' }),
    ).rejects.toThrow();
    await expect(
      enterWorktreeRuntime.run({ name: '' }, { surface: 'dashboard' }),
    ).rejects.toThrow(/required/);
  });

  test('ExitWorktree restores SWD; keeps dir by default', async () => {
    const r = await enterWorktreeRuntime.run({ name: 'feat-y' }, { surface: 'dashboard' });
    const wtPath = r.path;
    const exitRes = await exitWorktreeRuntime.run({}, { surface: 'dashboard' });
    expect(exitRes.returnedTo).toBe(resolve(repo));
    expect(exitRes.pruned).toBe(false);
    expect(getSessionCwd()).toBe(resolve(repo));
    expect(existsSync(wtPath)).toBe(true);
    expect(loadWorktreeSession(SID)).toBeNull();
  });

  test('ExitWorktree with prune removes the worktree dir', async () => {
    const r = await enterWorktreeRuntime.run({ name: 'feat-p' }, { surface: 'dashboard' });
    const wtPath = r.path;
    const exitRes = await exitWorktreeRuntime.run({ prune: true }, { surface: 'dashboard' });
    expect(exitRes.pruned).toBe(true);
    expect(existsSync(wtPath)).toBe(false);
  });

  test('ExitWorktree errors when no session is active', async () => {
    await expect(
      exitWorktreeRuntime.run({}, { surface: 'dashboard' }),
    ).rejects.toThrow(/no active worktree session/);
  });

  test('EnterWorktree errors outside a git repo', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'gt4-outside-'));
    try {
      setSessionCwd(outside, 'user');
      await expect(
        enterWorktreeRuntime.run({ name: 'x' }, { surface: 'dashboard' }),
      ).rejects.toThrow(/not inside a git repo/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('EnterWorktree from inside an existing worktree creates siblings of MAIN repo', async () => {
    const r1 = await enterWorktreeRuntime.run({ name: 'feat-a' }, { surface: 'dashboard' });
    // SWD is now inside feat-a. Clear session so a second EnterWorktree is valid.
    clearWorktreeSession(SID);
    const r2 = await enterWorktreeRuntime.run({ name: 'feat-b' }, { surface: 'dashboard' });
    // Both should sit under the configured repository root, not inside feat-a.
    expect(r2.path).not.toContain(r1.path);
    expect(r2.path).toContain(worktreeParentDir(repo, getUserConfig().tools.selfImplement.worktreeRoot));
  });
});
