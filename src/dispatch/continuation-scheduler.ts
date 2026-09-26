// ── §5-③ Phase C2: continuation scheduler ──
//
// The idle-gated ticker that drives the active auto-mode goal. codex's
// `on_thread_idle → continue_if_idle` in elanous shape: on each tick, if
// the host is idle AND a goal is Active, fire one ContinuationDriver
// step (build completion-audit prompt → run a turn → re-check
// termination → no-progress andon). A dedicated scheduler (not the
// per-task OpportunisticLauncher) because the auto-mode goal is a
// singleton, not a TOX task set.
//
// Pure + fully dependency-injected (idle check, active-goal lookup,
// driver factory, and the timer seam are all injected) so it's
// unit-testable and starts nothing on its own. Wiring it into the
// daemon behind a default-off `dispatch.enabled` gate is done in
// wireTox. See docs §5-③.

import { debug } from '../debug/log.js';
import type { ContinuationStepResult } from './continuation-driver.js';

/** `elanous logs --category` category for continuation scheduler decisions. */
export const SCHEDULER_LOG_CATEGORY = 'dispatch.continuation.scheduler';

/** 억제 대상인 대기 갈래 넷 — 리터럴로 좁혀 오타가 억제 상태를 조용히 깨지 못하게 한다. */
type WaitingEvent = 'step-in-progress' | 'not-idle' | 'no-active-goal' | 'driver-halted';

/** Minimal driver surface the scheduler steps. */
export interface SteppableDriver {
  step(): Promise<ContinuationStepResult>;
  readonly isHalted: boolean;
}

export interface ActiveGoalRef {
  goalSlug: string;
  /** Stable identity distinguishes a queued entry from an auto-mode goal with the same slug. */
  id?: string;
  source?: 'auto-mode' | 'file-queue';
}

export interface ContinuationSchedulerDeps {
  /** True when the host has been idle past threshold (IdleDetector.isIdle). */
  isIdle: () => boolean;
  /** The active auto-mode goal, or null when none is running. */
  getActiveGoal: () => ActiveGoalRef | null | Promise<ActiveGoalRef | null>;
  /** Build a fresh driver for a newly-active goal (bridge + runTurn). */
  makeDriver: (goal: ActiveGoalRef) => SteppableDriver | Promise<SteppableDriver>;
  /** Tick interval. Default 5000ms. */
  intervalMs?: number;
  /** Per-step outcome hook (observability / dispatch-runs recording). */
  onOutcome?: (goal: ActiveGoalRef, result: ContinuationStepResult) => void | Promise<void>;
  /** Timer seam — overridable for deterministic tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

const DEFAULT_INTERVAL_MS = 5000;

export class ContinuationScheduler {
  private handle: unknown = null;
  private driver: SteppableDriver | null = null;
  private driverGoal: ActiveGoalRef | null = null;
  private stepping = false;
  private lastWaitingEvent: WaitingEvent | null = null;

  constructor(private readonly deps: ContinuationSchedulerDeps) {}

  get running(): boolean { return this.handle !== null; }

  start(): void {
    if (this.handle !== null) return;
    const set = this.deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.handle = set(() => { void this.tick(); }, this.deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  }

  stop(): void {
    if (this.handle === null) return;
    const clear = this.deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    clear(this.handle);
    this.handle = null;
    this.driver = null;
    this.driverGoal = null;
  }

  /** One tick — public for deterministic tests. Fires at most one
   *  continuation step, gated on idle + an active, non-halted goal.
   *  A fresh driver is built when the active goal changes; terminal
   *  (halted) drivers are left idle until a new goal appears. */
  async tick(): Promise<void> {
    if (this.stepping) {
      if (this.shouldLogWaiting('step-in-progress')) debug.log(SCHEDULER_LOG_CATEGORY, 'step-in-progress');
      return;
    }
    if (!this.deps.isIdle()) {
      if (this.shouldLogWaiting('not-idle')) debug.log(SCHEDULER_LOG_CATEGORY, 'not-idle');
      return;
    }

    // Queue-backed lookup can await the cross-process lock. Claim the tick
    // before that await so a second timer tick cannot construct another driver.
    this.stepping = true;
    try {
      const goal = await this.deps.getActiveGoal();
      if (!goal) {
        this.driver = null;
        this.driverGoal = null;
        if (this.shouldLogWaiting('no-active-goal')) debug.log(SCHEDULER_LOG_CATEGORY, 'no-active-goal');
        return;
      }

      if (!this.driver || !sameGoal(this.driverGoal, goal)) {
        const previousGoalSlug = this.driverGoal?.goalSlug ?? null;
        // ⛔ 드라이버 생성 실패는 **스텝 거부가 아니다** — 여기서 던지면 `void tick()` 을 타고 타이머의
        //   미처리 rejection 이 되고, 그 골은 다시 시도되지도 않는다(리뷰 must-fix).
        //   ⇒ 관측에 남기고 이 틱만 건너뛴다. **다음 틱에 다시 만든다.**
        try {
          this.driver = await this.deps.makeDriver(goal);
        } catch (error) {
          this.driver = null;
          this.driverGoal = null;
          this.lastWaitingEvent = null;
          debug.log(SCHEDULER_LOG_CATEGORY, 'driver-create-failed', {
            goalSlug: goal.goalSlug,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        this.driverGoal = goal;
        this.lastWaitingEvent = null;
        debug.log(SCHEDULER_LOG_CATEGORY, 'driver-replaced', { goalSlug: goal.goalSlug, previousGoalSlug });
      }
      if (this.driver.isHalted) {
        if (this.shouldLogWaiting('driver-halted')) debug.log(SCHEDULER_LOG_CATEGORY, 'driver-halted', { goalSlug: goal.goalSlug });
        return;
      }

      this.lastWaitingEvent = null;
      let result: ContinuationStepResult;
      // ⛔ catch 는 **스텝 거부만** 감싼다 — 결과 로깅이나 onOutcome 콜백의 예외까지 삼키면
      //   그것들이 `step-failed` 로 오기록되어 "스텝이 실패했다" 는 거짓을 만든다(리뷰 must-fix).
      try {
        result = await this.driver.step();
      } catch (error) {
        debug.log(SCHEDULER_LOG_CATEGORY, 'step-failed', {
          goalSlug: goal.goalSlug,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      // ⛔ 스텝 **결과**를 남긴다 — 시작만 남기면 "돌았다" 와 "무엇을 했다" 가 구별되지 않고,
      //   거부한 스텝까지 실행 완료로 읽힌다.
      debug.log(SCHEDULER_LOG_CATEGORY, 'step-result', {
        goalSlug: goal.goalSlug,
        outcome: result.outcome,
        turns: result.turns,
        noProgressStreak: result.noProgressStreak,
      });
      await this.deps.onOutcome?.(goal, result);
    } finally {
      this.stepping = false;
    }
  }

  private shouldLogWaiting(event: WaitingEvent): boolean {
    if (this.lastWaitingEvent === event) return false;
    this.lastWaitingEvent = event;
    return true;
  }
}

function sameGoal(a: ActiveGoalRef | null, b: ActiveGoalRef): boolean {
  return a !== null && a.source === b.source && a.id === b.id && a.goalSlug === b.goalSlug;
}
