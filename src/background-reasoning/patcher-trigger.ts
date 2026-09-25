// W5 Y3 · Patcher trigger — 3-tier OR logic (threshold / idle / emergency).
// Cf. ROADMAP-background-reasoning §3.4.
// Fires when: emergency signal · or (threshold && idle).

import type { SignalEnvelope } from '../signal-bus/types.js';

export interface PatcherTriggerThresholds {
  /** Accumulated log bytes before threshold fires. Default 10 MB. */
  bytesAccumulatedMax: number;
  /** Days since last drain. Default 7. */
  daysAccumulatedMax: number;
  /** Skill runs accumulated. Default 100. */
  skillRunsMax: number;
  /** Idle minutes required. Default 30. */
  userIdleMin: number;
}

export const DEFAULT_THRESHOLDS: PatcherTriggerThresholds = {
  bytesAccumulatedMax: 10_000_000,
  daysAccumulatedMax: 7,
  skillRunsMax: 100,
  userIdleMin: 30,
};

export interface PatcherTriggerState {
  bytesAccumulated: number;
  daysAccumulated: number;
  skillRunsAccumulated: number;
  userIdleMin: number;
  /** System signals captured since last drain (sleep_started / focus_mode_off / ...). */
  systemSignals: string[];
}

export interface PatcherTriggerDeps {
  thresholds?: Partial<PatcherTriggerThresholds>;
  /** Custom emergency detector — defaults to tier ≥ emergency or
   *  source-glob match against `pattern_disruption`/`unrecoverable_error`. */
  isEmergency?: (env: SignalEnvelope) => boolean;
}

export type PatcherTriggerReason =
  | 'emergency'
  | 'threshold-and-idle'
  | 'none';

export interface PatcherTriggerVerdict {
  fire: boolean;
  reason: PatcherTriggerReason;
  /** Optional emergency envelope that drove the fire (for downstream logging). */
  emergency?: SignalEnvelope;
}

const EMERGENCY_SOURCES = new Set(['pattern_disruption', 'unrecoverable_error']);

export class PatcherTrigger {
  private readonly thresholds: PatcherTriggerThresholds;
  private readonly isEmergency: (env: SignalEnvelope) => boolean;

  constructor(deps: PatcherTriggerDeps = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...deps.thresholds };
    this.isEmergency = deps.isEmergency ?? defaultIsEmergency;
  }

  thresholdCheck(state: PatcherTriggerState): boolean {
    return state.bytesAccumulated >= this.thresholds.bytesAccumulatedMax
      || state.daysAccumulated >= this.thresholds.daysAccumulatedMax
      || state.skillRunsAccumulated >= this.thresholds.skillRunsMax;
  }

  idleCheck(state: PatcherTriggerState): boolean {
    if (state.userIdleMin >= this.thresholds.userIdleMin) return true;
    return state.systemSignals.includes('sleep_started')
      || state.systemSignals.includes('focus_mode_off');
  }

  emergencyCheck(signals: SignalEnvelope[]): SignalEnvelope | null {
    for (const s of signals) {
      if (this.isEmergency(s)) return s;
    }
    return null;
  }

  evaluate(state: PatcherTriggerState, signals: SignalEnvelope[] = []): PatcherTriggerVerdict {
    const em = this.emergencyCheck(signals);
    if (em) return { fire: true, reason: 'emergency', emergency: em };
    if (this.thresholdCheck(state) && this.idleCheck(state)) {
      return { fire: true, reason: 'threshold-and-idle' };
    }
    return { fire: false, reason: 'none' };
  }
}

function defaultIsEmergency(env: SignalEnvelope): boolean {
  if (env.tier === 'emergency' || env.tier === 'critical') return true;
  for (const m of EMERGENCY_SOURCES) {
    if (env.source.includes(m)) return true;
  }
  return false;
}
