// ── 미션 pending redecompose 슬롯(BC3 역방향 피드백 critique→decompose · 원탭 HITL) ──
//
// 흐름: se-mission-prepare 가 critique 치명을 잡으면 "🔁 자동 재분해" 버튼 카드를 띄우고, 재분해에
// 쓸 reviseContext(comment)와 지금까지의 탭 횟수(taps)를 이 슬롯에 저장한다. 대표가 탭하면 콜백이
// comment 로 재분해 재-spawn 하고 taps 를 올린다. 재-spawn 된 prepare 는 taps 를 보존(예산 유지).
// mission-pending-clarify 패턴 미러 — 미션별 1슬롯·최신 우선·fail-soft(저장/조회 실패가 미션 무차단).

import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { elanousStateRoot } from './state-paths.js';

/** 재분해 대기 슬롯 — comment(critique 반영 지시)·taps(누적 재분해 탭·예산). */
export interface PendingRedecompose {
  comment: string;
  taps: number;
  at?: string; // 저장 시각(ISO)
}

/** 미션별 pending redecompose 슬롯 경로(pending-clarify 옆·같은 safe-slug). */
export function pendingRedecomposePath(missionId: string): string {
  const safe = (missionId || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80);
  return join(elanousStateRoot(), 'conatus/missions', safe, 'pending-redecompose.json');
}

/** 조회 — 없거나 깨졌으면 null. 순수 조회. */
export function readPendingRedecompose(missionId: string): PendingRedecompose | null {
  try {
    const p = pendingRedecomposePath(missionId);
    if (!existsSync(p)) return null;
    const o = JSON.parse(readFileSync(p, 'utf-8'));
    if (!o || typeof o !== 'object' || typeof o.comment !== 'string') return null;
    return { comment: o.comment, taps: typeof o.taps === 'number' ? o.taps : 0, ...(o.at ? { at: String(o.at) } : {}) };
  } catch { return null; }
}

/** 지금까지 재분해 탭 횟수(슬롯 없으면 0). 예산 판정용. */
export function readRedecomposeTaps(missionId: string): number {
  return readPendingRedecompose(missionId)?.taps ?? 0;
}

/** 카드 렌더 시 저장 — comment 갱신, taps 는 보존(재-spawn 예산 유지). fail-soft. */
export function savePendingRedecompose(missionId: string, comment: string, at?: string): void {
  try {
    const taps = readRedecomposeTaps(missionId);
    const p = pendingRedecomposePath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ comment, taps, at: at ?? new Date().toISOString() }));
  } catch { /* fail-soft */ }
}

/** 탭 시 taps+1 후 갱신된 슬롯 반환(없으면 null). 예산 소진 판정은 호출측. fail-soft. */
export function bumpRedecomposeTaps(missionId: string, at?: string): PendingRedecompose | null {
  const cur = readPendingRedecompose(missionId);
  if (!cur) return null;
  const next: PendingRedecompose = { comment: cur.comment, taps: cur.taps + 1, at: at ?? new Date().toISOString() };
  try {
    const p = pendingRedecomposePath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(next));
  } catch { /* fail-soft */ }
  return next;
}

/** 슬롯 삭제(승인·취소 후). fail-soft. */
export function clearPendingRedecompose(missionId: string): void {
  try {
    const p = pendingRedecomposePath(missionId);
    if (existsSync(p)) rmSync(p);
  } catch { /* fail-soft */ }
}
