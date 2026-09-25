// ── RunShell ToolRuntime + registry wiring ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAllDefaultToolRuntimes } from '../src/tool-runtime/index';
import {
  getToolRuntime, dispatchToolByName, listToolRuntimes,
  _resetToolRuntimeRegistryForTest,
} from '../src/tool-runtime/registry';
import { runShellRuntime } from '../src/tool-runtime/run-shell-runtime';
import {
  setShellApprover, setAuditSinkForTesting,
} from '../src/shell-primitive';
import {
  _resetApprovalCacheForTesting,
} from '../src/shell-primitive/approval-cache';

describe('runShellRuntime registry', () => {
  let cwd: string;
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    _resetApprovalCacheForTesting();
    setShellApprover(null);
    setAuditSinkForTesting(() => { /* swallow */ });
    cwd = mkdtempSync(join(tmpdir(), 'run-shell-rt-'));
  });
  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    _resetToolRuntimeRegistryForTest();
    _resetApprovalCacheForTesting();
    setShellApprover(null);
    setAuditSinkForTesting(null);
  });

  test('registers under id "run_shell"', () => {
    registerAllDefaultToolRuntimes();
    expect(getToolRuntime('run_shell')).toBe(runShellRuntime);
  });

  test('aliases resolve via catalog', () => {
    registerAllDefaultToolRuntimes();
    expect(getToolRuntime('RunShell')).toBe(runShellRuntime);
    expect(getToolRuntime('exec_argv')).toBe(runShellRuntime);
  });

  test('dispatchToolByName delegates + returns LLM result shape', async () => {
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'RunShell',
      { command: ['echo', 'rt-hi'], cwd },
      { surface: 'dashboard' },
    ) as { output: string; exitCode: number; outcome: string };
    expect(res.exitCode).toBe(0);
    expect(res.outcome).toBe('exit');
    expect(res.output).toContain('outcome=exit');
  });

  test('ctx.signal reaches the child via the runtime', async () => {
    registerAllDefaultToolRuntimes();
    const ctrl = new AbortController();
    const p = dispatchToolByName(
      'RunShell',
      { command: ['sleep', '5'], cwd },
      { surface: 'dashboard', signal: ctrl.signal },
    );
    setTimeout(() => ctrl.abort(), 40);
    const res = await p as { outcome: string };
    expect(res.outcome).toBe('aborted');
  }, 10_000);

  test('listed under skill + tui hosts', () => {
    registerAllDefaultToolRuntimes();
    const skill = listToolRuntimes('skill');
    const tui = listToolRuntimes('tui');
    expect(skill.find(rt => rt.id === 'run_shell')).toBeTruthy();
    expect(tui.find(rt => rt.id === 'run_shell')).toBeTruthy();
  });
});
