import { afterEach, describe, expect, test } from 'bun:test';
import {
  getCapturedEnv,
  parsePrintenv,
  resetCapturedEnvForTesting,
  setCapturedEnvForTesting,
} from '../src/shell-env-bootstrap.js';

afterEach(() => {
  resetCapturedEnvForTesting();
});

describe('F3 — parsePrintenv', () => {
  test('parses standard KEY=VALUE lines', () => {
    const out = parsePrintenv('PATH=/usr/bin:/bin\nHOME=/Users/j\nSHELL=/bin/zsh');
    expect(out.PATH).toBe('/usr/bin:/bin');
    expect(out.HOME).toBe('/Users/j');
    expect(out.SHELL).toBe('/bin/zsh');
  });

  test('preserves = in values', () => {
    const out = parsePrintenv('CODE_PAGE=ISO-8859=1\nURL=https://foo?a=b');
    expect(out.CODE_PAGE).toBe('ISO-8859=1');
    expect(out.URL).toBe('https://foo?a=b');
  });

  test('skips empty lines and malformed entries', () => {
    const out = parsePrintenv('\nFOO=bar\n\n=oops\nBAZ=qux\n');
    expect(out.FOO).toBe('bar');
    expect(out.BAZ).toBe('qux');
    // leading `=` skipped (no key)
    expect(Object.keys(out)).toHaveLength(2);
  });
});

describe('F3 — setCapturedEnvForTesting / getCapturedEnv', () => {
  test('injected env is returned as-is', () => {
    setCapturedEnvForTesting({ PATH: '/mock/bin', HELLO: 'world' });
    const env = getCapturedEnv();
    expect(env.PATH).toBe('/mock/bin');
    expect(env.HELLO).toBe('world');
  });

  test('null cache falls back to process.env', () => {
    setCapturedEnvForTesting(null);
    const env = getCapturedEnv();
    // process.env always has at least PATH on a sane system; we just
    // check that we got *something* non-mock back.
    expect(env).not.toEqual({ PATH: '/mock/bin', HELLO: 'world' });
  });

  test('MONAD_SKIP_LOGIN_ENV=1 opt-out returns process.env without spawning', () => {
    const prev = process.env.MONAD_SKIP_LOGIN_ENV;
    process.env.MONAD_SKIP_LOGIN_ENV = '1';
    try {
      resetCapturedEnvForTesting();
      const env = getCapturedEnv();
      // Exact identity: we returned process.env itself (cast).
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      if (prev === undefined) delete process.env.MONAD_SKIP_LOGIN_ENV;
      else process.env.MONAD_SKIP_LOGIN_ENV = prev;
    }
  });
});
