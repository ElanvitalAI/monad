import { describe, expect, test } from 'bun:test';

import {
  refreshRemoteWorkingDir,
  refreshRemoteWorkingDirPreview,
  startRemoteMode,
  endRemoteMode,
  remoteBadge,
  enterRemoteDirectory,
  _testing,
} from '../src/ssh/remote-browser.js';
import { createWorkingDirState } from '../src/working-dir/index.js';
import type { SshFsDeps } from '../src/ssh/ssh-fs.js';
import type { SshHost } from '../src/ssh/ssh-hosts.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const HOST: SshHost = { name: 'mba', host: 'mba' };

type Reply = { stdout?: string; stderr?: string; code: number };

function mkSpawn(reply: Reply | ((cmd: string, args: string[]) => Reply)): SshFsDeps {
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
      stdin.on('data', () => {});   // flowing mode so 'finish' fires
      stdin.resume();
      stdin.on('finish', () => {
        const r = typeof reply === 'function' ? reply(cmd, args) : reply;
        setImmediate(() => {
          if (r.stdout) stdout.write(r.stdout);
          if (r.stderr) stderr.write(r.stderr);
          stdout.end(); stderr.end();
          ee.emit('close', r.code);
        });
      });
      return ee;
    }) as never,
  };
}

function createPreviewState() {
  return {
    previewPath: null as string | null,
    previewLines: [] as string[],
    previewOffset: 0,
  };
}

describe('startRemoteMode / endRemoteMode', () => {
  test('start sets remote + clears state', () => {
    const ws = createWorkingDirState('/local');
    const preview = createPreviewState();
    ws.cursor = 5; ws.offset = 2; ws.selected.add('/local/a');
    startRemoteMode(ws, HOST, '/home/alice', preview);
    expect(ws.remote).toEqual({ host: HOST, cwd: '/home/alice' });
    expect(ws.cursor).toBe(0);
    expect(ws.offset).toBe(0);
    expect(ws.selected.size).toBe(0);
  });

  test('end clears remote', () => {
    const ws = createWorkingDirState();
    const preview = createPreviewState();
    startRemoteMode(ws, HOST, '~', preview);
    endRemoteMode(ws, preview);
    expect(ws.remote).toBeNull();
  });
});

describe('remoteBadge', () => {
  test('null when not remote', () => {
    const ws = createWorkingDirState();
    expect(remoteBadge(ws)).toBeNull();
  });

  test('host + path when remote', () => {
    const ws = createWorkingDirState();
    startRemoteMode(ws, HOST, '/home/alice', createPreviewState());
    expect(remoteBadge(ws)).toBe('@mba:/home/alice');
  });
});

describe('refreshRemoteWorkingDir', () => {
  test('hydrates entries from ssh ls output', async () => {
    const ws = createWorkingDirState('/local');
    const preview = createPreviewState();
    startRemoteMode(ws, HOST, '/etc', preview);
    const deps = mkSpawn({
      stdout:
        '-rw-r--r-- 1 root wheel  120 1700000000 hosts\n' +
        'drwxr-xr-x 2 root wheel   64 1700000001 ssh\n',
      code: 0,
    });
    await refreshRemoteWorkingDir(ws, deps, preview);
    const names = ws.entries.map(e => e.name);
    expect(names).toContain('..');
    expect(names).toContain('hosts');
    expect(names).toContain('ssh');
  });

  test('error surfaces as single placeholder entry + preview message', async () => {
    const ws = createWorkingDirState();
    const preview = createPreviewState();
    startRemoteMode(ws, HOST, '/missing', preview);
    await refreshRemoteWorkingDir(ws, mkSpawn({
      stderr: 'No such file or directory', code: 2,
    }), preview);
    expect(ws.entries.length).toBe(1);
    expect(ws.entries[0]!.name).toContain('ssh');
    expect(preview.previewLines[0]).toContain('No such file');
  });

  test('hidden filter respects ws.showHidden', async () => {
    const ws = createWorkingDirState();
    const preview = createPreviewState();
    startRemoteMode(ws, HOST, '/home', preview);
    const deps = mkSpawn({
      stdout:
        '-rw-r--r-- 1 a a 10 1700000000 visible.txt\n' +
        '-rw-r--r-- 1 a a 10 1700000001 .hidden\n',
      code: 0,
    });
    await refreshRemoteWorkingDir(ws, deps, preview);
    // Defaults to hidden=false
    expect(ws.entries.map(e => e.name)).not.toContain('.hidden');
    ws.showHidden = true;
    await refreshRemoteWorkingDir(ws, deps, preview);
    expect(ws.entries.map(e => e.name)).toContain('.hidden');
  });
});

describe('refreshRemoteWorkingDirPreview', () => {
  test('file preview reads via cat', async () => {
    const ws = createWorkingDirState();
    const preview = createPreviewState();
    startRemoteMode(ws, HOST, '/etc', preview);
    ws.entries = [{
      name: 'hosts', absPath: '/etc/hosts', isDir: false, size: 40, mtime: 0, ext: '',
    }];
    ws.cursor = 0;
    const deps = mkSpawn((cmd, args) => {
      if (args.some(a => a.startsWith('cat '))) {
        return { stdout: '127.0.0.1 localhost\n', code: 0 };
      }
      return { stdout: '', code: 0 };
    });
    await refreshRemoteWorkingDirPreview(ws, deps, preview);
    expect(preview.previewLines.some(l => l.includes('127.0.0.1'))).toBe(true);
  });

  test('dir preview lists children', async () => {
    const ws = createWorkingDirState();
    const preview = createPreviewState();
    startRemoteMode(ws, HOST, '/home', preview);
    ws.entries = [{
      name: 'alice', absPath: '/home/alice', isDir: true, size: 0, mtime: 0, ext: '',
    }];
    ws.cursor = 0;
    const deps = mkSpawn({
      stdout:
        'drwxr-xr-x 2 a a 64 1700000000 Documents\n' +
        '-rw-r--r-- 1 a a 20 1700000001 profile.txt\n',
      code: 0,
    });
    await refreshRemoteWorkingDirPreview(ws, deps, preview);
    expect(preview.previewLines.some(l => l.includes('Documents'))).toBe(true);
    expect(preview.previewLines.some(l => l.includes('profile.txt'))).toBe(true);
  });

  test('oversized file skips cat', async () => {
    const ws = createWorkingDirState();
    const preview = createPreviewState();
    startRemoteMode(ws, HOST, '/big', preview);
    ws.entries = [{
      name: 'dump.bin', absPath: '/big/dump.bin', isDir: false,
      size: 99_999_999, mtime: 0, ext: 'bin',
    }];
    ws.cursor = 0;
    let called = false;
    const deps = mkSpawn(() => { called = true; return { stdout: '', code: 0 }; });
    await refreshRemoteWorkingDirPreview(ws, deps, preview);
    expect(preview.previewLines[0]).toContain('exceeds preview cap');
    expect(called).toBe(false);
  });
});

describe('enterRemoteDirectory', () => {
  test('updates remote.cwd + resets cursor', () => {
    const ws = createWorkingDirState();
    startRemoteMode(ws, HOST, '/home', createPreviewState());
    ws.cursor = 3;
    enterRemoteDirectory(ws, '/home/alice');
    expect(ws.remote?.cwd).toBe('/home/alice');
    expect(ws.cursor).toBe(0);
  });
});

describe('_testing.parentDir', () => {
  test('root / → null', () => {
    expect(_testing.parentDir('/')).toBeNull();
  });
  test('/home → /', () => {
    expect(_testing.parentDir('/home')).toBe('/');
  });
  test('/home/alice → /home', () => {
    expect(_testing.parentDir('/home/alice')).toBe('/home');
  });
});
