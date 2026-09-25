// W9b Z7 · Idle-task nudge policy — when to ping the user about a stalled task.
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §3 S7.
//
// The auto-relay TaskLifecycleListener feeds every "still in <status>"
// observation through `evaluateNudge`. The policy decides:
//   1. Has the task sat in its current status long enough?
//   2. Is the user in a polite local-hour window?
//   3. Have we already nudged this task recently (rate-limit)?
// The output is a small discriminated union so the listener can wire
// different surfaces (push · in-band toast · noop) without leaking the
// reasoning.

export type NudgeTaskStatus = 'ready' | 'running' | 'review' | 'blocked' | 'awaiting-approval';

export interface IdleTaskObservation {
  taskId: string;
  status: NudgeTaskStatus;
  /** Wall-clock ms when the task last transitioned into the current
   *  status (NOT the last keypress / partial mutation — the listener
   *  must filter out activity that does not move status). */
  enteredStatusAt: number;
  /** Wall-clock "now" of the observation. The listener owns the clock
   *  source; passing it explicitly keeps the policy pure for tests. */
  observedAt: number;
}

/** Idle threshold per status, in ms. Spec defaults from S7:
 *   review = 24h · ready/awaiting-approval = 72h · blocked = 7d.
 *  `running` is included so a runaway local LLM job can be nudged after
 *  ~12h, but the default is conservative — most running tasks legitimately
 *  take a while. */
export interface NudgeThresholds {
  ready?: number;
  running?: number;
  review?: number;
  blocked?: number;
  'awaiting-approval'?: number;
}

export const DEFAULT_NUDGE_THRESHOLDS: Required<NudgeThresholds> = {
  ready: 72 * 60 * 60 * 1000,
  running: 12 * 60 * 60 * 1000,
  review: 24 * 60 * 60 * 1000,
  blocked: 7 * 24 * 60 * 60 * 1000,
  'awaiting-approval': 12 * 60 * 60 * 1000,
};

export interface NudgeQuietHours {
  /** Local-hour window where nudges are allowed. Inclusive on both ends.
   *  Defaults to 09:00 – 22:00. A nudge attempt outside this window
   *  returns `kind: 'defer'` with `until` set to the next quiet-end. */
  startHour: number;
  endHour: number;
  /** Offset in minutes from UTC. e.g. KST = +540, PST = -480.
   *  Default 0 (UTC). The listener provides the user's offset via the
   *  daemon config; we keep the policy stateless. */
  tzOffsetMinutes: number;
}

export const DEFAULT_QUIET_HOURS: NudgeQuietHours = {
  startHour: 9,
  endHour: 22,
  tzOffsetMinutes: 0,
};

export interface NudgeRateLimit {
  /** Reject a new nudge if the previous one for the same task was less
   *  than this many ms ago. Defaults to 12h so the user does not get
   *  pinged twice on the same morning. */
  minIntervalMs: number;
  /** Max nudges per task per day (24h rolling). Defaults to 2. */
  maxPerDay: number;
}

export const DEFAULT_RATE_LIMIT: NudgeRateLimit = {
  minIntervalMs: 12 * 60 * 60 * 1000,
  maxPerDay: 2,
};

export interface NudgeHistory {
  /** Past nudge timestamps for this task, most-recent first. The
   *  listener trims this list — the policy never grows it. */
  recentNudgesAt: readonly number[];
}

export type NudgeDecision =
  | { kind: 'nudge'; reason: 'idle-threshold-exceeded'; status: NudgeTaskStatus; idleMs: number }
  | { kind: 'skip';  reason: 'still-fresh' | 'unknown-status' | 'rate-limited' }
  | { kind: 'defer'; reason: 'quiet-hours'; nextEligibleAt: number };

export interface NudgePolicyOpts {
  thresholds?: NudgeThresholds;
  quietHours?: NudgeQuietHours;
  rateLimit?: NudgeRateLimit;
}

export function evaluateNudge(
  obs: IdleTaskObservation,
  history: NudgeHistory,
  opts: NudgePolicyOpts = {},
): NudgeDecision {
  const thresholds = { ...DEFAULT_NUDGE_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const quiet = { ...DEFAULT_QUIET_HOURS, ...(opts.quietHours ?? {}) };
  const rate = { ...DEFAULT_RATE_LIMIT, ...(opts.rateLimit ?? {}) };

  const threshold = thresholds[obs.status];
  if (typeof threshold !== 'number') {
    return { kind: 'skip', reason: 'unknown-status' };
  }
  const idleMs = obs.observedAt - obs.enteredStatusAt;
  if (idleMs < threshold) {
    return { kind: 'skip', reason: 'still-fresh' };
  }

  if (!withinQuietHours(obs.observedAt, quiet)) {
    return {
      kind: 'defer',
      reason: 'quiet-hours',
      nextEligibleAt: nextQuietStart(obs.observedAt, quiet),
    };
  }

  if (rateLimited(history, obs.observedAt, rate)) {
    return { kind: 'skip', reason: 'rate-limited' };
  }

  return { kind: 'nudge', reason: 'idle-threshold-exceeded', status: obs.status, idleMs };
}

function withinQuietHours(nowMs: number, quiet: NudgeQuietHours): boolean {
  const local = localHour(nowMs, quiet.tzOffsetMinutes);
  if (quiet.startHour <= quiet.endHour) {
    return local >= quiet.startHour && local <= quiet.endHour;
  }
  // Wrap-around window (e.g. 22..7) — allowed when local is past start
  // or before end. The default config does not wrap, but the policy
  // handles it so a user can configure "always nudge except 02-07".
  return local >= quiet.startHour || local <= quiet.endHour;
}

function nextQuietStart(nowMs: number, quiet: NudgeQuietHours): number {
  const local = localHour(nowMs, quiet.tzOffsetMinutes);
  const hoursToStart =
    local < quiet.startHour
      ? quiet.startHour - local
      : 24 - local + quiet.startHour;
  return nowMs + hoursToStart * 60 * 60 * 1000;
}

function localHour(nowMs: number, tzOffsetMinutes: number): number {
  const localMs = nowMs + tzOffsetMinutes * 60 * 1000;
  // Compute the hour-of-day from epoch ms; we do this manually to avoid
  // any Date/locale ambiguity on the daemon side.
  const dayMs = 24 * 60 * 60 * 1000;
  const ms = ((localMs % dayMs) + dayMs) % dayMs;
  return Math.floor(ms / (60 * 60 * 1000));
}

function rateLimited(
  history: NudgeHistory,
  observedAt: number,
  rate: NudgeRateLimit,
): boolean {
  if (history.recentNudgesAt.length === 0) return false;
  const last = history.recentNudgesAt[0]!;
  if (observedAt - last < rate.minIntervalMs) return true;
  const dayAgo = observedAt - 24 * 60 * 60 * 1000;
  const dayCount = history.recentNudgesAt.filter((t) => t >= dayAgo).length;
  return dayCount >= rate.maxPerDay;
}
