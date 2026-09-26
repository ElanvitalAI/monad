/**
 * `intake.register_all` — Phase 1 / I8 / RESEARCH §4.8.
 *
 * Atomic bulk-write of the Phase 1 pipeline output to TOX:
 *
 *   1. For each `ProposedMission`, create a `Mission` row (tox_missions).
 *   2. For each `ProposedMemoTask`, create a `Task` row (tox_tasks)
 *      with `missionId` set + priority from `GoalAlignResult` +
 *      `dependsOn` resolved from the soft dependency edges.
 *   3. For each workflow-eligible task whose synth produced YAML, save
 *      the workflow via the injected `saveWorkflow` callable. Skeleton
 *      fallback YAMLs are saved too — the user edits them in I7.
 *   4. Update each mission's `taskIds` to point at the created tasks.
 *
 * The whole pipeline output is captured in a single `RegisterAllResult`
 * — id lists + errors + mapping `taskKey → taskId` so I9 e2e and I11
 * closure docs can join back to the decomposition.
 *
 * I/O surfaces are injected:
 *   - `TaskStore`              — fresh Mission/Task rows
 *   - `saveWorkflow` callable  — writes to `~/.elanous/workflows/` (R3 pattern)
 *
 * Errors during a single task / workflow write are captured as
 * `errors[]` entries; the loop continues so the user always gets a
 * partial result + the failing rows to retry in I7.
 */
import type { TaskStore } from '../task-orchestrator/store.js';
import { createMission, attachTaskToMission, type Mission, type MissionSource } from '../task-orchestrator/mission.js';
import { createTask, type Task, type TaskSurface } from '../task-orchestrator/types.js';

import type { EnrichedDecomposition, EnrichedTask, EnrichedMission } from './enrich.js';
import type { CategorizeResult, TaskCategorization } from './categorize.js';
import type { GoalAlignResult, TaskAlignment, AlignPriority } from './goal-align.js';
import type { MultiSynthResult, SingleSynthResult } from './multi-spec.js';
import { taskKey } from './categorize.js';
import {
  createMissionCard,
  mintMissionCardId,
  type KgsMissionWriter,
} from '../knowledge/kgs/mission-card.js';

// ──────────────────── Public shapes ────────────────────────────────────

export interface SaveWorkflowCallable {
  (args: {
    name: string;
    yaml: string;
    scope?: 'global' | 'project';
    skeleton: boolean;
    taskKey: string;
    /** M4-3.2 (FU8 PR #8 · 2026-05-12) — provenance block merged
     *  into the saved YAML's `_meta:` field. When the upstream synth
     *  emits a YAML with its own `_meta`, the saver merges (caller-
     *  provided fields win on conflict) so register-all's
     *  missionId binding never gets clobbered. */
    meta?: {
      missionId?: string;
      intakeId?: string;
      sourceTaskKey?: string;
    };
  }): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
}

export interface RegisterAllInput {
  /** Source intake id — propagated into each Mission's source.intakeId. */
  intakeId?: string;
  /** Raw memo bytes — stored verbatim in `mission.source.raw` excerpt. */
  rawText: string;
  decomposition: EnrichedDecomposition;
  categorize: CategorizeResult;
  align: GoalAlignResult;
  synth: MultiSynthResult;
  /** Optional bind to an existing goal. Forwarded to every mission row. */
  goalSlug?: string;
  /** FU-I7d (2026-05-12) — whitelist of `taskKey` (`m-<n>/t-<n>`) to
   *  commit. Cards the user swiped reject/defer in PWA preview are
   *  excluded; missions whose tasks all fell out of the filter are
   *  skipped entirely. When undefined or empty, behaviour matches the
   *  pre-FU-I7d default (commit every task in the decomposition). */
  includeTaskKeys?: readonly string[];
}

export interface RegisterAllDeps {
  store: TaskStore;
  /** Optional — when omitted, workflow YAMLs are not persisted (perf
   *  for tests that only care about TOX rows). */
  saveWorkflow?: SaveWorkflowCallable;
  /** FU8 follow-up #1 (2026-05-12) — KGS Mission card cross-link.
   *  When provided, register-all writes a `mission:<id>` URN-keyed
   *  KnowledgeCard for every committed Mission so the M4-3 endpoint
   *  + Patcher can join workflows ↔ mission via KGS instead of a
   *  sidecar mapping store. Omitted in tests that only need TOX
   *  rows or workflow YAMLs. */
  kgsMissionWriter?: KgsMissionWriter;
  /** Inject clock for determinism in tests. */
  now?: () => number;
}

export interface RegisterAllResult {
  missions: Array<{ missionKey: string; missionId: string }>;
  tasks: Array<{ taskKey: string; taskId: string; missionId: string }>;
  workflows: Array<{ taskKey: string; path: string; skeleton: boolean }>;
  errors: Array<{ scope: 'mission' | 'task' | 'workflow'; key: string; error: string }>;
  /** All actually-created Mission ids (post-saveMission). */
  missionIds: string[];
  /** All actually-created Task ids (post-saveTask). */
  taskIds: string[];
  /** FU-I7d — `taskKey`s that the filter excluded from the commit. The
   *  caller surfaces these so the user can see what was held back. */
  skippedTaskKeys: string[];
  /** FU-I7d — mission keys that were skipped because every task in
   *  the mission fell out of the filter. */
  skippedMissionKeys: string[];
}

// ──────────────────── Helpers ──────────────────────────────────────────

/** Surface kind for an intake-generated task. We default to `llm-direct`
 *  with the task's intent so the dispatcher has a valid execution path
 *  even before the user attaches a real workflow. When synth produced a
 *  YAML, the task surface can be upgraded by a later I7 confirm step. */
function defaultSurface(task: EnrichedTask): TaskSurface {
  return {
    kind: 'llm-direct',
    prompt: task.intent || task.title,
  };
}

function missionSourceFor(
  input: RegisterAllInput,
  mission: EnrichedMission,
): MissionSource {
  const source: MissionSource = {
    kind: input.intakeId ? 'intake' : 'manual',
  };
  if (input.intakeId) source.intakeId = input.intakeId;
  if (input.rawText) {
    // Excerpt up to 2000 chars to fit the description column comfortably.
    source.raw = input.rawText.slice(0, 2000);
  }
  // Embed mission title at the head so the excerpt is greppable.
  void mission;
  return source;
}

function priorityFor(
  align: GoalAlignResult,
  key: string,
): AlignPriority {
  return align.alignments[key]?.priority ?? 'medium';
}

// AlignPriority → TaskPriority (Task supports 'urgent' too but Mission
// never proposes it). 'low'/'medium'/'high' map 1:1.
function toTaskPriority(p: AlignPriority): 'low' | 'medium' | 'high' {
  return p;
}

// ──────────────────── Public entry ─────────────────────────────────────

export async function registerAll(
  input: RegisterAllInput,
  deps: RegisterAllDeps,
): Promise<RegisterAllResult> {
  const result: RegisterAllResult = {
    missions: [],
    tasks: [],
    workflows: [],
    errors: [],
    missionIds: [],
    taskIds: [],
    skippedTaskKeys: [],
    skippedMissionKeys: [],
  };
  const now = deps.now ?? Date.now;
  const missionIdByKey = new Map<string, string>();
  const taskIdByKey = new Map<string, string>();
  const missionsLive = new Map<string, Mission>();

  // FU-I7d — pre-compute filter sets. When `includeTaskKeys` is empty
  // or undefined, behaviour matches the pre-FU-I7d default (commit
  // every task). Otherwise, exclude task keys not in the set, and skip
  // missions whose entire task list fell out of the filter.
  const filterActive =
    Array.isArray(input.includeTaskKeys) && input.includeTaskKeys.length > 0;
  const includeKeys = filterActive
    ? new Set(input.includeTaskKeys)
    : null;
  const allowMission = (mission: EnrichedMission): boolean => {
    if (!includeKeys) return true;
    for (const t of mission.tasks) {
      if (includeKeys.has(taskKey(mission.id, t.id))) return true;
    }
    return false;
  };
  const allowTask = (missionId: string, task: EnrichedTask): boolean => {
    if (!includeKeys) return true;
    return includeKeys.has(taskKey(missionId, task.id));
  };

  // 1. Mission rows
  for (const mission of input.decomposition.missions) {
    if (!allowMission(mission)) {
      result.skippedMissionKeys.push(mission.id);
      for (const t of mission.tasks) {
        result.skippedTaskKeys.push(taskKey(mission.id, t.id));
      }
      continue;
    }
    try {
      const m = createMission(
        {
          title: mission.title.slice(0, 80),
          description: mission.intent,
          intent: mission.intent,
          source: missionSourceFor(input, mission),
          goalSlug: input.goalSlug,
          notes: [
            `intake: ${input.intakeId ?? 'manual'}`,
            input.decomposition.fallback ? '[fallback decomposition — review needed]' : '',
          ].filter((s) => s.length > 0),
        },
        { now: now() },
      );
      deps.store.saveMission(m);
      missionIdByKey.set(mission.id, m.id);
      missionsLive.set(mission.id, m);
      result.missionIds.push(m.id);
      result.missions.push({ missionKey: mission.id, missionId: m.id });
    } catch (err) {
      result.errors.push({
        scope: 'mission',
        key: mission.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Task rows (pass 1 — no deps yet so we can build the id map)
  for (const mission of input.decomposition.missions) {
    const missionId = missionIdByKey.get(mission.id);
    if (!missionId) continue;
    for (const task of mission.tasks) {
      const key = taskKey(mission.id, task.id);
      if (!allowTask(mission.id, task)) {
        result.skippedTaskKeys.push(key);
        continue;
      }
      try {
        const created = createTask(
          {
            title: task.title.slice(0, 80),
            description: task.intent,
            surface: defaultSurface(task),
            goalSlug: input.goalSlug,
            missionId,
            priority: toTaskPriority(priorityFor(input.align, key)),
          },
          { now: now() },
        );
        deps.store.saveTask(created);
        taskIdByKey.set(key, created.id);
        result.taskIds.push(created.id);
        result.tasks.push({ taskKey: key, taskId: created.id, missionId });

        // Keep the live mission's taskIds in sync.
        const live = missionsLive.get(mission.id);
        if (live) {
          const next = attachTaskToMission(live, created.id, { now: now() });
          missionsLive.set(mission.id, next);
          deps.store.saveMission(next);
        }
      } catch (err) {
        result.errors.push({
          scope: 'task',
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 3. Dependency edges (pass 2 — rewrite each downstream task with dependsOn)
  for (const edge of input.align.dependencies) {
    const fromId = taskIdByKey.get(edge.from);
    const toId = taskIdByKey.get(edge.to);
    if (!fromId || !toId) continue;
    const existing = deps.store.getTask(toId);
    if (!existing) continue;
    if (existing.dependsOn.includes(fromId)) continue;
    const updated: Task = {
      ...existing,
      dependsOn: Object.freeze([...existing.dependsOn, fromId]),
      updatedAt: now(),
    };
    deps.store.saveTask(updated);
  }

  // 4. Workflow YAMLs (best-effort)
  if (deps.saveWorkflow) {
    for (const [key, taskId] of taskIdByKey) {
      const synth = input.synth.perTask[key];
      if (!synth || !synth.ok) continue;
      try {
        const skeleton = isSkeleton(synth);
        const name = synth.workflowName ?? `intake-${taskId}`;
        // M4-3.2 (FU8 PR #8 · 2026-05-12) — stamp provenance on
        // every intake-generated workflow. `missionId` derives from
        // the task → mission edge built by the categorize phase
        // (already resolved into `missionIdByTaskKey`). `intakeId`
        // is the same id propagated into Mission rows above.
        // `sourceTaskKey` is the `m-<n>/t-<n>` slug from the
        // decomposition — preserves the link back to the user's
        // original card even after Task ids get re-issued.
        // PR #8 + FU8 follow-up #1 (2026-05-12) — TOX Mission ids
        // are already minted as `mission:<hex>` (see
        // src/task-orchestrator/mission.ts:newMissionId), so feed
        // them through `mintMissionCardId` which is idempotent on
        // the prefix. Pre-fix this used a bare template literal
        // (`mission:${missionId}`) and produced double-prefixed
        // URNs (`mission:mission:abc123`).
        const missionId = result.tasks.find((t) => t.taskKey === key)?.missionId;
        const meta: NonNullable<Parameters<SaveWorkflowCallable>[0]['meta']> = {
          sourceTaskKey: key,
          ...(missionId ? { missionId: mintMissionCardId(missionId) } : {}),
          ...(input.intakeId ? { intakeId: input.intakeId } : {}),
        };
        const out = await deps.saveWorkflow({
          name,
          yaml: synth.yaml,
          skeleton,
          scope: 'global',
          taskKey: key,
          meta,
        });
        if (out.ok) {
          result.workflows.push({ taskKey: key, path: out.path, skeleton });
        } else {
          result.errors.push({ scope: 'workflow', key, error: out.error });
        }
      } catch (err) {
        result.errors.push({
          scope: 'workflow',
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 5. KGS Mission cross-link cards (FU8 follow-up #1 · 2026-05-12)
  //
  // Closes PR #8's conservative path: workflows now carry
  // `_meta.missionId: mission:<id>` URN provenance; this step writes
  // the `mission:<id>` KnowledgeCard on the other side so KGS
  // consumers (Patcher · M4-3 endpoint · Thinker) can join the two
  // sides via FTS5 OR direct `readCard(missionCardId)` lookup.
  //
  // Best-effort: a KGS write failure logs an `errors` entry but
  // never blocks the register-all return. TOX Mission rows + the
  // workflow YAMLs are the authoritative record; KGS is the
  // searchable index that catches up on next intake.
  if (deps.kgsMissionWriter) {
    const workflowsByMission = new Map<string, string[]>();
    for (const w of result.workflows) {
      const tRow = result.tasks.find((t) => t.taskKey === w.taskKey);
      if (!tRow) continue;
      const arr = workflowsByMission.get(tRow.missionId) ?? [];
      arr.push(w.path);
      workflowsByMission.set(tRow.missionId, arr);
    }
    for (const { missionKey, missionId } of result.missions) {
      const source = input.decomposition.missions.find((m) => m.id === missionKey);
      if (!source) continue;
      try {
        const card = createMissionCard({
          missionId,
          title: source.title,
          intent: source.intent ?? source.title,
          ...(input.intakeId ? { intakeId: input.intakeId } : {}),
          sourceWorkflowIds: workflowsByMission.get(missionId) ?? [],
          sourceTaskCount: result.tasks.filter((t) => t.missionId === missionId).length,
          now: now(),
        });
        deps.kgsMissionWriter.writeCard(card);
      } catch (err) {
        result.errors.push({
          scope: 'mission',
          key: missionKey,
          error: `kgs write failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return result;
}

function isSkeleton(r: SingleSynthResult): boolean {
  return r.ok && 'skeleton' in r && r.skeleton === true;
}

// Re-export companion shapes for callers that already import from
// register-all (keeps the public surface flat).
export type { TaskAlignment, TaskCategorization };
