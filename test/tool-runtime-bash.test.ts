// ── Bash ToolRuntime tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  bashRuntime,
  setBashRuntimeDeps,
  _getBashRuntimeDepsForTesting,
} from '../src/tool-runtime/bash-runtime';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index';
import { getToolRuntime, dispatchToolByName, _resetToolRuntimeRegistryForTest } from '../src/tool-runtime/registry';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetSessionWorkingDir, setSessionCwd } from '../src/session/working-dir';

describe('Bash ToolRuntime', () => {
  let cwd: string;

  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    setBashRuntimeDeps(null);
    cwd = mkdtempSync(join(tmpdir(), 'bash-rt-'));
  });

  afterEach(() => {
    _resetToolRuntimeRegistryForTest();
    setBashRuntimeDeps(null);
    __resetSessionWorkingDir();
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('registry registers the runtime under id "bash"', () => {
    registerAllDefaultToolRuntimes();
    expect(getToolRuntime('bash')).toBe(bashRuntime);
  });

  test('alias "Bash" resolves via catalog', () => {
    registerAllDefaultToolRuntimes();
    expect(getToolRuntime('Bash')).toBe(bashRuntime);
  });

  test('setBashRuntimeDeps stores deps', () => {
    setBashRuntimeDeps({ cwd, defaultTimeoutMs: 5000 });
    expect(_getBashRuntimeDepsForTesting()?.cwd).toBe(cwd);
  });

  test('WD5 — missing deps falls back to session-working-dir (no throw)', async () => {
    // After WD5, deps are optional: cwd is pulled lazily from the
    // session-working-dir singleton. The old fail-closed error is
    // gone because the runtime now has a sensible default.
    registerAllDefaultToolRuntimes();
    setBashRuntimeDeps(null);
    const res = await dispatchToolByName(
      'Bash',
      { command: 'true' },
      { surface: 'dashboard' },
    ) as { exitCode: number };
    expect(res.exitCode).toBe(0);
  });

  test('runs simple command and returns BashResult shape', async () => {
    setBashRuntimeDeps({ cwd });
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'Bash',
      { command: 'echo hello' },
      { surface: 'dashboard' },
    ) as { stdout: string; exitCode: number; output: string; durationMs: number };
    expect(res.stdout).toContain('hello');
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('hello');
  });

  test('non-zero exit code is surfaced via [exit N] prefix', async () => {
    setBashRuntimeDeps({ cwd });
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'Bash',
      { command: 'exit 3' },
      { surface: 'dashboard' },
    ) as { exitCode: number; output: string };
    expect(res.exitCode).toBe(3);
    expect(res.output).toContain('[exit 3]');
  });

  test('signal forwarding kills the child', async () => {
    setBashRuntimeDeps({ cwd });
    registerAllDefaultToolRuntimes();
    const ctrl = new AbortController();
    const p = dispatchToolByName(
      'Bash',
      { command: 'sleep 10' },
      { surface: 'dashboard', signal: ctrl.signal },
    );
    // Abort shortly after — child should die and the runtime resolve.
    setTimeout(() => ctrl.abort(), 50);
    const res = await p as { aborted: boolean; output: string };
    expect(res.aborted).toBe(true);
    expect(res.output).toContain('[aborted]');
  }, 5000);

  test('empty command returns the empty-result sentinel', async () => {
    setBashRuntimeDeps({ cwd });
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'Bash',
      { command: '   ' },
      { surface: 'dashboard' },
    ) as { output: string };
    expect(res.output).toContain('(no command supplied)');
  });

  test('WD5 — deps without cwd pulls cwd from session-working-dir', async () => {
    // Pin SWD to the tmp cwd. Run pwd via bash to confirm the child
    // actually spawned there. This proves the runtime reads SWD at
    // dispatch time, not at setBashRuntimeDeps() time.
    setSessionCwd(cwd, 'user');
    setBashRuntimeDeps({});
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'Bash',
      { command: 'pwd' },
      { surface: 'dashboard' },
    ) as { stdout: string };
    // macOS /var vs /private/var symlink — accept either form.
    const actual = res.stdout.trim();
    expect(actual === cwd || actual === `/private${cwd}` || actual.endsWith(cwd.replace(/^.*\//, '/'))).toBe(true);
  });
});
