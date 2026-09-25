// PR-S1V.D4-γ · review-revised — dictation surface allowlist tests.
//
// PR #1115 review prescribed deny-by-default for plain-Space dictation
// hold across every PaneFocus value. Seven surfaces are now explicitly
// allowlisted; these tests lock that reviewed opt-in set in so a future
// addition is a deliberate change someone has to update both code and
// tests for.

import { describe, expect, test } from 'bun:test';
import {
  getAllowedDictationSurfaces,
  isAllowlistedDictationSurface,
} from '../src/dashboard/input/dictation-surface-allowlist.js';
import type { PaneFocus } from '../src/workspace-types.js';

// Surface-unification v2.2 V2.2-5 Part 2 (2026-05-11) — scheduler-*
// PaneFocus values retired.
const ALLOWED_FOCUS_VALUES: readonly PaneFocus[] = [
  'log',
  'playground',
  'agent-log',
  'debug-events',
  'debug-detail',
  'debug-stack',
  'debug-prompts',
];

const KNOWN_FOCUS_VALUES: readonly PaneFocus[] = [
  'input',
  'browser',
  'obsidian',
  'preview',
  'scratch',
  ...ALLOWED_FOCUS_VALUES,
  'skill-browser',
  'skill-file',
  'agent-roster',
  'agent-detail',
  'sessions-sidebar',
];

describe('PR-S1V.D4-γ · dictation surface allowlist', () => {
  test('default deny — every non-allowlisted known PaneFocus value rejects plain-Space dictation', () => {
    for (const focus of KNOWN_FOCUS_VALUES) {
      expect(isAllowlistedDictationSurface(focus)).toBe(ALLOWED_FOCUS_VALUES.includes(focus));
    }
  });

  test('plugin: prefixed focus values rejected (defensive default)', () => {
    expect(isAllowlistedDictationSurface('plugin:foo' as PaneFocus)).toBe(false);
    expect(isAllowlistedDictationSurface('plugin:bar' as PaneFocus)).toBe(false);
  });

  test('reviewed allowlist pins seven opted-in surfaces (grow via code and tests)', () => {
    expect(getAllowedDictationSurfaces()).toEqual(ALLOWED_FOCUS_VALUES);
  });
});
