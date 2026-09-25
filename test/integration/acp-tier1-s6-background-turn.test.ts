// M7 — Tier 1 · S6 · LLM-driven background turn invocation. Stub.
// HANDOFF §2 S6 documented LLM tool selection bias (model-agnostic);
// resolution lives in holistic task #8 (description disambiguation).
// This test will validate the "LLM picks ACP background tool" path
// once #8 lands.

import { describe, test } from 'bun:test';
import { tier1SkipReason, logSkipReason } from './_helpers.js';

const skipReason = tier1SkipReason();
logSkipReason('S6', skipReason);

describe.skipIf(skipReason !== null)('Tier 1 · S6 · background turn (post task #8)', () => {
  test.skip('LLM invokes ACP background tool not scheduler (TODO)', () => {
    /* deferred — task #8 holistic resolution */
  });
});
