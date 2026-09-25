import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import {
  prepareRemoteEdit,
  completeRemoteEdit,
  cleanupRemoteEdit,
  editRemoteFile,
} from '../src/ssh/remote-edit.js';
import type { SshFsDeps } from '../src/ssh/ssh-fs.js';
import type { SshHost } from '../src/ssh/ssh-hosts.js';

const HOST: SshHost = { name: 'mba', host: 'mba' };

type Reply = { stdout?: string; stderr?: string; code: number };

function mkSpawn(
  behavior: (cmd: string, args: string[], stdin: string) => Reply,
): SshFsDeps {
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
      let captured = '';
      stdin.on('data', (b: Buffer) => { captured += b.toString('utf-8'); });
      stdin.resume();
      stdin.on('finish', () => {
        const r = behavior(cmd, args, captured);
        setImmediate(() => {
          if (r.stdout) stdout.write(r.stdout);
          if (r.stderr) stderr.write(r.stderr);
          stdout.end();
          stderr.end();
          ee.emit('close', r.code);
        });
      });
      return ee;
    }) as never,
  };
}

describe('prepareRemoteEdit', () => {
  test('downloads body into a temp file + records checksum', async () => {
    const body = 'hello remote\n';
    const deps = mkSpawn(() => ({ stdout: body, code: 0 }));
    const r = await prepareRemoteEdit(HOST, '/etc/hosts', deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(existsSync(r.handle.localPath)).toBe(true);
      expect(readFileSync(r.handle.localPath, 'utf-8')).toBe(body);
      expect(r.handle.originalChecksum.length).toBe(40);
      expect(r.handle.remotePath).toBe('/etc/hosts');
      cleanupRemoteEdit(r.handle);
      expect(existsSync(r.handle.localPath)).toBe(false);
    }
  });

  test('propagates ssh error', async () => {
    const deps = mkSpawn(() => ({ stderr: 'permission denied', code: 1 }));
    const r = await prepareRemoteEdit(HOST, '/root/secret', deps);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('exit-nonzero');
      expect(r.message).toContain('permission denied');
    }
  });
});

describe('completeRemoteEdit', () => {
  test('uploads when remote body is unchanged', async () => {
    const original = 'v1\n';
    let phase: 'download' | 'verify' | 'upload' = 'download';
    const deps = mkSpawn((cmd, _args, stdin) => {
      if (cmd === 'ssh') {
        // Alternates: first = download, second = verify
        if (phase === 'download') { phase = 'verify'; return { stdout: original, code: 0 }; }
        return { stdout: original, code: 0 };
      }
      if (cmd === 'scp') return { code: 0 };
      return { code: 0 };
    });
    const prep = await prepareRemoteEdit(HOST, '/etc/hosts', deps);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    writeFileSync(prep.handle.localPath, 'v2 edited\n', 'utf-8');
    const save = await completeRemoteEdit(prep.handle, {}, deps);
    cleanupRemoteEdit(prep.handle);
    expect(save.ok).toBe(true);
    if (save.ok) expect(save.uploadedBytes).toBe(10);
  });

  test('refuses upload when remote drifted', async () => {
    const original = 'v1\n';
    let sshCalls = 0;
    const deps = mkSpawn((cmd) => {
      if (cmd === 'ssh') {
        sshCalls++;
        if (sshCalls === 1) return { stdout: original, code: 0 };
        // Second ssh call (verify) returns a different body.
        return { stdout: 'someone else edited\n', code: 0 };
      }
      return { code: 0 };
    });
    const prep = await prepareRemoteEdit(HOST, '/etc/hosts', deps);
    if (!prep.ok) throw new Error('prep failed');
    writeFileSync(prep.handle.localPath, 'my edit\n', 'utf-8');
    const save = await completeRemoteEdit(prep.handle, {}, deps);
    cleanupRemoteEdit(prep.handle);
    expect(save.ok).toBe(false);
    if (!save.ok) expect(save.reason).toBe('remote-drift');
  });

  test('force:true overrides the drift check', async () => {
    let sshCalls = 0;
    const deps = mkSpawn((cmd) => {
      if (cmd === 'ssh') {
        sshCalls++;
        return { stdout: sshCalls === 1 ? 'orig\n' : 'drifted\n', code: 0 };
      }
      return { code: 0 };
    });
    const prep = await prepareRemoteEdit(HOST, '/etc/hosts', deps);
    if (!prep.ok) throw new Error('prep failed');
    writeFileSync(prep.handle.localPath, 'forced edit\n', 'utf-8');
    const save = await completeRemoteEdit(prep.handle, { force: true }, deps);
    cleanupRemoteEdit(prep.handle);
    expect(save.ok).toBe(true);
  });

  test('upload failure propagates reason', async () => {
    const deps = mkSpawn((cmd) => {
      if (cmd === 'ssh') return { stdout: 'orig\n', code: 0 };
      return { stderr: 'permission denied', code: 1 };
    });
    const prep = await prepareRemoteEdit(HOST, '/etc/hosts', deps);
    if (!prep.ok) throw new Error('prep failed');
    writeFileSync(prep.handle.localPath, 'orig\n', 'utf-8');
    const save = await completeRemoteEdit(prep.handle, {}, deps);
    cleanupRemoteEdit(prep.handle);
    expect(save.ok).toBe(false);
    if (!save.ok) expect(save.reason).toBe('upload-failed');
  });
});

describe('editRemoteFile end-to-end', () => {
  test('full cycle: download → launch → upload', async () => {
    const body = 'abc\n';
    let sshCalls = 0;
    const deps = mkSpawn((cmd) => {
      if (cmd === 'ssh') {
        sshCalls++;
        return { stdout: body, code: 0 };
      }
      return { code: 0 };
    });
    let launchedPath = '';
    const r = await editRemoteFile(HOST, '/etc/hosts', async (p) => {
      launchedPath = p;
      // "Edit" — replace content in place.
      writeFileSync(p, 'abc edited\n', 'utf-8');
      return { ok: true };
    }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.uploadedBytes).toBe(11);
    expect(launchedPath).toContain('monad-ssh');
  });

  test('editor failure skips upload', async () => {
    const deps = mkSpawn(() => ({ stdout: 'x', code: 0 }));
    const r = await editRemoteFile(HOST, '/etc/hosts', async () => ({
      ok: false, message: 'user cancelled',
    }), deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('editor-failed');
  });
});
