// M7 (2026-04-28) — Tier 1 · S1 · claude-code-acp basic round-trip.
//
// Stub. Full implementation deferred to follow-up — requires
// claude-code-acp on PATH + ANTHROPIC_API_KEY. The harness pattern
// matches S4; future PR ports the manual scenario from
// 내부 문서 §2 (S1).
//
// Gated by ELANOUS_CODEX_TIER1_SMOKE=1.

import { describe, test } from 'bun:test';
import { tier1SkipReason, logSkipReason } from './_helpers.js';

const skipReason = tier1SkipReason();
logSkipReason('S1', skipReason);

describe.skipIf(skipReason !== null)('Tier 1 · S1 · claude-code-acp basic', () => {
  test.skip('claude-code-acp spawn + initialize + single-turn echo (TODO)', () => {
    /* deferred — see file header */
  });
});
