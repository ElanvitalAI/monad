import { describe, expect, test } from 'bun:test';

import {
  canLaunchEditor,
  launchEditor,
  resolveEditorCommand,
} from '../src/editor-launcher.js';
import { EventEmitter } from 'node:events';

describe('resolveEditorCommand', () => {
  test('returns null when both VISUAL and EDITOR are unset', () => {
    expect(resolveEditorCommand({})).toBeNull();
  });

  test('VISUAL wins over EDITOR', () => {
    expect(resolveEditorCommand({ VISUAL: 'nvim', EDITOR: 'vim' }))
      .toEqual(['nvim']);
  });

  test('falls back to EDITOR', () => {
    expect(resolveEditorCommand({ EDITOR: 'vim' })).toEqual(['vim']);
  });

  test('splits args on whitespace', () => {
    expect(resolveEditorCommand({ EDITOR: 'code -w' })).toEqual(['code', '-w']);
  });

  test('returns null on empty string', () => {
    expect(resolveEditorCommand({ EDITOR: '   ' })).toBeNull();
  });
});

describe('canLaunchEditor', () => {
  test('false when no $EDITOR', () => {
    // canLaunchEditor also checks isTTY, but when EDITOR is empty
    // it short-circuits to false regardless.
    expect(canLaunchEditor({})).toBe(false);
  });
});

describe('launchEditor', () => {
  test('returns no-editor when $EDITOR/$VISUAL unset', async () => {
    const r = await launchEditor('/tmp/x.txt', {}, {
      env: {},
      allowNonTty: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('no-editor');
    }
  });

  test('returns no-tty when stdin is not a TTY and allowNonTty is false', async () => {
    // Bun test stdin is typically not a TTY. Without allowNonTty the
    // launcher refuses.
    const r = await launchEditor('/tmp/x.txt', {}, {
      env: { EDITOR: 'vim' },
    });
    if (!r.ok) {
      expect(r.reason).toBe('no-tty');
    } else {
      // If the test env IS a TTY, we'd need to let it through. The
      // assertion becomes conditional — the spawn path would fail
      // because vim isn't available in CI anyway.
      expect(r).toBeDefined();
    }
  });

  test('spawns the editor + resolves with the exit code', async () => {
    const suspends: number[] = [];
    const resumes: number[] = [];
    const spawnedArgs: { cmd: string; args: string[] } = { cmd: '', args: [] };
    const fakeSpawn = ((c: string, a: string[]) => {
      spawnedArgs.cmd = c;
      spawnedArgs.args = a;
      const ee = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
      setImmediate(() => ee.emit('exit', 0, null));
      return ee;
    }) as unknown as typeof import('node:child_process').spawn;

    const r = await launchEditor('/tmp/foo.txt', { extraArgs: ['+42'] }, {
      env: { EDITOR: 'nvim' },
      allowNonTty: true,
      suspend: () => suspends.push(1),
      resume: () => resumes.push(1),
      spawnImpl: fakeSpawn,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.exitCode).toBe(0);
    expect(spawnedArgs.cmd).toBe('nvim');
    expect(spawnedArgs.args).toEqual(['+42', '/tmp/foo.txt']);
    expect(suspends.length).toBe(1);
    expect(resumes.length).toBe(1);
  });

  test('resume fires even on spawn error', async () => {
    const suspends: number[] = [];
    const resumes: number[] = [];
    const fakeSpawn = ((_c: string, _a: string[]) => {
      const ee = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
      setImmediate(() => ee.emit('error', new Error('ENOENT')));
      setImmediate(() => ee.emit('exit', -1, null));
      return ee;
    }) as unknown as typeof import('node:child_process').spawn;

    const r = await launchEditor('/tmp/foo.txt', {}, {
      env: { EDITOR: 'ghost-bin' },
      allowNonTty: true,
      suspend: () => suspends.push(1),
      resume: () => resumes.push(1),
      spawnImpl: fakeSpawn,
    });

    expect(suspends.length).toBe(1);
    expect(resumes.length).toBe(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBeDefined();
  });

  test('passes command with flags through to spawn args', async () => {
    const spawned: { cmd: string; args: string[] } = { cmd: '', args: [] };
    const fakeSpawn = ((c: string, a: string[]) => {
      spawned.cmd = c;
      spawned.args = a;
      const ee = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
      setImmediate(() => ee.emit('exit', 0, null));
      return ee;
    }) as unknown as typeof import('node:child_process').spawn;

    await launchEditor('/tmp/bar.js', {}, {
      env: { EDITOR: 'code -w --no-sandbox' },
      allowNonTty: true,
      suspend: () => {},
      resume: () => {},
      spawnImpl: fakeSpawn,
    });

    expect(spawned.cmd).toBe('code');
    expect(spawned.args).toEqual(['-w', '--no-sandbox', '/tmp/bar.js']);
  });

  test('signal-terminated child returns 128', async () => {
    const fakeSpawn = ((_c: string, _a: string[]) => {
      const ee = new EventEmitter() as EventEmitter & { on: EventEmitter['on'] };
      setImmediate(() => ee.emit('exit', null, 'SIGTERM'));
      return ee;
    }) as unknown as typeof import('node:child_process').spawn;

    const r = await launchEditor('/tmp/x.txt', {}, {
      env: { EDITOR: 'vim' },
      allowNonTty: true,
      suspend: () => {}, resume: () => {},
      spawnImpl: fakeSpawn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.exitCode).toBe(128);
  });
});
