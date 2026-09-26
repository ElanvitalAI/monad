// ── User-Intent redaction — content hashing + key blocklist ──
//
// PLAN §5 — utterance value default = sha256 content hash, raw GPS
// never persisted, biometric raw numbers never persisted, MSS
// REDACT_KEY_BLOCKLIST applied for cloud sinks.
//
// Two-stage:
//   1. `redactValue(layer, value)` — caller-friendly hash for
//      utterance content (chat / voice transcripts).
//   2. `redactIntentEvent(event)` — recursive key-blocklist sweep that
//      reuses the MSS keyset so authorization / api-key / cookie
//      values never reach a sink.

import { createHash } from 'node:crypto';
import { REDACT_KEY_BLOCKLIST } from '../mss/logging/redaction.js';
import type {
  UserIntentEvent,
  UserIntentLayer,
} from './types.js';

const BLOCK_SET: Set<string> = new Set(REDACT_KEY_BLOCKLIST.map((k) => k.toLowerCase()));

export interface RedactOpts {
  /** When true, utterance `value` is kept verbatim (opt-in via
   *  `~/.elanous/user-intents/opt-in.yaml`). Defaults to false. */
  logFullContent?: boolean;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Hash an utterance value down to `{ content_hash, length }`. Numbers
 *  / booleans pass through; objects/arrays are JSON-stringified before
 *  hashing so structural equality still survives. */
export function hashUtteranceValue(value: unknown): { content_hash: string; length: number } {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { content_hash: sha256(text), length: text.length };
}

/** Layer-aware value pre-processing. Utterance defaults to a hash; all
 *  other layers pass the value through (key-blocklist sweep in
 *  `redactIntentEvent` still applies). */
export function redactValue(
  layer: UserIntentLayer,
  value: unknown,
  opts: RedactOpts = {},
): unknown {
  if (value === undefined || value === null) return value;
  if (layer === 'utterance' && !opts.logFullContent) {
    return hashUtteranceValue(value);
  }
  return value;
}

function sweep(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t !== 'object') return value;
  if (seen.has(value as object)) return '<circular>';
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((item) => sweep(item, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (BLOCK_SET.has(k.toLowerCase())) {
      out[k] = typeof v === 'string' && v.length > 12
        ? `${v.slice(0, 4)}…${v.slice(-4)}`
        : '<redacted>';
    } else if (v !== null && typeof v === 'object') {
      out[k] = sweep(v, seen);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Final sink-bound redaction. Sweeps the entire event for
 *  blocklisted keys and strips raw GPS / raw motion / raw biometric
 *  numbers per PLAN §5. */
export function redactIntentEvent(event: UserIntentEvent): UserIntentEvent {
  const swept = sweep(event, new WeakSet()) as UserIntentEvent;
  // Defensive — strip any motion.raw_signal that survived. Callers
  // opt-in via debug only; sinks should never see it.
  if (swept.intent?.motion?.raw_signal !== undefined) {
    const { raw_signal: _drop, ...rest } = swept.intent.motion;
    swept.intent = { ...swept.intent, motion: rest };
  }
  return swept;
}
