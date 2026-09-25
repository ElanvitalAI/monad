// ── Self-Evolution SE1 · gate.baseline preexisting 빨강 스캐너 ────────────
//
// 세는 자(gate.baseline attribution)와 쏘는 자(ProposalSeed → 발굴 사이클) 사이
// 한 칸. 관측 행은 주입받는다. 후보와 seed 만 낸다 — 미션 생성·승인 API 금지.
// 순수 함수. fs/db/network 없음. 행 조회·러너 배선은 호출측(다음 골).
//
// 만료: 파일을 담은(baselineFiles) 최신 행 하나로만 판정. 시간 창·임계 없음.
// 시각이 하나도 없으면 만료를 짓지 않고 이전과 같이 빈도만 센다.

import { slugify, type ProposalSeed } from '../proposal/draft-plan.js';

export interface PreexistingRedCandidate {
  file: string;
  contactCount: number;
}

export interface PreexistingRedScanCounts {
  /** preexisting 로 본 고유 파일 수. 0 은 센 값이다. */
  seen: number;
  /** 최신 행이 이제 빨강이 아니라서 뺀 수. 0 은 센 값이다. */
  subtracted: number;
  /** 후보에 남은 수. 0 은 센 값이다. */
  remaining: number;
  /** 담은 새 행이 없어 빼지 못한 수. 0 은 센 값이다. */
  residual: number;
  /** 파일마다 마지막으로 관측된 시각(ms). 시각이 없으면 칸을 비운다 — 지어내지 않는다. */
  lastObservedAtMsByFile: { readonly [file: string]: number };
}

/** 스캔 산출. 후보는 배열로 남아 기존 호출이 그대로 먹고, 셈은 칸으로 붙는다. */
export interface PreexistingRedScanResult extends Array<PreexistingRedCandidate>, PreexistingRedScanCounts {}

interface FailureSlice {
  attribution?: unknown;
  file?: unknown;
}

interface ContainingRow {
  ts: number;
  index: number;
  status: string | undefined;
  preexisting: ReadonlySet<string>;
}

function failuresOf(row: unknown): readonly FailureSlice[] {
  if (!row || typeof row !== 'object') return [];
  const failures = (row as { failures?: unknown }).failures;
  return Array.isArray(failures) ? failures as FailureSlice[] : [];
}

function timestampMsOf(row: unknown): number | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const ts = (row as { ts?: unknown }).ts;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (typeof ts === 'string' && ts) {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item) out.push(item);
  }
  return out;
}

function baselineFilesOf(row: unknown): readonly string[] {
  if (!row || typeof row !== 'object') return [];
  return stringList((row as { baselineFiles?: unknown }).baselineFiles);
}

function baselineStatusOf(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const status = (row as { baselineStatus?: unknown }).baselineStatus;
  return typeof status === 'string' ? status : undefined;
}

function preexistingFilesOf(row: unknown): Set<string> {
  const files = new Set<string>();
  for (const failure of failuresOf(row)) {
    if (failure.attribution !== 'preexisting') continue;
    if (typeof failure.file !== 'string' || !failure.file) continue;
    files.add(failure.file);
  }
  return files;
}

function rememberLastObserved(into: Map<string, number>, file: string, ts: number): void {
  const prev = into.get(file);
  if (prev === undefined || ts > prev) into.set(file, ts);
}

function rememberFirst(into: Map<string, number>, file: string, ts: number): void {
  const prev = into.get(file);
  if (prev === undefined || ts < prev) into.set(file, ts);
}

function attachCounts(
  candidates: PreexistingRedCandidate[],
  counts: PreexistingRedScanCounts,
): PreexistingRedScanResult {
  const result = candidates as PreexistingRedScanResult;
  result.seen = counts.seen;
  result.subtracted = counts.subtracted;
  result.remaining = counts.remaining;
  result.residual = counts.residual;
  result.lastObservedAtMsByFile = counts.lastObservedAtMsByFile;
  return result;
}

function isExpired(file: string, latest: ContainingRow): boolean {
  if (latest.status === 'pass') return true;
  if (latest.status === 'test-fail' && !latest.preexisting.has(file)) return true;
  return false;
}

/** gate.baseline 관측 행 → preexisting 실패를 시험 파일 단위로 묶고 접촉 빈도 내림차순.
 *  후보는 배열로 남고, 셈(seen/subtracted/remaining/residual/lastObservedAtMsByFile)은 그 배열에 붙는다. */
export function scanPreexistingRed(observations: readonly unknown[]): PreexistingRedCandidate[] {
  const counts = new Map<string, number>();
  const lastObservedAtMsByFile = new Map<string, number>();
  const firstPreexistingAtMs = new Map<string, number>();
  const latestContaining = new Map<string, ContainingRow>();
  let hasTimestamp = false;

  for (let index = 0; index < observations.length; index++) {
    const row = observations[index];
    const ts = timestampMsOf(row);
    if (ts !== undefined) hasTimestamp = true;
    const preexisting = preexistingFilesOf(row);
    for (const failure of failuresOf(row)) {
      if (failure.attribution !== 'preexisting') continue;
      if (typeof failure.file !== 'string' || !failure.file) continue;
      counts.set(failure.file, (counts.get(failure.file) ?? 0) + 1);
      if (ts !== undefined) {
        rememberLastObserved(lastObservedAtMsByFile, failure.file, ts);
        rememberFirst(firstPreexistingAtMs, failure.file, ts);
      }
    }
    if (ts === undefined) continue;
    const status = baselineStatusOf(row);
    for (const file of baselineFilesOf(row)) {
      rememberLastObserved(lastObservedAtMsByFile, file, ts);
      const prev = latestContaining.get(file);
      if (!prev || ts > prev.ts || (ts === prev.ts && index > prev.index)) {
        latestContaining.set(file, { ts, index, status, preexisting });
      }
    }
  }

  const ranked = [...counts.entries()]
    .map(([file, contactCount]) => ({ file, contactCount }))
    .sort((a, b) => b.contactCount - a.contactCount || a.file.localeCompare(b.file));

  const lastObserved = hasTimestamp
    ? Object.fromEntries(lastObservedAtMsByFile)
    : {};

  if (!hasTimestamp) {
    return attachCounts(ranked, {
      seen: ranked.length,
      subtracted: 0,
      remaining: ranked.length,
      residual: 0,
      lastObservedAtMsByFile: lastObserved,
    });
  }

  const kept: PreexistingRedCandidate[] = [];
  let subtracted = 0;
  let residual = 0;
  for (const candidate of ranked) {
    const latest = latestContaining.get(candidate.file);
    const firstTs = firstPreexistingAtMs.get(candidate.file);
    const hasNewerContaining = latest !== undefined && firstTs !== undefined && latest.ts > firstTs;
    if (!hasNewerContaining) {
      residual += 1;
      kept.push(candidate);
      continue;
    }
    if (isExpired(candidate.file, latest)) {
      subtracted += 1;
      continue;
    }
    kept.push(candidate);
  }

  return attachCounts(kept, {
    seen: ranked.length,
    subtracted,
    remaining: kept.length,
    residual,
    lastObservedAtMsByFile: lastObserved,
  });
}

/** preexisting 빨강 후보 → 제안 seed. 미션을 만들지 않는다. */
export function seedFromPreexistingRed(candidate: PreexistingRedCandidate): ProposalSeed {
  return {
    slug: slugify(candidate.file),
    title: `[preexisting 빨강] ${candidate.file} (접촉 ${candidate.contactCount})`,
    source: 'preexisting-red',
    rationale: `gate.baseline 관측에서 시험 ${candidate.file} 이 preexisting 빨강으로 ${candidate.contactCount}회 접촉됐다. 세는 자는 찍었으나 청구자가 없어 수가 자란다.`,
    evidence: [candidate.file, `preexisting 접촉 ${candidate.contactCount}회`],
    tier: candidate.contactCount > 3 ? 'heavy' : 'light',
  };
}
