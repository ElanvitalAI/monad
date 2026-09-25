// ── Track H: dashboard surface defaults sandbox='auto' ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchToolByName, _resetToolRuntimeRegistryForTest } from '../src/tool-runtime/registry';
import {
  registerAllDefaultToolRuntimes, setBashRuntimeDeps,
} from '../src/tool-runtime/index';
import {
  setShellApprover, setAuditSinkForTesting,
} from '../src/shell-primitive';
import { _resetApprovalCacheForTesting } from '../src/shell-primitive/approval-cache';

describe('Track H: RunShell dashboard surface default sandbox', () => {
  let cwd: string;
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    _resetApprovalCacheForTesting();
    setShellApprover(null);
    setAuditSinkForTesting(() => { /* noop */ });
    cwd = mkdtempSync(join(tmpdir(), 'rt-h-'));
  });
  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    _resetToolRuntimeRegistryForTest();
    _resetApprovalCacheForTesting();
    setShellApprover(null);
    setAuditSinkForTesting(null);
  });

  test('dashboard + no explicit sandbox → wrapped on darwin', async () => {
    if (process.platform !== 'darwin') return;
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'RunShell',
      { command: ['/bin/echo', 'h'] },
      { surface: 'dashboard' },
    ) as { sandboxed: boolean; sandboxTool: string };
    expect(res.sandboxed).toBe(true);
    expect(res.sandboxTool).toBe('sandbox-exec');
  });

  test('dashboard + explicit sandbox=off → NOT wrapped', async () => {
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'RunShell',
      { command: ['/bin/echo', 'h'], sandbox: 'off' },
      { surface: 'dashboard' },
    ) as { sandboxed: boolean };
    expect(res.sandboxed).toBe(false);
  });

  test('skill surface + no sandbox → NOT wrapped (skill default off)', async () => {
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'RunShell',
      { command: ['/bin/echo', 'h'] },
      { surface: 'skill' },
    ) as { sandboxed: boolean };
    expect(res.sandboxed).toBe(false);
  });
});

describe('Track H: Bash dashboard surface default sandbox', () => {
  let cwd: string;
  beforeEach(() => {
    _resetToolRuntimeRegistryForTest();
    cwd = mkdtempSync(join(tmpdir(), 'rt-h-bash-'));
    setBashRuntimeDeps({ cwd });
  });
  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    _resetToolRuntimeRegistryForTest();
    setBashRuntimeDeps(null);
  });

  test('dashboard surface default sandbox=auto wraps Bash on darwin', async () => {
    if (process.platform !== 'darwin') return;
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'Bash',
      { command: 'echo h' },
      { surface: 'dashboard' },
    ) as { sandboxed: boolean; sandboxTool: string };
    expect(res.sandboxed).toBe(true);
    expect(res.sandboxTool).toBe('sandbox-exec');
  });

  test('LLM explicit sandbox=off wins over dashboard default', async () => {
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'Bash',
      { command: 'echo h', sandbox: 'off' },
      { surface: 'dashboard' },
    ) as { sandboxed: boolean };
    expect(res.sandboxed).toBe(false);
  });

  test('skill surface: unchanged (no sandbox default)', async () => {
    registerAllDefaultToolRuntimes();
    const res = await dispatchToolByName(
      'Bash',
      { command: 'echo h' },
      { surface: 'skill' },
    ) as { sandboxed: boolean };
    expect(res.sandboxed).toBe(false);
  });
});
