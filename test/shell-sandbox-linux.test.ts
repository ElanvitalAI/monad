// ── Track K: Linux sandbox (bwrap) scaffold tests ──
//
// These run on any platform — they test the PURE argv-building +
// cache seam, not real bwrap execution. Linux CI that has bwrap
// would exercise the integration path; macOS dev machines are
// covered by the cache-override seam so the dispatch logic still
// gets tested here.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  applySandbox, buildLinuxBwrapArgs, resolveBwrapPath,
  SandboxUnavailableError, _resetBwrapPathCacheForTesting,
} from '../src/shell-primitive/sandbox';

describe('buildLinuxBwrapArgs', () => {
  test('argv starts with bwrap + permissive root + writable cwd + tmpfs', () => {
    const argv = buildLinuxBwrapArgs({
      bwrapBinary: '/usr/bin/bwrap',
      cwd: '/home/me/proj',
      network: 'inherit',
      command: ['echo', 'hi'],
    });
    expect(argv[0]).toBe('/usr/bin/bwrap');
    // Read-only root
    expect(argv).toContain('--ro-bind');
    // Writable project dir
    const bindIdx = argv.indexOf('--bind');
    expect(bindIdx).toBeGreaterThan(0);
    expect(argv[bindIdx + 1]).toBe('/home/me/proj');
    expect(argv[bindIdx + 2]).toBe('/home/me/proj');
    // tmpfs /tmp
    const tmpfsIdx = argv.indexOf('--tmpfs');
    expect(tmpfsIdx).toBeGreaterThan(0);
    expect(argv[tmpfsIdx + 1]).toBe('/tmp');
    // dev, proc
    expect(argv).toContain('--proc');
    expect(argv).toContain('--dev');
    // lifetime flags
    expect(argv).toContain('--die-with-parent');
    expect(argv).toContain('--new-session');
    // actual command follows
    expect(argv.at(-2)).toBe('echo');
    expect(argv.at(-1)).toBe('hi');
  });

  test('--unshare-net only when network=off', () => {
    const inheritArgv = buildLinuxBwrapArgs({
      bwrapBinary: '/usr/bin/bwrap',
      cwd: '/tmp',
      network: 'inherit',
      command: ['true'],
    });
    expect(inheritArgv).not.toContain('--unshare-net');
    const offArgv = buildLinuxBwrapArgs({
      bwrapBinary: '/usr/bin/bwrap',
      cwd: '/tmp',
      network: 'off',
      command: ['true'],
    });
    expect(offArgv).toContain('--unshare-net');
  });
});

describe('resolveBwrapPath (cache)', () => {
  beforeEach(() => _resetBwrapPathCacheForTesting());

  test('returns null when absent + caches the null', () => {
    // Cache override: simulate "not present" by setting null.
    _resetBwrapPathCacheForTesting(null);
    expect(resolveBwrapPath()).toBeNull();
  });

  test('override path propagates', () => {
    _resetBwrapPathCacheForTesting('/opt/bwrap');
    expect(resolveBwrapPath()).toBe('/opt/bwrap');
  });
});

describe('applySandbox on Linux (simulated)', () => {
  beforeEach(() => _resetBwrapPathCacheForTesting());

  test.skipIf(process.platform !== 'linux')('linux + bwrap present + auto → sandboxed via bwrap', () => {
    _resetBwrapPathCacheForTesting('/usr/bin/bwrap');
    const d = applySandbox({
      command: ['echo', 'h'], cwd: '/tmp', sandbox: 'auto',
    });
    expect(d.sandboxed).toBe(true);
    expect(d.tool).toBe('bwrap');
    expect(d.command[0]).toBe('/usr/bin/bwrap');
  });

  test.skipIf(process.platform !== 'linux')('linux + bwrap absent + auto → soft-fail passthrough', () => {
    _resetBwrapPathCacheForTesting(null);
    const d = applySandbox({
      command: ['echo', 'h'], cwd: '/tmp', sandbox: 'auto',
    });
    expect(d.sandboxed).toBe(false);
    expect(d.tool).toBe('none');
    expect(d.reason ?? '').toContain('bwrap');
  });

  test.skipIf(process.platform !== 'linux')('linux + bwrap absent + strict → SandboxUnavailableError', () => {
    _resetBwrapPathCacheForTesting(null);
    expect(() => applySandbox({
      command: ['echo'], cwd: '/tmp', sandbox: 'strict',
    })).toThrow(SandboxUnavailableError);
  });
});
