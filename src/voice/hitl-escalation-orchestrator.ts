// ── M2 (Phase 4 Bundle 3) — Voice HITL escalation ──
//
// HANDOFF Phase 4 / ROADMAP §7 M2: "외부 agent voice HITL escalation".
// External agent (codex / V2 subagent / mesh debate split) 가 confidence
// 낮거나 destructive action 결정 시 사용자에게 voice prompt + 응답
// 받음. M1 (multi-modal handoff) + ACP H4 HITL 합류.
//
// 흐름:
//   [External agent] "이 fix 를 적용해도 되나요?"
//     ↓ HitlEscalation.askUser({ question, options, urgency })
//     ↓ V1 voice ('TTS) speaks question
//     ↓ user voice response (또는 channel reply)
//     ↓ STT → 응답 분석 → 'yes' | 'no' | 'unclear'
//     ↓ HitlResponse { decision, transcript }

export type HitlUrgency = 'low' | 'normal' | 'urgent';

export interface HitlPromptInput {
  /** 외부 agent 가 사용자에게 묻는 질문. */
  readonly question: string;
  /** 가능한 옵션 (예: ['apply', 'rollback', 'investigate']). */
  readonly options: readonly string[];
  /** Urgency — 'urgent' 시 다른 작업 모두 차단 + 즉시 prompt. */
  readonly urgency?: HitlUrgency;
  /** Caller agent / context (audit). */
  readonly source?: string;
}

export interface HitlResponse {
  readonly decision: string;       // 매칭된 option 또는 'cancel' / 'unclear'
  readonly transcript: string;     // raw user 응답
  readonly confidence: number;     // 0-1
}

export type HitlOutcome =
  | 'answered'        // 명확한 응답
  | 'unclear'         // 응답 받았지만 매칭 안됨
  | 'timeout'         // 응답 시간 초과
  | 'cancelled'       // 사용자가 명시 cancel
  | 'tts-failed';     // TTS 단계 실패

export interface HitlEscalationResult {
  readonly outcome: HitlOutcome;
  readonly response?: HitlResponse;
}

export interface HitlEscalationDeps {
  /** TTS — 사용자에게 question 발화. */
  speak: (sentence: string) => Promise<void>;
  /** 사용자 voice 응답 받음. host 가 STT 통합. budget 안에 응답 못 받으면 null. */
  awaitUserResponse: (opts: { promptId: string; budgetMs: number }) => Promise<{
    transcript: string;
    confidence?: number;
  } | null>;
  /** 응답 transcript → option 매칭. host 가 fuzzy match / LLM intent
   *  classification. defaults to substring match. */
  matchOption?: (transcript: string, options: readonly string[]) => {
    decision: string;
    confidence: number;
  } | null;
  /** Per-prompt 응답 budget. Default 30s. urgent 는 90s. */
  responseBudgetMs?: number;
  urgentResponseBudgetMs?: number;
  /** Compose spoken question — defaults to "{question} 옵션: {a}, {b}, {c}". */
  composePrompt?: (input: HitlPromptInput) => string;
  /** Test seam — defaults to crypto.randomUUID. */
  newPromptId?: () => string;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface HitlEscalation {
  askUser(input: HitlPromptInput): Promise<HitlEscalationResult>;
  /** Diagnostic — currently in-flight prompts. */
  inFlight(): readonly string[];
}

const DEFAULT_RESPONSE_BUDGET_MS = 30_000;
const DEFAULT_URGENT_BUDGET_MS = 90_000;

function defaultMatchOption(
  transcript: string,
  options: readonly string[],
): { decision: string; confidence: number } | null {
  if (!transcript) return null;
  const lower = transcript.toLowerCase().trim();
  if (lower === 'cancel' || lower === '취소' || lower === '취소해') {
    return { decision: 'cancel', confidence: 1 };
  }
  // Try exact match first.
  for (const opt of options) {
    if (lower === opt.toLowerCase()) return { decision: opt, confidence: 1 };
  }
  // Substring contains.
  for (const opt of options) {
    if (lower.includes(opt.toLowerCase())) return { decision: opt, confidence: 0.7 };
  }
  // 'yes'/'no' shortcuts when options match.
  if ((lower.includes('yes') || lower.includes('네') || lower.includes('맞')) &&
      options.some((o) => o === 'yes' || o === 'apply' || o === 'confirm')) {
    return {
      decision: options.find((o) => o === 'yes' || o === 'apply' || o === 'confirm')!,
      confidence: 0.6,
    };
  }
  if ((lower.includes('no') || lower.includes('아니') || lower.includes('안')) &&
      options.some((o) => o === 'no' || o === 'rollback' || o === 'cancel')) {
    return {
      decision: options.find((o) => o === 'no' || o === 'rollback' || o === 'cancel')!,
      confidence: 0.6,
    };
  }
  return null;
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `hitl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultCompose(input: HitlPromptInput): string {
  return `${input.question} 옵션: ${input.options.join(', ')}.`;
}

export function createHitlEscalation(deps: HitlEscalationDeps): HitlEscalation {
  const compose = deps.composePrompt ?? defaultCompose;
  const matchOption = deps.matchOption ?? defaultMatchOption;
  const newId = deps.newPromptId ?? defaultId;
  const responseBudget = deps.responseBudgetMs ?? DEFAULT_RESPONSE_BUDGET_MS;
  const urgentBudget = deps.urgentResponseBudgetMs ?? DEFAULT_URGENT_BUDGET_MS;
  const inflight = new Set<string>();

  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  return {
    async askUser(input) {
      const promptId = newId();
      inflight.add(promptId);
      log('hitl.askUser.start', promptId, { urgency: input.urgency, source: input.source });

      try {
        // Step 1 — speak question
        try {
          await deps.speak(compose(input));
        } catch (err) {
          log('hitl.askUser.tts-throw', promptId, { error: String(err) });
          return { outcome: 'tts-failed' };
        }

        // Step 2 — await response
        const budget = input.urgency === 'urgent' ? urgentBudget : responseBudget;
        const userResponse = await deps.awaitUserResponse({ promptId, budgetMs: budget });
        if (!userResponse) {
          log('hitl.askUser.timeout', promptId);
          return { outcome: 'timeout' };
        }

        // Step 3 — match
        const match = matchOption(userResponse.transcript, input.options);
        if (!match) {
          log('hitl.askUser.unclear', promptId, { transcript: userResponse.transcript });
          return {
            outcome: 'unclear',
            response: {
              decision: 'unclear',
              transcript: userResponse.transcript,
              confidence: 0,
            },
          };
        }

        if (match.decision === 'cancel') {
          log('hitl.askUser.cancelled', promptId);
          return {
            outcome: 'cancelled',
            response: {
              decision: 'cancel',
              transcript: userResponse.transcript,
              confidence: match.confidence,
            },
          };
        }

        log('hitl.askUser.answered', promptId, { decision: match.decision });
        return {
          outcome: 'answered',
          response: {
            decision: match.decision,
            transcript: userResponse.transcript,
            confidence: match.confidence,
          },
        };
      } finally {
        inflight.delete(promptId);
      }
    },
    inFlight() {
      return Array.from(inflight);
    },
  };
}
