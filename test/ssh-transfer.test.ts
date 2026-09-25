import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { sshTransfer, type SshTransferProgress } from '../src/transfer/ssh-transfer.js';
import type { SshFsDeps } from '../src/ssh/ssh-fs.js';
import type { SshHost } from '../src/ssh/ssh-hosts.js';

const HOST: SshHost = { name: 'mba', host: 'mba' };

type Reply = { stderr?: string; code?: number };

function mkSpawn(behavior: (cmd: string, args: string[]) => Reply): SshFsDeps {
  return {
    spawnImpl: ((cmd: string, args: string[]) => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const ee = new EventEmitter() as EventEmitter & {
        stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void;
      };
      ee.stdin = stdin;
      ee.stdout = stdout;
      ee.stderr = stderr;
      ee.kill = () => {};
      stdin.on('data', () => {});
      stdin.resume();
      stdin.on('finish', () => {
        const r = behavior(cmd, args);
        setImmediate(() => {
          if (r.stderr) stderr.write(r.stderr);
          stdout.end();
          stderr.end();
          ee.emit('close', r.code ?? 0);
        });
      });
      // scp and mkdir don't send stdin; close it immediately.
      setImmediate(() => stdin.end());
      return ee;
    }) as never,
  };
}

describe('sshTransfer', () => {
  test('uploads all files when every scp succeeds', async () => {
    const events: SshTransferProgress[] = [];
    const deps = mkSpawn(() => ({ code: 0 }));
    const r = await sshTransfer({
      host: HOST,
      remoteDir: '~/Downloads/',
      files: [
        { localPath: '/tmp/a.txt' },
        { localPath: '/tmp/b.txt' },
      ],
      onProgress: (e) => events.push(e),
    }, deps);
    expect(r.uploaded).toEqual(['/tmp/a.txt', '/tmp/b.txt']);
    expect(r.failed).toEqual([]);
    expect(events.some(e => e.phase === 'mkdir')).toBe(true);
    expect(events.filter(e => e.phase === 'start').length).toBe(2);
    expect(events.filter(e => e.phase === 'done').length).toBe(2);
  });

  test('stops on first failure by default', async () => {
    let call = 0;
    const deps = mkSpawn((cmd) => {
      call++;
      // Call 1 = mkdir ssh, call 2 = first scp (fail), call 3 = second scp
      if (cmd === 'scp' && call === 2) return { stderr: 'network timeout', code: 1 };
      return { code: 0 };
    });
    const r = await sshTransfer({
      host: HOST,
      remoteDir: '~/Downloads/',
      files: [
        { localPath: '/tmp/a.txt' },
        { localPath: '/tmp/b.txt' },
      ],
    }, deps);
    expect(r.uploaded).toEqual([]);
    expect(r.failed.length).toBe(1);
    expect(r.failed[0]!.localPath).toBe('/tmp/a.txt');
  });

  test('continueOnError lets subsequent files through', async () => {
    let call = 0;
    const deps = mkSpawn((cmd) => {
      call++;
      if (cmd === 'scp' && call === 2) return { stderr: 'fail-1', code: 1 };
      return { code: 0 };
    });
    const r = await sshTransfer({
      host: HOST,
      remoteDir: '~/Downloads/',
      files: [
        { localPath: '/tmp/a.txt' },
        { localPath: '/tmp/b.txt' },
        { localPath: '/tmp/c.txt' },
      ],
      continueOnError: true,
    }, deps);
    expect(r.failed.length).toBe(1);
    expect(r.uploaded).toEqual(['/tmp/b.txt', '/tmp/c.txt']);
  });

  test('mkdir failure short-circuits the whole batch', async () => {
    const deps = mkSpawn((cmd, args) => {
      // mkdir runs as ssh with `mkdir -p ...` in args; fail it.
      if (cmd === 'ssh' && args.some(a => a.includes('mkdir'))) {
        return { stderr: 'permission denied', code: 1 };
      }
      return { code: 0 };
    });
    const r = await sshTransfer({
      host: HOST,
      remoteDir: '/forbidden/dest',
      files: [
        { localPath: '/tmp/a.txt' },
        { localPath: '/tmp/b.txt' },
      ],
    }, deps);
    expect(r.uploaded).toEqual([]);
    expect(r.failed.length).toBe(2);
    expect(r.failed[0]!.message).toContain('permission denied');
  });

  test('skipMkdir omits the mkdir prelude', async () => {
    let mkdirCalls = 0;
    const deps = mkSpawn((cmd, args) => {
      if (cmd === 'ssh' && args.some(a => a.includes('mkdir'))) mkdirCalls++;
      return { code: 0 };
    });
    await sshTransfer({
      host: HOST,
      remoteDir: '~/Downloads/',
      files: [{ localPath: '/tmp/a.txt' }],
      skipMkdir: true,
    }, deps);
    expect(mkdirCalls).toBe(0);
  });

  test('progress events carry index + total', async () => {
    const events: SshTransferProgress[] = [];
    const deps = mkSpawn(() => ({ code: 0 }));
    await sshTransfer({
      host: HOST,
      remoteDir: '~/',
      files: [
        { localPath: '/a' }, { localPath: '/b' }, { localPath: '/c' },
      ],
      onProgress: (e) => events.push(e),
    }, deps);
    const starts = events.filter((e): e is Extract<SshTransferProgress, { phase: 'start' }> => e.phase === 'start');
    expect(starts.map(s => s.index)).toEqual([0, 1, 2]);
    expect(starts.every(s => s.total === 3)).toBe(true);
  });

  test('dest path joins remoteDir + basename', async () => {
    const scpArgs: string[][] = [];
    const deps = mkSpawn((cmd, args) => {
      if (cmd === 'scp') scpArgs.push(args);
      return { code: 0 };
    });
    await sshTransfer({
      host: HOST,
      remoteDir: '/srv/drop',
      files: [{ localPath: '/tmp/some-file.bin' }],
      skipMkdir: true,
    }, deps);
    expect(scpArgs.length).toBe(1);
    expect(scpArgs[0]!.some(a => a.includes('some-file.bin'))).toBe(true);
    expect(scpArgs[0]!.some(a => a.includes('/srv/drop/some-file.bin'))).toBe(true);
  });

  test('remoteDir gets trailing slash added', async () => {
    const scpArgs: string[][] = [];
    const deps = mkSpawn((cmd, args) => {
      if (cmd === 'scp') scpArgs.push(args);
      return { code: 0 };
    });
    await sshTransfer({
      host: HOST,
      remoteDir: '/noslash',
      files: [{ localPath: '/tmp/x' }],
      skipMkdir: true,
    }, deps);
    // destination is host:/noslash/x
    expect(scpArgs[0]!.some(a => a.includes(':/noslash/x'))).toBe(true);
  });
});
