// M7 — Tier 1 · S5 · multi-backend session isolation. Stub.
// Future PR ports the manual scenario from HANDOFF §2 S5 — verifies
// `/acp status` shows 2 entries + sessions don't bleed across backends.

import { describe, test } from 'bun:test';
import { tier1SkipReason, logSkipReason } from './_helpers.js';

const skipReason = tier1SkipReason();
logSkipReason('S5', skipReason);

describe.skipIf(skipReason !== null)('Tier 1 · S5 · multi-backend isolation', () => {
  test.skip('two backends concurrent · session bleed check (TODO)', () => {
    /* deferred — see file header */
  });
});
