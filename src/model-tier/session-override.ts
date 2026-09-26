// M3-3 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// Session-scoped model-tier override store.
//
// In-memory map keyed by sessionId so a chat turn that triggered an
// NL switch ("이번 회의는 의료 용어 많아") can apply preset overrides
// for the rest of the session and auto-revert on session end / TTL
// expiry. Survives nothing — process restart drops every override.
// Persisted overrides go through `PUT /v1/config/model-tier` instead.
//
// Used by:
//   - tier-resolver.ts (read path) — consults the override before
//     reading UserConfig.modelTier so chat-driven switches take effect
//     immediately without a daemon round-trip.
//   - nl-tier-switch chat hook (write path) — calls `setOverride`
//     after the user confirms the proposed plan.
//
// Auto-revert: a TTL is optional (default 8h for in-session usage).
// Callers may also call `clearOverride(sessionId)` on session end.

import type { ModelTier } from './types.js';

export interface SessionTierOverride {
  /** Surfaces to override — sparse · matches NlTierApplyPlan.apply. */
  stt?: ModelTier;
  llm?: ModelTier;
  tts?: ModelTier;
  /** Optional monthly cap propagated from preset.monthlyUsdCap. */
  monthlyUsdCap?: number;
  /** Why the override exists — surfaced by `elanous voice status` so
   *  the user remembers what kicked it off. */
  rationale: string;
  /** Absolute expiry timestamp (Date.now() based). undefined = no TTL. */
  expiresAt?: number;
  /** When the override was installed — for telemetry / UX. */
  installedAt: number;
}

interface StoreEntry {
  sessionId: string;
  override: SessionTierOverride;
}

const STORE = new Map<string, StoreEntry>();

export interface SetOverrideOpts {
  /** TTL in ms. Default 8h for in-session chat usage; pass 0 / Infinity
   *  to skip TTL. */
  ttlMs?: number;
  /** Inject `Date.now()` substitute — tests use this. */
  now?: () => number;
}

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

export function setSessionTierOverride(
  sessionId: string,
  override: Omit<SessionTierOverride, 'installedAt' | 'expiresAt'>,
  opts: SetOverrideOpts = {},
): SessionTierOverride {
  const now = (opts.now ?? Date.now)();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = Number.isFinite(ttlMs) && ttlMs > 0 ? now + ttlMs : undefined;
  const next: SessionTierOverride = {
    ...override,
    installedAt: now,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
  STORE.set(sessionId, { sessionId, override: next });
  return next;
}

export function getSessionTierOverride(
  sessionId: string,
  opts: { now?: () => number } = {},
): SessionTierOverride | undefined {
  const entry = STORE.get(sessionId);
  if (!entry) return undefined;
  const now = (opts.now ?? Date.now)();
  if (entry.override.expiresAt !== undefined && now >= entry.override.expiresAt) {
    STORE.delete(sessionId);
    return undefined;
  }
  return entry.override;
}

export function clearSessionTierOverride(sessionId: string): boolean {
  return STORE.delete(sessionId);
}

/** Drop every override. Tests + dev-only. */
export function _resetSessionTierOverridesForTesting(): void {
  STORE.clear();
}

export function listSessionTierOverrides(): readonly StoreEntry[] {
  return Array.from(STORE.values());
}
