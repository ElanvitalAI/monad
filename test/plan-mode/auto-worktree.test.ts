// ── Plan ↔ Worktree auto-link tests (Coding Pipeline P4 followup) ──
//
// Verifies dispatchEnterPlanMode honors `plan.autoWorktree`:
//   - default (off) → no worktree path returned, no auto-worktree note
//   - on, but cwd not a git repo → soft-fail, plan mode still active
//   - on with a real temp git repo → worktree path returned, branch
//     created, SWD flipped to it
//
// We seed an XDG_CONFIG_HOME-rooted config.json with the desired
// autoWorktree value, then resetUserConfig() so the next
// getUserConfig() picks it up.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  dispatchEnterPlanMode,
  getPlanModeState,
  resetPlanModeState,
} from '../../src/plan-mode/index.js';
import {
  resetPolicyToDefault,
  setPolicy,
  _resetPlanStateForTesting,
} from '../../src/code-edit/index.js';
import { setPlanToolPlanModeGuard } from '../../src/code-edit/plan-tool.js';
import {
  resetUserConfig,
  reloadUserConfig,
  userConfigPath,
} from '../../src/user-config.js';
import {
  setSessionCwd,
  getSessionCwd,
} from '../../src/session/working-dir.js';
import { setWorktreeRuntimeDeps } from '../../src/tool-runtime/git-worktree-runtimes.js';

const prevHome = process.env.HOME;
const prevXdg = process.env.XDG_CONFIG_HOME;
const prevCwd = process.cwd();
const dirs: string[] = [];

function seedConfig(home: string, autoWorktree: boolean): void {
  const cfgDir = join(home, 'elanous');
  mkdirSync(cfgDir, { recursive: true });
  const cfg = autoWorktree ? { plan: { autoWorktree: true } } : {};
  writeFileSync(join(cfgDir, 'config.json'), JSON.stringify(cfg, null, 2));
  resetUserConfig();
  reloadUserConfig(userConfigPath());
}

beforeEach(() => {
  const d = mkdtempSync(join(tmpdir(), 'pm-aw-'));
  dirs.push(d);
  process.env.HOME = d;
  process.env.XDG_CONFIG_HOME = d;
  setPolicy({ mode: 'ask-edit' });
  _resetPlanStateForTesting();
  setWorktreeRuntimeDeps({ sessionId: () => 'test' });
});

afterEach(() => {
  resetPlanModeState();
  resetPolicyToDefault();
  setPlanToolPlanModeGuard(null);
  setWorktreeRuntimeDeps(null);
  resetUserConfig();
  process.env.HOME = prevHome;
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  setSessionCwd(prevCwd, 'tool');
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('dispatchEnterPlanMode + plan.autoWorktree=false (default)', () => {
  test('no worktreePath in result; no auto-worktree note in output', async () => {
    seedConfig(process.env.HOME!, false);
    const r = await dispatchEnterPlanMode({ initialTitle: 'Fix bug' });
    expect(r.worktreePath).toBeUndefined();
    expect(r.worktreeBranch).toBeUndefined();
    expect(r.output).not.toContain('Auto worktree');
    expect(getPlanModeState().active).toBe(true);
  });
});

describe('dispatchEnterPlanMode + plan.autoWorktree=true, cwd not a git repo', () => {
  test('soft-fails; plan mode still active; output carries the skip notice', async () => {
    seedConfig(process.env.HOME!, true);
    // Point session cwd at a non-git temp dir so enterWorktreeRuntime
    // throws and the helper records the skip.
    const nonGitDir = mkdtempSync(join(tmpdir(), 'pm-aw-nongit-'));
    dirs.push(nonGitDir);
    setSessionCwd(nonGitDir, 'tool');
    const r = await dispatchEnterPlanMode({ initialTitle: 'Try thing' });
    expect(r.worktreePath).toBeUndefined();
    expect(r.output).toContain('Auto worktree skipped');
    // Plan mode should still be active — auto-worktree failure must not
    // block entry.
    expect(getPlanModeState().active).toBe(true);
  });
});

describe('dispatchEnterPlanMode + plan.autoWorktree=true with a real git repo', () => {
  test('creates a worktree, flips SWD, returns path + branch', async () => {
    seedConfig(process.env.HOME!, true);
    // Set up a temp git repo so enterWorktreeRuntime can create a
    // worktree off it.
    const repoDir = mkdtempSync(join(tmpdir(), 'pm-aw-repo-'));
    dirs.push(repoDir);
    execSync('git init -q -b main', { cwd: repoDir });
    execSync('git config user.email t@t.com && git config user.name t', { cwd: repoDir });
    writeFileSync(join(repoDir, 'README.md'), '# t\n');
    execSync('git add README.md && git commit -q -m init', { cwd: repoDir });
    setSessionCwd(repoDir, 'tool');
    const r = await dispatchEnterPlanMode({ initialTitle: 'Refactor cache' });
    expect(r.worktreePath).toBeTruthy();
    expect(r.worktreeBranch).toBeTruthy();
    // Branch synthesised under session/<ts>-refactor-cache
    expect(r.worktreeBranch!).toContain('refactor-cache');
    // Output should announce the worktree path
    expect(r.output).toContain('Auto worktree →');
    // SWD should now point at the worktree dir, not the original
    expect(getSessionCwd()).toBe(r.worktreePath!);
    // Plan mode active, with the original initialTitle preserved
    const s = getPlanModeState();
    expect(s.active).toBe(true);
    expect(s.title).toBe('Refactor cache');
  });
});
