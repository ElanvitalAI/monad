// ── PX-4 P1: mission types ──
//
// A mission is a declarative goal with a shell-command "evaluator"
// that periodically answers "done yet?". The runtime (P3) wires the
// evaluator as a Turn hook (priority 5, reserved) so missions run
// alongside LLM turns without a dedicated scheduler.
//
// Two files pair with the manifest entry:
//   - mission.md   (goalPath)     — human-readable goal + constraints.
//                                    Passed to the evaluator on stdin.
//   - sandbox.md   (sandboxPath)  — evaluator's working context
//                                    (allowed tools, working dir hints).
//                                    Also on stdin.
//
// Evaluator JSON contract (see src/plugin-missions/evaluator-runner.ts):
//   stdin : { missionId, iteration, lastResult?, workDir,
//             goalContent, sandboxContent }
//   stdout: { done: bool, score?: number, reason?: string, keep?: bool,
//             error?: string }
//   exit 0         → stdout parsed as MissionResult
//   exit != 0      → synthetic MissionResult { done:false, keep:false,
//                                                error:'exit ' + code }
//   timeout        → error:'timeout'
//   JSON parse err → error:'malformed-json'
//
// Naming: "mission" is new to the codebase (grep-clean) so no
// collision with the existing scheduler (which owns "workflow").

/** Plugin capability required to register + run missions. Builtin
 *  plugins are auto-granted (PluginCapabilityPolicy treats source
 *  'builtin' as fully trusted). User/workspace plugins MUST declare
 *  this in manifest.capabilities[] or host skips the register with
 *  a stderr warning. */
export const MISSION_CAPABILITY = 'mission:run' as const;

/** Plugin-declared mission. Loaded from manifest.contributes.missions[]
 *  at host activate. Paths are plugin-root-relative and validated
 *  against escape (..) by the parser. */
export interface MissionDefinition {
  id: string;
  name: string;
  /** Relative md file inside the plugin directory. Read at evaluator
   *  spawn time so authors can edit without plugin reload. */
  goalPath: string;
  /** Relative md file describing the evaluator sandbox — read alongside
   *  goalPath and piped to the evaluator. */
  sandboxPath: string;
  evaluator: MissionEvaluator;
  keepPolicy: MissionKeepPolicy;
  /** Hard cap on iterations before the runtime force-aborts.
   *  Validator clamps to [1, 1000]. */
  maxIterations: number;
  cadence?: MissionCadence;
  /** true → runtime starts the mission at plugin activate; false (or
   *  omitted) → the plugin's onActivate must call ctx.missions.start(id)
   *  (or a future LLM tool). */
  autostart?: boolean;
  /** Reserved — when the evaluator returns keep=true, auto-start a
   *  workflow with this id. Actual wiring lands in PX-4 → PX-5
   *  follow-up; parser accepts the field today so manifests don't
   *  break when it's set. */
  onKeepRun?: string;
  description?: string;
}

export interface MissionEvaluator {
  /** Shell command (default interpreter /bin/sh -c). Receives JSON on
   *  stdin, expected to emit JSON on stdout. */
  command: string;
  /** Only 'json' in v1. Reserved for future 'exit-code' (boolean
   *  pass/fail via exit status) or 'text' (LLM-parses) modes. */
  format: 'json';
  /** Hard timeout in ms. Default 300_000 (5 min). Validator clamps
   *  to [1_000, 1_800_000] — nothing runs longer than 30 min. */
  timeoutMs?: number;
  /** Optional cwd override for the shell invocation. Relative paths
   *  resolve against the plugin root at runtime. Defaults to the
   *  plugin root. */
  cwd?: string;
}

/** Which evaluator results "keep" (treat as a completed iteration).
 *  Subsequent iterations run when keep=false until maxIterations. */
export type MissionKeepPolicy =
  /** Only done=true iterations count as progress. Used when the goal
   *  is binary — either the task is finished or not. */
  | 'pass_only'
  /** Only score strictly greater than the previous iteration's score
   *  counts. undefined score → keep=false. Good for optimisation loops
   *  where every iteration should improve something measurable. */
  | 'score_improvement'
  /** Every iteration is recorded but never considered "kept". Mission
   *  terminates on done=true or maxIterations. Useful for mapped-work
   *  evaluators that just want per-turn observation. */
  | 'never';

export interface MissionCadence {
  /** Run the evaluator every N-th turn (default 1). Turns where the
   *  cadence gate rejects are recorded as { skipped: true } in state
   *  but do not consume an iteration slot. */
  everyNTurn?: number;
}

export interface MissionResult {
  done: boolean;
  score?: number;
  reason?: string;
  keep?: boolean;
  error?: string;
}

export type MissionStatus =
  | 'idle'      // registered but not yet started
  | 'running'   // active; tick() drives iterations
  | 'done'      // evaluator returned done=true
  | 'aborted'   // maxIterations exceeded OR explicit abort()
  | 'error';    // consecutive error results (e.g. evaluator crashed)

export interface MissionHistoryEntry {
  iteration: number;
  result: MissionResult;
  ts: number;
}

/** Persisted per-mission state. Key under plugin-state:
 *    mission:<missionId>:state   (scope: project)                 */
export interface MissionState {
  missionId: string;
  pluginId: string;
  iteration: number;
  status: MissionStatus;
  lastResult?: MissionResult;
  startedAt: number;
  endedAt?: number;
  history: MissionHistoryEntry[];
}

/** Default values for missing optional fields — applied by the parser
 *  at manifest time so the runtime never sees undefined. Exported so
 *  tests can assert they match expectations. */
export const MISSION_DEFAULTS = {
  maxIterations: 10,
  cadenceEveryNTurn: 1,
  evaluatorTimeoutMs: 300_000,
  evaluatorTimeoutMaxMs: 1_800_000,
  evaluatorTimeoutMinMs: 1_000,
  maxIterationsMax: 1000,
} as const;
