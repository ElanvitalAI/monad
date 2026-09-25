// MSS M3 Signal Bus — cascade-zyu W3 Y1.
// 5-tier signal envelope so Patcher / Thinker / workflow-runtime can subscribe
// to threshold + emergency triggers without a per-source poll loop.

export type SignalTier =
  /** Trivial — usually never crosses the bus alone (e.g. heartbeat). */
  | 'trace'
  /** Routine — log accumulation, periodic stat. */
  | 'info'
  /** Threshold reached — Patcher batch trigger, KGS write quota. */
  | 'threshold'
  /** Emergency — user-flagged urgent, oncall-style. */
  | 'emergency'
  /** Critical — system-level fault, never silenced. */
  | 'critical';

export const SIGNAL_TIERS: readonly SignalTier[] = [
  'trace', 'info', 'threshold', 'emergency', 'critical',
];

export function isSignalTier(v: unknown): v is SignalTier {
  return typeof v === 'string' && (SIGNAL_TIERS as readonly string[]).includes(v);
}

export const SIGNAL_TIER_RANK: Record<SignalTier, number> = {
  trace: 0,
  info: 1,
  threshold: 2,
  emergency: 3,
  critical: 4,
};

export function tierAtLeast(a: SignalTier, b: SignalTier): boolean {
  return SIGNAL_TIER_RANK[a] >= SIGNAL_TIER_RANK[b];
}

export interface SignalEnvelope {
  schema_version: 1;
  id: string;
  /** Dotted source — `patcher.batch_ready` / `user_intent.jsonl_quota`. */
  source: string;
  tier: SignalTier;
  /** ISO 8601 UTC. */
  ts: string;
  /** Short human-readable summary. */
  message: string;
  /** Free-form payload — subscribers decide how to interpret. */
  payload?: Record<string, unknown>;
  /** Idempotency key — bus rejects duplicates with the same dedupeKey
   *  within a window. */
  dedupeKey?: string;
}

export interface SignalSubscription {
  /** `source` glob (e.g. `patcher.*`). Matches by prefix when ending in `*`. */
  sourceGlob: string;
  /** Minimum tier — subscriber receives signals at this tier or above. */
  minTier: SignalTier;
  handler: (envelope: SignalEnvelope) => void | Promise<void>;
}

export interface SignalEmitOptions {
  /** Override the envelope `id`. */
  id?: string;
  /** Override `ts`. */
  ts?: string;
}
