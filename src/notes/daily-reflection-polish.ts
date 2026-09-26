// R6 v2 (2026-05-09) — Hansei (반성) LLM polish for daily reflection.
//
// Wraps `buildDailyReflection`'s deterministic snapshot with an LLM-
// generated reflective summary. The snapshot is data-only (counts +
// session previews); the polish layer turns those numbers into a
// short paragraph that names what the user actually did today and
// suggests one next step.
//
// Tone: 1st-person, Korean default, ~3-4 sentences, end with one
// concrete suggestion. The summary is meant to be glanceable on a
// lock-screen push notification.
//
// Failure mode: throws on missing provider / empty response. The
// caller (scheduler) catches + falls back to the raw snapshot's
// counters in the push notification body.
//
// Cross-ref:
//   src/notes/daily-reflection.ts (snapshot · pure data)
//   src/notes/polish-callable.ts (sibling — vision-bound polish)
//   src/notes/daily-reflection-scheduler.ts (scheduler · consumer)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R6 v2

import { streamLLM, resolveDefaultProvider } from '../llm.js';
import type { LLMMessage } from '../llm.js';
import type { DailyReflectionSnapshot } from './daily-reflection.js';

const DEFAULT_PROMPT = `다음은 오늘 하루 elanous 에이전트와 함께 한 작업의 데이터 스냅샷이야.
이 데이터를 바탕으로 1인칭 시점의 짧은 반성문 (Hansei) 을 한국어로 작성해줘.

작성 규칙:
1. 3~4 문장 이내. 너무 길지 않게.
2. 오늘의 양적 성과 (저장된 노트 수 · OCR 횟수 · 활동한 세션 수) 를 자연스럽게 언급.
3. 가장 활발했던 세션이 있으면 한 줄로 무엇을 했는지 추론 + 언급 (lastMsgPreview 활용).
4. 마지막 한 문장으로 내일/다음 단계로 시도해볼 만한 작은 제안 1개.
5. 출력은 본문만. 헤딩 / preamble / "반성문:" / 인용 부호 / fences 없이 plain Korean text.`;

const DEFAULT_MAX_TOKENS = 600;

export interface DailyReflectionPolishCallable {
  (input: { snapshot: DailyReflectionSnapshot }): Promise<string>;
}

interface FactoryOpts {
  /** Override the prompt. */
  prompt?: string;
  /** Override the max tokens budget. Default 600 — Hansei is short. */
  maxTokens?: number;
  /** Test seam — replace `streamLLM`. */
  llm?: typeof streamLLM;
  /** Test seam — provider resolver. */
  resolveProvider?: () => { name: string; defaultModel: string; available(): boolean };
}

/** True when the active default LLM provider is available. Polish
 *  is text-only so vision-capability is NOT required (unlike
 *  notes-polish-callable). The scheduler skips the polish pass when
 *  this returns false; the push falls back to a raw counts summary. */
export function isDailyReflectionPolishAvailable(
  opts: Pick<FactoryOpts, 'resolveProvider'> = {},
): boolean {
  try {
    const provider = (opts.resolveProvider ?? resolveDefaultProvider)();
    return provider.available();
  } catch {
    return false;
  }
}

function snapshotAsContext(snap: DailyReflectionSnapshot): string {
  const lines: string[] = [];
  lines.push(`날짜: ${snap.date}`);
  lines.push(`저장된 노트: ${snap.notesSaved}`);
  lines.push(`OCR 실행: ${snap.ocrRuns}`);
  lines.push(`활동한 세션: ${snap.sessionsToday}`);
  if (snap.topSessions.length > 0) {
    lines.push('가장 활발한 세션 (최대 3개):');
    for (const s of snap.topSessions) {
      const preview = (s.lastMsgPreview ?? '').slice(0, 120);
      lines.push(`- ${s.id} · 메시지 ${s.msgCount}개 · "${preview}"`);
    }
  } else {
    lines.push('활동한 세션 없음.');
  }
  return lines.join('\n');
}

/** Build the Hansei polish callable. The scheduler invokes this
 *  after `buildDailyReflection`; failure → scheduler logs +
 *  degrades to a raw-counts push body. */
export function createDailyReflectionPolishCallable(
  opts: FactoryOpts = {},
): DailyReflectionPolishCallable {
  const llm = opts.llm ?? streamLLM;
  const prompt = opts.prompt ?? DEFAULT_PROMPT;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const resolveProvider = opts.resolveProvider;

  return async ({ snapshot }) => {
    if (!isDailyReflectionPolishAvailable(resolveProvider ? { resolveProvider } : {})) {
      throw new Error('reflection_polish_unavailable: default LLM provider not available');
    }
    const userText = `${prompt}\n\n=== 오늘의 데이터 ===\n${snapshotAsContext(snapshot)}`;
    const messages: LLMMessage[] = [
      { role: 'user', content: userText },
    ];
    const polished = await llm(messages, () => { /* final string only */ }, {
      maxTokens,
    });
    if (!polished || polished.trim().length === 0) {
      throw new Error('reflection_polish_empty: LLM returned no content');
    }
    return polished.trim();
  };
}
