// M7 (2026-04-28) — Tier 1 · S2 · codex-acp multi-turn context preservation.
//
// Stub. Future PR ports the manual 3-turn scenario (FRB → "that
// organization" → Powell) from HANDOFF §2 (S2).

import { describe, test } from 'bun:test';
import { tier1SkipReason, logSkipReason } from './_helpers.js';

const skipReason = tier1SkipReason();
logSkipReason('S2', skipReason);

describe.skipIf(skipReason !== null)('Tier 1 · S2 · codex-acp multi-turn', () => {
  test.skip('3-turn pronoun resolution against codex-acp (TODO)', () => {
    /* deferred — see file header */
  });
});
