// ── U4 — Tailscale integration smoke test ──
//
// Two layers of verification:
//
//  1) UNCONDITIONAL — `resolveTransport` builds the exact argv that
//     will be handed to node-pty at spawn time. This runs in every
//     CI because it doesn't need the tailscale binary or a real
//     remote host.
//
//  2) LIVE — only when `TAILSCALE_TEST=1` AND `TAILSCALE_HOST` is
//     set AND the `tailscale` binary resolves on PATH. Actually
//     spawns `tailscale ssh <host> -- echo monad-smoke` and
//     captures stdout via the existing SpawnFn seam. Skips
//     otherwise (logged as pending rather than fail).
//
// The live leg is deliberately tiny — we only prove the wire-up
// doesn't crash + a line comes back. Real SSH / Tailscale admin
// tests live in the platform's own infra repo.

import { describe, expect, test } from 'bun:test';
import { execSync, spawnSync } from 'node:child_process';

import { resolveTransport, transportLabel } from '../../src/terminal-matrix/transport.js';

function tailscaleAvailable(): boolean {
  try {
    const r = spawnSync('tailscale', ['version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}

const LIVE = process.env.TAILSCALE_TEST === '1'
  && !!process.env.TAILSCALE_HOST
  && tailscaleAvailable();

describe('Tailscale transport — argv construction (unconditional)', () => {
  test('shell character: tailscale ssh <host> --', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a' },
      { character: { kind: 'shell' }, defaultShell: '/bin/bash' },
    );
    expect(r.shell).toBe('tailscale');
    expect(r.args).toEqual(['ssh', 'node-a', '--']);
    expect(r.env.MONAD_REMOTE_HOST).toBe('node-a');
    expect(r.env.MONAD_REMOTE_TRANSPORT).toBe('tailscale');
  });

  test('user@host formatting preserved in argv', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a', user: 'ops' },
      { character: { kind: 'shell' }, defaultShell: '/bin/bash' },
    );
    expect(r.args[1]).toBe('ops@node-a');
  });

  test('claude-code character → exec claude-code inside login shell', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a' },
      { character: { kind: 'claude-code' }, defaultShell: '/bin/bash' },
    );
    // ['ssh','node-a','--','bash','-lc','exec claude-code']
    expect(r.args.slice(3)).toEqual(['bash', '-lc', 'exec claude-code']);
  });

  test('codex character → exec codex', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a' },
      { character: { kind: 'codex' }, defaultShell: '/bin/bash' },
    );
    expect(r.args.slice(3)).toEqual(['bash', '-lc', 'exec codex']);
  });

  test('custom character is shell-escaped', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: 'node-a' },
      {
        character: { kind: 'custom', name: 'lazygit', spawnArgs: ['-p', 'some path'] },
        defaultShell: '/bin/bash',
      },
    );
    const joined = r.args.join(' ');
    expect(joined).toContain("exec 'lazygit'");
    expect(joined).toContain("'-p'");
    expect(joined).toContain("'some path'");
  });

  test('transportLabel renders human-friendly', () => {
    expect(transportLabel({ kind: 'tailscale', host: 'node-a' }))
      .toBe('tailscale:node-a');
    expect(transportLabel({ kind: 'ssh', host: 'node-b', user: 'root', port: 2222 }))
      .toBe('ssh:root@node-b:2222');
  });
});

describe('Tailscale transport — LIVE smoke', () => {
  if (!LIVE) {
    test.skip('gated — set TAILSCALE_TEST=1 + TAILSCALE_HOST=<host> + ensure `tailscale` on PATH', () => {
      // skipped
    });
    return;
  }

  // This test runs `tailscale ssh <host> -- echo monad-smoke` via
  // spawnSync (not via PreviewTerminal) and asserts the expected
  // sentinel comes back. That proves (a) tailscale binary works,
  // (b) the host is reachable, (c) argv we'd hand to node-pty at
  // real spawn time is functional. A failure here means the remote
  // transport path would fail in production too.
  test('argv from resolveTransport actually executes round-trip', () => {
    const r = resolveTransport(
      { kind: 'tailscale', host: process.env.TAILSCALE_HOST! },
      { character: { kind: 'shell' }, defaultShell: '/bin/bash' },
    );
    // Append an echo so we don't need to start a real shell.
    const argv = [...r.args, 'echo', 'monad-smoke-ok'];
    const output = execSync(`${r.shell} ${argv.join(' ')}`, {
      timeout: 15_000,
      env: { ...process.env, ...r.env },
    }).toString('utf8');
    expect(output).toContain('monad-smoke-ok');
  }, 20_000);
});
