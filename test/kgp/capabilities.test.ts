// Verify the KGP terminal detection heuristic matches Yazi's brand.rs
// behaviour across the terminals we actually ship to.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { detectKgpSupport, isKgpTerminal, _resetForTest } from '../../src/kgp/capabilities.js';

// Env needs to be scrubbed between tests or cached results + parent env
// bleed-through will give false positives. This helper snapshots +
// restores the small set of vars we care about.
const ENV_KEYS = [
  'MONAD_KGP',
  'TERM',
  'TERM_PROGRAM',
  'KITTY_WINDOW_ID',
  'GHOSTTY_RESOURCES_DIR',
  'KONSOLE_VERSION',
  'WEZTERM_EXECUTABLE',
  'ITERM_SESSION_ID',
] as const;

let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const k of ENV_KEYS) {
    snapshot[k] = process.env[k];
    delete process.env[k];
  }
  _resetForTest();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
  _resetForTest();
});

describe('capabilities — brand detection', () => {
  test('Ghostty via TERM=xterm-ghostty', () => {
    process.env.TERM = 'xterm-ghostty';
    expect(detectKgpSupport()).toBe('kgp');
    expect(isKgpTerminal()).toBe(true);
  });

  test('Ghostty via GHOSTTY_RESOURCES_DIR env var', () => {
    process.env.TERM = 'xterm-256color'; // TERM not helpful
    process.env.GHOSTTY_RESOURCES_DIR = '/Applications/Ghostty.app/...';
    expect(detectKgpSupport()).toBe('kgp');
  });

  test('Kitty via TERM=xterm-kitty', () => {
    process.env.TERM = 'xterm-kitty';
    expect(detectKgpSupport()).toBe('kgp');
  });

  test('Kitty via KITTY_WINDOW_ID', () => {
    process.env.TERM = 'screen';
    process.env.KITTY_WINDOW_ID = '1';
    expect(detectKgpSupport()).toBe('kgp');
  });

  test('Konsole maps to kgp-old', () => {
    process.env.KONSOLE_VERSION = '240400';
    expect(detectKgpSupport()).toBe('kgp-old');
  });

  test('iTerm2 falls back to chafa (IIP not KGP)', () => {
    process.env.TERM_PROGRAM = 'iTerm.app';
    expect(detectKgpSupport()).toBeNull();
  });

  test('xterm-256color with no brand env = null', () => {
    process.env.TERM = 'xterm-256color';
    expect(detectKgpSupport()).toBeNull();
    expect(isKgpTerminal()).toBe(false);
  });
});

describe('capabilities — overrides', () => {
  test('MONAD_KGP=0 forces null even on Ghostty', () => {
    process.env.TERM = 'xterm-ghostty';
    process.env.MONAD_KGP = '0';
    expect(detectKgpSupport()).toBeNull();
  });

  test('MONAD_KGP=1 forces kgp on xterm', () => {
    process.env.TERM = 'xterm-256color';
    process.env.MONAD_KGP = '1';
    expect(detectKgpSupport()).toBe('kgp');
  });

  test('MONAD_KGP=old forces kgp-old', () => {
    process.env.MONAD_KGP = 'old';
    expect(detectKgpSupport()).toBe('kgp-old');
  });

  test('MONAD_KGP=off reads as falsey', () => {
    process.env.TERM = 'xterm-kitty';
    process.env.MONAD_KGP = 'off';
    expect(detectKgpSupport()).toBeNull();
  });
});

describe('capabilities — memoization', () => {
  test('result is cached within a session', () => {
    process.env.TERM = 'xterm-ghostty';
    expect(detectKgpSupport()).toBe('kgp');
    // Even if env flips, cached value stays until _resetForTest.
    delete process.env.TERM;
    delete process.env.GHOSTTY_RESOURCES_DIR;
    expect(detectKgpSupport()).toBe('kgp');
  });
});
