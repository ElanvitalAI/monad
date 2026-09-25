// W9b Z7 · Morning Digest → 4-pane showroom adapter.
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §3 S8 + §4 Z7.
//
// `composeMorningDigest()` (dispatch/morning-digest.ts) returns a flat
// MorningDigest shape that the D7 surface renders as a single text card.
// Z7 extends that into a four-pane conversational standup:
//   - yesterday        — what closed overnight
//   - today            — what is scheduled now
//   - blockers         — HITL pending + failed runs
//   - opportunities    — backlog picks worth picking up today
//
// The adapter does NOT rerun the digest composer. The caller passes the
// already-composed digest in (so the rendered markdown / plainText that
// the splash already shows stays the source of truth) plus an optional
// `backlogRecommendations` array — the opportunities lane needs a signal
// the MorningDigest itself does not carry (KGS-derived suggestions).
//
// Persona binding (§6.4) is dependency-injected; production wires user
// preference and falls back to the defaults declared here. The adapter
// itself stays pure: it owns prompt assembly + per-lane invocation only.

import type { MorningDigest } from '../dispatch/morning-digest.js';
import type {
  ShowroomLaneCallable,
  ShowroomLaneOutput,
} from '../task-orchestrator/surfaces/showroom-surface.js';

export const MORNING_LANES = ['yesterday', 'today', 'blockers', 'opportunities'] as const;
export type MorningLane = (typeof MORNING_LANES)[number];

export interface BacklogRecommendation {
  taskTitle: string;
  reason?: string;
  /** Optional minute-cost estimate for the user's morning capacity check. */
  estimateMinutes?: number;
}

export interface MorningShowroomInput {
  digest: MorningDigest;
  /** Opportunities lane needs an input not in `MorningDigest`. Empty
   *  list ⇒ the lane still fires but with a "no recommendations" prompt. */
  backlogRecommendations?: readonly BacklogRecommendation[];
}

export interface MorningLaneOutput {
  lane: MorningLane;
  modelId?: string;
  text: string;
  /** Snapshot of the lane prompt — kept so the audit log / KGS extractor
   *  can re-run a lane without rebuilding state. */
  prompt: string;
}

export interface MorningShowroomCard {
  kind: 'morning-digest-showroom';
  date: string;
  lanes: MorningLaneOutput[];
  createdAt: number;
}

export interface PersonaBinding {
  /** Lane label → role (`plan` / `review` / `reflect` / `build`) + model.
   *  When omitted, the adapter uses the defaults declared below. */
  bindings?: Partial<Record<MorningLane, { role: 'plan' | 'review' | 'reflect' | 'build'; model: string }>>;
}

const DEFAULT_BINDINGS: Record<MorningLane, { role: 'plan' | 'review' | 'reflect' | 'build'; model: string }> = {
  yesterday:     { role: 'reflect', model: 'claude-sonnet' },
  today:         { role: 'plan',    model: 'gemini-flash' },
  blockers:      { role: 'review',  model: 'claude-sonnet' },
  opportunities: { role: 'build',   model: 'codex' },
};

export interface MorningShowroomDeps {
  laneCallable: ShowroomLaneCallable;
  personaBinding?: PersonaBinding;
  /** When true, the adapter fires the 4 lanes concurrently. Default
   *  `false` (sequential) — sequential streams better on a single
   *  LM-Studio process; daemons with cloud routing flip to true. */
  parallel?: boolean;
  now?: () => number;
}

export async function runMorningShowroom(
  input: MorningShowroomInput,
  deps: MorningShowroomDeps,
): Promise<MorningShowroomCard> {
  const bindings = { ...DEFAULT_BINDINGS, ...(deps.personaBinding?.bindings ?? {}) };
  const prompts = buildAllPrompts(input);

  const tasks = MORNING_LANES.map((lane) => async () => {
    const out = await safeCallable(deps.laneCallable, {
      role: bindings[lane].role,
      model: bindings[lane].model,
      prompt: prompts[lane],
    });
    return { lane, prompt: prompts[lane], out };
  });

  const results = deps.parallel
    ? await Promise.all(tasks.map((t) => t()))
    : await runSequential(tasks);

  const now = (deps.now ?? Date.now)();
  return {
    kind: 'morning-digest-showroom',
    date: input.digest.date,
    lanes: results.map((r) => ({
      lane: r.lane,
      ...(r.out.modelId !== undefined ? { modelId: r.out.modelId } : {}),
      text: r.out.text,
      prompt: r.prompt,
    })),
    createdAt: now,
  };
}

async function runSequential<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = [];
  for (const t of tasks) out.push(await t());
  return out;
}

/** Exported for tests + the audit/replay path. Pure — does not touch
 *  the lane callable. */
export function buildAllPrompts(input: MorningShowroomInput): Record<MorningLane, string> {
  return {
    yesterday:     buildYesterdayPrompt(input),
    today:         buildTodayPrompt(input),
    blockers:      buildBlockersPrompt(input),
    opportunities: buildOpportunitiesPrompt(input),
  };
}

function buildYesterdayPrompt(input: MorningShowroomInput): string {
  const d = input.digest;
  const completed = d.sections.completed;
  const retrying = d.sections.retrying;
  return [
    `You are the "yesterday" lane in the morning digest showroom.`,
    `Date: ${d.date} (window ${d.windowStart} → ${d.windowEnd}).`,
    `Completed (${completed.length}):`,
    bulletOrEmpty(completed),
    retrying.length > 0 ? `Retrying overnight (${retrying.length}):` : '',
    retrying.length > 0 ? bulletOrEmpty(retrying) : '',
    '',
    'Summarise yesterday in 3 short bullets. Reflect on what *moved* the user forward.',
  ].filter(Boolean).join('\n');
}

function buildTodayPrompt(input: MorningShowroomInput): string {
  const d = input.digest;
  const upcoming = d.sections.upcoming;
  return [
    `You are the "today" lane in the morning digest showroom.`,
    `Date: ${d.date}.`,
    `Upcoming / scheduled (${upcoming.length}):`,
    bulletOrEmpty(upcoming),
    '',
    'Propose a 3-bullet plan for the day. Lead with the highest-leverage item.',
  ].join('\n');
}

function buildBlockersPrompt(input: MorningShowroomInput): string {
  const d = input.digest;
  const review = d.sections.reviewNeeded;
  const failed = d.sections.failed;
  return [
    `You are the "blockers" lane in the morning digest showroom.`,
    `Date: ${d.date}.`,
    review.length > 0 ? `HITL pending (${review.length}):` : '',
    review.length > 0 ? bulletOrEmpty(review) : '',
    failed.length > 0 ? `Failed runs (${failed.length}):` : '',
    failed.length > 0 ? bulletOrEmpty(failed) : '',
    review.length === 0 && failed.length === 0 ? 'Nothing blocked this morning.' : '',
    '',
    'For each blocker, name the smallest unblock step. One per line.',
  ].filter(Boolean).join('\n');
}

function buildOpportunitiesPrompt(input: MorningShowroomInput): string {
  const recs = input.backlogRecommendations ?? [];
  const lines = recs.length === 0
    ? '(no recommendations surfaced — backlog is quiet or KGS has insufficient signal)'
    : recs
        .map((r) => `- ${r.taskTitle}${r.estimateMinutes ? ` (~${r.estimateMinutes}m)` : ''}${r.reason ? ` — ${r.reason}` : ''}`)
        .join('\n');
  return [
    `You are the "opportunities" lane in the morning digest showroom.`,
    `Date: ${input.digest.date}.`,
    `Backlog picks worth picking up today:`,
    lines,
    '',
    'Endorse at most 2 items and explain why each fits *this* morning.',
  ].join('\n');
}

function bulletOrEmpty(items: readonly string[]): string {
  return items.length === 0 ? '(none)' : items.map((i) => `- ${i}`).join('\n');
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
