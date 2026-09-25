// WT-A-3 — pure-output meta-command dispatcher.

import { describe, expect, test } from 'bun:test';
import { dispatchMetaCommand } from '../src/repl/dispatch-meta';
import type { UserConfig } from '../src/user-config';

function fakeCfg(): UserConfig {
  // Minimum shape — provider rotation entries needed for `:provider`.
  return {
    providers: [],
    debug: { level: 'off' },
    rotation: [],
    skillSets: {},
  } as unknown as UserConfig;
}

function ctx() {
  return { cfg: fakeCfg(), sessionId: 'test-session-12345678' };
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('dispatchMetaCommand', () => {
  test('non-: line returns consumed=false + empty output', () => {
    const r = dispatchMetaCommand('ls -la', ctx());
    expect(r.consumed).toBe(false);
    expect(r.output).toBe('');
  });

  test(':help lists commands', () => {
    const r = dispatchMetaCommand(':help', ctx());
    expect(r.consumed).toBe(true);
    const plain = stripAnsi(r.output);
    expect(plain).toContain(':help');
    expect(plain).toContain(':provider');
    expect(plain).toContain(':fork');
    expect(plain).toContain(':budget');
    expect(plain).toContain(':session');
  });

  test(':? alias works', () => {
    const r = dispatchMetaCommand(':?', ctx());
    expect(r.consumed).toBe(true);
    expect(stripAnsi(r.output)).toContain(':help');
  });

  test(':session echoes the active session id', () => {
    const r = dispatchMetaCommand(':session', ctx());
    expect(r.consumed).toBe(true);
    expect(stripAnsi(r.output)).toContain('test-session-12345678');
  });

  test(':exit sets exitRequested', () => {
    const r = dispatchMetaCommand(':exit', ctx());
    expect(r.consumed).toBe(true);
    expect(r.exitRequested).toBe(true);
    expect(stripAnsi(r.output)).toContain('exit');
  });

  test(':quit / :q aliases', () => {
    expect(dispatchMetaCommand(':quit', ctx()).exitRequested).toBe(true);
    expect(dispatchMetaCommand(':q', ctx()).exitRequested).toBe(true);
  });

  test('unknown :commands return helpful hint', () => {
    const r = dispatchMetaCommand(':bogus', ctx());
    expect(r.consumed).toBe(true);
    const plain = stripAnsi(r.output);
    expect(plain).toContain(':bogus');
    expect(plain).toContain(':help');
  });

  test(':attach is rejected with CLI-only hint (web has different attach)', () => {
    const r = dispatchMetaCommand(':attach /etc/hosts', ctx());
    expect(r.consumed).toBe(true);
    const plain = stripAnsi(r.output);
    expect(plain).toContain('CLI-only');
    expect(plain).toContain('PWA');
  });

  test(':clear-attachments is similarly rejected', () => {
    const r = dispatchMetaCommand(':clear-attachments', ctx());
    expect(r.consumed).toBe(true);
    expect(stripAnsi(r.output)).toContain('CLI-only');
  });

  test('leading whitespace tolerated', () => {
    const r = dispatchMetaCommand('   :session   ', ctx());
    expect(r.consumed).toBe(true);
    expect(stripAnsi(r.output)).toContain('test-session');
  });

  test('non-: with leading whitespace not consumed', () => {
    const r = dispatchMetaCommand('   ls -la', ctx());
    expect(r.consumed).toBe(false);
  });
});

// ── Track 2 — web-term surface narrowing ──────────────────────────────

function webCtx(opts: { terminalId?: string } = {}) {
  const c: { cfg: UserConfig; sessionId: string; surface: 'web-term'; terminalId?: string } = {
    cfg: fakeCfg(),
    sessionId: 'test-session-12345678',
    surface: 'web-term',
  };
  if (opts.terminalId) c.terminalId = opts.terminalId;
  return c;
}

describe('dispatchMetaCommand · web-term surface', () => {
  test(':help lists web-term commands only', () => {
    const r = dispatchMetaCommand(':help', webCtx());
    const plain = stripAnsi(r.output);
    expect(plain).toContain(':tab');
    expect(plain).toContain(':cwd');
    expect(plain).toContain(':capture');
    expect(plain).toContain(':peers');
    expect(plain).not.toContain(':fork');
    expect(plain).not.toContain(':provider');
    expect(plain).not.toContain(':budget');
  });

  test(':fork is redirected with UI hint (not executed)', () => {
    const r = dispatchMetaCommand(':fork', webCtx());
    expect(r.consumed).toBe(true);
    expect(r.sessionIdChange).toBeUndefined();  // not actually forked
    const plain = stripAnsi(r.output);
    expect(plain).toContain(':fork');
    expect(plain).toContain('TopBar');  // hint mentions UI affordance
  });

  test(':provider, :budget, :session, :history, :reload also redirect', () => {
    for (const cmd of ['provider', 'budget', 'session', 'history', 'reload']) {
      const r = dispatchMetaCommand(`:${cmd}`, webCtx());
      expect(r.consumed).toBe(true);
      expect(stripAnsi(r.output)).toContain(`:${cmd}`);
    }
  });

  test(':tab next sets tabIntent="next"', () => {
    const r = dispatchMetaCommand(':tab next', webCtx());
    expect(r.consumed).toBe(true);
    expect(r.tabIntent).toBe('next');
  });

  test(':tab prev sets tabIntent="prev"', () => {
    const r = dispatchMetaCommand(':tab prev', webCtx());
    expect(r.tabIntent).toBe('prev');
  });

  test(':tab <N> sets tabIntent=N (1-indexed)', () => {
    const r = dispatchMetaCommand(':tab 3', webCtx());
    expect(r.tabIntent).toBe(3);
  });

  test(':tab without arg returns error', () => {
    const r = dispatchMetaCommand(':tab', webCtx());
    expect(r.consumed).toBe(true);
    expect(r.tabIntent).toBeUndefined();
    expect(stripAnsi(r.output)).toContain('next | prev');
  });

  test(':cwd needs terminalId', () => {
    const r = dispatchMetaCommand(':cwd', webCtx());
    expect(r.consumed).toBe(true);
    expect(stripAnsi(r.output)).toContain('terminalId');
  });

  test(':peers consumed (ACP handler enriches output)', () => {
    const r = dispatchMetaCommand(':peers', webCtx());
    expect(r.consumed).toBe(true);
  });

  test(':capture consumed (ACP handler does the heavy lift)', () => {
    const r = dispatchMetaCommand(':capture', webCtx({ terminalId: 'preview-1' }));
    expect(r.consumed).toBe(true);
    // The dispatcher itself doesn't set injectPath — ACP handler does.
    expect(r.injectPath).toBeUndefined();
  });
});

describe('dispatchMetaCommand · cli surface keeps web-term commands disabled', () => {
  test(':tab is rejected on cli surface', () => {
    const r = dispatchMetaCommand(':tab next', ctx());
    expect(r.consumed).toBe(true);
    expect(r.tabIntent).toBeUndefined();
    expect(stripAnsi(r.output)).toContain('web-terminal only');
  });

  test(':cwd is rejected on cli surface', () => {
    const r = dispatchMetaCommand(':cwd', ctx());
    expect(stripAnsi(r.output)).toContain('web-terminal only');
  });
});
