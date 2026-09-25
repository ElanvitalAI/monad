import type { LeveragePlan } from './capstone-leverage.js';
import type { RegimeVector } from './regime-synth.js';

/** Stable wire-schema identifier for the market-posture contract. */
export const MARKET_POSTURE_SCHEMA_VERSION = 'market-posture/v2' as const;

/** DEFCON is an observation cadence and alertness level, not a trade instruction. */
export type DefconLevel = 1 | 2 | 3 | 4 | 5;

export type FreshnessStatus = 'FRESH' | 'STALE' | 'UNKNOWN';

/** Source inputs used for a posture calculation, retained for auditability. */
export interface MarketPostureProvenance {
  sources: readonly string[];
  calculatedBy: string;
}

/** Age assessment of the inputs at the time the posture was calculated. */
export interface MarketPostureFreshness {
  status: FreshnessStatus;
  observedAt: string;
  ageMs: number;
}

/** Read-only market-regime projection of the shared regime vector. */
export interface MarketPostureRegimeSummary {
  composite: RegimeVector['composite'];
  label: RegimeVector['regimeLabel'];
  transition: RegimeVector['transition'];
  transitionAxes: readonly string[];
  asOf: RegimeVector['asOf'];
}

/** Read-only leverage context; it deliberately contains no order or execution fields. */
export interface MarketPostureLeverageSummary {
  regime: LeveragePlan['regime'];
  effectiveExposure: LeveragePlan['effectiveExposure'];
}

/**
 * Versioned, observational market posture shared between watch loops.
 * It intentionally describes cadence/depth/alertness context only.
 */
export interface DefconResponseProfile {
  /** Relative consumer cadence; this is observation density, never a trade size. */
  cadenceMultiplier: 1 | 2 | 5 | 15 | 30;
  /** Research resolution to use for the next review. */
  depth: 'rules' | 'gate2' | 'cross-check' | 'deep' | 'emergency';
  /** Notification delivery urgency. */
  alertMode: 'batch' | 'priority' | 'immediate';
  /** Whether the high-frequency emergency sweep should perform work. */
  emergencySweep: boolean;
  /** Both defensive and bargain-buy candidates remain subject to Gate2/HITL. */
  gate2HitlRequired: boolean;
}

/** DEFCON response is alertness only: it contains no directional execution instruction. */
export const DEFCON_RESPONSE_PROFILES: Readonly<Record<DefconLevel, DefconResponseProfile>> = {
  5: { cadenceMultiplier: 1, depth: 'rules', alertMode: 'batch', emergencySweep: false, gate2HitlRequired: false },
  4: { cadenceMultiplier: 2, depth: 'gate2', alertMode: 'priority', emergencySweep: false, gate2HitlRequired: false },
  3: { cadenceMultiplier: 5, depth: 'cross-check', alertMode: 'immediate', emergencySweep: true, gate2HitlRequired: true },
  2: { cadenceMultiplier: 15, depth: 'deep', alertMode: 'immediate', emergencySweep: true, gate2HitlRequired: true },
  1: { cadenceMultiplier: 30, depth: 'emergency', alertMode: 'immediate', emergencySweep: true, gate2HitlRequired: true },
};

export function defconResponseProfile(defcon: DefconLevel): DefconResponseProfile {
  return DEFCON_RESPONSE_PROFILES[defcon];
}

export interface MarketPosture {
  schemaVersion: typeof MARKET_POSTURE_SCHEMA_VERSION;
  asOf: string;
  defcon: DefconLevel;
  response: DefconResponseProfile;
  provenance: MarketPostureProvenance;
  freshness: MarketPostureFreshness;
  regime: MarketPostureRegimeSummary;
  leverage: MarketPostureLeverageSummary;
}

// ── DEFCON derivation inputs (RFC §S2 — 점진 융합 + tripwire) ─────────────

/**
 * Progressive-fusion threat driver (RFC §S2 점진). Each driver contributes a
 * bounded threat signal in [0,1] with a non-negative fusion weight. The
 * weighted average of drivers escalates DEFCON within the 5/4/3 band only —
 * it never itself jumps to 2/1 (that is tripwire territory).
 */
export interface ThreatDriver {
  key: string;
  /** Threat contribution, clamped to [0,1]. */
  contribution: number;
  /** Non-negative fusion weight. Non-positive/NaN weights are ignored. */
  weight: number;
}

/** Broad-index observation (KOSPI/KOSDAQ/S&P500/NASDAQ). */
export interface IndexObservation {
  symbol: string;
  /** Same-day fractional return, e.g. -0.05 for -5%. */
  dayReturn: number;
  /** Circuit-breaker / trading halt fired today. */
  circuitBreaker?: boolean;
}

/** Cash-equity (현물) large-cap observation — held names only. */
export interface SpotObservation {
  symbol: string;
  dayReturn: number;
}

/**
 * Leveraged-ETF observation. The raw same-day return is normalized to an
 * underlying-equivalent return (dayReturn / leverage) BEFORE any threshold
 * judgment, so a 3x ETF at -21% maps to -7% underlying-equivalent (RFC §S2:
 * "배수×-7%"). Missing/zero/negative leverage is treated fail-safe (see
 * normalizeLeveragedReturn).
 */
export interface LeveragedEtfObservation {
  symbol: string;
  dayReturn: number;
  /** Leverage multiple (2 for 2x, 3 for 3x). Must be > 0 to normalize. */
  leverage?: number;
}

/** Index futures observation (ES/NQ). */
export interface FuturesObservation {
  symbol: string;
  limitDown?: boolean;
  gapDown?: boolean;
}

/** Hard tripwire observations (RFC §S2 — DEFCON 2/1 즉시 점프). */
export interface TripwireInputs {
  indices?: readonly IndexObservation[];
  spots?: readonly SpotObservation[];
  leveragedEtfs?: readonly LeveragedEtfObservation[];
  futures?: readonly FuturesObservation[];
  /** Multi-source cross-confirmed system crisis → DEFCON 1. */
  systemCrisis?: boolean;
}

/** Deterministic DEFCON thresholds (RFC §S2). All defaults are constants. */
export interface DefconThresholds {
  /** Progressive fused threat score (0..1) at/above which DEFCON = 3. */
  progressiveLevel3: number;
  /** Progressive fused threat score (0..1) at/above which DEFCON = 4. */
  progressiveLevel4: number;
  /** Index same-day return at/below which DEFCON = 2. */
  indexLevel2: number;
  /** Index same-day return at/below which DEFCON = 1. */
  indexLevel1: number;
  /** Held cash-equity large-cap return at/below which DEFCON = 2. */
  spotLevel2: number;
  /** Underlying-equivalent (normalized) leveraged-ETF return at/below → DEFCON 2. */
  leverageEquivalentLevel2: number;
}

export const DEFAULT_DEFCON_THRESHOLDS: DefconThresholds = {
  progressiveLevel3: 0.66,
  progressiveLevel4: 0.33,
  indexLevel2: -0.05,
  indexLevel1: -0.1,
  spotLevel2: -0.07,
  leverageEquivalentLevel2: -0.07,
};

/** Inputs to the pure MarketPosture v2 derivation. */
export interface DeriveMarketPostureInput {
  asOf: string;
  provenance: MarketPostureProvenance;
  freshness: MarketPostureFreshness;
  regime: RegimeVector;
  leverage: LeveragePlan;
  /** Progressive-fusion threat drivers (produce DEFCON 5/4/3 only). */
  drivers?: readonly ThreatDriver[];
  /** Hard tripwire observations (produce DEFCON 2/1). */
  tripwire?: TripwireInputs;
  /** Optional threshold overrides; defaults are deterministic constants. */
  thresholds?: Partial<DefconThresholds>;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** More-severe DEFCON = smaller number, so fail-safe combine = Math.min. */
function moreSevere(a: DefconLevel, b: DefconLevel): DefconLevel {
  return (a < b ? a : b) as DefconLevel;
}

/**
 * Progressive fused threat score → DEFCON 5/4/3 (RFC §S2 점진).
 * Score = Σ(weight·contribution) / Σ(weight) over valid drivers, in [0,1].
 * Empty/all-invalid drivers → DEFCON 5 (평시).
 */
export function progressiveDefcon(
  drivers: readonly ThreatDriver[] | undefined,
  th: DefconThresholds,
): DefconLevel {
  let weightSum = 0;
  let acc = 0;
  for (const d of drivers ?? []) {
    const w = Number.isFinite(d.weight) && d.weight > 0 ? d.weight : 0;
    if (w === 0) continue;
    weightSum += w;
    acc += w * clamp01(d.contribution);
  }
  if (weightSum === 0) return 5;
  const score = acc / weightSum;
  if (score >= th.progressiveLevel3) return 3;
  if (score >= th.progressiveLevel4) return 4;
  return 5;
}

/**
 * Normalize a leveraged-ETF same-day return to its underlying-equivalent
 * return (RFC §S2: 2x=-14%→-7%, 3x=-21%→-7%). Fail-safe rules for the retry
 * guide's leverage edge cases:
 *   - leverage > 0            → dayReturn / leverage (correct normalization)
 *   - missing / 0 / negative  → dayReturn unchanged (treated as a direct/spot
 *                               observation): normalization is impossible, so
 *                               keep full magnitude — never dampen an unknown
 *                               multiplier (fail-safe = more sensitive).
 */
export function normalizeLeveragedReturn(dayReturn: number, leverage?: number): number {
  if (typeof leverage === 'number' && Number.isFinite(leverage) && leverage > 0) {
    return dayReturn / leverage;
  }
  return dayReturn;
}

/**
 * Hard tripwire observations → DEFCON 5/4/3/2/1 (RFC §S2). Only 2/1 are ever
 * produced here; absence of any trip returns 5 (no escalation). Leveraged ETFs
 * are normalized to underlying-equivalent returns BEFORE judgment.
 */
export function tripwireDefcon(
  tw: TripwireInputs | undefined,
  th: DefconThresholds,
): DefconLevel {
  if (!tw) return 5;
  let level: DefconLevel = 5;

  for (const idx of tw.indices ?? []) {
    if (idx.circuitBreaker || (Number.isFinite(idx.dayReturn) && idx.dayReturn <= th.indexLevel1)) {
      level = moreSevere(level, 1);
    } else if (Number.isFinite(idx.dayReturn) && idx.dayReturn <= th.indexLevel2) {
      level = moreSevere(level, 2);
    }
  }

  for (const s of tw.spots ?? []) {
    if (Number.isFinite(s.dayReturn) && s.dayReturn <= th.spotLevel2) {
      level = moreSevere(level, 2);
    }
  }

  // Small epsilon absorbs float division error (e.g. -0.21/3 = -0.06999...).
  const EPS = 1e-9;
  for (const etf of tw.leveragedEtfs ?? []) {
    const equiv = normalizeLeveragedReturn(etf.dayReturn, etf.leverage);
    if (Number.isFinite(equiv) && equiv <= th.leverageEquivalentLevel2 + EPS) {
      level = moreSevere(level, 2);
    }
  }

  for (const f of tw.futures ?? []) {
    if (f.limitDown || f.gapDown) level = moreSevere(level, 2);
  }

  if (tw.systemCrisis) level = moreSevere(level, 1);

  return level;
}

/**
 * Deterministic DEFCON derivation (RFC §S2): progressive fusion (5/4/3) is
 * combined with hard tripwire (2/1) by taking the MORE SEVERE of the two
 * (fail-safe = min). Pure — depends only on its arguments.
 */
export function deriveDefcon(
  input: Pick<DeriveMarketPostureInput, 'drivers' | 'tripwire' | 'thresholds'>,
): DefconLevel {
  const th: DefconThresholds = { ...DEFAULT_DEFCON_THRESHOLDS, ...(input.thresholds ?? {}) };
  const progressive = progressiveDefcon(input.drivers, th);
  const tripwire = tripwireDefcon(input.tripwire, th);
  return moreSevere(progressive, tripwire);
}

/**
 * Projects regime + leverage observations into the v2 wire contract AND
 * derives DEFCON deterministically from injected threat drivers + tripwire
 * observations. Pure: it reads no files, DB, cron, or current time and returns
 * no execution/order decision — DEFCON is an alertness/cadence signal only.
 */
export function deriveMarketPosture(input: DeriveMarketPostureInput): MarketPosture {
  const defcon = deriveDefcon(input);
  return {
    schemaVersion: MARKET_POSTURE_SCHEMA_VERSION,
    asOf: input.asOf,
    defcon,
    response: defconResponseProfile(defcon),
    provenance: input.provenance,
    freshness: input.freshness,
    regime: {
      composite: input.regime.composite,
      label: input.regime.regimeLabel,
      transition: input.regime.transition,
      transitionAxes: input.regime.transitionAxes,
      asOf: input.regime.asOf,
    },
    leverage: {
      regime: input.leverage.regime,
      effectiveExposure: input.leverage.effectiveExposure,
    },
  };
}
