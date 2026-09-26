// Cold ledger — 냉동보관 durable 스냅샷 스토어 (공용·중립 · 2026-07-20 C2 승격).
//
// 원본: src/autopilot/lineage/cold-ledger.ts(H2 lineage). 핵심 패턴 = "삭제 아닌 보관" — 라이브 행/run 이
// 사라져도(cancel-purge·run 완료) 그 직전 이력을 **never-prune config-dir archive** 에 JSON 스냅샷으로 남겨
// 나중에 도달(self-recall·history). fail-soft·비파괴.
//
// ★ 이 모듈은 **도메인-무관 제네릭 코어**만 담는다(DESIGN §16 C2). `kind` 가 archive 네임스페이스
//   (미션='lineage-cold' · 하니스='harness-run' 등)·스냅샷 타입은 제네릭 <T>. 미션 스냅샷 스키마
//   (ColdLineageSnapshot·RerunGenerationSnapshot)는 autopilot 잔류. 스몰-폼 하니스가 run 히스토리 보관에 재사용(§15b).
//
// 위치: <configDir>/archive/<kind>/<safeId>/snapshot.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getElanousConfigDir } from '../elanous-config-dir.js';

function safeSlug(id: string): string {
  return (id || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80);
}

/** 냉동보관 스냅샷 경로. `kind` 가 archive 네임스페이스. */
export function coldLedgerPath(id: string, kind: string): string {
  return join(getElanousConfigDir(), 'archive', kind, safeSlug(id), 'snapshot.json');
}

/** 냉동보관 파일 디렉토리 — 고아 파일(run-lock·state 등)을 여기로 move. */
export function coldFilesDir(id: string, kind: string): string {
  return join(getElanousConfigDir(), 'archive', kind, safeSlug(id), 'files');
}

/** 냉동보관 스냅샷 저장(never prune·덮어씀). fail-soft — 보관 실패가 상위 작업을 막지 않음. */
export function writeColdSnapshot<T>(id: string, kind: string, snap: T): void {
  try {
    const p = coldLedgerPath(id, kind);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(snap));
  } catch { /* fail-soft */ }
}

/** 냉동보관 스냅샷 읽기(purge 후 도달). 없으면 null. fail-soft. */
export function readColdSnapshot<T>(id: string, kind: string): T | null {
  try {
    const p = coldLedgerPath(id, kind);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch { return null; }
}

/** 냉동보관 스냅샷 존재 여부. */
export function hasColdSnapshot(id: string, kind: string): boolean {
  return existsSync(coldLedgerPath(id, kind));
}

/** kind 아래 모든 스냅샷 id(safeSlug 된 dir 명) 나열 — 검색/집계 소스용. 없으면 []. fail-soft. */
export function listColdSnapshotIds(kind: string): string[] {
  try {
    const base = join(getElanousConfigDir(), 'archive', kind);
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }
}
