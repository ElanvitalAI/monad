// ── 미션 워킹 메모리(미션 스코프 셀프 인지 · 2026-07-13 · C4 승격 후 2026-07-20) ─────────────────────
//
// 근본: 미션 실행의 컨텍스트 관리 문제. 각 페이즈가 fresh 세션(SE 격리 worktree·walker runTurnImpl·매 시도
// 새 컨텍스트)으로 독립 실행되어 이전 페이즈의 컨텍스트(조사·결정·재사용 경계)를 상실한다. 이 모듈은 미션
// 스코프 append-only 워킹 메모리 — 각 페이즈가 자기 작업 요약을 기록, 후속 페이즈가 읽어 프롬프트에 주입.
//
// ★ 순수 포맷/파싱 코어(엔트리 타입·parse/format/dedup/marker)는 공용 중립층
//   `src/agent-substrate/working-memory-format.ts` 로 승격(DESIGN §16 C4). 여기엔 **미션 저장 I/O**만 남는다:
//   미션 경로(state root/config dir)·jsonl append·tail-bounded read·리비전별 아카이브·compaction·리셋.
//   순수 심볼은 재-export → 기존 import 처(18곳) 무접촉.
//
// 설계: 내부 문서 `PLAN-mission-working-memory-2026-07-13` §2.

import { elanousStateRoot } from './state-paths.js';
import { getElanousConfigDir } from '../elanous-config-dir.js';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, appendFileSync, statSync, openSync, readSync, closeSync, renameSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import {
  normList,
  isWorkingMemoryScope,
  parseWorkingMemoryJsonl,
  dedupWorkingMemory,
  type WorkingMemoryEntry,
} from '../agent-substrate/working-memory-format.js';

// 순수 포맷/파싱 코어 재-export — 이 경로에서 import 하던 곳 무접촉.
export {
  isWorkingMemoryScope,
  dedupWorkingMemory,
  parseWorkingMemoryJsonl,
  formatWorkingMemoryForPrompt,
  formatWorkingMemoryDigest,
  parseDeviation,
  parseWorkingMemorySignals,
  stripWorkingMemoryMarker,
  normList,
} from '../agent-substrate/working-memory-format.js';
export type {
  PhaseMemoryKind,
  MemoryProvenance,
  DeviationKind,
  WorkingMemoryDeviation,
  WorkingMemoryScope,
  WorkingMemoryEntry,
} from '../agent-substrate/working-memory-format.js';

/** 읽기 상한(대용량 방어) — 반복 rebuild/rerun 으로 jsonl 이 무한 성장해도 마지막 이 만큼만 파싱.
 *  run.log 리더(mission-tool)와 동일한 tail-bounded 전략. */
const READ_CAP_BYTES = 512 * 1024;

/** 미션 id → 파일시스템 안전 슬러그(공용). missionRunLogPath 와 동일 규칙. */
function safeMissionSlug(missionId: string): string {
  return (missionId || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80);
}

/** 미션별 워킹 메모리 파일 경로 — run.log 옆(같은 미션 디렉토리·state root). 라이브 워킹셋(U2.5 compaction 대상). */
export function missionWorkingMemoryPath(missionId: string): string {
  return join(elanousStateRoot(), 'conatus/missions', safeMissionSlug(missionId), 'working-memory.jsonl');
}

/**
 * ★ 워킹메모리 풀 아카이브(일원화 RFC U2.5·2026-07-19) — config dir 아래 append-only 영구 원장.
 * 라이브 파일은 compaction 으로 과거 구현 스토리가 이탈하지만, 이 아카이브는 **never prune** 라 전 히스토리를
 * 풀 보관 → 리플레이·풀 스토리 이해. config dir = `--config-dir` 격리를 env 없이 존중하는 canonical 경계.
 *
 * ★ 리비전(revise 세대)별 파티션 — generation 별 파일(gen-<N>.jsonl)로 나눠 리비전별 리플레이/조회 가능.
 */
export function missionWorkingMemoryArchiveDir(missionId: string): string {
  return join(getElanousConfigDir(), 'archive', 'working-memory', safeMissionSlug(missionId));
}

/** 리비전(generation)별 아카이브 파일 경로 — gen-<N>.jsonl. */
export function missionWorkingMemoryArchivePath(missionId: string, generation: number): string {
  const gen = Number.isFinite(generation) && generation >= 0 ? Math.floor(generation) : 0;
  return join(missionWorkingMemoryArchiveDir(missionId), `gen-${gen}.jsonl`);
}

/** 엔트리 정규화(순수) — 라이브 append·아카이브 append 가 공유. reusables/decisions/artifacts 트림·중복제거·상한. */
function normalizeWorkingMemoryEntry(entry: Omit<WorkingMemoryEntry, 'at'> & { at?: string }): WorkingMemoryEntry {
  return {
    phaseId: String(entry.phaseId || '').slice(0, 120),
    phaseTitle: String(entry.phaseTitle || '').slice(0, 200),
    kind: entry.kind,
    at: entry.at ?? new Date().toISOString(),
    summary: String(entry.summary || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    reusables: normList(entry.reusables),
    decisions: normList(entry.decisions),
    artifacts: normList(entry.artifacts),
    provenance: entry.provenance ?? 'self',
    ...(entry.arcId ? { arcId: String(entry.arcId).slice(0, 80) } : {}),
    ...(entry.deviation && entry.deviation.note
      ? { deviation: { kind: entry.deviation.kind, note: String(entry.deviation.note).replace(/\s+/g, ' ').trim().slice(0, 300) } }
      : {}),
    ...(isWorkingMemoryScope(entry.scope) ? { scope: entry.scope } : {}),
  };
}

/** ★ U2.5 — 정규화 엔트리를 리비전(generation)별 풀 아카이브(config dir·never prune)에 append. fail-soft. */
export function appendWorkingMemoryArchive(
  missionId: string,
  entry: Omit<WorkingMemoryEntry, 'at'> & { at?: string },
  generation: number,
): void {
  try {
    const p = missionWorkingMemoryArchivePath(missionId, generation);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(normalizeWorkingMemoryEntry(entry)) + '\n');
  } catch { /* fail-soft — 아카이브 기록 실패가 미션을 막으면 안 됨 */ }
}

/** ★ U2.5 — 리비전별 아카이브 읽기(리플레이·풀 스토리). generation 지정 시 그 세대만, 미지정 시 전 세대 병합
 *  (오름차순·과거→현재). dedup/tail-bound 없음(풀 히스토리). fail-soft(없으면 []). */
export function readWorkingMemoryArchive(
  missionId: string,
  opts: { generation?: number } = {},
): WorkingMemoryEntry[] {
  try {
    const dir = missionWorkingMemoryArchiveDir(missionId);
    if (!existsSync(dir)) return [];
    let files: string[];
    if (opts.generation !== undefined) {
      files = [missionWorkingMemoryArchivePath(missionId, opts.generation)];
    } else {
      files = readdirSync(dir)
        .filter((f) => /^gen-\d+\.jsonl$/.test(f))
        .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
        .map((f) => join(dir, f));
    }
    const out: WorkingMemoryEntry[] = [];
    for (const f of files) {
      try { if (existsSync(f)) out.push(...parseWorkingMemoryJsonl(readFileSync(f, 'utf-8'))); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

/** 워킹 메모리 1 엔트리 append(jsonl). fail-soft — 미션 실행을 절대 막지 않는다. */
export function appendWorkingMemory(
  missionId: string,
  entry: Omit<WorkingMemoryEntry, 'at'> & { at?: string },
): void {
  try {
    const p = missionWorkingMemoryPath(missionId);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(normalizeWorkingMemoryEntry(entry)) + '\n');
  } catch { /* fail-soft — 워킹 메모리 기록 실패가 미션을 막으면 안 됨 */ }
}

/** 미션 워킹 메모리 읽기(바운디드·dedup). 없으면 []. tail-bounded + 잘린 첫 줄 방어 + latest-wins dedup. */
export function readWorkingMemory(missionId: string): WorkingMemoryEntry[] {
  try {
    const p = missionWorkingMemoryPath(missionId);
    if (!existsSync(p)) return [];
    const size = statSync(p).size;
    const readBytes = Math.min(size, READ_CAP_BYTES);
    const buf = Buffer.alloc(readBytes);
    const fd = openSync(p, 'r');
    try { readSync(fd, buf, 0, readBytes, size - readBytes); } finally { closeSync(fd); }
    let text = buf.toString('utf-8');
    if (readBytes < size) { const nl = text.indexOf('\n'); if (nl >= 0) text = text.slice(nl + 1); }
    return dedupWorkingMemory(parseWorkingMemoryJsonl(text));
  } catch { return []; }
}

/** write-time compaction 임계 — READ_CAP_BYTES(512KB tail 창)의 절반. */
const COMPACT_THRESHOLD_BYTES = READ_CAP_BYTES / 2;

/**
 * ★ 일원화 RFC U2.5(저장 최적화·2026-07-19) — write-time compaction. append 후 파일이 임계를 넘으면
 * dedup(latest-wins) 엔트리로 원자 재작성해 jsonl 무한 성장을 bound. 임계 미만이면 no-op. fail-soft.
 */
export function compactWorkingMemoryIfNeeded(
  missionId: string,
  opts: { thresholdBytes?: number } = {},
): { compacted: boolean; entries: number } {
  const p = missionWorkingMemoryPath(missionId);
  let size = 0;
  try { if (existsSync(p)) size = statSync(p).size; } catch { /* fail-soft */ }
  const entries = readWorkingMemory(missionId);   // bounded + dedup(latest-wins)
  const threshold = opts.thresholdBytes ?? COMPACT_THRESHOLD_BYTES;
  if (size <= threshold) return { compacted: false, entries: entries.length };
  try {
    const body = entries.map((e) => JSON.stringify(e)).join('\n');
    const tmp = `${p}.compact.tmp`;
    writeFileSync(tmp, entries.length ? `${body}\n` : '');
    renameSync(tmp, p);
    return { compacted: true, entries: entries.length };
  } catch { return { compacted: false, entries: entries.length }; }
}

/** 워킹 메모리 리셋(revise 등 골 정정·재분해 시) — 현재 파일을 archive(.bak)로 옮겨 비운다(삭제 아니라 이관).
 *  suffix 는 호출측이 결정론적으로 주입(세대/사유) — Date 비의존(재현·테스트 안정). fail-soft. */
export function resetWorkingMemory(missionId: string, archiveSuffix?: string): void {
  try {
    const p = missionWorkingMemoryPath(missionId);
    if (!existsSync(p)) return;
    const safeSuffix = (archiveSuffix || 'archived').replace(/[^\w.-]/g, '_').slice(0, 40);
    try { renameSync(p, `${p}.${safeSuffix}.bak`); }
    catch { /* fail-soft */ }
  } catch { /* fail-soft */ }
}
