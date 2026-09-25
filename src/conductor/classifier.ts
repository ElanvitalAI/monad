// ── PFC-S2 generalization: goalKind classifier ──
//
// 3-tier classification:
//   1. Heuristic — keyword regex table (weighted 3/1, 한/영 dual).
//   2. LLM fallback — caller-provided async classifier (haiku-sized).
//   3. `force_kind` override — operator can bypass both tiers.
//
// Keyword table lives in this file (see HEURISTIC_TABLE). Add entries
// by appending to the relevant kind; update PFC-CONDUCTOR-FIRST-DOGFOOD
// §3 in sync.

import {
  GOAL_KINDS,
  type ClassifyInput,
  type ClassifyResult,
  type GoalKind,
  type HeuristicTable,
  type KeywordEntry,
  type LLMClassifyResult,
} from './types.js';

// ── Thresholds ─────────────────────────────────────────────────────────

export const MIN_SCORE = 3;
export const MIN_CONFIDENCE = 0.3;
export const DEFAULT_FALLBACK_KIND: GoalKind = 'research';

// ── Keyword table — first dogfood bootstrap (한/영 dual) ───────────────

export const HEURISTIC_TABLE: HeuristicTable = {
  research: [
    { pattern: '분석', weight: 3 },
    { pattern: 'research', weight: 3 },
    { pattern: 'analyze', weight: 3 },
    { pattern: 'survey', weight: 3 },
    { pattern: 'executive\\s+summary', weight: 3 },
    { pattern: '리포트', weight: 3 },
    { pattern: 'report', weight: 3 },
    { pattern: '시장\\s*전망', weight: 3 },
    { pattern: 'forecast', weight: 3 },
    { pattern: '합성', weight: 3 },
    { pattern: 'synthesis', weight: 3 },
    { pattern: '정리', weight: 1 },
    { pattern: 'summary', weight: 1 },
    { pattern: '찾아', weight: 1 },
    { pattern: 'lookup', weight: 1 },
    { pattern: '논문', weight: 1 },
    { pattern: 'paper', weight: 1 },
    { pattern: '동향', weight: 1 },
    { pattern: 'trend', weight: 1 },
  ],
  coding: [
    { pattern: '구현', weight: 3 },
    { pattern: 'implement', weight: 3 },
    { pattern: '만들어', weight: 3 },
    { pattern: 'build', weight: 3 },
    { pattern: '코드\\s*(작성|추가|만들)?', weight: 3 },
    { pattern: '\\bcode\\b', weight: 3 },
    { pattern: '\\bPR\\b', weight: 3 },
    { pattern: 'commit', weight: 3 },
    { pattern: '함수', weight: 3 },
    { pattern: 'function', weight: 3 },
    { pattern: '모듈', weight: 3 },
    { pattern: 'module', weight: 3 },
    { pattern: '새로운?\\s*기능', weight: 3 },
    { pattern: '\\badd\\b', weight: 1 },
    { pattern: '추가', weight: 1 },
    { pattern: '붙여', weight: 1 },
    { pattern: 'wire', weight: 1 },
    { pattern: 'hook\\s*up', weight: 1 },
    { pattern: '버그', weight: 1 },
    { pattern: '\\bbug\\b', weight: 1 },
    { pattern: '고쳐', weight: 1 },
    { pattern: '\\bfix\\b', weight: 1 },
  ],
  analysis: [
    { pattern: '판단', weight: 3 },
    { pattern: 'decide', weight: 3 },
    { pattern: '추천', weight: 3 },
    { pattern: 'recommend', weight: 3 },
    { pattern: '평가', weight: 3 },
    { pattern: 'evaluate', weight: 3 },
    { pattern: '옵션', weight: 3 },
    { pattern: 'option', weight: 3 },
    { pattern: 'trade-off', weight: 3 },
    { pattern: 'consensus', weight: 3 },
    { pattern: '비교', weight: 3 },
    { pattern: 'compare', weight: 3 },
    { pattern: '타당성', weight: 3 },
    { pattern: '생각', weight: 1 },
    { pattern: 'thought', weight: 1 },
    { pattern: '의견', weight: 1 },
    { pattern: 'opinion', weight: 1 },
    { pattern: '검토', weight: 1 },
    { pattern: 'review', weight: 1 },
  ],
  monitoring: [
    { pattern: '주기', weight: 3 },
    { pattern: 'cron', weight: 3 },
    { pattern: 'every\\s+\\d', weight: 3 },
    { pattern: 'schedule', weight: 3 },
    { pattern: '정기', weight: 3 },
    { pattern: 'periodic', weight: 3 },
    { pattern: '매일', weight: 3 },
    { pattern: 'daily', weight: 3 },
    { pattern: '매주', weight: 3 },
    { pattern: 'weekly', weight: 3 },
    { pattern: 'alert', weight: 3 },
    { pattern: '알림', weight: 3 },
    { pattern: 'notify', weight: 3 },
    { pattern: '\\bwatch\\b', weight: 3 },
    { pattern: '체크', weight: 1 },
    { pattern: '\\bcheck\\b', weight: 1 },
    { pattern: '모니터', weight: 1 },
    { pattern: 'monitor', weight: 1 },
    { pattern: '지켜', weight: 1 },
  ],
  refactor: [
    { pattern: '리팩터', weight: 3 },
    { pattern: 'refactor', weight: 3 },
    { pattern: '재구조', weight: 3 },
    { pattern: 'restructure', weight: 3 },
    { pattern: 'cleanup', weight: 3 },
    { pattern: '이관', weight: 3 },
    { pattern: 'migrate', weight: 3 },
    { pattern: '분리', weight: 3 },
    { pattern: '\\bsplit\\b', weight: 3 },
    { pattern: '표준화', weight: 3 },
    { pattern: 'normalize', weight: 3 },
    { pattern: '정렬', weight: 1 },
    { pattern: 'order', weight: 1 },
    { pattern: '구조', weight: 1 },
    { pattern: 'structure', weight: 1 },
    { pattern: 'naming', weight: 1 },
  ],
};

// ── Score computation ──────────────────────────────────────────────────

export function scoreIntake(
  raw: string,
  table: HeuristicTable = HEURISTIC_TABLE,
): {
  scores: Record<GoalKind, number>;
  hits: Record<GoalKind, number>;
} {
  const scores: Record<GoalKind, number> = {
    research: 0, coding: 0, analysis: 0, monitoring: 0, refactor: 0,
  };
  const hits: Record<GoalKind, number> = {
    research: 0, coding: 0, analysis: 0, monitoring: 0, refactor: 0,
  };
  const lower = raw.toLowerCase();
  for (const kind of GOAL_KINDS) {
    for (const entry of table[kind]) {
      const re = new RegExp(entry.pattern, 'i');
      if (re.test(lower)) {
        scores[kind] += entry.weight;
        hits[kind] += 1;
      }
    }
  }
  return { scores, hits };
}

// ── Top + margin ───────────────────────────────────────────────────────

function argmaxWithRunnerUp(
  scores: Record<GoalKind, number>,
): { top: GoalKind; topScore: number; secondScore: number } {
  let top: GoalKind = 'research';
  let topScore = -1;
  let secondScore = -1;
  for (const kind of GOAL_KINDS) {
    const s = scores[kind];
    if (s > topScore) {
      secondScore = topScore;
      topScore = s;
      top = kind;
    } else if (s > secondScore) {
      secondScore = s;
    }
  }
  return { top, topScore, secondScore: Math.max(0, secondScore) };
}

function confidence(topScore: number, secondScore: number): number {
  if (topScore <= 0) return 0;
  return (topScore - secondScore) / topScore;
}

// ── classify() — main entrypoint ───────────────────────────────────────

export async function classify(input: ClassifyInput): Promise<ClassifyResult> {
  const table = input.heuristicTable ?? HEURISTIC_TABLE;
  const raw = input.intake.raw ?? '';

  // Step 1 — operator override short-circuit.
  if (input.force_kind) {
    const { scores, hits } = scoreIntake(raw, table);
    return {
      kind: input.force_kind,
      confidence: 1.0,
      classifier: 'user-override',
      keywordHits: hits,
      scores,
    };
  }

  // Step 2 — heuristic.
  const { scores, hits } = scoreIntake(raw, table);
  const { top, topScore, secondScore } = argmaxWithRunnerUp(scores);
  const conf = confidence(topScore, secondScore);

  if (topScore >= MIN_SCORE && conf >= MIN_CONFIDENCE) {
    return {
      kind: top,
      confidence: Math.min(1, conf),
      classifier: 'heuristic',
      keywordHits: hits,
      scores,
    };
  }

  // Step 3 — LLM fallback.
  if (input.llmFallback) {
    let llmOut: LLMClassifyResult | null = null;
    try {
      llmOut = await input.llmFallback(input.intake);
    } catch {
      /* swallow — fall through to DEFAULT */
    }
    if (llmOut && llmOut.kind !== 'ambiguous') {
      return {
        kind: llmOut.kind,
        confidence: Math.max(0, Math.min(1, llmOut.confidence)),
        classifier: 'llm',
        keywordHits: hits,
        scores,
        ...(llmOut.reason ? { reason: llmOut.reason } : {}),
      };
    }
  }

  // Step 4 — fallback to research (safest default; `research` adapter is
  // the only fully-implemented path).
  return {
    kind: DEFAULT_FALLBACK_KIND,
    confidence: 0,
    classifier: 'fallback',
    keywordHits: hits,
    scores,
    notices: [
      topScore < MIN_SCORE
        ? `heuristic score too low (${topScore} < ${MIN_SCORE})`
        : `margin too tight (confidence ${conf.toFixed(2)} < ${MIN_CONFIDENCE})`,
      'no LLM fallback matched — defaulting to research',
    ],
  };
}

/** Pure helper for tests / debugging. */
export { argmaxWithRunnerUp, confidence };

/** Re-export kind (Type-only imports are silently dropped if unused. */
export type { KeywordEntry };
