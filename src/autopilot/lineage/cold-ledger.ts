// ── Lineage cold ledger — 미션 스냅샷 스키마 + 바인딩 (C2 승격 후 · 2026-07-20) ───────────
//
// ★ RFC-coordinator-loop-template-lineage-historian §3f. cancel-purge 는 미션 행을 삭제하는데,
//   행 안의 ① 세대 아카이브(rerunHistory)가 함께 증발한다(확립 원칙 "삭제 아닌 보관" 위반).
//   purge 직전 이력을 **config-dir cold ledger**(never prune) 스냅샷 → 행을 지워도 self-recall 로 도달.
//
// ★ 제네릭 냉동보관 코어(coldLedgerPath/writeColdSnapshot/read/has)는 공용 중립층
//   `src/agent-substrate/cold-ledger.ts` 로 승격(DESIGN §16 C2). 여기엔 **미션 스냅샷 스키마**
//   (ColdLineageSnapshot·RerunGenerationSnapshot)와 kind='lineage-cold' 바인딩만. 기존 import 처 무접촉
//   (시그니처·심볼 보존).
//
// 위치: <configDir>/archive/lineage-cold/<safeId>/snapshot.json.

import type { RerunGenerationSnapshot } from '../../task-orchestrator/mission.js';
import {
  coldLedgerPath as coldLedgerPathG,
  coldFilesDir as coldFilesDirG,
  writeColdSnapshot as writeColdSnapshotG,
  readColdSnapshot as readColdSnapshotG,
  hasColdSnapshot as hasColdSnapshotG,
} from '../../agent-substrate/cold-ledger.js';

/** 미션 lineage 냉동보관 archive 네임스페이스. */
const KIND = 'lineage-cold';

export interface ColdLineageSnapshot {
  missionId: string;
  /** 냉동보관 계기 — 'cancel-purge' 등. */
  reason: string;
  /** 보관 시각(ISO). */
  archivedAt: string;
  goal?: string;
  currentGeneration?: number;
  /** ① 세대 아카이브 전체(purge 로 증발할 rerunHistory). */
  revisions: RerunGenerationSnapshot[];
  /** ② 워킹메모리 라이브 엔트리 수(풀 히스토리는 config-dir archive 에 상주 — 여기엔 도달 표식만). */
  workingMemoryCount: number;
}

/** 미션 냉동보관 스냅샷 경로(lineage-cold 바인딩). */
export function coldLedgerPath(missionId: string): string {
  return coldLedgerPathG(missionId, KIND);
}

/** 냉동보관 파일 디렉토리(H3) — cancel-purge 시 고아 파일을 여기로 move. */
export function coldFilesDir(missionId: string): string {
  return coldFilesDirG(missionId, KIND);
}

/** 미션 냉동보관 스냅샷 저장(never prune·덮어씀). fail-soft. */
export function writeColdSnapshot(snap: ColdLineageSnapshot): void {
  writeColdSnapshotG(snap.missionId, KIND, snap);
}

/** 미션 냉동보관 스냅샷 읽기(purge 후 self-recall·history 도달). 없으면 null. fail-soft. */
export function readColdSnapshot(missionId: string): ColdLineageSnapshot | null {
  return readColdSnapshotG<ColdLineageSnapshot>(missionId, KIND);
}

export function hasColdSnapshot(missionId: string): boolean {
  return hasColdSnapshotG(missionId, KIND);
}
