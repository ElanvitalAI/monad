// ── Sink-level redaction (MSS M2.3) ──
//
// Last-line defence against secret material leaking into log sinks.
// `redactSecrets()` in `src/debug/log.ts` is caller-driven — every LLM
// adapter / ACP layer must remember to call it, and any missed site is
// silently unsafe. This module applies a uniform pass in `DebugLog.log`
// after record enrichment and before every sink receives the record,
// so file / ring / mirror / extra sinks all observe the masked payload.
//
// Opt-in via `MSS_REDACT_LOGS=1` (flag default false). When off, the
// log path is byte-identical to pre-M2.3 behaviour.
//
// Design invariants:
//   • Never throws. Circular references short-circuit to a sentinel.
//   • Original `rec.data` is not mutated — the pass returns a shallow
//     copy with a redacted `data` tree.
//   • Top-level `LogRecord` fields (`trace_id`, `elanous_id`, `category`,
//     etc.) are IDs, not secrets — not touched.
//   • Key matching is case-insensitive against a blocklist shared in
//     spirit with `redactSecrets()` (same names, wider coverage).

import type { LogRecord } from './record.js';

/** Key names (lowercase) considered secrets. Matched exactly against
 *  object keys after `toLowerCase()`. Extend via `RedactOpts.keyBlocklist`. */
export const REDACT_KEY_BLOCKLIST: readonly string[] = [
  'authorization',
  'api-key', 'api_key', 'apikey', 'x-api-key', 'x_api_key',
  'openai-api-key', 'openai_api_key',
  'anthropic-api-key', 'anthropic_api_key',
  'cookie', 'set-cookie',
  'access_token', 'accesstoken',
  'refresh_token', 'refreshtoken',
  'password', 'secret', 'private_key',
  // LF6 dogfood 보강(2026-07-13) — 맨몸 'token' 등이 빠져 있어 ingest 프로브의
  // {token: "…"} 가 원문 통과(실측). 카운트류 오탐 가능성보다 유출 방지 우선.
  'token', 'bot_token', 'bottoken', 'bearer',
  'passwd', 'privatekey', 'private-key', 'credentials', 'session_token',
];

export interface RedactOpts {
  /** Key blocklist override. Defaults to `REDACT_KEY_BLOCKLIST`. */
  keyBlocklist?: readonly string[];
  /** Mask function applied to flagged string values. Defaults to
   *  head/tail retention for values longer than 12 chars, `<redacted>`
   *  otherwise. */
  mask?: (value: string) => string;
}

function defaultMask(v: string): string {
  if (v.length <= 12) return '<redacted>';
  return v.slice(0, 4) + '…' + v.slice(-4);
}

function buildBlockSet(opts: RedactOpts): Set<string> {
  const src = opts.keyBlocklist ?? REDACT_KEY_BLOCKLIST;
  return new Set(src.map((k) => k.toLowerCase()));
}

function redactValue(
  v: unknown,
  keyBlock: Set<string>,
  mask: (s: string) => string,
  seen: WeakSet<object>,
): unknown {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t !== 'object') return v;
  if (seen.has(v as object)) return '<circular>';
  seen.add(v as object);
  if (Array.isArray(v)) {
    return v.map((item) => redactValue(item, keyBlock, mask, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (keyBlock.has(k.toLowerCase())) {
      out[k] = typeof val === 'string' ? mask(val) : '<redacted>';
    } else if (val !== null && typeof val === 'object') {
      out[k] = redactValue(val, keyBlock, mask, seen);
    } else {
      out[k] = val;
    }
  }
  return out;
}

/** Return a redacted shallow copy of `rec`. When `rec.data` is absent
 *  or not an object/array, the original record is returned unchanged. */
export function redactLogRecord(rec: LogRecord, opts: RedactOpts = {}): LogRecord {
  if (rec.data === undefined || rec.data === null) return rec;
  if (typeof rec.data !== 'object') return rec;
  const keyBlock = buildBlockSet(opts);
  const mask = opts.mask ?? defaultMask;
  return { ...rec, data: redactValue(rec.data, keyBlock, mask, new WeakSet()) };
}
