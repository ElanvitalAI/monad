// W9b Z7 · Auto-Relay TaskLifecycleListener — bridge idle-task observations
// into a 3-lane nudge showroom. Cf. ROADMAP-showroom-x-task-fabric §3 S7 / §4 Z7.
//
// The listener does not own the lifecycle source — the daemon's TOX
// dispatcher (or a cron tick) feeds observations in via `observe()`.
// On each observation:
//   1. evaluate `nudge-policy.ts` (threshold + quiet hours + rate limit)
//   2. on `kind: 'nudge'`, spawn the 3-lane (analyzer / proposer / motivator)
//      showroom against the injected ShowroomLaneCallable
//   3. emit a `NudgeRecord` so the caller can persist
//      `~/.elanous/task-nudges/<id>/<ts>.json` + push the user
//
// The listener stores no state across processes — `history` is provided
// by the caller (or `createInMemoryNudgeHistoryStore` for tests/dev).

import type { ShowroomLaneCallable, ShowroomLaneOutput } from '../../task-orchestrator/surfaces/showroom-surface.js';
import {
  evaluateNudge,
  type IdleTaskObservation,
  type NudgeDecision,
  type NudgeHistory,
  type NudgePolicyOpts,
} from './nudge-policy.js';

export const NUDGE_LANE_PERSONAS = ['analyzer', 'proposer', 'motivator'] as const;
export type NudgeLanePersona = (typeof NUDGE_LANE_PERSONAS)[number];

export interface NudgeContext {
  taskTitle: string;
  /** Optional snapshot of why the user might have stalled — KGS recent
   *  activity summary, prior similar nudges, etc. The listener does not
   *  build this; the caller pipes it in from upstream. */
  recentActivity?: string;
}

export interface NudgeLaneOutput {
  persona: NudgeLanePersona;
  modelId?: string;
  text: string;
}

export interface NudgeRecord {
  taskId: string;
  status: IdleTaskObservation['status'];
  idleMs: number;
  spawnedAt: number;
  lanes: NudgeLaneOutput[];
  /** PWA jump URL — the listener mints a synthetic showroom session id
   *  so the surface can route the user into a deep view. */
  showroomSessionId: string;
}

export interface NudgeHistoryStore {
  get(taskId: string): Promise<NudgeHistory>;
  record(taskId: string, at: number): Promise<void>;
}

export function createInMemoryNudgeHistoryStore(): NudgeHistoryStore & {
  snapshot(): ReadonlyMap<string, number[]>;
} {
  const map = new Map<string, number[]>();
  return {
    async get(taskId) {
      const arr = map.get(taskId) ?? [];
      return { recentNudgesAt: [...arr] };
    },
    async record(taskId, at) {
      const arr = map.get(taskId) ?? [];
      arr.unshift(at);
      // Keep at most 14 entries — enough for a week of 2-per-day rate-limit.
      map.set(taskId, arr.slice(0, 14));
    },
    snapshot() { return map; },
  };
}

export interface AutoRelayListenerDeps {
  laneCallable: ShowroomLaneCallable;
  history: NudgeHistoryStore;
  /** Per-persona model pin. Defaults to conservative locals. */
  models?: Partial<Record<NudgeLanePersona, string>>;
  policy?: NudgePolicyOpts;
  /** Mint the synthetic showroom session id. */
  mintSessionId?: (taskId: string) => string;
  /** Allow `NudgeRecord` to be observed by the surface (push / PWA toast). */
  onNudgeRecord?: (record: NudgeRecord) => void;
  now?: () => number;
}

const DEFAULT_MODELS: Record<NudgeLanePersona, string> = {
  analyzer: 'qwen-7b',
  proposer: 'qwen-7b',
  motivator: 'qwen-7b',
};

/** Spawn-or-skip entry point. Returns the decision the policy emitted +
 *  the resulting record (when the decision was `nudge`). Callers persist
 *  the record + push the user. */
export async function observeIdleTask(
  obs: IdleTaskObservation,
  ctx: NudgeContext,
  deps: AutoRelayListenerDeps,
): Promise<{ decision: NudgeDecision; record: NudgeRecord | null }> {
  const history = await deps.history.get(obs.taskId);
  const decision = evaluateNudge(obs, history, deps.policy);
  if (decision.kind !== 'nudge') {
    return { decision, record: null };
  }

  const models = { ...DEFAULT_MODELS, ...(deps.models ?? {}) };
  const now = (deps.now ?? Date.now)();
  const lanes: NudgeLaneOutput[] = [];

  for (const persona of NUDGE_LANE_PERSONAS) {
    const out = await safeCallable(deps.laneCallable, {
      role: laneRoleForPersona(persona),
      model: models[persona],
      prompt: buildNudgePrompt(persona, obs, ctx, decision.idleMs),
    });
    lanes.push({
      persona,
      ...(out.modelId !== undefined ? { modelId: out.modelId } : {}),
      text: out.text,
    });
  }

  const mintId = deps.mintSessionId ?? defaultMintSessionId;
  const record: NudgeRecord = {
    taskId: obs.taskId,
    status: obs.status,
    idleMs: decision.idleMs,
    spawnedAt: now,
    lanes,
    showroomSessionId: mintId(obs.taskId),
  };

  await deps.history.record(obs.taskId, now);
  if (deps.onNudgeRecord) {
    try { deps.onNudgeRecord(record); } catch { /* surface-side issue */ }
  }
  return { decision, record };
}

function defaultMintSessionId(taskId: string): string {
  const safe = taskId.replace(/[^a-z0-9-]/gi, '-').slice(0, 32);
  return `showroom:nudge-${safe}-${Math.floor(Date.now() / 1000).toString(36)}`;
}

async function safeCallable(
  callable: ShowroomLaneCallable,
  input: Parameters<ShowroomLaneCallable>[0],
): Promise<ShowroomLaneOutput> {
  try {
    return await callable(input);
  } catch (err) {
    return { text: `[lane-error: ${err instanceof Error ? err.message : String(err)}]` };
  }
}

function laneRoleForPersona(p: NudgeLanePersona): 'plan' | 'build' | 'review' | 'reflect' {
  switch (p) {
    case 'analyzer':  return 'review';
    case 'proposer':  return 'plan';
    case 'motivator': return 'reflect';
  }
}

function buildNudgePrompt(
  persona: NudgeLanePersona,
  obs: IdleTaskObservation,
  ctx: NudgeContext,
  idleMs: number,
): string {
  const hours = Math.round(idleMs / (60 * 60 * 1000));
  const stance = personaStance(persona);
  return [
    `You are the "${persona}" lane in an idle-task nudge showroom.`,
    stance,
    '',
    `Task: ${obs.taskId} (${ctx.taskTitle})`,
    `Status: ${obs.status} for ~${hours}h`,
    ctx.recentActivity ? `Recent user activity: ${ctx.recentActivity}` : '',
    '',
    personaInstruction(persona),
  ].filter(Boolean).join('\n');
}

function personaStance(persona: NudgeLanePersona): string {
  switch (persona) {
    case 'analyzer':
      return 'Identify the most likely cause of the stall (data-missing · decision-fatigue · low-priority).';
    case 'proposer':
      return 'Surface 2-3 concrete one-click options that would unblock the task.';
    case 'motivator':
      return 'Help the user decide: act-now / defer / cancel. Be honest about cost.';
  }
}

function personaInstruction(persona: NudgeLanePersona): string {
  switch (persona) {
    case 'analyzer':
      return 'Reply with 1-2 lines naming the likely cause and a confidence percent.';
    case 'proposer':
      return 'Reply with up to 3 options, one per line, `<verb> — <estimated minutes>` shape.';
    case 'motivator':
      return 'Reply with a single recommendation and one sentence of motivation. No preamble.';
  }
}
