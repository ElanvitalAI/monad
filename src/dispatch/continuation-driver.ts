// ── §5-③ Phase A: headless continuation driver ──
//
// The stateful step() the OpportunisticLauncher fires per idle tick.
// While a goal is Active it: builds the completion-audit loop-prompt,
// runs one agent turn, re-evaluates the goal's Termination DSL, and —
// the furnace guard — escalates an andon when consecutive turns make no
// progress. This is the missing "driver" that turns EnterAutoMode's
// one-shot kickoff into an actual self-firing loop.
//
// Pure + fully dependency-injected so it's unit-testable and starts
// nothing on its own; wiring it into the daemon (via wireTox + a
// default-off `dispatch.enabled` gate) is Phase C. See
// 내부 문서 `RESEARCH-loop-engineering-vs-pfc-dual-loop-2026-07-01` §5-③.

export type ContinuationOutcome =
  | 'inactive'           // no active goal (or already halted) → nothing to drive
  | 'continued'          // a turn ran, goal still in progress
  | 'complete'           // goal termination satisfied → done
  | 'budget'             // goal budget exhausted → stop (furnace guard, §5-⑤)
  | 'max_turns'          // hard turn cap hit (furnace guard)
  | 'andon-no-progress'; // K consecutive no-progress turns → escalated + halt

export interface ContinuationStepResult {
  outcome: ContinuationOutcome;
  /** Total turns fired by this driver so far. */
  turns: number;
  /** Consecutive no-progress turns observed (resets on any change). */
  noProgressStreak: number;
}

export interface ContinuationDriverDeps<TResult> {
  /** Is a goal currently Active? (bind to getAutoModeState().active). */
  isActive: () => boolean;
  /** Build the turn's kickoff prompt — the completion-audit loop-prompt
   *  injection (buildLoopPromptSnapshot + renderLoopPromptInjection). */
  buildPrompt: () => Promise<string> | string;
  /** Run one agent turn with the given prompt; returns the turn result. */
  runTurn: (prompt: string) => Promise<TResult>;
  /** Re-evaluate goal termination after the turn (Termination DSL).
   *  `true` = objective conditions satisfied → stop. */
  isTerminated: (result: TResult) => Promise<boolean> | boolean;
  /** Stable digest of the turn's tool results — identical across turns
   *  means no progress (mirrors AXON factor 3 `idempotent-recent-turns`). */
  hashToolResults: (result: TResult) => string;
  /** Escalate an andon when the loop stalls. Wired to cft/andon
   *  emitEscalation in Phase C; the next prompt surfaces the banner. */
  onAndon?: (reason: string) => void;
  /** Observability hook — one call per step. */
  onStep?: (info: ContinuationStepResult) => void;
  /** Idempotent terminal lifecycle hook, called once when this driver halts. */
  onHalt?: (outcome: Exclude<ContinuationOutcome, 'inactive' | 'continued'>) => void;
  /** Hard turn cap (furnace guard). Default 100 (AUTO_MODE_HARD_MAX_TURNS). */
  maxTurns?: number;
  /** Consecutive no-progress turns before andon. Default 3 (codex
   *  blocked-after-3× guardrail). */
  noProgressAndonThreshold?: number;
  /** §5-⑤ — budget-based furnace guard. `true` = the goal's budget is
   *  exhausted → stop (outcome 'budget') instead of relying only on the
   *  turn cap, so long goals run as long as budget allows and no longer.
   *  Checked before each turn. */
  budgetExhausted?: () => boolean | Promise<boolean>;
  /** §5-⑤ — record a turn's resource usage (e.g. tokens) so the goal
   *  budget accrues across turns and `budgetExhausted` can trip. Called
   *  once per completed turn. */
  recordUsage?: (result: TResult) => void;
}

/** Mirror of AUTO_MODE_HARD_MAX_TURNS (src/auto-research/auto-mode/types.ts)
 *  kept local so this module stays dependency-free. */
const DEFAULT_MAX_TURNS = 100;
const DEFAULT_NO_PROGRESS_ANDON = 3;

export class ContinuationDriver<TResult> {
  private turns = 0;
  private noProgressStreak = 0;
  private lastHash: string | null = null;
  private halted = false;

  constructor(private readonly deps: ContinuationDriverDeps<TResult>) {}

  get turnCount(): number { return this.turns; }
  get isHalted(): boolean { return this.halted; }

  /** Fire one continuation turn. The launcher calls this per idle tick;
   *  cross-tick state (turn count, no-progress streak, halted) persists
   *  on the instance so the furnace guard spans ticks. Terminal outcomes
   *  (complete / max_turns / andon) latch `halted` — subsequent calls
   *  return 'inactive' until a fresh driver is created for a new goal. */
  async step(): Promise<ContinuationStepResult> {
    const maxTurns = this.deps.maxTurns ?? DEFAULT_MAX_TURNS;
    const andonAt = this.deps.noProgressAndonThreshold ?? DEFAULT_NO_PROGRESS_ANDON;

    if (this.halted || !this.deps.isActive()) return this.emit('inactive');
    if (this.turns >= maxTurns) return this.halt('max_turns');
    // §5-⑤ — budget furnace guard: stop before spending more when the
    // goal's budget is exhausted (lets long goals run to budget, not a
    // fixed turn count).
    if (this.deps.budgetExhausted && (await this.deps.budgetExhausted())) return this.halt('budget');

    const prompt = await this.deps.buildPrompt();
    const result = await this.deps.runTurn(prompt);
    this.turns++;
    this.deps.recordUsage?.(result); // accrue usage into the goal budget

    if (await this.deps.isTerminated(result)) return this.halt('complete');

    const hash = this.deps.hashToolResults(result);
    if (this.lastHash !== null && hash === this.lastHash) this.noProgressStreak++;
    else this.noProgressStreak = 0;
    this.lastHash = hash;

    if (this.noProgressStreak >= andonAt) {
      this.deps.onAndon?.(
        `no progress across ${this.noProgressStreak + 1} consecutive turns — escalating for human review`,
      );
      return this.halt('andon-no-progress');
    }

    return this.emit('continued');
  }

  private halt(outcome: Exclude<ContinuationOutcome, 'inactive' | 'continued'>): ContinuationStepResult {
    if (!this.halted) {
      this.halted = true;
      this.deps.onHalt?.(outcome);
    }
    return this.emit(outcome);
  }

  private emit(outcome: ContinuationOutcome): ContinuationStepResult {
    const r: ContinuationStepResult = {
      outcome,
      turns: this.turns,
      noProgressStreak: this.noProgressStreak,
    };
    this.deps.onStep?.(r);
    return r;
  }
}
