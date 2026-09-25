import { describe, expect, test } from 'bun:test';
import { resolveTransport, transportLabel } from '../../src/terminal-matrix/transport.js';

describe('resolveTransport — local', () => {
  test('shell character uses defaultShell', () => {
    const r = resolveTransport(
      { kind: 'local' },
      { character: { kind: 'shell' }, defaultShell: '/bin/zsh' },
    );
    expect(r.shell).toBe('/bin/zsh');
    expect(r.args).toEqual([]);
  });

  test('shell character with explicit shell overrides defaultShell', () => {
    const r = resolveTransport(
      { kind: 'local' },
      { character: { kind: 'shell', shell: '/bin/bash' }, defaultShell: '/bin/zsh' },
    );
    expect(r.shell).toBe('/bin/bash');
  });

  test('claude-code character launches claude-code', () => {
    const r = resolveTransport(
      { kind: 'local' },
      { character: { kind: 'claude-code' }, defaultShell: '/bin/bash' },
    );
    expect(r.shell).toBe('claude-code');
  });

  test('codex character launches codex', () => {
    const r = resolveTransport(
      { kind: 'local' },
      { character: { kind: 'codex' }, defaultShell: '/bin/bash' },
    );
    expect(r.shell).toBe('codex');
  });

  test('custom character passes through spawnArgs', () => {
    const r = resolveTransport(
      { kind: 'local' },
      { character: { kind: 'custom', name: 'lazygit', spawnArgs: ['-p', '/repo'] }, defaultShell: '/bin/bash' },
    );
    expect(r.shell).toBe('lazygit');
    expect(r.args).toEqual(['-p', '/repo']);
  });
});

describe('resolveTransport — tailscale', () => {
  test('shell: tailscale ssh <host> --', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a' },
      { character: { kind: 'shell' }, defaultShell: '/bin/bash' },
    );
    expect(r.shell).toBe('tailscale');
    expect(r.args[0]).toBe('ssh');
    expect(r.args[1]).toBe('node-a');
    expect(r.args[2]).toBe('--');
    expect(r.env.MONAD_REMOTE_TRANSPORT).toBe('tailscale');
    expect(r.env.MONAD_REMOTE_HOST).toBe('node-a');
  });

  test('user@host formatting', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a', user: 'admin' },
      { character: { kind: 'shell' }, defaultShell: '/bin/bash' },
    );
    expect(r.args[1]).toBe('admin@node-a');
  });

  test('claude-code runs exec claude-code inside login shell', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a' },
      { character: { kind: 'claude-code' }, defaultShell: '/bin/bash' },
    );
    const joined = r.args.join(' ');
    expect(joined).toContain('bash -lc exec claude-code');
  });

  test('custom character is shell-quoted', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a' },
      { character: { kind: 'custom', name: 'my app', spawnArgs: ["it's ok"] }, defaultShell: '/bin/bash' },
    );
    const joined = r.args.join(' ');
    expect(joined).toContain("'my app'");
    expect(joined).toContain("'it'\\''s ok'");
  });
});

describe('resolveTransport — ssh', () => {
  test('ssh with port', () => {
    const r = resolveTransport(
      { kind: 'ssh', host: 'node-b', user: 'root', port: 2222 },
      { character: { kind: 'shell' }, defaultShell: '/bin/bash' },
    );
    expect(r.shell).toBe('ssh');
    expect(r.args).toContain('-p');
    expect(r.args).toContain('2222');
    expect(r.args).toContain('root@node-b');
    expect(r.args).toContain('-t');
    expect(r.env.MONAD_REMOTE_TRANSPORT).toBe('ssh');
  });

  test('ssh without port omits -p', () => {
    const r = resolveTransport(
      { kind: 'ssh', host: 'node-b' },
      { character: { kind: 'shell' }, defaultShell: '/bin/bash' },
    );
    expect(r.args).not.toContain('-p');
  });
});

describe('transportLabel', () => {
  test('local', () => {
    expect(transportLabel({ kind: 'local' })).toBe('local');
  });
  test('tailscale', () => {
    expect(transportLabel({ kind: 'tailscale', host: 'x' })).toBe('tailscale:x');
  });
  test('ssh with port + user', () => {
    expect(transportLabel({ kind: 'ssh', host: 'x', user: 'u', port: 22 })).toBe('ssh:u@x:22');
  });
  test('ssh bare', () => {
    expect(transportLabel({ kind: 'ssh', host: 'x' })).toBe('ssh:x');
  });
});
