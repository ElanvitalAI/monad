// ── PTY activity log formatter tests ──

import { describe, test, expect } from 'bun:test';
import { formatPtyCallLine, formatPtyResultLine, isPtyTool } from '../src/pty-activity-log';

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('isPtyTool', () => {
  test('recognizes the 5 PtyShell tools', () => {
    for (const n of ['PtyShellStart', 'PtyShellPoll', 'PtyShellSend', 'PtyShellKill', 'PtyShellList']) {
      expect(isPtyTool(n)).toBe(true);
    }
  });

  test('rejects other names', () => {
    expect(isPtyTool('Bash')).toBe(false);
    expect(isPtyTool('ptyshellstart')).toBe(false); // case-sensitive
    expect(isPtyTool('')).toBe(false);
  });
});

describe('formatPtyCallLine', () => {
  test('returns null for non-PTY tools', () => {
    expect(formatPtyCallLine('Bash', { cmd: 'ls' })).toBeNull();
    expect(formatPtyCallLine('FileRead', {})).toBeNull();
  });

  test('Start shows ⚡ spawn + quoted cmd', () => {
    const s = strip(formatPtyCallLine('PtyShellStart', { cmd: 'bun test --watch' })!);
    expect(s).toContain('⚡ spawn');
    expect(s).toContain('"bun test --watch"');
  });

  test('Start truncates long cmd to … at 60 chars', () => {
    const long = 'bun '.repeat(40);
    const s = strip(formatPtyCallLine('PtyShellStart', { cmd: long })!);
    expect(s).toContain('…');
    // quoted cmd body ≤ 60 chars
    const m = s.match(/"([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(60);
  });

  test('Start flags detach', () => {
    const s = strip(formatPtyCallLine('PtyShellStart', { cmd: 'tail -f log', detach: true })!);
    expect(s).toContain('[detach]');
  });

  test('Poll shows ⚡ poll + id', () => {
    const s = strip(formatPtyCallLine('PtyShellPoll', { process_id: 'pty_abc123' })!);
    expect(s).toContain('⚡ poll pty_abc123');
  });

  test('Send shows id + quoted input', () => {
    const s = strip(formatPtyCallLine('PtyShellSend', { process_id: 'pty_x', input: 'hello' })!);
    expect(s).toContain('⚡ write pty_x');
    expect(s).toContain('"hello"');
  });

  test('Send escapes whitespace in input', () => {
    const s = strip(formatPtyCallLine('PtyShellSend', { process_id: 'pty_x', input: 'hi\nthere\t!' })!);
    expect(s).toContain('\\n');
    expect(s).toContain('\\t');
    // No literal newline should leak into the line.
    expect(s.split('\n').length).toBe(1);
  });

  test('Kill shows ⚡ kill + id + optional signal', () => {
    expect(strip(formatPtyCallLine('PtyShellKill', { process_id: 'pty_y' })!)).toContain('⚡ kill pty_y');
    const s = strip(formatPtyCallLine('PtyShellKill', { process_id: 'pty_y', signal: 'SIGKILL' })!);
    expect(s).toContain('SIGKILL');
  });

  test('List shows ⚡ list', () => {
    const s = strip(formatPtyCallLine('PtyShellList', {})!);
    expect(s).toContain('⚡ list');
  });

  test('missing required args fall back to placeholder, not crash', () => {
    expect(strip(formatPtyCallLine('PtyShellStart', {})!)).toContain('(no cmd)');
    expect(strip(formatPtyCallLine('PtyShellPoll', {})!)).toContain('?');
  });
});

describe('formatPtyResultLine', () => {
  test('returns null for non-PTY tools', () => {
    expect(formatPtyResultLine('Bash', { output: 'foo' })).toBeNull();
  });

  test('returns null for error payloads', () => {
    expect(formatPtyResultLine('PtyShellStart', { error: 'nope' })).toBeNull();
  });

  test('returns null when output missing', () => {
    expect(formatPtyResultLine('PtyShellStart', {})).toBeNull();
    expect(formatPtyResultLine('PtyShellStart', { output: '' })).toBeNull();
  });

  test('Start parses process_id + status', () => {
    const s = strip(formatPtyResultLine('PtyShellStart', {
      output: 'PtyShellStart process_id=pty_abc123 status=running bytes=0\n',
    })!);
    expect(s).toContain('spawned pty_abc123');
    expect(s).toContain('running');
  });

  test('Poll parses bytes + status', () => {
    const s = strip(formatPtyResultLine('PtyShellPoll', {
      output: 'PtyShellPoll process_id=pty_x status=running bytes=512\nhello',
    })!);
    expect(s).toContain('512B from pty_x');
    expect(s).toContain('running');
  });

  test('Send parses id + byte count', () => {
    const s = strip(formatPtyResultLine('PtyShellSend', {
      output: 'PtyShellSend process_id=pty_y status=running bytes=20\nhi',
    })!);
    expect(s).toContain('wrote to pty_y');
    expect(s).toContain('20B reply');
  });

  test('Send preserves full-header success wording', () => {
    const s = strip(formatPtyResultLine('PtyShellSend', {
      output: 'PtyShellSend process_id=pty_cc86e3d0 status=running bytes=60\nhi',
    })!);
    expect(s).toBe('  ↳ wrote to pty_cc86e3d0 · 60B reply (running)');
  });

  test('Send distinguishes missing bytes from measured zero bytes', () => {
    const zero = strip(formatPtyResultLine('PtyShellSend', {
      output: 'PtyShellSend process_id=pty_zero status=running bytes=0\n',
    })!);
    const missing = strip(formatPtyResultLine('PtyShellSend', {
      output: 'PtyShellSend process_id=pty_missing status=running\n',
    })!);
    expect(zero).toBe('  ↳ wrote to pty_zero · 0B reply (running)');
    expect(missing).toBe('  ↳ wrote to pty_missing · ?B reply (running) · incomplete header');
  });

  test('Send marks a fully missing result header as incomplete without measured defaults', () => {
    const s = strip(formatPtyResultLine('PtyShellSend', {
      output: 'PtyShellSend\n',
    })!);
    expect(s).toBe('  ↳ wrote to ? · ?B reply (?) · incomplete header');
    expect(s).not.toContain('0B reply');
    expect(s).not.toContain('(unknown)');
  });

  test('Start marks a missing status as incomplete', () => {
    const s = strip(formatPtyResultLine('PtyShellStart', {
      output: 'PtyShellStart process_id=pty_start bytes=0\n',
    })!);
    expect(s).toBe('  ↳ spawned pty_start (?) · incomplete header');
  });

  test('Poll marks partial missing header values as incomplete', () => {
    const missingBytes = strip(formatPtyResultLine('PtyShellPoll', {
      output: 'PtyShellPoll process_id=pty_poll status=running\n',
    })!);
    const missingStatus = strip(formatPtyResultLine('PtyShellPoll', {
      output: 'PtyShellPoll process_id=pty_poll bytes=0\n',
    })!);
    expect(missingBytes).toBe('  ↳ ?B from pty_poll (running) · incomplete header');
    expect(missingStatus).toBe('  ↳ 0B from pty_poll (?) · incomplete header');
  });

  test('Kill marks a missing exit code as incomplete', () => {
    const s = strip(formatPtyResultLine('PtyShellKill', {
      output: 'PtyShellKill process_id=pty_z killed=true\n',
    })!);
    expect(s).toBe('  ↳ killed pty_z (exit ?) · incomplete header');
  });

  test('Kill marks a missing killed flag as incomplete without defaulting to already-exited', () => {
    const s = strip(formatPtyResultLine('PtyShellKill', {
      output: 'PtyShellKill process_id=pty_z exit=0\n',
    })!);
    expect(s).toBe('  ↳ ? pty_z (exit 0) · incomplete header');
    expect(s).not.toContain('already-exited');
  });

  test('empty header values are missing values, not measured values', () => {
    const send = strip(formatPtyResultLine('PtyShellSend', {
      output: 'PtyShellSend process_id=pty_empty status=running bytes=\n',
    })!);
    const kill = strip(formatPtyResultLine('PtyShellKill', {
      output: 'PtyShellKill process_id=pty_empty killed= exit=0\n',
    })!);
    expect(send).toBe('  ↳ wrote to pty_empty · ?B reply (running) · incomplete header');
    expect(kill).toBe('  ↳ ? pty_empty (exit 0) · incomplete header');
    expect(send).not.toContain(' · B reply');
    expect(kill).not.toContain('already-exited');
  });

  test('Kill parses killed flag + exit', () => {
    const s = strip(formatPtyResultLine('PtyShellKill', {
      output: 'PtyShellKill process_id=pty_z killed=true exit=0\n',
    })!);
    expect(s).toContain('killed pty_z');
    expect(s).toContain('exit 0');
  });

  test('Kill on already-exited shows different verb', () => {
    const s = strip(formatPtyResultLine('PtyShellKill', {
      output: 'PtyShellKill process_id=pty_z killed=false exit=1\n',
    })!);
    expect(s).toContain('already-exited');
  });

  test('List returns null — list output already self-describing', () => {
    expect(formatPtyResultLine('PtyShellList', {
      output: 'PtyShellList — no active processes',
    })).toBeNull();
  });
});
