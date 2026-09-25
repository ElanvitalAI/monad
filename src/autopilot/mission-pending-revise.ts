// ── 미션 pending revise 초안 저장(원탭 승인 게이트 · 대표 2026-07-14) ──────────
//
// 자율 revise 는 "추천 생성(DECIDE) -> 원탭 승인(HITL) -> 트리거(ACT)"다. 추천으로 만든
// 정정 지시(comment)는 텔레그램 callback_data 64byte 에 담을 수 없어(길다), 카드를 띄우는
// 시점에 여기 미션별 1슬롯으로 저장하고, 승인 탭이 오면 읽어서 집행한다. 최신 초안이
// 이전 것을 덮는다(단일 슬롯). fail-soft — 저장/조회 실패가 미션을 막지 않는다.

import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { monadStateRoot } from './state-paths.js';

/** 승인 대기 중인 revise 초안 — recommender 가 생성. 승인 탭이 comment 를 집행. */
export interface PendingRevise {
  comment: string;
  reviseKind: string;
  rationale: string;
  confidence: string;
  /** 생성 출처(추천 계보) — 'llm' | 'heuristic'. */
  source: string;
  /** 저장 시각(ISO) — 호출측이 결정론 주입 가능(테스트). 미지정 시 현재. */
  at?: string;
}

/** 미션별 pending revise 슬롯 경로(working-memory 옆·같은 safe-slug 규칙). */
export function pendingRevisePath(missionId: string): string {
  const safe = (missionId || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80);
  return join(monadStateRoot(), 'conatus/missions', safe, 'pending-revise.json');
}

/** 초안 저장(단일 슬롯·최신 우선). fail-soft. */
export function savePendingRevise(missionId: string, draft: PendingRevise): void {
  try {
    const p = pendingRevisePath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...draft, at: draft.at ?? new Date().toISOString() }));
  } catch { /* fail-soft */ }
}

/** 초안 조회 — 없거나 깨졌으면 null. 순수 조회(부작용 0). */
export function readPendingRevise(missionId: string): PendingRevise | null {
  try {
    const p = pendingRevisePath(missionId);
    if (!existsSync(p)) return null;
    const o = JSON.parse(readFileSync(p, 'utf-8'));
    if (!o || typeof o !== 'object' || typeof o.comment !== 'string' || !o.comment.trim()) return null;
    return {
      comment: String(o.comment),
      reviseKind: String(o.reviseKind ?? 'revise-custom'),
      rationale: String(o.rationale ?? ''),
      confidence: String(o.confidence ?? 'low'),
      source: String(o.source ?? 'heuristic'),
      ...(o.at ? { at: String(o.at) } : {}),
    };
  } catch { return null; }
}

/** 초안 삭제(승인·취소·집행 후). fail-soft. */
export function clearPendingRevise(missionId: string): void {
  try {
    const p = pendingRevisePath(missionId);
    if (existsSync(p)) rmSync(p);
  } catch { /* fail-soft */ }
}
