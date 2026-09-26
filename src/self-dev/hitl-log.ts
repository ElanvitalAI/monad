/**
 * HITL 로그 (G7 · 1d — 회고 + 패턴 학습).
 *
 * 무인 self-dev 루프에서 사람에게 올라가는 결정(escalation·parked 리뷰·수리 신호)과 그
 * 결정을 **두 곳에 남긴다**:
 *   ① logs.db 관측 — `elanous logs --category self-dev.hitl` 로 회고(언제 무슨 결정이
 *      올라왔고 무엇으로 결정됐나). 값싸고 상시.
 *   ② elanous 기억 — 반복되는 HITL 패턴(특히 system 수리 신호)을 self-awareness 에 주입해
 *      **패턴 학습**(다음엔 자동화 후보인지·러버스탬프였는지). significant 만.
 *
 * 북극성 HITL 철학(개수↓·품질↑)의 계측 기반 — 회고로 "이 HITL 이 진짜 결정이었나"를 본다.
 * Cf. [[ROADMAP-elanous-is-all-pty-unified-autonomy-2026-07-21]] G7·§0.
 */
import { debug } from '../debug/log.js';

export type HitlEventKind = 'escalation' | 'decision-surfaced' | 'decision-made';

export interface HitlEvent {
  kind: HitlEventKind;
  /** 무엇에 대한 HITL 인가 — 'repair-signals' | 'parked-review' | 'merge-conflict' | 'resume' | … */
  action: string;
  /** 실패/신호 패턴(있으면). */
  pattern?: string;
  feature?: string;
  /** 사람의 결정(알면) — 'resume' | 'abandon' | 'manual' | 'approve' | … */
  decision?: string;
  detail?: Record<string, unknown>;
}

/** ① logs.db 관측 — 회고 가능(`elanous logs --category self-dev.hitl`). fail-soft. */
export function recordHitlEvent(ev: HitlEvent): void {
  try {
    debug.log('self-dev.hitl', ev.kind, {
      action: ev.action,
      ...(ev.pattern ? { pattern: ev.pattern } : {}),
      ...(ev.feature ? { feature: ev.feature.slice(0, 80) } : {}),
      ...(ev.decision ? { decision: ev.decision } : {}),
      ...(ev.detail ?? {}),
    });
  } catch { /* fail-soft — 계측 실패가 루프를 막지 않게 */ }
}

/** injectSelfMemory 시그니처(주입 가능 seam·테스트 fake). */
export type SelfMemoryInject = (input: {
  tool: string; summary: string; kind?: string; refs?: Record<string, unknown>; importance?: number;
}) => Promise<unknown>;

/**
 * ② elanous 기억 주입 — 반복 HITL 패턴을 self-awareness 에 넣어 패턴 학습. significant
 * (system 수리 신호·중요 결정)만. fire-and-forget·fail-soft(기억 주입 실패가 루프 무영향).
 * inject 미주입 시 lazy import(prod)·테스트는 fake 주입.
 */
export async function recordHitlToMemory(
  summary: string,
  refs?: Record<string, unknown>,
  inject?: SelfMemoryInject,
): Promise<void> {
  try {
    const fn = inject ?? ((await import('../domains/self-awareness.js')).injectSelfMemory as unknown as SelfMemoryInject);
    await fn({
      tool: 'self-dev-loop',
      summary: `[HITL] ${summary}`,
      kind: 'change',
      importance: 5,
      ...(refs ? { refs } : {}),
    });
  } catch { /* fail-soft */ }
}
