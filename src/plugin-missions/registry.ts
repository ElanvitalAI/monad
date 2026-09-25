// ── PX-4 P3: MissionRegistry ──
//
// In-memory map of active missions keyed by mission id, plus a tick()
// driver the Turn hook calls once per turn. Each registered mission
// carries its PluginStateApi handle (PX-2) so state persists under
// `mission:<missionId>:state` (scope: project).
//
// Flow per tick:
//   1. Skip missions whose status is not 'running' (idle / done /
//      aborted / error are terminal until a caller calls start()).
//   2. Cadence gate: skip if (turnNumber - startedAtTurn) % everyNTurn
//      != 0 — tracked lazily via lastEvaluatedTurn.
//   3. Resolve goalContent / sandboxContent from disk on each tick so
//      authors can edit the prompt without plugin reload. Large files
//      are fine; shell stdin handles them.
//   4. runMissionEvaluator() — returns MissionResult.
//   5. keepPolicy application:
//        pass_only          — done=true → complete; else iteration++
//        score_improvement — score > prev.score → kept iteration++;
//                            else same iteration (no increment)
//        never              — history append, always iteration++
//   6. Persist state; exit if done or iteration > maxIterations.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginStateApi } from '../plugin-state/api.js';
import { runMissionEvaluator } from './evaluator-runner.js';
import {
  MISSION_DEFAULTS,
  type MissionDefinition,
  type MissionResult,
  type MissionState,
  type MissionStatus,
} from './types.js';

/** What the plugin-host passes at register time so the registry can
 *  read mission.md / sandbox.md from the plugin dir and persist state
 *  into the right scope. */
export interface MissionRegistration {
  pluginId: string;
  pluginDir: string;                  // absolute
  def: MissionDefinition;
  /** Optional — when omitted, state is memory-only. PX-2 plugin-host
   *  always provides one; tests can skip for simpler fixtures. */
  stateApi?: PluginStateApi;
}

interface ActiveMission {
  reg: MissionRegistration;
  state: MissionState;
  /** Last turn number tick() actually invoked the evaluator for. Used
   *  to apply cadence without persisting turn counters. */
  lastEvaluatedTurn: number;
  /** Turn number when start() flipped status to 'running'. Used with
   *  cadence.everyNTurn so the first eval lands on startedAtTurn. */
  startedAtTurn: number;
}

export interface TickOpts {
  now?: number;
  /** When provided, override `onStderr` for the evaluator runner —
   *  tests use this to capture warnings. */
  onStderr?: (line: string) => void;
}

/** Persisted blob shape — matches MissionState but omits `pluginId`
 *  which is recovered from the registry key. */
function stateKey(missionId: string): string {
  return `mission:${missionId}:state`;
}

export class MissionRegistry {
  private entries = new Map<string, ActiveMission>();

  /** Register a mission. autostart=true flips status to 'running'
   *  immediately; otherwise the mission stays idle until start(). */
  register(r: MissionRegistration): () => void {
    if (this.entries.has(r.def.id)) {
      throw new Error(`mission '${r.def.id}' already registered`);
    }
    const state: MissionState = {
      missionId: r.def.id,
      pluginId: r.pluginId,
      iteration: 0,
      status: r.def.autostart ? 'running' : 'idle',
      startedAt: r.def.autostart ? Date.now() : 0,
      history: [],
    };
    this.entries.set(r.def.id, {
      reg: r,
      state,
      lastEvaluatedTurn: -1,
      startedAtTurn: r.def.autostart ? 0 : -1,
    });
    return () => { this.dispose(r.def.id); };
  }

  dispose(missionId: string): void {
    this.entries.delete(missionId);
  }

  /** List registered mission definitions (active + idle). */
  list(): MissionDefinition[] {
    return [...this.entries.values()].map(e => e.reg.def);
  }

  /** List currently-running missions (for Turn hook banner). */
  active(): MissionDefinition[] {
    return [...this.entries.values()]
      .filter(e => e.state.status === 'running')
      .map(e => e.reg.def);
  }

  state(missionId: string): MissionState | null {
    const e = this.entries.get(missionId);
    return e ? structuredClone(e.state) : null;
  }

  /** Flip an idle / terminal mission back to 'running'. Clears history
   *  so the run starts fresh. */
  async start(missionId: string, turnNumber = 0): Promise<void> {
    const e = this.entries.get(missionId);
    if (!e) throw new Error(`mission '${missionId}' not registered`);
    e.state = {
      missionId,
      pluginId: e.reg.pluginId,
      iteration: 0,
      status: 'running',
      startedAt: Date.now(),
      history: [],
    };
    e.startedAtTurn = turnNumber;
    e.lastEvaluatedTurn = -1;
    await this.persist(e);
  }

  abort(missionId: string, reason?: string): void {
    const e = this.entries.get(missionId);
    if (!e) return;
    if (e.state.status === 'running') {
      e.state.status = 'aborted';
      e.state.endedAt = Date.now();
      if (reason) e.state.lastResult = { done: false, error: reason };
      void this.persist(e);
    }
  }

  /** Drive all running missions for this turn. Returns the list of
   *  missions that are *currently* running after the tick — useful
   *  for the Turn hook to render a banner of in-flight work. */
  async tick(turnNumber: number, opts: TickOpts = {}): Promise<MissionDefinition[]> {
    const running: MissionDefinition[] = [];
    for (const e of this.entries.values()) {
      if (e.state.status !== 'running') continue;
      const cadence = e.reg.def.cadence?.everyNTurn
        ?? MISSION_DEFAULTS.cadenceEveryNTurn;
      const since = turnNumber - Math.max(0, e.startedAtTurn);
      if (since % cadence !== 0) {
        running.push(e.reg.def);
        continue;
      }
      if (e.lastEvaluatedTurn === turnNumber) {
        // Same turn may re-tick via a re-dispatch; don't double-eval.
        running.push(e.reg.def);
        continue;
      }
      e.lastEvaluatedTurn = turnNumber;
      const result = await this.evaluate(e, opts);
      this.applyResult(e, result, opts.now ?? Date.now());
      if (e.state.status === 'running') running.push(e.reg.def);
      await this.persist(e);
    }
    return running;
  }

  private async evaluate(e: ActiveMission, opts: TickOpts): Promise<MissionResult> {
    const goalContent = safeRead(join(e.reg.pluginDir, e.reg.def.goalPath));
    const sandboxContent = safeRead(join(e.reg.pluginDir, e.reg.def.sandboxPath));
    return runMissionEvaluator(e.reg.def, {
      missionId: e.reg.def.id,
      iteration: e.state.iteration + 1,
      ...(e.state.lastResult ? { lastResult: e.state.lastResult } : {}),
      workDir: e.reg.pluginDir,
      goalContent,
      sandboxContent,
    }, {
      ...(opts.onStderr ? { onStderr: opts.onStderr } : {}),
    });
  }

  private applyResult(e: ActiveMission, result: MissionResult, now: number): void {
    e.state.lastResult = result;
    const nextIteration = e.state.iteration + 1;
    const policy = e.reg.def.keepPolicy;

    // Decide "kept" — which drives iteration increment + history row.
    const prev = lastNonErrorResult(e.state);
    let kept = false;
    if (result.error) {
      // Errors never satisfy keep, regardless of policy.
      kept = false;
    } else if (policy === 'pass_only') {
      kept = result.done;
    } else if (policy === 'score_improvement') {
      if (typeof result.score !== 'number') kept = false;
      else if (prev?.score === undefined) kept = true;
      else kept = result.score > prev.score;
    } else {
      // never — history records everything, iteration advances always.
      kept = true;
    }

    // History row for every evaluation (including error / skipped-keep).
    e.state.history.push({
      iteration: nextIteration,
      result,
      ts: now,
    });

    // Iteration counter advances on kept OR policy='never' — every
    // non-error eval increments for those. pass_only / score_improvement
    // only advance when kept=true.
    if (kept || policy === 'never') {
      e.state.iteration = nextIteration;
    }

    // Terminal check — done takes precedence; maxIterations next.
    if (result.done) {
      e.state.status = 'done';
      e.state.endedAt = now;
      return;
    }
    if (e.state.iteration >= e.reg.def.maxIterations) {
      e.state.status = 'aborted';
      e.state.endedAt = now;
      return;
    }
    // If policy=pass_only and we got an error twice in a row, count as
    // error so the mission stops instead of spinning forever.
    if (result.error && policy === 'pass_only') {
      const errorsInARow = countTrailingErrors(e.state);
      if (errorsInARow >= 3) {
        e.state.status = 'error';
        e.state.endedAt = now;
      }
    }
  }

  private async persist(e: ActiveMission): Promise<void> {
    if (!e.reg.stateApi) return;
    try {
      await e.reg.stateApi.persist(stateKey(e.reg.def.id), e.state, { scope: 'project' });
    } catch (err) {
      // Persistence failures must never throw into the tick() caller
      // — the Turn hook chain would surface that as an abort.
      console.warn(`[mission:${e.reg.def.id}] persist failed:`, (err as Error).message);
    }
  }

  /** Testing helper — snapshot every active state. */
  snapshot(): MissionState[] {
    return [...this.entries.values()].map(e => structuredClone(e.state));
  }

  /** Testing helper — forget everything. */
  clear(): void {
    this.entries.clear();
  }

  get size(): number { return this.entries.size; }
}

function safeRead(path: string): string {
  if (!existsSync(path)) return '';
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

function lastNonErrorResult(state: MissionState): MissionResult | undefined {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const r = state.history[i]!.result;
    if (!r.error) return r;
  }
  return undefined;
}

function countTrailingErrors(state: MissionState): number {
  let n = 0;
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (state.history[i]!.result.error) n++;
    else break;
  }
  return n;
}

/** Process-wide singleton. Plugin-host registers missions here at
 *  activate; the Turn hook reads via globalMissionRegistry. */
export const globalMissionRegistry = new MissionRegistry();
