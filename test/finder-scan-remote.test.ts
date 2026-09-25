import { afterEach, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  scanRemoteFinder,
  relativizeRemoteResults,
  _resetRemoteFinderCacheForTesting,
} from '../src/finder/finder-scan-remote.js';
import type { RemoteFinderScanDeps } from '../src/finder/finder-scan-remote.js';
import type { SshHost } from '../src/ssh/ssh-hosts.js';

const HOST: SshHost = { name: 'mba', host: 'mba' };

afterEach(() => {
  _resetRemoteFinderCacheForTesting();
});

type Reply = { stdout?: string; stderr?: string; code?: number };

function mkSpawn(behavior: (cmd: string, args: string[]) => Reply): RemoteFinderScanDeps {
  return {
    spawnImpl: ((cmd: string, args: string[]) => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const ee = new EventEmitter() as EventEmitter & {
        stdout: PassThrough; stderr: PassThrough; kill: () => void;
      };
      ee.stdout = stdout;
      ee.stderr = stderr;
      ee.kill = () => {};
      setImmediate(() => {
        const r = behavior(cmd, args);
        if (r.stdout) stdout.write(r.stdout);
        if (r.stderr) stderr.write(r.stderr);
        stdout.end();
        stderr.end();
        ee.emit('close', r.code ?? 0);
      });
      return ee;
    }) as never,
  };
}

describe('scanRemoteFinder', () => {
  test('probes backend + returns fd on success', async () => {
    let probed = false;
    const deps = mkSpawn((_cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) {
        probed = true;
        return { code: 0 };
      }
      return { stdout: 'src/a.ts\nsrc/b.ts\n', code: 0 };
    });
    const r = await scanRemoteFinder({ host: HOST, root: '/home/alice' }, deps);
    expect(probed).toBe(true);
    expect(r.backend).toBe('fd');
    expect(r.paths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(r.host).toBe('mba');
  });

  test('probe failure falls back to find', async () => {
    const deps = mkSpawn((_cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) return { code: 1 };
      return { stdout: 'x.txt\n', code: 0 };
    });
    const r = await scanRemoteFinder({ host: HOST }, deps);
    expect(r.backend).toBe('find');
  });

  test('backend is cached per host', async () => {
    let probeCount = 0;
    const deps = mkSpawn((_cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) {
        probeCount++;
        return { code: 0 };
      }
      return { stdout: '', code: 0 };
    });
    await scanRemoteFinder({ host: HOST }, deps);
    await scanRemoteFinder({ host: HOST }, deps);
    await scanRemoteFinder({ host: HOST }, deps);
    expect(probeCount).toBe(1);
  });

  test('explicit backend skips probe', async () => {
    const deps = mkSpawn((_cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) {
        throw new Error('probe should not run');
      }
      return { stdout: 'a\n', code: 0 };
    });
    const r = await scanRemoteFinder({
      host: HOST, backend: 'fd',
    }, deps);
    expect(r.backend).toBe('fd');
    expect(r.paths).toEqual(['a']);
  });

  test('truncates at maxFiles', async () => {
    const big = Array.from({ length: 10 }, (_, i) => `f${i}.ts`).join('\n') + '\n';
    const deps = mkSpawn((_cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) return { code: 0 };
      return { stdout: big, code: 0 };
    });
    const r = await scanRemoteFinder({ host: HOST, maxFiles: 3 }, deps);
    expect(r.truncated).toBe(true);
    expect(r.paths.length).toBe(3);
  });

  test('remote fd cmd includes --hidden by default', async () => {
    let capturedCmd = '';
    const deps = mkSpawn((cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) return { code: 0 };
      capturedCmd = args[args.length - 1] ?? '';
      return { stdout: '', code: 0 };
    });
    await scanRemoteFinder({ host: HOST, root: '/tmp' }, deps);
    expect(capturedCmd).toContain('--hidden');
    expect(capturedCmd).toContain("'/tmp'");
    expect(capturedCmd).toContain('--exclude .git');
    expect(capturedCmd).toContain('--exclude node_modules');
  });

  test('remote find cmd excludes .git + node_modules', async () => {
    let capturedCmd = '';
    const deps = mkSpawn((cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) return { code: 1 };
      capturedCmd = args[args.length - 1] ?? '';
      return { stdout: '', code: 0 };
    });
    await scanRemoteFinder({ host: HOST, root: '/tmp' }, deps);
    expect(capturedCmd).toContain('find');
    expect(capturedCmd).toContain(".git");
    expect(capturedCmd).toContain('node_modules');
  });

  test('path with spaces is shell-quoted', async () => {
    let capturedCmd = '';
    const deps = mkSpawn((cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) return { code: 0 };
      capturedCmd = args[args.length - 1] ?? '';
      return { stdout: '', code: 0 };
    });
    await scanRemoteFinder({
      host: HOST, root: "/path with 'quotes'",
    }, deps);
    // shellQuoteRemote uses single-quote wrap with '\''
    expect(capturedCmd).toContain("'\\''");
  });

  test('trailing line without newline is flushed', async () => {
    const deps = mkSpawn((_cmd, args) => {
      if (args.some(a => a.startsWith('command -v'))) return { code: 0 };
      return { stdout: 'only-file.ts', code: 0 };
    });
    const r = await scanRemoteFinder({ host: HOST }, deps);
    expect(r.paths).toEqual(['only-file.ts']);
  });

  test('durationMs > 0', async () => {
    let t = 0;
    const deps: RemoteFinderScanDeps = {
      ...mkSpawn((_cmd, args) => {
        if (args.some(a => a.startsWith('command -v'))) return { code: 0 };
        return { stdout: 'a\n', code: 0 };
      }),
      now: () => (t += 10),
    };
    const r = await scanRemoteFinder({ host: HOST }, deps);
    expect(r.durationMs).toBeGreaterThan(0);
  });
});

describe('relativizeRemoteResults', () => {
  test('strips absolute root', () => {
    expect(relativizeRemoteResults(['/home/alice/a.ts'], '/home/alice'))
      .toEqual(['a.ts']);
  });

  test('root itself → .', () => {
    expect(relativizeRemoteResults(['/home'], '/home')).toEqual(['.']);
  });
});
