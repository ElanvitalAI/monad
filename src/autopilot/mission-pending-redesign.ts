// ── 미션 pending redesign 슬롯 (CC3·역제안 수용 실처리·2026-07-20) ──
//
// 골분해가 "골 리디자인 역제안"(이질 관심사 미션 경계 재구성 제안·A6-a)을 내면 그 텍스트를 이 슬롯에
// 저장한다. 대표가 "🔀 역제안 수용(재구성)" 버튼(CC2b·ux 경로)을 탭하면 콜백(mission-ux-live action)이
// 이 comment 를 reviseContext 로 재분해 재-spawn 한다. mission-pending-redecompose 패턴 미러 —
// 미션별 1슬롯·최신 우선·fail-soft(저장/조회 실패가 미션을 무차단).

import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { elanousStateRoot } from './state-paths.js';

/** 역제안 대기 슬롯 — comment(골 리디자인 역제안 텍스트·reviseContext 로 재분해). */
export interface PendingRedesign {
  comment: string;
  at?: string; // 저장 시각(ISO)
}

/** 미션별 pending redesign 슬롯 경로(pending-redecompose 옆·같은 safe-slug). */
export function pendingRedesignPath(missionId: string): string {
  const safe = (missionId || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80);
  return join(elanousStateRoot(), 'conatus/missions', safe, 'pending-redesign.json');
}

/** 조회 — 없거나 깨졌으면 null. 순수 조회. */
export function readPendingRedesign(missionId: string): PendingRedesign | null {
  try {
    const p = pendingRedesignPath(missionId);
    if (!existsSync(p)) return null;
    const o = JSON.parse(readFileSync(p, 'utf-8'));
    if (!o || typeof o !== 'object' || typeof o.comment !== 'string') return null;
    return { comment: o.comment, ...(o.at ? { at: String(o.at) } : {}) };
  } catch { return null; }
}

/** 카드 렌더 시 저장 — comment 갱신(최신 역제안). fail-soft. */
export function savePendingRedesign(missionId: string, comment: string, at?: string): void {
  try {
    const p = pendingRedesignPath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ comment, at: at ?? new Date().toISOString() }));
  } catch { /* fail-soft */ }
}

/** 슬롯 삭제(수용·취소 후). fail-soft. */
export function clearPendingRedesign(missionId: string): void {
  try {
    const p = pendingRedesignPath(missionId);
    if (existsSync(p)) rmSync(p);
  } catch { /* fail-soft */ }
}
