// W6 Y4 · Thinker trigger — strict 4-tier (KGS threshold · explicit · routine-disrupt · hourly).
// Cf. ROADMAP-background-reasoning-patcher-thinker-2026-05-12.md §4.4.
// Stricter than Patcher (Y3) because Thinker calls cloud models (~$0.005-0.02/check).

import type { SignalEnvelope } from '../signal-bus/types.js';

export interface ThinkerTriggerThresholds {
  kgsNewCardsMax: number;
  kgsNewEntitiesMax: number;
  daysSinceLastMax: number;
  /** Hourly light-check cadence (ms). Default 1h. */
  scheduledIntervalMs: number;
}

export const DEFAULT_THINKER_THRESHOLDS: ThinkerTriggerThresholds = {
  kgsNewCardsMax: 50,
  kgsNewEntitiesMax: 20,
  daysSinceLastMax: 1,
  scheduledIntervalMs: 60 * 60 * 1000,
};

export interface ThinkerTriggerState {
  kgsNewCardsSinceLast: number;
  kgsNewEntitiesSinceLast: number;
  daysSinceLast: number;
  /** Last full-fire timestamp (ms epoch). Used to gate scheduled hourly. */
  lastFiredAt: number;
}

export type ThinkerTriggerReason =
  | 'emergency'
  | 'explicit-request'
  | 'kgs-threshold'
  | 'routine-disrupt'
  | 'scheduled-hourly'
  | 'none';

export interface ThinkerTriggerVerdict {
  fire: boolean;
  reason: ThinkerTriggerReason;
  emergency?: SignalEnvelope;
}

export interface ThinkerTriggerDeps {
  thresholds?: Partial<ThinkerTriggerThresholds>;
  now?: () => number;
  isExplicit?: (env: SignalEnvelope) => boolean;
  isRoutineDisrupt?: (env: SignalEnvelope) => boolean;
}

function defaultIsExplicit(env: SignalEnvelope): boolean {
  return env.source === 'user.explicit.thinker' || env.source.endsWith('.thinker.request');
}

function defaultIsRoutineDisrupt(env: SignalEnvelope): boolean {
  return env.source.includes('pattern_disruption');
}

export class ThinkerTrigger {
  private readonly thresholds: ThinkerTriggerThresholds;
  private readonly now: () => number;
  private readonly isExplicit: (env: SignalEnvelope) => boolean;
  private readonly isRoutineDisrupt: (env: SignalEnvelope) => boolean;

  constructor(deps: ThinkerTriggerDeps = {}) {
    this.thresholds = { ...DEFAULT_THINKER_THRESHOLDS, ...deps.thresholds };
    this.now = deps.now ?? Date.now;
    this.isExplicit = deps.isExplicit ?? defaultIsExplicit;
    this.isRoutineDisrupt = deps.isRoutineDisrupt ?? defaultIsRoutineDisrupt;
  }

  kgsThresholdMet(state: ThinkerTriggerState): boolean {
    return state.kgsNewCardsSinceLast >= this.thresholds.kgsNewCardsMax
      || state.kgsNewEntitiesSinceLast >= this.thresholds.kgsNewEntitiesMax
      || state.daysSinceLast >= this.thresholds.daysSinceLastMax;
  }

  /** Hourly cadence — fires regardless of threshold so Thinker stays warm. */
  scheduledDue(state: ThinkerTriggerState): boolean {
    return this.now() - state.lastFiredAt >= this.thresholds.scheduledIntervalMs;
  }

  evaluate(state: ThinkerTriggerState, signals: SignalEnvelope[] = []): ThinkerTriggerVerdict {
    for (const s of signals) {
      if (s.tier === 'emergency' || s.tier === 'critical') {
        return { fire: true, reason: 'emergency', emergency: s };
      }
    }
    for (const s of signals) {
      if (this.isExplicit(s)) return { fire: true, reason: 'explicit-request', emergency: s };
      if (this.isRoutineDisrupt(s)) return { fire: true, reason: 'routine-disrupt', emergency: s };
    }
    if (this.kgsThresholdMet(state)) return { fire: true, reason: 'kgs-threshold' };
    if (this.scheduledDue(state)) return { fire: true, reason: 'scheduled-hourly' };
    return { fire: false, reason: 'none' };
  }
}
