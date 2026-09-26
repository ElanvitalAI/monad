// ── Historian — 미션 이력 냉동보관 오케스트레이션 (H2 · 2026-07-20) ──────────
//
// ★ RFC-coordinator-loop-template-lineage-historian §3f. 조율자가 intent(cancel-purge)만 선언하면
//   Historian 이 "이력을 어떻게 보관하나"를 소유 — purge 직전 ① 세대 아카이브를 cold ledger 로 이관.
//   결정론·조율자 무관. 순환 import 회피 위해 mission-lifecycle 는 동적 import. 전부 fail-soft.

import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { debug } from '../../debug/log.js';
import { coldFilesDir, writeColdSnapshot, type ColdLineageSnapshot } from './cold-ledger.js';

/** 파일/디렉토리 1건을 cold files 디렉토리로 move(basename 보존). 없으면 skip. fail-soft→false. */
function moveToCold(src: string, destDir: string): boolean {
  try {
    if (!existsSync(src)) return false;
    mkdirSync(destDir, { recursive: true });
    renameSync(src, join(destDir, basename(src)));
    return true;
  } catch { return false; } // 크로스-fs/레이스 등 — 고아로 남더라도 cancel 은 막지 않음
}

/** ★ H3 — cancel-purge 시 ③④⑤·run-lock·state.json 고아 파일을 cold files 디렉토리로 move(냉동보관·
 *  live 경로 청소). 경로 슬러그가 모듈마다 달라 exported 헬퍼를 직접 사용(재구현 금지). fail-soft.
 *  반환 = move 한 항목 수. (② 워킹메모리 라이브 파일은 conatus/missions 디렉토리째 이동에 포함.) */
export async function coldArchiveMissionFiles(missionId: string): Promise<{ moved: number }> {
  const destDir = coldFilesDir(missionId);
  let moved = 0;
  try {
    // ⑤ 캐시 + ② 라이브 워킹메모리 = conatus/missions/<slug>/ 디렉토리째(캐시 경로의 부모).
    try {
      const { groundingCachePath } = await import('../mission-grounding-cache.js');
      const missionDir = join(groundingCachePath(missionId), '..');
      if (moveToCold(missionDir, join(destDir, 'missions'))) moved++;
    } catch { /* fail-soft */ }
    // ③④ 빌드/실행 프레임 + state.json + LLM sidecar = frameDir 내 <safeId> 접두 파일 전부.
    try {
      const { framePath, frameDir } = await import('../pipeline/frame-journal.js');
      const dir = frameDir();
      const prefix = basename(framePath(missionId)).replace(/\.jsonl$/, ''); // safeId
      if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
          if (f === prefix + '.jsonl' || f.startsWith(prefix + '.')) {
            if (moveToCold(join(dir, f), join(destDir, 'frames'))) moved++;
          }
        }
      }
    } catch { /* fail-soft */ }
    // run-lock.
    try {
      const { runLockPath } = await import('../mission-run-lock.js');
      if (moveToCold(runLockPath(missionId), destDir)) moved++;
    } catch { /* fail-soft */ }
  } catch { /* fail-soft */ }
  return { moved };
}

/** cancel-purge 직전 호출 — 행 삭제로 증발할 ① 세대 아카이브를 cold ledger 로 냉동보관.
 *  (② 워킹메모리는 U2.5 로 이미 config-dir archive 상주 — 여기선 라이브 count 만 표식.)
 *  반환 = 보관한 세대 수(0=이력 없음). fail-soft(보관 실패가 cancel 을 절대 막지 않음). */
export async function archiveMissionLineageOnCancel(missionId: string, reason: string): Promise<{ archived: number; moved: number }> {
  let archived = 0;
  try {
    // ① 세대 아카이브 스냅샷(행 삭제로 증발) — 파일 move 前에 라이브 워킹메모리 count 를 읽는다(move 후엔 사라짐).
    const { getMissionRevisions } = await import('../mission-lifecycle.js');
    const rev = getMissionRevisions(missionId);
    if (rev) {
      let wmCount = 0;
      try { const { readWorkingMemory } = await import('../mission-working-memory.js'); wmCount = readWorkingMemory(missionId).length; } catch { /* fail-soft */ }
      const snap: ColdLineageSnapshot = {
        missionId, reason, archivedAt: new Date().toISOString(),
        ...(rev.currentGoal ? { goal: rev.currentGoal } : {}),
        currentGeneration: rev.currentGeneration,
        revisions: rev.history,
        workingMemoryCount: wmCount,
      };
      writeColdSnapshot(snap);
      archived = rev.history.length;
    }
  } catch (err) {
    try { debug.log('mission.lineage', 'cold-archive.error', { missionId, reason, error: err instanceof Error ? err.message : String(err) }, { level: 'error' }); } catch { /* fail-soft */ }
  }
  // ③④⑤·run-lock·state.json 고아 파일 move(H3) — 스냅샷 성공 여부와 무관하게 청소.
  const { moved } = await coldArchiveMissionFiles(missionId);
  // ★ 제1원칙 관측(자기인지) — "언제·무엇을·왜 냉동보관했나". elanous logs --category mission.lineage 로 회상.
  try { debug.log('mission.lineage', 'cold-archive', { missionId, reason, revisions: archived, movedFiles: moved }); } catch { /* fail-soft */ }
  return { archived, moved };
}
