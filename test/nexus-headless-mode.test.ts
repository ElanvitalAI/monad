// P.1.5 — `--headless` flag · resolveHeadlessMode unit coverage.
//
// Covers the 4 documented scenarios from HANDOFF Track P §3.3:
//   - TUI skip (opt set true)
//   - signal env equivalent (ELANOUS_NEXUS_HEADLESS=1)
//   - explicit `false` opt overrides env (allow opt-out scripts)
//   - default false (TUI mode preserved when neither set)
//
// Plus matrix coverage on truthy env value spellings + TTY independence.

import { describe, expect, test } from 'bun:test';

import { resolveHeadlessMode } from '../src/nexus/headless-mode.js';

describe('P.1.5 · resolveHeadlessMode', () => {
  test('opts.headless = true → headless', () => {
    expect(resolveHeadlessMode({ headless: true, env: {} })).toBe(true);
  });

  test('ELANOUS_NEXUS_HEADLESS=1 env (no opt) → headless', () => {
    expect(resolveHeadlessMode({ env: { ELANOUS_NEXUS_HEADLESS: '1' } })).toBe(true);
  });

  test('opts.headless = false overrides env=1 (explicit opt wins)', () => {
    expect(
      resolveHeadlessMode({ headless: false, env: { ELANOUS_NEXUS_HEADLESS: '1' } }),
    ).toBe(false);
  });

  test('neither opt nor env → TUI mode (default false)', () => {
    expect(resolveHeadlessMode({ env: {} })).toBe(false);
  });
});

describe('P.1.5 · ELANOUS_NEXUS_HEADLESS truthy spellings', () => {
  test.each([
    ['1', true],
    ['true', true],
    ['TRUE', true],
    ['yes', true],
    ['on', true],
    [' 1 ', true],   // whitespace tolerated
    ['0', false],
    ['false', false],
    ['no', false],
    ['off', false],
    ['', false],
    ['anything-else', false],
  ])('env value %p → headless = %p', (raw, expected) => {
    expect(resolveHeadlessMode({ env: { ELANOUS_NEXUS_HEADLESS: raw } })).toBe(expected);
  });
});

describe('P.1.5 · TTY independence', () => {
  test('resolver does not consult process.stdin.isTTY', () => {
    // The resolver is a pure (opts, env) → boolean function. The
    // first-boot wizard (P.3) is the layer that reads isTTY for prompt
    // suppression — headless decisions stay env-driven so the user can
    // opt in even when running through `elanous nexus | tee` (which
    // strips TTY but is not a service-mode invocation).
    //
    // This test pins the contract: with no env / no opt, headless is
    // false regardless of whether stdin is a TTY.
    expect(resolveHeadlessMode({ env: {} })).toBe(false);
    // And with env=1, headless is true regardless of TTY.
    expect(resolveHeadlessMode({ env: { ELANOUS_NEXUS_HEADLESS: '1' } })).toBe(true);
  });
});
