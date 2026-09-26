// ── Session URI minter (MSS M1.1 Phase B1) ──
//
// Single helper for minting a fresh Tier 2 `SessionUri`. Wraps the
// generic `newElanousUri('session')` + `asSessionUri()` pair so every
// call site gets a typed `SessionUri` without repeating the validation
// step — and so the bifurcation between "this is a SessionUri" and
// "this is some other ElanousUri" is encoded in one place.
//
// PLAN §7 (URI grammar) + §11.2 (Migration). The ACP backend agent
// feeds this into its `mintSessionId()` and cross-casts the result
// back to the SDK's `SessionId` string-alias; internal code paths
// keep the brand so the compiler catches "did you pass a raw string
// where a SessionUri was expected?" drift.

import type { SessionUri } from './brand.js';
import { asSessionUri, newElanousUri } from './builder.js';

/** Mint a fresh Tier 2 SessionUri of the form `session/<ULID>`.
 *
 *  Monotonic-ish ordering: ULID's 48-bit timestamp prefix means
 *  successive mints in different milliseconds sort in insertion
 *  order. Calls within the same millisecond pick random 80-bit
 *  suffixes, so ties break randomly (ULID spec). Callers that need
 *  deterministic ordering should pair the URI with an explicit
 *  monotonic counter. */
export function mintSessionUri(): SessionUri {
  return asSessionUri(newElanousUri('session'));
}
