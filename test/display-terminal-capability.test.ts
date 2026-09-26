// AXON P3.1 — Terminal image capability detection tests.
//
// The detector is env-driven (TERM / TERM_PROGRAM / KITTY_WINDOW_ID /
// ELANOUS_IMAGE) + PATH-driven (chafa probe). Tests flip env vars,
// reset the cached state via `_resetForTest()`, and check the
// resolved `protocol` + description.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  detectImageCapability,
  hasImageSupport,
  _resetForTest,
} from '../src/display/terminal-capability.js';
import { _resetForTest as _resetKgp } from '../src/kgp/capabilities.js';

const ENV_KEYS = [
  'ELANOUS_IMAGE',
  'ELANOUS_KGP',
  'TERM',
  'TERM_PROGRAM',
  'KITTY_WINDOW_ID',
  'GHOSTTY_RESOURCES_DIR',
  'KONSOLE_VERSION',
  'WEZTERM_EXECUTABLE',
  'XTERM_VERSION',
];

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
}

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = snapshotEnv();
  clearEnv();
  _resetForTest();
  _resetKgp();
});

afterEach(() => {
  restoreEnv(saved);
  _resetForTest();
  _resetKgp();
});

// ── Override path ────────────────────────────────────────────────────

describe('detectImageCapability · ELANOUS_IMAGE override', () => {
  test('ELANOUS_IMAGE=kitty → kitty', () => {
    process.env.ELANOUS_IMAGE = 'kitty';
    expect(detectImageCapability().protocol).toBe('kitty');
  });

  test('ELANOUS_IMAGE=iterm2 → iterm2', () => {
    process.env.ELANOUS_IMAGE = 'iterm2';
    expect(detectImageCapability().protocol).toBe('iterm2');
  });

  test('ELANOUS_IMAGE=sixel → sixel', () => {
    process.env.ELANOUS_IMAGE = 'sixel';
    expect(detectImageCapability().protocol).toBe('sixel');
  });

  test('ELANOUS_IMAGE=chafa → chafa-fallback', () => {
    process.env.ELANOUS_IMAGE = 'chafa';
    expect(detectImageCapability().protocol).toBe('chafa-fallback');
  });

  test('ELANOUS_IMAGE=none → none', () => {
    process.env.ELANOUS_IMAGE = 'none';
    expect(detectImageCapability().protocol).toBe('none');
  });

  test('ELANOUS_IMAGE=off → none', () => {
    process.env.ELANOUS_IMAGE = 'off';
    expect(detectImageCapability().protocol).toBe('none');
  });

  test('ELANOUS_IMAGE case-insensitive', () => {
    process.env.ELANOUS_IMAGE = 'KITTY';
    expect(detectImageCapability().protocol).toBe('kitty');
  });

  test('unknown override falls through to detection', () => {
    process.env.ELANOUS_IMAGE = 'banana';
    process.env.ELANOUS_IMAGE = '';  // unset → re-detect
    delete process.env.ELANOUS_IMAGE;
    process.env.TERM = 'xterm-kitty';
    expect(detectImageCapability().protocol).toBe('kitty');
  });
});

// ── Auto-detection ───────────────────────────────────────────────────

describe('detectImageCapability · auto-detect', () => {
  test('TERM=xterm-kitty → kitty', () => {
    process.env.TERM = 'xterm-kitty';
    expect(detectImageCapability().protocol).toBe('kitty');
  });

  test('TERM=xterm-ghostty → kitty', () => {
    process.env.TERM = 'xterm-ghostty';
    expect(detectImageCapability().protocol).toBe('kitty');
  });

  test('TERM_PROGRAM=iTerm.app → iterm2', () => {
    process.env.TERM_PROGRAM = 'iTerm.app';
    expect(detectImageCapability().protocol).toBe('iterm2');
  });

  test('TERM_PROGRAM=WezTerm → iterm2 (IIP)', () => {
    process.env.TERM_PROGRAM = 'WezTerm';
    expect(detectImageCapability().protocol).toBe('iterm2');
  });

  test('TERM_PROGRAM=ghostty → kitty (via KGP detect)', () => {
    process.env.TERM_PROGRAM = 'ghostty';
    expect(detectImageCapability().protocol).toBe('kitty');
  });

  test('KITTY_WINDOW_ID set → kitty (via KGP detect)', () => {
    process.env.KITTY_WINDOW_ID = '1';
    expect(detectImageCapability().protocol).toBe('kitty');
  });
});

describe('detectImageCapability · cache + reset', () => {
  test('result cached after first call', () => {
    process.env.ELANOUS_IMAGE = 'kitty';
    expect(detectImageCapability().protocol).toBe('kitty');
    // Flip env without reset — cached result wins.
    delete process.env.ELANOUS_IMAGE;
    process.env.ELANOUS_IMAGE = 'iterm2';
    expect(detectImageCapability().protocol).toBe('kitty');
  });

  test('_resetForTest clears the cache', () => {
    process.env.ELANOUS_IMAGE = 'kitty';
    expect(detectImageCapability().protocol).toBe('kitty');
    _resetForTest();
    delete process.env.ELANOUS_IMAGE;
    process.env.ELANOUS_IMAGE = 'none';
    expect(detectImageCapability().protocol).toBe('none');
  });
});

describe('hasImageSupport', () => {
  test('true for any non-none protocol', () => {
    process.env.ELANOUS_IMAGE = 'kitty';
    expect(hasImageSupport()).toBe(true);
  });

  test('false for none', () => {
    process.env.ELANOUS_IMAGE = 'none';
    expect(hasImageSupport()).toBe(false);
  });
});

describe('detectImageCapability · description text', () => {
  test('each protocol carries a non-empty description', () => {
    const cases: Array<[string, string]> = [
      ['kitty', 'Kitty'],
      ['iterm2', 'iTerm2'],
      ['sixel', 'Sixel'],
      ['chafa', 'chafa'],
      ['none', 'No image'],
    ];
    for (const [override, expected] of cases) {
      _resetForTest();
      _resetKgp();
      delete process.env.ELANOUS_IMAGE;
      process.env.ELANOUS_IMAGE = override;
      const cap = detectImageCapability();
      expect(cap.description.toLowerCase()).toContain(expected.toLowerCase());
    }
  });

  test('cellPx defaults to (8, 16)', () => {
    process.env.ELANOUS_IMAGE = 'kitty';
    const cap = detectImageCapability();
    expect(cap.cellPx).toEqual({ w: 8, h: 16 });
  });
});
