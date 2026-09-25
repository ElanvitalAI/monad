import { describe, expect, test } from 'bun:test';

import {
  shouldWrapForKeychainUnlock,
  wrapCommandForKeychainUnlock,
} from '../src/terminal/keychain-unlock.js';

// `process.platform` is a runtime-fixed string — we can't override
// it cleanly in bun:test. The wrap function takes the env as an
// arg so we test the env branch deterministically; the
// platform-gate branches collapse to "no-op on non-darwin"
// implicitly when this file runs on Linux CI.

describe('shouldWrapForKeychainUnlock', () => {
  test('false when no SSH env vars set', () => {
    const env = {} as NodeJS.ProcessEnv;
    if (process.platform === 'darwin') {
      expect(shouldWrapForKeychainUnlock(env)).toBe(false);
    }
  });

  test('true on darwin when SSH_CONNECTION is set', () => {
    if (process.platform !== 'darwin') return;
    expect(shouldWrapForKeychainUnlock({ SSH_CONNECTION: '1.2.3.4 5 6 7' } as NodeJS.ProcessEnv))
      .toBe(true);
  });

  test('true on darwin when only SSH_TTY is set', () => {
    if (process.platform !== 'darwin') return;
    expect(shouldWrapForKeychainUnlock({ SSH_TTY: '/dev/ttys001' } as NodeJS.ProcessEnv))
      .toBe(true);
  });

  test('true on darwin when only SSH_CLIENT is set', () => {
    if (process.platform !== 'darwin') return;
    expect(shouldWrapForKeychainUnlock({ SSH_CLIENT: '1.2.3.4 12345 22' } as NodeJS.ProcessEnv))
      .toBe(true);
  });

  test.skipIf(process.platform === 'darwin')('false on non-darwin even with SSH_CONNECTION', () => {
    expect(shouldWrapForKeychainUnlock({ SSH_CONNECTION: '1.2.3.4 5 6 7' } as NodeJS.ProcessEnv))
      .toBe(false);
  });
});

describe('wrapCommandForKeychainUnlock', () => {
  test('returns input unchanged when SSH env not set', () => {
    const env = {} as NodeJS.ProcessEnv;
    if (process.platform === 'darwin') {
      expect(wrapCommandForKeychainUnlock('claude', env)).toBe('claude');
      expect(wrapCommandForKeychainUnlock('claude --foo bar', env)).toBe('claude --foo bar');
    }
  });

  test('wraps in sh -c with security unlock-keychain preamble on darwin+SSH', () => {
    if (process.platform !== 'darwin') return;
    const env = { SSH_CONNECTION: '1.2.3.4 5 6 7' } as NodeJS.ProcessEnv;
    const out = wrapCommandForKeychainUnlock('claude', env);
    expect(out.startsWith(`sh -c '`)).toBe(true);
    expect(out).toContain('security unlock-keychain');
    expect(out).toContain('login.keychain-db');
    expect(out).toContain('exec claude');
  });

  test('preserves extra args after exec', () => {
    if (process.platform !== 'darwin') return;
    const env = { SSH_TTY: '/dev/ttys001' } as NodeJS.ProcessEnv;
    const out = wrapCommandForKeychainUnlock('claude --resume abc123', env);
    expect(out).toContain('exec claude --resume abc123');
  });

  test('escapes single quotes in the wrapped command', () => {
    if (process.platform !== 'darwin') return;
    const env = { SSH_CONNECTION: 'x' } as NodeJS.ProcessEnv;
    // hypothetical command with a single quote in an arg
    const out = wrapCommandForKeychainUnlock(`claude --note 'hi'`, env);
    // Outer wrapper opens with `sh -c '` so any single quote inside
    // the wrapped command must be closed-and-reopened.
    expect(out).toContain(`'\\''hi'\\''`);
    expect(out.endsWith(`'`)).toBe(true);
  });

  test.skipIf(process.platform === 'darwin')('returns input unchanged on non-darwin', () => {
    const env = { SSH_CONNECTION: '1.2.3.4 5 6 7' } as NodeJS.ProcessEnv;
    expect(wrapCommandForKeychainUnlock('claude', env)).toBe('claude');
  });

  // Regression: an earlier version embedded a single-quoted printf
  // format ("printf '\033[1;36m…'") inside the outer `sh -c '…'`,
  // which broke the outer quoting and let the shell glob-expand
  // `\033[1;…]` ("zsh: bad pattern: 033[1"). The wrapped command
  // must contain no raw single quotes inside the outer single-
  // quoted region — only the standard close/reopen escape pattern
  // `'\''` produced by the input-escape pass.
  test('no nested single quotes that break sh -c parsing (regression)', () => {
    if (process.platform !== 'darwin') return;
    const env = { SSH_CONNECTION: 'x' } as NodeJS.ProcessEnv;
    const out = wrapCommandForKeychainUnlock('claude', env);
    // Strip the outer `sh -c '` open and the trailing `'` close.
    expect(out.startsWith(`sh -c '`)).toBe(true);
    expect(out.endsWith(`'`)).toBe(true);
    const inner = out.slice(`sh -c '`.length, -1);
    // For the canonical `claude` input (no quotes), the inner
    // string should contain zero single-quote characters.
    expect(inner.includes(`'`)).toBe(false);
  });

  // Regression: an earlier version chained `security unlock` and
  // `exec claude` with `;`, so a wrong-password unlock would still
  // exec claude — and claude's TUI cleared the screen and hid the
  // "incorrect passphrase" line from `security`. With `&&`, exec
  // only runs on unlock success and the failure stays visible.
  test('uses && between unlock and exec so failures stay visible (regression)', () => {
    if (process.platform !== 'darwin') return;
    const env = { SSH_CONNECTION: 'x' } as NodeJS.ProcessEnv;
    const out = wrapCommandForKeychainUnlock('claude', env);
    expect(out).toContain('login.keychain-db" && exec claude');
    expect(out).not.toContain('login.keychain-db"; exec');
  });

  test('no \\033 escape sequences leak into the wrapped command (regression)', () => {
    if (process.platform !== 'darwin') return;
    const env = { SSH_CONNECTION: 'x' } as NodeJS.ProcessEnv;
    const out = wrapCommandForKeychainUnlock('claude', env);
    // Old impl included `\033[1;36m…` which the shell would try to
    // glob-expand. New impl uses plain echo without colors.
    expect(out).not.toContain(`\\033`);
    expect(out).not.toContain('printf');
  });
});
