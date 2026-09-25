// ── 로컬 LLM 벤치마크 · 스코어카드 렌더링 (2026-07-15) ────────────────────────────
//
// 대표 요약 포맷 이식: 총점/영역별/문항별 + 순위 테이블. 순수 문자열 — CLI·로그·미션 카드 공용.

import type { Scorecard } from './runner.js';
import { RUBRIC_VERSION } from './tasks.js';

const BAR = '━'.repeat(30);

/** 단일 모델 스코어카드를 사람이 읽는 블록으로. */
export function formatScorecard(sc: Scorecard): string {
  const c = sc.byCategory;
  const lines: string[] = [];
  lines.push(`📊 ${sc.target.node}:${sc.target.model} — 총점 ${sc.total}/${sc.max}${sc.saturated ? ' ⚠️포화(변별불가·harder tier 필요)' : ''}`);
  lines.push(
    `  🧑‍💻 코딩 ${c.coding.score}/${c.coding.max} · 🧠 추론 ${c.reasoning.score}/${c.reasoning.max} · `
    + `📚 RAG ${c.rag.score}/${c.rag.max} · 🇰🇷 형식 ${c['kr-format'].score}/${c['kr-format'].max}`,
  );
  lines.push(`  ⏱️ 워밍업 ${(sc.warmupMs / 1000).toFixed(2)}초 · 전체 ${(sc.totalMs / 1000).toFixed(1)}초${sc.tokPerSec !== undefined ? ` · 🚀 ${sc.tokPerSec.toFixed(1)} tok/s` : ''}`);
  for (const t of sc.tasks) {
    const mark = t.errored ? '⚠️' : t.score === t.max ? '✅' : t.score === 0 ? '❌' : '🟡';
    lines.push(`  ${mark} ${t.id}: ${t.score}/${t.max} — ${t.detail} (${(t.latencyMs / 1000).toFixed(1)}s)`);
  }
  return lines.join('\n');
}

/** 여러 스코어카드를 총점 내림차순 순위 테이블로(대표 최종 순위 포맷). */
export function formatRanking(cards: readonly Scorecard[]): string {
  const sorted = [...cards].sort((a, b) => b.total - a.total);
  const medals = ['🥇', '🥈', '🥉'];
  const lines: string[] = [`🏆 로컬 LLM 벤치 순위 (${sorted.length}종 · 100점)`, BAR];
  sorted.forEach((sc, i) => {
    const c = sc.byCategory;
    const rank = medals[i] ?? `${i + 1}위`;
    lines.push(
      `${rank} ${sc.target.node}:${sc.target.model} — ${sc.total}/${sc.max}`
      + `  (코딩 ${c.coding.score} · 추론 ${c.reasoning.score} · RAG ${c.rag.score} · 형식 ${c['kr-format'].score}`
      + `${sc.tokPerSec !== undefined ? ` · ${sc.tokPerSec.toFixed(0)} tok/s` : ''}`
      + ` · 워밍업 ${(sc.warmupMs / 1000).toFixed(1)}s)`,
    );
  });
  lines.push(BAR);
  return lines.join('\n');
}

/** 스코어카드 → JSONL 한 줄(스토어·로그 영속용). 결정론. */
export function scorecardToRecord(sc: Scorecard, at: string): Record<string, unknown> {
  return {
    at,
    rubricVersion: RUBRIC_VERSION,
    node: sc.target.node,
    model: sc.target.model,
    endpoint: sc.target.endpoint,
    total: sc.total,
    max: sc.max,
    coding: sc.byCategory.coding.score,
    reasoning: sc.byCategory.reasoning.score,
    rag: sc.byCategory.rag.score,
    krFormat: sc.byCategory['kr-format'].score,
    warmupMs: sc.warmupMs,
    totalMs: sc.totalMs,
    saturated: sc.saturated,
    ...(sc.tokPerSec !== undefined ? { tokPerSec: Math.round(sc.tokPerSec), totalCompletionTokens: sc.totalCompletionTokens } : {}),
    tasks: sc.tasks.map((t) => ({ id: t.id, score: t.score, max: t.max })),
  };
}
