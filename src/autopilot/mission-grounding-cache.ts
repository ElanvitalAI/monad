// ── grounding/research 조사 데이터 캐시 (대표 2026-07-20) ─────────────────────────
//
// 매 재분해마다 research(omni-crawl 딥리서치)·ground(코드베이스 조사)를 다시 하면 시간 낭비(라이브
// 실측: 재분해 ~7분 중 상당). 조사 결과는 "데이터"(로직 아님)라 골이 안 바뀌면 재사용 가능.
//
// freshness("invalid 필수 체크만"·대표 확정):
//   · 외부조사(research) — 골 동일 + **6시간 이내**(웹/시장 정보 신선도 TTL).
//   · 소스(grounding)   — 골 동일 + **git HEAD SHA 동일**(코드 안 바뀜). 다르면 재조사.
//
// 순수 freshness 판정(isResearchFresh·isGroundingFresh·hashGoal)은 단위테스트. I/O(load/save·
// currentHeadSha)는 seam. 미션 디렉토리(conatus/missions/<id>/grounding-cache.json)·fail-soft·비파괴.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runGitCommand } from '../git-fs/runner.js';
import { elanousStateRoot } from './state-paths.js';
import { missionGeneration } from './lineage/mission-generation.js';

export interface CachedResearch { researched: boolean; enrichments: string[]; corrections: string[]; needReason: string; error?: string }
export interface CachedGrounding { grounded: boolean; context: string; files: string[] }

export interface GroundingCacheEntry {
  goalHash: string;
  /** research 결과 + 저장 시각(6h TTL 기준). */
  research?: CachedResearch;
  researchAt?: string;
  /** grounding 결과. */
  grounding?: CachedGrounding;
  /** ★ H5(2026-07-20) — grounded 파일 스코프 SHA(무관 커밋 오버무효화 해소). 이전 방식(repo HEAD)은
   *  grounding 이 만진 적 없는 파일 커밋에도 재조사(gotcha). 저장 시점 grounding.files 의 blob SHA 조합. */
  groundingFilesSha?: string;
  /** @deprecated repo-wide HEAD SHA(H5 이전). 하위호환 read only — 신규 저장은 groundingFilesSha. */
  groundingHeadSha?: string;
  /** ★ H4 — 이 캐시가 저장된 rerun 세대(파티션·lineage 관측). 저장 시점 스탬프. */
  generation?: number;
}

/** 외부조사 재사용 TTL — 6시간(대표 2026-07-20). */
export const RESEARCH_TTL_MS = 6 * 60 * 60 * 1000;

/** 골 해시(freshness 키·앞 16자). 순수. */
export function hashGoal(goal: string): string {
  return createHash('sha256').update(goal.trim()).digest('hex').slice(0, 16);
}

/** research 캐시 재사용 판정(순수) — 골 동일 + 저장 후 6h 이내. */
export function isResearchFresh(entry: GroundingCacheEntry | null, goal: string, nowMs: number): boolean {
  if (!entry?.research || !entry.researchAt) return false;
  if (entry.goalHash !== hashGoal(goal)) return false;
  const at = new Date(entry.researchAt).getTime();
  return Number.isFinite(at) && nowMs - at < RESEARCH_TTL_MS;
}

/** grounding 캐시 재사용 판정(순수·H5) — 골 동일 + grounded 파일 스코프 SHA 동일(그 파일들 무변경).
 *  currentFilesSha = 저장된 grounding.files 를 지금 재계산한 값(loadFreshGrounding 이 주입). */
export function isGroundingFresh(entry: GroundingCacheEntry | null, goal: string, currentFilesSha: string): boolean {
  if (!entry?.grounding || !entry.groundingFilesSha) return false;
  if (entry.goalHash !== hashGoal(goal)) return false;
  return currentFilesSha !== '' && entry.groundingFilesSha === currentFilesSha;
}

/** 현재 git HEAD SHA(I/O·fail-soft). filesScopeSha 폴백(스코프 없음)용. 빈 문자열=캐시 미사용(안전). */
export function currentHeadSha(repoRoot?: string): string {
  try {
    const result = runGitCommand(repoRoot ?? process.cwd(), ['rev-parse', 'HEAD'], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.status === 0 ? result.stdout.trim() : '';
  } catch { return ''; }
}

/** ★ H5(2026-07-20) — grounded 파일 스코프 SHA(I/O·fail-soft). 각 파일의 git blob SHA(HEAD:<file>)를
 *  정렬·조합해 해시. 그 파일들이 안 바뀌면 무관 커밋에도 동일 → 오버무효화 해소(핸드오프 gotcha).
 *  files 비면 repo HEAD 폴백(안전). 미추적/삭제 파일은 'missing' 마커(변경으로 감지). */
export function filesScopeSha(files: readonly string[], repoRoot?: string): string {
  if (!files.length) return currentHeadSha(repoRoot);
  const cwd = repoRoot ?? process.cwd();
  try {
    const parts: string[] = [];
    for (const f of [...files].sort()) {
      try {
        const result = runGitCommand(cwd, ['rev-parse', `HEAD:${f}`], {
          encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (result.status !== 0) throw new Error(result.stderr);
        parts.push(`${f}:${result.stdout.trim()}`);
      } catch { parts.push(`${f}:missing`); }
    }
    return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
  } catch { return currentHeadSha(repoRoot); }
}

export function groundingCachePath(missionId: string): string {
  const safe = missionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(elanousStateRoot(), 'conatus/missions', safe, 'grounding-cache.json');
}

function loadRaw(missionId: string): GroundingCacheEntry | null {
  try {
    const p = groundingCachePath(missionId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as GroundingCacheEntry;
  } catch { return null; }
}

/** read-only 관측용 캐시 엔트리(H1 Lineage 통합 타임라인). freshness 판정 없이 저장 상태 그대로. fail-soft null. */
export function loadCacheEntryForObserve(missionId: string): GroundingCacheEntry | null {
  return loadRaw(missionId);
}

/** ★ fresh 리셋(진짜 처음부터) — 조사 캐시 전체 무효화(research+grounding 재수집 강제). 파일 삭제. fail-soft. */
export function invalidateGroundingCache(missionId: string): boolean {
  try {
    const p = groundingCachePath(missionId);
    if (!existsSync(p)) return false;
    rmSync(p);
    return true;
  } catch { return false; }
}

/** fresh 하면 research 데이터, 아니면 null(재조사 신호). */
export function loadFreshResearch(missionId: string, goal: string, nowMs: number): CachedResearch | null {
  const e = loadRaw(missionId);
  return isResearchFresh(e, goal, nowMs) ? e!.research! : null;
}

/** fresh 하면 grounding 데이터, 아니면 null(재조사 신호). H5 — 저장된 grounding.files 를 지금 재계산해 비교. */
export function loadFreshGrounding(missionId: string, goal: string): CachedGrounding | null {
  const e = loadRaw(missionId);
  if (!e?.grounding) return null;
  const nowSha = filesScopeSha(e.grounding.files);
  return isGroundingFresh(e, goal, nowSha) ? e.grounding : null;
}

function writeEntry(missionId: string, next: GroundingCacheEntry): void {
  try {
    const p = groundingCachePath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(next));
  } catch { /* fail-soft */ }
}

/** research 결과 캐시 저장(at=ISO). 골 바뀌면 grounding 도 무효화(엇갈린 골 방지). */
export function saveResearchCache(missionId: string, goal: string, research: CachedResearch, at: string): void {
  const gh = hashGoal(goal);
  const prev = loadRaw(missionId);
  const carry = prev && prev.goalHash === gh ? prev : {}; // 골 다르면 이전(grounding 포함) 버림
  writeEntry(missionId, { ...carry, goalHash: gh, research, researchAt: at, generation: missionGeneration(missionId) });
}

/** grounding 결과 캐시 저장(H5 — grounded 파일 스코프 SHA). 골 바뀌면 research 도 무효화. */
export function saveGroundingCache(missionId: string, goal: string, grounding: CachedGrounding): void {
  const gh = hashGoal(goal);
  const prev = loadRaw(missionId);
  const carry = prev && prev.goalHash === gh ? prev : {};
  // 골 바뀌면 이전 groundingHeadSha(deprecated) 잔재 제거 — 새 저장은 groundingFilesSha 만.
  const { groundingHeadSha: _drop, ...carryClean } = carry as GroundingCacheEntry;
  writeEntry(missionId, { ...carryClean, goalHash: gh, grounding, groundingFilesSha: filesScopeSha(grounding.files), generation: missionGeneration(missionId) });
}
