// ── V2 (Phase 2 Bundle 2) — Voice → ACP subagent → shell → 음성 보고 ──
//
// HANDOFF Phase 2 §5 V2 / ROADMAP §5: "Voice → ACP subagent → shell → 음성
// 보고". V1 (Phase 1) 의 역방향 — V1 은 shell 죽음을 voice 로 알렸다면,
// V2 는 voice 로 받은 의도를 ACP subagent 에 위임 + shell 실행 + 결과
// 음성 보고.
//
// Pure orchestrator — host (dashboard / Telegram / PWA) 가 4 dep 주입:
//   1. classifyVoiceGoal — voice transcript → 실행 가능한 작업 의도
//      (research / coding / monitoring 등 conductor goalKind 활용)
//   2. spawnSubagent — ACP H3 #6 background subagent 생성 + start
//   3. awaitSubagent — subagent 완료까지 poll (또는 streaming progress)
//   4. speak — TTS 출력 (V1 의 PfcVoiceRuntime 또는 직접 controller)
//
// 4 step 모두 budget gate · cancel 처리 · graceful failure utterance.

import type { GoalKind } from '../conductor/types.js';

export interface VoiceOrchestrationGoal {
  /** Coarse intent (conductor goalKind 와 동일 vocabulary). */
  readonly kind: GoalKind;
  /** 원문 transcript — subagent 의 task description 으로 forward. */
  readonly transcript: string;
  /** Optional subagent role hint ('codex' / 'gemini' / 'claude'). */
  readonly preferredAgent?: string;
}

export interface VoiceOrchestrationSubagentHandle {
  readonly id: string;
  /** Cancel — subagent 종료. */
  cancel(): Promise<void>;
}

export interface VoiceOrchestrationResult {
  readonly outcome:
    | 'spoken'
    | 'classify-failed'   // classifier 가 actionable goal 못 판별
    | 'spawn-failed'      // subagent 생성 실패 (no capacity / config)
    | 'await-timeout'     // subagent 가 wallclock budget 초과
    | 'subagent-failed'   // subagent 실패 (exit code · error)
    | 'tts-failed';
  readonly utterance?: string;
  readonly goal?: VoiceOrchestrationGoal;
  readonly subagentId?: string;
  readonly subagentSummary?: string;
}

export interface VoiceOrchestrationDeps {
  /** Classifier — null → orchestration 종료. */
  classifyVoiceGoal: (transcript: string) => Promise<VoiceOrchestrationGoal | null>;
  /** Subagent spawn — throws / null on failure. */
  spawnSubagent: (goal: VoiceOrchestrationGoal) => Promise<VoiceOrchestrationSubagentHandle | null>;
  /** Wait for subagent completion — returns final summary or null on
   *  failure. Call site uses ACP H3 background poll loop. */
  awaitSubagent: (handle: VoiceOrchestrationSubagentHandle) => Promise<{
    ok: boolean;
    summary: string;
  } | null>;
  /** TTS sink. */
  speak: (sentence: string) => Promise<void>;
  /** Per-step budgets. */
  classifyBudgetMs?: number;     // default 3000
  spawnBudgetMs?: number;        // default 5000
  awaitBudgetMs?: number;        // default 600000 (10 min — subagents
                                  // can be long-running; budget is
                                  // upper guard, not normal path)
  logDebug?: (category: string, event: string, data?: unknown) => void;
  /** Compose final utterance — defaults to natural Korean phrasing. */
  composeUtterance?: (input: {
    goal: VoiceOrchestrationGoal;
    summary: string;
    ok: boolean;
  }) => string;
}

const DEFAULT_CLASSIFY_BUDGET = 3000;
const DEFAULT_SPAWN_BUDGET = 5000;
const DEFAULT_AWAIT_BUDGET = 600_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function defaultCompose(input: {
  goal: VoiceOrchestrationGoal;
  summary: string;
  ok: boolean;
}): string {
  const verb = input.ok ? '완료했습니다' : '실패했습니다';
  return `${input.goal.kind} 작업 ${verb}. ${input.summary}`;
}

export interface VoiceOrchestrator {
  run(input: { transcript: string }): Promise<VoiceOrchestrationResult>;
}

export function createVoiceOrchestrator(
  deps: VoiceOrchestrationDeps,
): VoiceOrchestrator {
  const compose = deps.composeUtterance ?? defaultCompose;
  const classifyBudget = deps.classifyBudgetMs ?? DEFAULT_CLASSIFY_BUDGET;
  const spawnBudget = deps.spawnBudgetMs ?? DEFAULT_SPAWN_BUDGET;
  const awaitBudget = deps.awaitBudgetMs ?? DEFAULT_AWAIT_BUDGET;

  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  const fail = async (
    outcome: VoiceOrchestrationResult['outcome'],
    utterance: string,
    extra: Partial<VoiceOrchestrationResult> = {},
  ): Promise<VoiceOrchestrationResult> => {
    try { await deps.speak(utterance); } catch { /* graceful */ }
    return { outcome, utterance, ...extra };
  };

  return {
    async run({ transcript }) {
      log('voice.orchestrator.start', 'transcript', { chars: transcript.length });

      // Step 1 — classify
      const goal = await withTimeout(deps.classifyVoiceGoal(transcript), classifyBudget);
      if (!goal) {
        log('voice.orchestrator.classify-failed', '');
        return fail(
          'classify-failed',
          '음성 의도를 파악하지 못했어요. 다시 말씀해주세요.',
        );
      }
      log('voice.orchestrator.classified', goal.kind, { transcript: goal.transcript });

      // Step 2 — spawn subagent
      let handle: VoiceOrchestrationSubagentHandle | null = null;
      try {
        handle = await withTimeout(deps.spawnSubagent(goal), spawnBudget);
      } catch (err) {
        log('voice.orchestrator.spawn-throw', '', { error: String(err) });
      }
      if (!handle) {
        return fail('spawn-failed', `${goal.kind} 작업 시작에 실패했어요. 잠시 후 다시 시도해주세요.`, { goal });
      }
      log('voice.orchestrator.spawned', handle.id);

      // Step 3 — await subagent
      const finalResult = await withTimeout(deps.awaitSubagent(handle), awaitBudget);
      if (!finalResult) {
        log('voice.orchestrator.await-timeout', handle.id);
        try { await handle.cancel(); } catch { /* graceful */ }
        return fail(
          'await-timeout',
          `${goal.kind} 작업이 ${Math.round(awaitBudget / 60000)}분 안에 끝나지 않아 취소했어요.`,
          { goal, subagentId: handle.id },
        );
      }
      if (!finalResult.ok) {
        const utterance = compose({ goal, summary: finalResult.summary, ok: false });
        return fail('subagent-failed', utterance, {
          goal,
          subagentId: handle.id,
          subagentSummary: finalResult.summary,
        });
      }

      // Step 4 — speak success
      const utterance = compose({ goal, summary: finalResult.summary, ok: true });
      try {
        await deps.speak(utterance);
      } catch (err) {
        log('voice.orchestrator.tts-failed', handle.id, { error: String(err) });
        return {
          outcome: 'tts-failed',
          utterance,
          goal,
          subagentId: handle.id,
          subagentSummary: finalResult.summary,
        };
      }

      log('voice.orchestrator.spoken', handle.id, { chars: utterance.length });
      return {
        outcome: 'spoken',
        utterance,
        goal,
        subagentId: handle.id,
        subagentSummary: finalResult.summary,
      };
    },
  };
}
