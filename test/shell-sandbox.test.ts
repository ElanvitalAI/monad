// ── Codex X3 — sandbox wrapper tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySandbox, buildMacOsProfile, SandboxUnavailableError,
  runShell, setShellApprover, setAuditSinkForTesting,
} from '../src/shell-primitive';
import { _resetApprovalCacheForTesting } from '../src/shell-primitive/approval-cache';

describe('buildMacOsProfile', () => {
  test('includes deny network* when network=off', () => {
    const prof = buildMacOsProfile({ cwd: '/tmp/foo', network: 'off' });
    expect(prof).toContain('(deny network*)');
    expect(prof).not.toContain('(allow network*)');
  });

  test('includes allow network* when network=inherit', () => {
    const prof = buildMacOsProfile({ cwd: '/tmp/foo', network: 'inherit' });
    expect(prof).toContain('(allow network*)');
  });

  test('writes restricted to cwd + /tmp', () => {
    const prof = buildMacOsProfile({ cwd: '/home/me/proj', network: 'inherit' });
    expect(prof).toContain('(deny file-write*)');
    expect(prof).toContain('(allow file-write* (subpath "/home/me/proj"))');
    expect(prof).toContain('(allow file-write* (subpath "/tmp"))');
  });

  test('escapes quotes in cwd', () => {
    const prof = buildMacOsProfile({ cwd: '/weird "dir"', network: 'inherit' });
    expect(prof).toContain('/weird \\"dir\\"');
  });
});

describe('applySandbox (pure)', () => {
  test('sandbox=off returns argv unchanged', () => {
    const d = applySandbox({
      command: ['echo', 'hi'], cwd: '/tmp', sandbox: 'off',
    });
    expect(d.sandboxed).toBe(false);
    expect(d.tool).toBe('none');
    expect(d.command).toEqual(['echo', 'hi']);
  });

  test('sandbox=auto on darwin wraps in sandbox-exec', () => {
    if (process.platform !== 'darwin') return;
    const d = applySandbox({
      command: ['echo', 'hi'], cwd: '/tmp', sandbox: 'auto',
    });
    expect(d.sandboxed).toBe(true);
    expect(d.tool).toBe('sandbox-exec');
    expect(d.command[0]).toBe('/usr/bin/sandbox-exec');
    expect(d.command).toContain('-p');
    // original argv is preserved at the tail
    expect(d.command.at(-2)).toBe('echo');
    expect(d.command.at(-1)).toBe('hi');
  });

  test('sandbox=strict on a non-darwin platform throws', () => {
    expect(() => applySandbox({
      command: ['echo'], cwd: '/tmp', sandbox: 'strict',
    }, { platform: 'linux', resolveBwrap: () => null })).toThrow(SandboxUnavailableError);
    expect(() => applySandbox({
      command: ['echo'], cwd: '/tmp', sandbox: 'strict',
    }, { platform: 'linux', resolveBwrap: () => null })).toThrow(/bubblewrap/);
  });

  test('sandbox=auto on non-darwin soft-fails (passthrough + reason)', () => {
    const d = applySandbox({
      command: ['echo'], cwd: '/tmp', sandbox: 'auto',
    }, { platform: 'linux', resolveBwrap: () => null });
    expect(d.sandboxed).toBe(false);
    expect(d.tool).toBe('none');
    expect(d.reason ?? '').toContain('linux sandbox requires bwrap (bubblewrap); not installed');
  });

  test('sandbox=auto on linux wraps in bwrap when present', () => {
    const d = applySandbox({
      command: ['echo', 'hi'], cwd: '/tmp', sandbox: 'auto',
    }, { platform: 'linux', resolveBwrap: () => '/usr/bin/bwrap' });
    expect(d.sandboxed).toBe(true);
    expect(d.tool).toBe('bwrap');
    expect(d.command[0]).toBe('/usr/bin/bwrap');
  });

  test('sandbox=auto on unsupported platform soft-fails with no implementation', () => {
    const d = applySandbox({
      command: ['echo'], cwd: '/tmp', sandbox: 'auto',
    }, { platform: 'freebsd' });
    expect(d.sandboxed).toBe(false);
    expect(d.tool).toBe('none');
    expect(d.reason ?? '').toContain('no implementation');
  });
});

describe('runShell + sandbox integration', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'shell-sandbox-'));
    _resetApprovalCacheForTesting();
    setShellApprover(null);
    setAuditSinkForTesting(() => { /* swallow */ });
  });
  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
    _resetApprovalCacheForTesting();
    setShellApprover(null);
    setAuditSinkForTesting(null);
  });

  test('sandbox=off leaves sandboxed=false on result', async () => {
    const res = await runShell({ command: ['echo', 'x'], cwd });
    expect(res.sandboxed).toBe(false);
    expect(res.sandboxTool).toBe('none');
    expect(res.outcome).toBe('exit');
  });

  test('sandbox=auto on darwin produces sandboxed=true result', async () => {
    if (process.platform !== 'darwin') return;
    const res = await runShell({
      command: ['/bin/echo', 'sandbox-ok'], cwd, sandbox: 'auto',
    });
    expect(res.sandboxed).toBe(true);
    expect(res.sandboxTool).toBe('sandbox-exec');
    expect(res.outcome).toBe('exit');
    expect(res.stdout).toContain('sandbox-ok');
  });

  test.skipIf(process.platform === 'darwin')('sandbox=strict on unsupported platform → spawn-error result', async () => {
    const res = await runShell({
      command: ['echo'], cwd, sandbox: 'strict',
    });
    expect(res.outcome).toBe('spawn-error');
    expect(res.spawnError ?? '').toContain('sandbox unavailable');
  });
});
