// ── 게시물 라이프사이클 GC — 만료 시 삭제 아닌 콜드 백업 (대표 2026-07-23) ──────────────
//
// SECURITY-external-publishing-tailscale-s3 §4. 기본 라이프사이클(1년) 만료 게시물을 **삭제하지 않고**
// S3 콜드(Glacier)로 이관(백업)한다 → 콜드리드 가능. 영구보존(permanent)은 far-future expiresAt 라
// 만료 판정에 안 걸려 자동 제외. 로컬 hot 디스크는 이관 후 정리(누적 방지). 순수-ish(archive/store 주입).

import type { StoredDocument } from './artifact-store.js';

export interface PublishLifecycleStore {
  list(): readonly StoredDocument[];
  delete(id: string): void;
}

export interface PublishLifecycleDeps {
  store: PublishLifecycleStore;
  /** S3 hot→cold(Glacier) 이관(백업·삭제 아님). 콜드리드는 Glacier restore. 실패 시 throw(해당 id skip). */
  archiveToS3Cold: (id: string) => void;
  now?: () => number;
}

export interface PruneSummary {
  /** 콜드 백업 + 로컬 정리된 만료 게시물 id. */
  archived: string[];
  /** 아직 유효(만료 전·permanent 포함) — 보존. */
  kept: number;
  /** 이관 실패(다음 회차 재시도). */
  errors: Array<{ id: string; error: string }>;
}

/** ★ 만료 게시물 콜드 백업 GC(순수-ish). 만료(now ≥ expiresAt) & non-permanent 게시물을 S3 콜드로 이관 후
 *  로컬 hot 정리. permanent(far-future expiresAt)는 만료 판정 미해당 → 자동 보존. 크론(elanous schedule)이 호출. */
export function pruneExpiredPublications(deps: PublishLifecycleDeps): PruneSummary {
  const now = deps.now?.() ?? Date.now();
  const archived: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];
  let kept = 0;
  for (const doc of deps.store.list()) {
    const exp = Date.parse(doc.manifest.expiresAt);
    const expired = Number.isFinite(exp) && now >= exp; // permanent = 9999 far-future → 여기 false → 보존
    if (!expired) { kept++; continue; }
    try {
      deps.archiveToS3Cold(doc.id); // 백업(삭제 아님) — 콜드리드 가능
      deps.store.delete(doc.id);    // 로컬 hot 정리(콜드가 백업)
      archived.push(doc.id);
    } catch (e) {
      errors.push({ id: doc.id, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
    }
  }
  return { archived, kept, errors };
}
