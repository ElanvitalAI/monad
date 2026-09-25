// ── 미션 pending clarify 저장(Intake Q&A 블로킹 게이트 · RFC-mission-intake-qa-agent) ──
//
// clarify 흐름은 "질문 생성(첫 spawn) → 옵션 카드 발송 → 대표 탭 수집 → 답변 fold → 재-spawn 분해".
// 첫 spawn 과 콜백 재-spawn 사이에 질문/답변을 보관할 슬롯이 필요하다(mission-pending-revise 패턴).
// 미션별 1슬롯·최신 우선·fail-soft(저장/조회 실패가 미션을 막지 않음).

import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { monadStateRoot } from './state-paths.js';
import type { IntakeClarification } from './mission-intake-clarify.js';

/** 답변 수집 중인 clarify 세트 — 첫 spawn 이 저장, 콜백이 answer 채움, 완료 시 재-spawn 후 삭제. */
export interface PendingClarify {
  clarifications: IntakeClarification[];
  /** "이대로 진행" control 메시지 id — finalize 가 이 메시지를 "✅ 확정"으로 편집(I3c). */
  controlMessageId?: number;
  at?: string; // 저장 시각(ISO) — 테스트 결정론 주입 가능. 미지정 시 현재.
  // ── 2단계 되묻기(RFC P3·2026-07-17) — 없으면 레거시 단일턴(비파괴 폴백). ──
  /** 현재 단계 — 1=범위확정(scope/term/safety), 2=아크(확정 범위 반영). 미지정=단일턴. */
  stage?: 1 | 2;
  /** 골 원문 — stage1 완료 시 콜백이 arc judge 를 재호출(analyzeGoalAmbiguity phase='arc')하는 데 필요. */
  goal?: string;
  /** heavy 미션인가 — stage1 완료 후 arc 단계(stage2)로 전이할지 판단(light=arc 무의미·바로 finalize). */
  heavy?: boolean;
  /** stage2 일 때 stage1 확정 답변 — finalize 가 priorAnswers + stage2 답을 합쳐 전체 설계 fold. */
  priorAnswers?: IntakeClarification[];
  /** ★ 자유 피드백 재투입 횟수(RFC P4·예산 MAX 2·무한 교정 방지). 미지정=0. */
  refineCount?: number;
}

/** 미션별 pending clarify 슬롯 경로(pending-revise 옆·같은 safe-slug 규칙). */
export function pendingClarifyPath(missionId: string): string {
  const safe = (missionId || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80);
  return join(monadStateRoot(), 'conatus/missions', safe, 'pending-clarify.json');
}

/** clarify 세트 저장(단일 슬롯·최신 우선). fail-soft. */
export function savePendingClarify(missionId: string, pending: PendingClarify): void {
  try {
    const p = pendingClarifyPath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...pending, at: pending.at ?? new Date().toISOString() }));
  } catch { /* fail-soft */ }
}

/** clarify 세트 조회 — 없거나 깨졌으면 null. 순수 조회. */
export function readPendingClarify(missionId: string): PendingClarify | null {
  try {
    const p = pendingClarifyPath(missionId);
    if (!existsSync(p)) return null;
    const o = JSON.parse(readFileSync(p, 'utf-8'));
    if (!o || typeof o !== 'object' || !Array.isArray(o.clarifications)) return null;
    return {
      clarifications: o.clarifications as IntakeClarification[],
      ...(typeof o.controlMessageId === 'number' ? { controlMessageId: o.controlMessageId } : {}),
      ...(o.at ? { at: String(o.at) } : {}),
      ...(o.stage === 1 || o.stage === 2 ? { stage: o.stage as 1 | 2 } : {}),
      ...(typeof o.goal === 'string' ? { goal: o.goal } : {}),
      ...(typeof o.heavy === 'boolean' ? { heavy: o.heavy } : {}),
      ...(Array.isArray(o.priorAnswers) ? { priorAnswers: o.priorAnswers as IntakeClarification[] } : {}),
      ...(typeof o.refineCount === 'number' ? { refineCount: o.refineCount } : {}),
    };
  } catch { return null; }
}

/** control(진행) 메시지 id 기록 — 첫 spawn 이 카드 발송 후 저장(finalize 가 이 메시지를 편집). fail-soft. */
export function setClarifyControlMessage(missionId: string, controlMessageId: number): void {
  const pending = readPendingClarify(missionId);
  if (!pending) return;
  savePendingClarify(missionId, { ...pending, controlMessageId });
}

/** clarify 세트 삭제(재-spawn·취소 후). fail-soft. */
export function clearPendingClarify(missionId: string): void {
  try {
    const p = pendingClarifyPath(missionId);
    if (existsSync(p)) rmSync(p);
  } catch { /* fail-soft */ }
}

/** 답변 1건 기록 — questionId 매칭 옵션 라벨을 answer 로 채운다. 저장 후 갱신된 세트 반환(없으면 null).
 *  optIdx 범위 밖이면 무시(방어). fail-soft. */
export function recordClarifyAnswer(
  missionId: string, questionId: string, optIdx: number,
): PendingClarify | null {
  const pending = readPendingClarify(missionId);
  if (!pending) return null;
  const q = pending.clarifications.find((c) => c.questionId === questionId);
  if (!q) return null;
  const opt = q.options[optIdx];
  if (!opt) return pending; // 범위 밖 — 무변경(방어)
  q.answer = opt.label;
  savePendingClarify(missionId, pending);
  return pending;
}
