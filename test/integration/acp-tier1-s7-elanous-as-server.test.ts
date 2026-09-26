// M7 — Tier 1 · S7 · MT5b · elanous-as-server echo skeleton. Stub.
// HANDOFF §2 S7 confirmed the protocol surface works (echo prefix +
// stopReason: end_turn). Future PR drives the scenario through the
// agent harness so a regression in `acp/server.ts` surfaces.

import { describe, test } from 'bun:test';
import { tier1SkipReason, logSkipReason } from './_helpers.js';

const skipReason = tier1SkipReason();
logSkipReason('S7', skipReason);

describe.skipIf(skipReason !== null)('Tier 1 · S7 · elanous-as-server echo', () => {
  test.skip('echo prefix + stopReason end_turn round-trip (TODO)', () => {
    /* deferred — see file header */
  });
});
