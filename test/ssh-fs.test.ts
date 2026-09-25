import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  listRemoteDir,
  readRemoteFile,
  statRemoteFile,
  writeRemoteFile,
  scpDownload,
  scpUpload,
  parseLsLine,
  shellQuoteRemote,
  sshTarget,
} from '../src/ssh/ssh-fs.js';
import type { SshHost } from '../src/ssh/ssh-hosts.js';

function mkHost(overrides: Partial<SshHost> = {}): SshHost {
  return { name: 'test', host: 'test.local', ...overrides };
}

type FakeCall = { cmd: string; args: string[]; stdinData: string };

function mkSpawnStub(
  behavior: (call: FakeCall) => { stdout?: string; stderr?: string; code: number; delay?: number },
): { calls: FakeCall[]; spawnImpl: (c: string, a: string[]) => unknown } {
  const calls: FakeCall[] = [];
  return {
    calls,
    spawnImpl: (c: string, a: string[]) => {
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
      let capturedStdin = '';
      stdin.on('data', (b: Buffer) => { capturedStdin += b.toString('utf-8'); });
      stdin.on('end', () => {
        const call: FakeCall = { cmd: c, args: a, stdinData: capturedStdin };
        calls.push(call);
        const r = behavior(call);
        setTimeout(() => {
          if (r.stdout) stdout.write(r.stdout);
          if (r.stderr) stderr.write(r.stderr);
          stdout.end();
          stderr.end();
          ee.emit('close', r.code);
        }, r.delay ?? 0);
      });
      return ee;
    },
  };
}

describe('shellQuoteRemote', () => {
  test('wraps safe paths in single quotes', () => {
    expect(shellQuoteRemote('/etc/hosts')).toBe("'/etc/hosts'");
  });

  test('escapes embedded single quotes', () => {
    expect(shellQuoteRemote("/tmp/o'brien")).toBe(`'/tmp/o'\\''brien'`);
  });
});

describe('sshTarget', () => {
  test('host only', () => {
    expect(sshTarget({ name: 'x', host: 'foo' })).toBe('foo');
  });
  test('user@host', () => {
    expect(sshTarget({ name: 'x', host: 'foo', user: 'ops' })).toBe('ops@foo');
  });
});

describe('parseLsLine', () => {
  test('parses a regular file line', () => {
    const e = parseLsLine('-rw-r--r--  1 alice staff 1234 1700000000 README.md');
    expect(e).not.toBeNull();
    expect(e!.name).toBe('README.md');
    expect(e!.isDir).toBe(false);
    expect(e!.size).toBe(1234);
    expect(e!.mtime).toBe(1700000000);
  });

  test('parses a directory line', () => {
    const e = parseLsLine('drwxr-xr-x  3 bob  staff   96 1700000001 src');
    expect(e!.isDir).toBe(true);
    expect(e!.name).toBe('src');
  });

  test('parses a symlink line + drops target', () => {
    const e = parseLsLine('lrwxrwxrwx  1 alice staff 12 1700000002 cfg -> /etc/cfg');
    expect(e!.isSymlink).toBe(true);
    expect(e!.name).toBe('cfg');
  });

  test('filters out . and ..', () => {
    expect(parseLsLine('drwx------  2 a a 0 1 .')).toBeNull();
    expect(parseLsLine('drwx------  2 a a 0 1 ..')).toBeNull();
  });

  test('returns null on blank or non-ls lines', () => {
    expect(parseLsLine('')).toBeNull();
    expect(parseLsLine('total 8')).toBeNull();
  });
});

describe('listRemoteDir', () => {
  test('parses lines from stdout', async () => {
    const { calls, spawnImpl } = mkSpawnStub((call) => ({
      stdout:
        '-rw-r--r--  1 a a  10 1700000001 a.txt\n' +
        'drwxr-xr-x  2 a a  64 1700000002 sub\n',
      code: 0,
    }));
    const r = await listRemoteDir(mkHost(), '/tmp', { spawnImpl: spawnImpl as never });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBe(2);
      expect(r.value[0]!.name).toBe('a.txt');
      expect(r.value[1]!.isDir).toBe(true);
    }
    expect(calls[0]!.cmd).toBe('ssh');
    expect(calls[0]!.args).toContain('test.local');
    expect(calls[0]!.args.some(a => a.includes("'/tmp'"))).toBe(true);
  });

  test('propagates non-zero exit', async () => {
    const { spawnImpl } = mkSpawnStub(() => ({
      stderr: 'ls: /missing: No such file',
      code: 2,
    }));
    const r = await listRemoteDir(mkHost(), '/missing', { spawnImpl: spawnImpl as never });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('exit-nonzero');
      expect(r.exitCode).toBe(2);
      expect(r.message).toContain('No such file');
    }
  });

  test('timeout surfaces as reason=timeout', async () => {
    const { spawnImpl } = mkSpawnStub(() => ({ code: 0, delay: 50 }));
    const r = await listRemoteDir(mkHost(), '/', { spawnImpl: spawnImpl as never, timeoutMs: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });
});

describe('readRemoteFile', () => {
  test('returns file body on success', async () => {
    const { calls, spawnImpl } = mkSpawnStub(() => ({
      stdout: 'hello world\n', code: 0,
    }));
    const r = await readRemoteFile(mkHost(), '/etc/hosts', { spawnImpl: spawnImpl as never });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('hello world\n');
    expect(calls[0]!.args.some(a => a.startsWith('cat '))).toBe(true);
  });
});

describe('statRemoteFile', () => {
  test('parses GNU-style stat output', async () => {
    const { spawnImpl } = mkSpawnStub(() => ({
      stdout: '123 1700000000 regular file\n', code: 0,
    }));
    const r = await statRemoteFile(mkHost(), '/etc/hosts', { spawnImpl: spawnImpl as never });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.size).toBe(123);
      expect(r.value.mtime).toBe(1700000000);
      expect(r.value.kind).toBe('file');
    }
  });

  test('directory kind detected', async () => {
    const { spawnImpl } = mkSpawnStub(() => ({
      stdout: '96 1700000001 Directory\n', code: 0,
    }));
    const r = await statRemoteFile(mkHost(), '/tmp', { spawnImpl: spawnImpl as never });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe('directory');
  });
});

describe('writeRemoteFile', () => {
  test('pipes body into tee stdin', async () => {
    const { calls, spawnImpl } = mkSpawnStub(() => ({ code: 0 }));
    const r = await writeRemoteFile(mkHost(), '/tmp/x.txt', 'new body', { spawnImpl: spawnImpl as never });
    expect(r.ok).toBe(true);
    expect(calls[0]!.stdinData).toBe('new body');
    expect(calls[0]!.args.some(a => a.includes('tee'))).toBe(true);
  });

  test('non-zero exit is surfaced', async () => {
    const { spawnImpl } = mkSpawnStub(() => ({
      stderr: 'tee: cannot write', code: 1,
    }));
    const r = await writeRemoteFile(mkHost(), '/forbidden', 'x', { spawnImpl: spawnImpl as never });
    expect(r.ok).toBe(false);
  });
});

describe('scpDownload / scpUpload', () => {
  test('download calls scp with host:path as source', async () => {
    const { calls, spawnImpl } = mkSpawnStub(() => ({ code: 0 }));
    const r = await scpDownload(mkHost({ user: 'u' }), '/remote/file', '/local/file', {
      spawnImpl: spawnImpl as never,
    });
    expect(r.ok).toBe(true);
    expect(calls[0]!.cmd).toBe('scp');
    expect(calls[0]!.args).toContain('u@test.local:/remote/file');
    expect(calls[0]!.args).toContain('/local/file');
  });

  test('upload calls scp with host:path as destination', async () => {
    const { calls, spawnImpl } = mkSpawnStub(() => ({ code: 0 }));
    const r = await scpUpload(mkHost(), '/local/file', '/remote/file', {
      spawnImpl: spawnImpl as never,
    });
    expect(r.ok).toBe(true);
    expect(calls[0]!.args).toContain('test.local:/remote/file');
  });
});
