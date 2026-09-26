// ── logs → 중단 산출 draft PR 중 salvage 미판정 ────────────────────────────
//
// 읽기 전용. PR 을 닫거나 라벨·코멘트를 남기지 않는다. 세고 이름을 댄다.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { LogQuery, LogStoreRow } from '../mss/logging/log-store.js';
import { LogStore, STORE_SAFETY_MAX } from '../mss/logging/log-store.js';
import { collectDegenerateRows } from './logs-degenerate.js';
import { resolveLogTargets } from './logs-cli.js';
import { loadFederatedRunLedger, type RunLedgerEntry } from '../self-implement/run-ledger.js';

const OPEN_EVENT = 'rework-blocked-draft-pr';
const SALVAGE_EVENT = 'rework-salvage';
export const QUERY_EVENTS = [OPEN_EVENT, SALVAGE_EVENT] as const;
export const ABANDONED_DRAFT_PRS_LIMITATION = '이 자는 rework-blocked-draft-pr 이벤트가 있는 런만 보며, 다른 이유로 열린 채 남은 draft PR은 세지 않는다.';
const FINAL_SALVAGE_ACTIONS = new Set(['parked', 'launched']);

const EXPECTED_STORE_READ_SQLITE_CODES = new Set([
  'SQLITE_CANTOPEN',
  'SQLITE_NOTADB',
  'SQLITE_IOERR',
  'SQLITE_CORRUPT',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
  'SQLITE_PERM',
  'SQLITE_READONLY',
  'SQLITE_FULL',
  'SQLITE_AUTH',
  'SQLITE_FORMAT',
  'SQLITE_NOTFOUND',
]);

const EXPECTED_STORE_READ_ERRNO = new Set([
  'ENOENT', 'EACCES', 'EPERM', 'EIO', 'ENOTDIR', 'EISDIR', 'EBUSY', 'EMFILE', 'ENFILE', 'EAGAIN',
]);

/** 스토어 open/query 의 예상 I/O·손상 오류만 true. 분석·프로그래밍 오류는 false. */
export function isExpectedStoreReadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const rec = error as { name?: unknown; code?: unknown };
  if (typeof rec.code !== 'string') return false;
  if (EXPECTED_STORE_READ_ERRNO.has(rec.code)) return true;
  if (EXPECTED_STORE_READ_SQLITE_CODES.has(rec.code)) return true;
  return rec.code.startsWith('SQLITE_IOERR');
}

export type AbandonedDraftPrCurrentStatus = 'merged' | 'closed' | 'open' | 'notLookedUp' | 'lookupFailed';

export interface AbandonedDraftPr {
  store: string;
  number: number;
  url: string | null;
  branch: string;
  openedAt: string;
  openedAtMs: number;
  stage: string | null;
  verdict: string | null;
  runId: string | null;
  currentStatus?: AbandonedDraftPrCurrentStatus;
  laterMergedInSameRun?: number[];
  runLineage?: 'unreadable';
}

export type LookupCurrentDraftPrStatus =
  (candidate: Readonly<AbandonedDraftPr>) => Exclude<AbandonedDraftPrCurrentStatus, 'notLookedUp' | 'lookupFailed'>;

export interface AbandonedDraftPrsCurrentStatusDistribution {
  merged: number;
  closed: number;
  open: number;
  notLookedUp: number;
  lookupFailed: number;
  reviewNow: number;
}

export interface AbandonedDraftPrCurrentStatusResult {
  readonly distribution: AbandonedDraftPrsCurrentStatusDistribution;
  /** 후보별 판정 — 입력 배열과 같은 순서·같은 길이. 입력은 바뀌지 않는다. */
  readonly statuses: readonly AbandonedDraftPrCurrentStatus[];
}

export interface AbandonedDraftPrsRunLineage {
  withLaterMerge: number;
  withoutLaterMerge: number;
  unreadable: number;
}

export interface AbandonedDraftPrsJudged {
  launched: number;
  parked: number;
  total: number;
}

export interface AbandonedDraftPrsStores {
  count: number;
  names: string[];
  truncated: boolean;
  rowsCollected: number;
  unreadable: number;
}

/** 같은 골 GitHub 병합 조회 결과. none ≠ unavailable ≠ incomplete. */
export type MergedGoalLookupState = 'merged' | 'none' | 'unavailable' | 'incomplete';

export interface MergedGoalLookupResult {
  state: MergedGoalLookupState;
  mergedPrNumbers: number[];
  supersededPrNumbers: number[];
}

export interface MergedPrHead {
  number: number;
  headRefName: string;
}

export interface OpenDraftPr {
  number: number;
  url: string;
}

export type AbandonedDraftPrsDomainGap =
  | { state: 'measured'; totalOpenDrafts: number; matchedCandidates: number; unmatchedNumbers: number[] }
  | { state: 'unavailable'; reason: string };

/** 병합 조회 스냅샷. incomplete/truncated 는 none·완전한 merged 로 접지 않는다. */
export interface MergedPrLookupResponse {
  heads: MergedPrHead[];
  incomplete?: boolean;
  truncated?: boolean;
}

export interface SpawnGhResult {
  stdout: string;
  stderr?: string;
  status: number | null;
  error?: Error;
}

export const MERGED_PR_LIST_LIMIT = 100;
/** 창 안을 이어서 물을 때 한 질의의 상한. GitHub Search 는 1000에서 끊긴다. */
export const MERGED_PR_LIST_MAX_LIMIT = 1000;

export interface AbandonedDraftPrGoalGroup {
  goalId: string | null;
  prNumbers: number[];
  lookup?: MergedGoalLookupResult;
}

export interface AbandonedDraftPrsReport {
  abandoned: AbandonedDraftPr[];
  abandonedCount: number;
  /** 이 자가 읽어 중단 산출 draft PR을 구성하는 로그 이벤트 이름. */
  populationEvents?: readonly string[];
  /** 이 자가 세지 않는 열린 draft PR의 범위. */
  limitation?: string;
  judged: AbandonedDraftPrsJudged;
  skipped: number;
  stores: AbandonedDraftPrsStores;
  /** 같은 goalId 묶음. 못 뽑은 PR 은 각자 단독 묶음. */
  goalGroups?: AbandonedDraftPrGoalGroup[];
  /** 골 묶음 수. 옛 형식 PR 도 1로 센다. */
  goalCount?: number;
  /** `--lookup-merged` 를 켠 조회 시각(ISO). 기본 산출에는 없다. */
  lookedUpAt?: string;
  /** `--lookup-current-status`를 켠 경우의 현재 PR 상태 분포. */
  currentStatus?: AbandonedDraftPrsCurrentStatusDistribution;
  /** `--run-lineage`를 켠 경우의 같은 런 후속 병합 집계. */
  runLineage?: AbandonedDraftPrsRunLineage;
  /** `--count-domain-gap`를 켠 경우 열린 draft 전체와 이 보고서 후보의 차이. */
  domainGap?: AbandonedDraftPrsDomainGap;
}

/**
 * 브랜치 이름에서 `goalid-<id>` 조각을 뽑는다.
 * self-impl/ 접두는 있어도 되고 없어도 된다. 옛 형식(마커 없음)은 null.
 * ⛔ `mygoalid-` 같은 부분문자열은 경계가 아니라서 잡지 않는다.
 */
const GOAL_ID_SEGMENT = /(?:^|[-/])goalid-([^/-]+)(?:-|$)/;

export function extractAbandonedDraftPrGoalId(branch: string): string | null {
  const match = GOAL_ID_SEGMENT.exec(branch);
  const id = match?.[1];
  return id && id.length > 0 ? id : null;
}

/** 같은 goalId 는 한 묶음. 못 뽑은 PR 은 각자 단독 묶음(옛 형식을 버리지 않는다). */
function groupAbandonedDraftPrsByGoal(
  abandoned: readonly AbandonedDraftPr[],
): AbandonedDraftPrGoalGroup[] {
  const groups: AbandonedDraftPrGoalGroup[] = [];
  const byGoalId = new Map<string, AbandonedDraftPrGoalGroup>();
  for (const pr of abandoned) {
    const goalId = extractAbandonedDraftPrGoalId(pr.branch);
    if (goalId === null) {
      groups.push({ goalId: null, prNumbers: [pr.number] });
      continue;
    }
    const existing = byGoalId.get(goalId);
    if (existing) {
      existing.prNumbers.push(pr.number);
      continue;
    }
    const group: AbandonedDraftPrGoalGroup = { goalId, prNumbers: [pr.number] };
    byGoalId.set(goalId, group);
    groups.push(group);
  }
  return groups;
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => b - a);
}

/**
 * 같은 골의 병합 PR 을 번호로 가른다. 나이로 판정하지 않는다.
 * goalId 가 없으면 같은 골을 조회할 방법이 없으므로 incomplete.
 * 잘못된 행·잘림은 none 이나 완전한 merged 로 단정하지 않는다.
 */
export function classifyMergedGoalLookup(
  group: AbandonedDraftPrGoalGroup,
  mergedHeads: readonly MergedPrHead[],
  opts: { incomplete?: boolean; truncated?: boolean } = {},
): MergedGoalLookupResult {
  if (group.goalId === null) {
    return { state: 'incomplete', mergedPrNumbers: [], supersededPrNumbers: [] };
  }
  const mergedForGoal = uniqueSortedNumbers(
    mergedHeads
      .filter((head) => extractAbandonedDraftPrGoalId(head.headRefName) === group.goalId)
      .map((head) => head.number),
  );
  const mergedSet = new Set(mergedForGoal);
  const supersededPrNumbers = uniqueSortedNumbers(
    group.prNumbers.filter((number) => !mergedSet.has(number)),
  );
  if (opts.incomplete || opts.truncated) {
    return {
      state: 'incomplete',
      mergedPrNumbers: mergedForGoal,
      supersededPrNumbers: mergedForGoal.length > 0 ? supersededPrNumbers : [],
    };
  }
  if (mergedForGoal.length === 0) {
    return { state: 'none', mergedPrNumbers: [], supersededPrNumbers: [] };
  }
  return { state: 'merged', mergedPrNumbers: mergedForGoal, supersededPrNumbers };
}

function asLookupResponse(
  output: readonly MergedPrHead[] | MergedPrLookupResponse,
): MergedPrLookupResponse {
  if ('heads' in output) return output;
  return { heads: [...output] };
}

export function lookupMergedPrsForGoalGroup(
  group: AbandonedDraftPrGoalGroup,
  lookupMerged: (goalId: string) => readonly MergedPrHead[] | MergedPrLookupResponse,
): MergedGoalLookupResult {
  if (group.goalId === null) {
    return { state: 'incomplete', mergedPrNumbers: [], supersededPrNumbers: [] };
  }
  try {
    const response = asLookupResponse(lookupMerged(group.goalId));
    return classifyMergedGoalLookup(group, response.heads, {
      incomplete: response.incomplete,
      truncated: response.truncated,
    });
  } catch {
    return { state: 'unavailable', mergedPrNumbers: [], supersededPrNumbers: [] };
  }
}

function parseGhJsonArray(stdout: string): unknown[] | null {
  const text = stdout.trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface ParsedMergedPrHeads {
  heads: MergedPrHead[];
  incomplete: boolean;
  rowCount: number;
}

/**
 * GitHub `gh pr list --json number,headRefName` 응답.
 * 잘못된 행은 조용히 버리지 않고 incomplete 로 표시한다. 파싱 불가면 null.
 */
export function parseMergedPrHeads(stdout: string): ParsedMergedPrHeads | null {
  const rows = parseGhJsonArray(stdout);
  if (rows === null) return null;
  const heads: MergedPrHead[] = [];
  let incomplete = false;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      incomplete = true;
      continue;
    }
    const rec = row as { number?: unknown; headRefName?: unknown };
    if (typeof rec.number !== 'number' || !Number.isInteger(rec.number)) {
      incomplete = true;
      continue;
    }
    if (typeof rec.headRefName !== 'string' || rec.headRefName.length === 0) {
      incomplete = true;
      continue;
    }
    heads.push({ number: rec.number, headRefName: rec.headRefName });
  }
  return { heads, incomplete, rowCount: rows.length };
}

export function defaultSpawnGh(args: readonly string[]): SpawnGhResult {
  // ⛔⭐ maxBuffer 를 «명시»한다 — 기본값(1MB)은 `gh api --paginate` 의 전체 PR 목록에 부족해
  //    `ENOBUFS` 로 죽는다. 그 실패는 상위에서 「못 쟀다」로 정직하게 나오지만, ***쓸 수 없는 자는
  //    정직해도 쓸모가 없다***(2026-09-21 실물: 정상 경로에서 바로 ENOBUFS 였다).
  const result = spawnSync('gh', [...args], { encoding: 'utf-8', timeout: 30_000, env: process.env, maxBuffer: 64 * 1024 * 1024 });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    error: result.error,
  };
}

/**
 * 주입 가능한 «열린 draft PR 전체 조회» 경계.
 * ⛔⭐ 실패는 ***빈 목록으로 접지 않고 throw 한다*** — 「못 쟀다」와 「0건」은 다른 값이고,
 *    호출부가 그 둘을 갈라야 하기 때문이다(`AbandonedDraftPrsDomainGap` 의 `unavailable`).
 * ⚠️ 이 «이름»이 계약이다 — 구현이 바뀌어도 호출부·시험은 이 타입에 붙는다.
 */
export type LookupOpenDraftPrs = (
  spawnGh?: (args: readonly string[]) => SpawnGhResult,
) => readonly OpenDraftPr[];

/** 열린 draft PR 전체를 읽는다. spawnGh를 주입해 실물 gh 없이 시험할 수 있다. */
export const lookupOpenDraftPrs: LookupOpenDraftPrs = (
  spawnGh: (args: readonly string[]) => SpawnGhResult = defaultSpawnGh,
): OpenDraftPr[] => {
  const result = spawnGh(['api', '--paginate', '--slurp', '/repos/{owner}/{repo}/pulls?state=open&per_page=100', '-H', 'Accept: application/vnd.github+json']);
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim() || 'gh pr list failed');
  }
  const pages = parseGhJsonArray(result.stdout);
  if (pages === null || !pages.every(Array.isArray)) throw new Error('gh pr list returned unparseable JSON');
  const drafts: OpenDraftPr[] = [];
  for (const row of pages.flat()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('gh pr list returned invalid draft PR row');
    }
    const record = row as { number?: unknown; html_url?: unknown; draft?: unknown };
    if (!Number.isInteger(record.number) || typeof record.html_url !== 'string' || record.html_url.length === 0 || typeof record.draft !== 'boolean') {
      throw new Error('gh pr list returned invalid draft PR row');
    }
    if (record.draft) drafts.push({ number: record.number as number, url: record.html_url });
  }
  return drafts;
};

function matchesOpenDraft(candidate: Readonly<AbandonedDraftPr>, draft: Readonly<OpenDraftPr>): boolean {
  if (candidate.number !== draft.number) return false;
  const candidateRepo = repoSlugFromPrUrl(candidate.url);
  const draftRepo = repoSlugFromPrUrl(draft.url);
  if (candidateRepo !== null && candidateRepo !== draftRepo) return false;
  return true;
}

export function calculateAbandonedDraftPrsDomainGap(
  abandoned: readonly AbandonedDraftPr[],
  openDrafts: readonly OpenDraftPr[],
): Extract<AbandonedDraftPrsDomainGap, { state: 'measured' }> {
  const matchedDraftIndexes = new Set<number>();
  for (const candidate of abandoned) {
    const index = openDrafts.findIndex((draft) => matchesOpenDraft(candidate, draft));
    if (index !== -1) matchedDraftIndexes.add(index);
  }
  return {
    state: 'measured',
    totalOpenDrafts: openDrafts.length,
    matchedCandidates: matchedDraftIndexes.size,
    unmatchedNumbers: openDrafts.filter((_, index) => !matchedDraftIndexes.has(index)).map((pr) => pr.number),
  };
}

function lookupFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/, 1)[0] || 'unknown error';
}

/**
 * 방치 draft 중 가장 오래된 개설 시각을 UTC ISO(`YYYY-MM-DDTHH:mm:ssZ`) 로 돌려
 * `gh pr list --search merged:>=…` 창을 그 판에 필요한 만큼만 연다.
 * 목록이 비면 창을 못 정하므로 undefined — 호출자가 전역 목록으로 떨어진다.
 */
export function mergedSinceFromAbandoned(
  abandoned: readonly Pick<AbandonedDraftPr, 'openedAtMs'>[],
): string | undefined {
  if (abandoned.length === 0) return undefined;
  let oldest = abandoned[0]!.openedAtMs;
  for (const pr of abandoned) {
    if (pr.openedAtMs < oldest) oldest = pr.openedAtMs;
  }
  if (!Number.isFinite(oldest)) return undefined;
  return new Date(oldest).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 병합 PR 목록을 받아 `headRefName` 에서 goal-id 토큰을 가른다.
 * head 브랜치 접두 검색은 `self-impl/…-goalid-<id>-…` 와 일치하지 않는다.
 * `mergedSince` 가 있으면 그 날짜 이후 병합만 물어 상한이 상시 차지 않게 한다.
 * 첫 페이지(`MERGED_PR_LIST_LIMIT`)가 차면 같은 창을 더 큰 상한으로 이어 묻고 합친다.
 * 그래도 `MERGED_PR_LIST_MAX_LIMIT` 에 닿으면 truncated — 「못 물어봤다」.
 */
export function listMergedPrHeads(
  spawnGh: ((args: readonly string[]) => SpawnGhResult) | undefined = undefined,
  opts: { mergedSince?: string } = {},
): MergedPrLookupResponse {
  const run = spawnGh ?? defaultSpawnGh;
  const heads: MergedPrHead[] = [];
  const seen = new Set<number>();
  let incomplete = false;
  let limit = MERGED_PR_LIST_LIMIT;
  for (;;) {
    const args = [
      'pr', 'list',
      '--state', 'merged',
      '--limit', String(limit),
      '--json', 'number,headRefName',
    ];
    if (opts.mergedSince) {
      args.push('--search', `merged:>=${opts.mergedSince}`);
    }
    const result = run(args);
    if (result.error || result.status !== 0) {
      throw new Error(result.error?.message || result.stderr?.trim() || 'gh pr list failed');
    }
    const parsed = parseMergedPrHeads(result.stdout ?? '');
    if (parsed === null) {
      throw new Error('gh pr list returned unparseable JSON');
    }
    incomplete = incomplete || parsed.incomplete;
    for (const head of parsed.heads) {
      if (seen.has(head.number)) continue;
      seen.add(head.number);
      heads.push(head);
    }
    const pageFull = parsed.rowCount >= limit;
    if (!pageFull) {
      return { heads, incomplete, truncated: false };
    }
    if (limit >= MERGED_PR_LIST_MAX_LIMIT) {
      return { heads, incomplete, truncated: true };
    }
    limit = MERGED_PR_LIST_MAX_LIMIT;
  }
}

interface TrackedOpen {
  pr: AbandonedDraftPr;
  consumed: boolean;
}

function parsedData(row: LogStoreRow): Record<string, unknown> | null {
  if (!row.data) return null;
  try {
    const data: unknown = JSON.parse(row.data);
    return data && !Array.isArray(data) && typeof data === 'object' ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringField(data: Record<string, unknown>, field: string): string | null {
  const value = data[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberField(data: Record<string, unknown>, field: string): number | null {
  const value = data[field];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function stageField(data: Record<string, unknown>): string | null {
  return stringField(data, 'stage');
}

function verdictField(data: Record<string, unknown>): string | null {
  const value = data.verdict;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mergedPrNumbersAfter(entries: readonly RunLedgerEntry[], pr: AbandonedDraftPr): number[] {
  return [...new Set(entries.flatMap((entry) => {
    const timestamp = entry.timestamp === undefined ? NaN : Date.parse(entry.timestamp);
    const prNumber = numberField(entry.data, 'prNumber');
    return entry.event === 'run-rollup'
      && entry.data.stage === 'merged'
      && prNumber !== null
      && prNumber !== pr.number
      && timestamp > pr.openedAtMs
      ? [prNumber]
      : [];
  }))].sort((a, b) => a - b);
}

function applyRunLineage(
  abandoned: readonly AbandonedDraftPr[],
  loadRunLedger: (runId: string) => readonly RunLedgerEntry[] | null,
): AbandonedDraftPrsRunLineage {
  const ledgers = new Map<string, readonly RunLedgerEntry[] | null>();
  const counts: AbandonedDraftPrsRunLineage = { withLaterMerge: 0, withoutLaterMerge: 0, unreadable: 0 };
  for (const pr of abandoned) {
    if (pr.runId === null) {
      pr.runLineage = 'unreadable';
      counts.unreadable += 1;
      continue;
    }
    let ledger = ledgers.get(pr.runId);
    if (ledger === undefined) {
      ledger = loadRunLedger(pr.runId);
      ledgers.set(pr.runId, ledger);
    }
    if (ledger === null) {
      pr.runLineage = 'unreadable';
      counts.unreadable += 1;
      continue;
    }
    const laterMergedInSameRun = mergedPrNumbersAfter(ledger, pr);
    pr.laterMergedInSameRun = laterMergedInSameRun;
    if (laterMergedInSameRun.length > 0) counts.withLaterMerge += 1;
    else counts.withoutLaterMerge += 1;
  }
  return counts;
}

/** 같은 비어 있지 않은 브랜치 이름만 잇는다. 항상 참이면 다른 브랜치의 판정이 앞선 미판정 PR을 지운다. */
export function salvageMatchesOpen(salvageBranch: string, openBranch: string): boolean {
  return salvageBranch.length > 0 && salvageBranch === openBranch;
}

function chronological(rows: readonly LogStoreRow[]): LogStoreRow[] {
  return [...rows].sort((a, b) => a.ts_ms - b.ts_ms || a.id - b.id);
}

/**
 * 한 스토어 안의 개설 행과 최종 salvage(parked/launched)를 브랜치로 잇되, 한 salvage 는
 * 그 시점의 가장 최근 미소비 개설 한 건만 소비한다.
 * OPEN #71 → OPEN #72 → SALVAGE 이면 #72 만 판정되고 #71 은 목록에 남는다.
 * 스토어를 넘나드는 번호·브랜치 일치는 호출자가 행을 섞지 않아야 성립한다.
 */
export function findAbandonedDraftPrs(
  rows: readonly LogStoreRow[],
  store = '',
): Omit<AbandonedDraftPrsReport, 'stores'> {
  const opens: TrackedOpen[] = [];
  const seenNumbers = new Set<number>();
  let skipped = 0;
  let launched = 0;
  let parked = 0;

  for (const row of chronological(rows)) {
    const data = parsedData(row);
    if (!data) continue;
    if (row.event === OPEN_EVENT) {
      if (data.skipped) {
        skipped += 1;
        continue;
      }
      const number = numberField(data, 'number');
      if (number === null) continue;
      if (seenNumbers.has(number)) continue;
      seenNumbers.add(number);
      opens.push({
        pr: {
          store,
          number,
          url: stringField(data, 'url'),
          branch: stringField(data, 'branch') ?? '',
          openedAt: row.ts,
          openedAtMs: row.ts_ms,
          stage: stageField(data),
          verdict: verdictField(data),
          runId: stringField(data, 'runId'),
        },
        consumed: false,
      });
      continue;
    }
    if (row.event !== SALVAGE_EVENT) continue;
    const action = stringField(data, 'action');
    if (!action || !FINAL_SALVAGE_ACTIONS.has(action)) continue;
    const salvageBranch = stringField(data, 'branch') ?? '';
    let match = -1;
    for (let i = opens.length - 1; i >= 0; i--) {
      const open = opens[i]!;
      if (open.consumed) continue;
      if (!salvageMatchesOpen(salvageBranch, open.pr.branch)) continue;
      match = i;
      break;
    }
    if (match < 0) continue;
    opens[match]!.consumed = true;
    if (action === 'launched') launched += 1;
    else parked += 1;
  }

  const abandoned = opens.filter((open) => !open.consumed).map((open) => open.pr)
    .sort((a, b) => b.openedAtMs - a.openedAtMs || b.number - a.number);
  const goalGroups = groupAbandonedDraftPrsByGoal(abandoned);
  return {
    abandoned,
    abandonedCount: abandoned.length,
    judged: { launched, parked, total: launched + parked },
    skipped,
    goalGroups,
    goalCount: goalGroups.length,
  };
}

function parseSince(raw: string): number | null {
  const relative = /^(\d+)(s|m|h|d)$/.exec(raw.trim());
  if (relative) {
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2] as 's' | 'm' | 'h' | 'd'];
    return Date.now() - Number(relative[1]) * unit;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 호출자가 goalGroups/goalCount 를 빼도 abandoned 로부터 같은 묶음 규칙을 적용한다. */
function resolveAbandonedDraftPrGoalView(report: AbandonedDraftPrsReport): {
  goalGroups: AbandonedDraftPrGoalGroup[];
  goalCount: number;
} {
  const goalGroups = report.goalGroups ?? groupAbandonedDraftPrsByGoal(report.abandoned);
  return { goalGroups, goalCount: report.goalCount ?? goalGroups.length };
}

/** PR url 에서 `<owner>/<repo>` 를 뽑는다 — ⛔ 번호만으로 `gh pr view` 를 치면 «현재 디렉토리의 저장소»를
 *  묻게 되고, 다른 저장소를 대상으로 돈 런의 draft PR 은 ***같은 번호의 «남의 PR»***로 답이 온다.
 *  📏 2026-09-21 실측: e2e 시험 저장소의 #3(OPEN)이 monad-agent 의 #3(2026-04 MERGED)으로 읽혔다. */
export function repoSlugFromPrUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function lookupCurrentPrStatus(
  candidate: Readonly<AbandonedDraftPr>,
  spawnGh: (args: readonly string[]) => SpawnGhResult = (args) => spawnSync('gh', args, { encoding: 'utf8' }),
): Exclude<AbandonedDraftPrCurrentStatus, 'notLookedUp' | 'lookupFailed'> {
  const repo = repoSlugFromPrUrl(candidate.url);
  const result = spawnGh([
    'pr', 'view', String(candidate.number),
    ...(repo ? ['--repo', repo] : []),
    '--json', 'state,mergedAt',
  ]);
  if (result.error || result.status !== 0) throw new Error(result.stderr || `gh pr view failed for #${candidate.number}`);
  const parsed: unknown = JSON.parse(result.stdout);
  if (!parsed || typeof parsed !== 'object') throw new Error(`invalid gh pr view response for #${candidate.number}`);
  const response = parsed as { state?: unknown; mergedAt?: unknown };
  if (response.mergedAt !== null && response.mergedAt !== undefined) return 'merged';
  const state = typeof response.state === 'string' ? response.state.toUpperCase() : '';
  if (state === 'CLOSED') return 'closed';
  if (state === 'OPEN') return 'open';
  if (state === 'MERGED') return 'merged';
  throw new Error(`unknown gh pr state for #${candidate.number}`);
}

export function applyCurrentStatus(
  abandoned: readonly AbandonedDraftPr[],
  lookupCurrentStatus?: LookupCurrentDraftPrStatus,
): AbandonedDraftPrCurrentStatusResult {
  const distribution: AbandonedDraftPrsCurrentStatusDistribution = {
    merged: 0, closed: 0, open: 0, notLookedUp: 0, lookupFailed: 0, reviewNow: 0,
  };
  const statuses: AbandonedDraftPrCurrentStatus[] = [];
  for (const pr of abandoned) {
    let status: AbandonedDraftPrCurrentStatus;
    try {
      status = lookupCurrentStatus ? lookupCurrentStatus(pr) : 'notLookedUp';
    } catch {
      status = 'lookupFailed';
    }
    statuses.push(status);
    distribution[status] += 1;
    if (status === 'open') distribution.reviewNow += 1;
  }
  return { distribution, statuses };
}

function formatMergedGoalLookup(lookup: MergedGoalLookupResult): string {
  if (lookup.state === 'merged') {
    const merged = lookup.mergedPrNumbers.map((number) => `#${number}`).join(' ');
    const superseded = lookup.supersededPrNumbers.map((number) => `#${number}`).join(' ');
    return superseded
      ? `superseded  old: ${superseded}  merged: ${merged}`
      : `merged: ${merged}`;
  }
  if (lookup.state === 'none') return 'lookup: none';
  if (lookup.state === 'unavailable') return 'lookup: unavailable';
  return 'lookup: incomplete';
}

export function renderAbandonedDraftPrs(
  report: AbandonedDraftPrsReport,
  opts: { storeNames?: boolean } = {},
): string {
  const truncated = report.stores.truncated ? 'yes (limit reached)' : 'no';
  const { goalGroups, goalCount } = resolveAbandonedDraftPrGoalView(report);
  const populationEvents = report.populationEvents ?? QUERY_EVENTS;
  const limitation = report.limitation ?? ABANDONED_DRAFT_PRS_LIMITATION;
  const lines = [
    `abandoned draft PRs: ${report.abandonedCount}  goals: ${goalCount}  judged: launched=${report.judged.launched} parked=${report.judged.parked}  skipped=${report.skipped}`,
    `stores: ${report.stores.count}  truncated: ${truncated}  unreadable=${report.stores.unreadable}  rows=${report.stores.rowsCollected}`,
    `population events: ${populationEvents.join(', ')}`,
    `limitation: ${limitation}`,
  ];
  if (opts.storeNames) {
    lines.push(`store names: ${report.stores.names.join(', ') || 'none'}`);
  }
  if (report.lookedUpAt) {
    lines.push(`looked up at: ${report.lookedUpAt}`);
  }
  if (report.currentStatus) {
    const status = report.currentStatus;
    lines.push(`현재 상태 병합됨 ${status.merged} · 닫힘 ${status.closed} · 열림 ${status.open} · 안 물어봤다 ${status.notLookedUp} · 못 쟀다 ${status.lookupFailed} · 지금 볼 것 ${status.reviewNow}`);
    if (status.lookupFailed > 0) {
      lines.push(`⚠️ 조회 실패 ${status.lookupFailed}건 — 「깨끗하다」가 아니라 「못 쟀다」다 (gh 인증·네트워크·저장소 접근을 확인하라)`);
    }
  }
  if (report.runLineage) {
    lines.push(`같은 런 나중 병합 있음 ${report.runLineage.withLaterMerge} · 없음 ${report.runLineage.withoutLaterMerge} · 원장 못 읽음 ${report.runLineage.unreadable}`);
  }
  if (report.domainGap) {
    if (report.domainGap.state === 'unavailable') {
      lines.push(`정의역 — 못 쟀다 (gh 조회 실패: ${report.domainGap.reason})`);
    } else {
      const gap = report.domainGap.unmatchedNumbers.length;
      lines.push(`정의역 — 현재 저장소의 열린 draft 전체 ${report.domainGap.totalOpenDrafts} · 이 자가 이은 것 ${report.domainGap.matchedCandidates} · 못 이은 것 ${gap}`);
      if (gap > 0) lines.push(`못 이은 PR: ${report.domainGap.unmatchedNumbers.map((number) => `#${number}`).join(' ')}`);
    }
  }
  for (const pr of report.abandoned) {
    const stage = pr.stage ?? '(none)';
    const verdict = pr.verdict ?? '(none)';
    const store = pr.store ? `${pr.store}  ` : '';
    const runLineage = pr.runLineage === 'unreadable'
      ? ' · 같은 런 원장 못 읽음'
      : pr.laterMergedInSameRun && pr.laterMergedInSameRun.length > 0
        ? ` · 같은 런 나중 병합: ${pr.laterMergedInSameRun.map((number) => `#${number}`).join(' ')}`
        : '';
    const currentStatus = pr.currentStatus ? ` · 현재 상태=${pr.currentStatus}` : '';
    lines.push(`#${pr.number}  ${store}${pr.branch || '(no-branch)'}  ${pr.openedAt}  stage=${stage}  verdict=${verdict}${currentStatus}${runLineage}`);
    if (pr.url) lines.push(`  ${pr.url}`);
  }
  for (const group of goalGroups) {
    if (group.prNumbers.length < 2 && !group.lookup) continue;
    const label = group.goalId ?? '(none)';
    const numbers = group.prNumbers.map((number) => `#${number}`).join(' ');
    const lookup = group.lookup ? `  ${formatMergedGoalLookup(group.lookup)}` : '';
    lines.push(`goal ${label}: ${numbers}${lookup}`);
  }
  return lines.join('\n');
}

export interface LogsAbandonedDraftPrsOpts {
  test?: boolean;
  instance?: string;
  all?: boolean;
  includeTest?: boolean;
  since?: string;
  limit?: string;
  json?: boolean;
  storeNames?: boolean;
  lookupMerged?: boolean;
  lookupCurrentStatus?: boolean;
  countDomainGap?: boolean;
  runLineage?: boolean;
}

export interface LogsAbandonedDraftPrsDeps {
  exists: typeof existsSync;
  openReadOnly: typeof LogStore.openReadOnly;
  resolveTargets: typeof resolveLogTargets;
  write: (line: string) => void;
  writeError: (line: string) => void;
  analyze?: typeof findAbandonedDraftPrs;
  lookupMerged?: (goalId: string) => readonly MergedPrHead[] | MergedPrLookupResponse;
  lookupCurrentStatus?: LookupCurrentDraftPrStatus;
  lookupOpenDraftPrs?: LookupOpenDraftPrs;
  spawnGh?: (args: readonly string[]) => SpawnGhResult;
  loadRunLedger?: (runId: string) => readonly RunLedgerEntry[] | null;
  now?: () => string;
}

const DEFAULT_DEPS: LogsAbandonedDraftPrsDeps = {
  exists: existsSync,
  openReadOnly: LogStore.openReadOnly,
  resolveTargets: resolveLogTargets,
  write: console.log,
  writeError: console.error,
  now: () => new Date().toISOString(),
};

/** Injectable read-only ledger query used by start-of-run draft triage. */
export function queryAbandonedDraftPrs(
  opts: Pick<LogsAbandonedDraftPrsOpts, 'all' | 'includeTest' | 'since'>,
  deps: Pick<LogsAbandonedDraftPrsDeps, 'exists' | 'openReadOnly' | 'resolveTargets' | 'analyze'> = DEFAULT_DEPS,
): readonly AbandonedDraftPr[] {
  const sinceMs = opts.since ? parseSince(opts.since) : undefined;
  if (opts.since && sinceMs === null) throw new Error(`invalid abandoned-draft since: ${opts.since}`);
  const resolved = deps.resolveTargets({ all: opts.all, includeTest: opts.includeTest });
  if (resolved.error) throw new Error(resolved.error);
  const query: Omit<LogQuery, 'beforeId' | 'limit'> = {
    events: [...QUERY_EVENTS],
    ...(typeof sinceMs === 'number' ? { sinceMs } : {}),
  };
  const abandoned: AbandonedDraftPr[] = [];
  const analyze = deps.analyze ?? findAbandonedDraftPrs;
  for (const target of resolved.targets) {
    if (!deps.exists(target.dbPath)) continue;
    let handle: ReturnType<LogsAbandonedDraftPrsDeps['openReadOnly']>;
    try {
      handle = deps.openReadOnly(target.dbPath);
    } catch (error) {
      if (isExpectedStoreReadError(error)) continue;
      throw error;
    }
    try {
      const scan = collectDegenerateRows(handle, query, STORE_SAFETY_MAX);
      abandoned.push(...analyze(scan.rows, target.name).abandoned);
    } finally {
      handle.close();
    }
  }
  const seen = new Set<string>();
  return abandoned
    .sort((a, b) => b.openedAtMs - a.openedAtMs || b.number - a.number || a.store.localeCompare(b.store))
    .filter((pr) => {
      const key = `${pr.runId ?? ''}\u0000${pr.number}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** `elanous logs abandoned-draft-prs` — 개설됐으나 최종 salvage 가 없는 draft PR 을 세고 이름을 댄다. */
export function runLogsAbandonedDraftPrs(
  opts: LogsAbandonedDraftPrsOpts,
  deps: LogsAbandonedDraftPrsDeps = DEFAULT_DEPS,
): number {
  const limit = opts.limit === undefined ? STORE_SAFETY_MAX : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    deps.writeError('elanous logs abandoned-draft-prs: --limit 은 양의 정수');
    return 1;
  }
  const sinceMs = opts.since ? parseSince(opts.since) : undefined;
  if (opts.since && sinceMs === null) {
    deps.writeError(`elanous logs abandoned-draft-prs: --since 파싱 불가 '${opts.since}' (30s|15m|2h|7d 또는 ISO)`);
    return 1;
  }
  const resolved = deps.resolveTargets({
    test: opts.test,
    instance: opts.instance,
    all: opts.all,
    includeTest: opts.includeTest,
  });
  if (resolved.error) {
    deps.writeError(`elanous logs abandoned-draft-prs: ${resolved.error}`);
    return 1;
  }

  const validSinceMs: number | undefined = sinceMs ?? undefined;
  const query: Omit<LogQuery, 'beforeId' | 'limit'> = {
    events: [...QUERY_EVENTS],
    ...(validSinceMs === undefined ? {} : { sinceMs: validSinceMs }),
  };
  const abandoned: AbandonedDraftPr[] = [];
  const existingTargets = resolved.targets.filter((target) => deps.exists(target.dbPath));
  const names = existingTargets.map((target) => target.name);
  let skipped = 0;
  let launched = 0;
  let parked = 0;
  let remaining = limit;
  let truncated = false;
  let rowsCollected = 0;
  let unreadable = 0;
  const analyze = deps.analyze ?? findAbandonedDraftPrs;
  for (const target of existingTargets) {
    if (remaining === 0) {
      truncated = true;
      break;
    }
    let handle: ReturnType<LogsAbandonedDraftPrsDeps['openReadOnly']>;
    try {
      handle = deps.openReadOnly(target.dbPath);
    } catch (error) {
      if (!isExpectedStoreReadError(error)) throw error;
      unreadable += 1;
      continue;
    }
    try {
      let scan: ReturnType<typeof collectDegenerateRows>;
      try {
        scan = collectDegenerateRows(handle, query, remaining);
      } catch (error) {
        if (!isExpectedStoreReadError(error)) throw error;
        unreadable += 1;
        continue;
      }
      rowsCollected += scan.rows.length;
      remaining -= scan.rows.length;
      truncated ||= scan.truncated;
      const analysis = analyze(scan.rows, target.name);
      abandoned.push(...analysis.abandoned);
      skipped += analysis.skipped;
      launched += analysis.judged.launched;
      parked += analysis.judged.parked;
    } finally {
      handle.close();
    }
  }

  abandoned.sort((a, b) => b.openedAtMs - a.openedAtMs || b.number - a.number || a.store.localeCompare(b.store));
  const goalGroups = groupAbandonedDraftPrsByGoal(abandoned);
  const report: AbandonedDraftPrsReport = {
    abandoned,
    abandonedCount: abandoned.length,
    populationEvents: QUERY_EVENTS,
    limitation: ABANDONED_DRAFT_PRS_LIMITATION,
    judged: { launched, parked, total: launched + parked },
    skipped,
    stores: { count: names.length, names, truncated, rowsCollected, unreadable },
    goalGroups,
    goalCount: goalGroups.length,
  };
  const currentStatus = applyCurrentStatus(
    abandoned,
    opts.lookupCurrentStatus
      ? deps.lookupCurrentStatus ?? ((candidate) => lookupCurrentPrStatus(candidate, deps.spawnGh))
      : undefined,
  );
  report.currentStatus = currentStatus.distribution;
  if (opts.countDomainGap) {
    try {
      const openDrafts = deps.lookupOpenDraftPrs?.() ?? lookupOpenDraftPrs(deps.spawnGh ?? defaultSpawnGh);
      const candidatesWithCurrentStatus = abandoned.map((candidate, index) => ({
        ...candidate,
        currentStatus: currentStatus.statuses[index]!,
      }));
      report.domainGap = calculateAbandonedDraftPrsDomainGap(candidatesWithCurrentStatus, openDrafts);
    } catch (error) {
      report.domainGap = { state: 'unavailable', reason: lookupFailureReason(error) };
    }
  }
  if (opts.runLineage) {
    // 원장은 «방금 읽은 로그 스토어»와 같은 우주에서 찾는다 — 옵션 없이 부르면 test 우주 원장을 못 봐서
    // test 우주에서 모은 draft 가 「원장 못 읽음」이 된다.
    report.runLineage = applyRunLineage(
      abandoned,
      deps.loadRunLedger ?? ((runId) => loadFederatedRunLedger(runId, { targets: existingTargets })),
    );
  }
  if (opts.lookupMerged) {
    if (deps.lookupMerged) {
      for (const group of goalGroups) {
        group.lookup = lookupMergedPrsForGoalGroup(group, deps.lookupMerged);
      }
    } else {
      for (const group of goalGroups) {
        if (group.goalId === null) {
          group.lookup = { state: 'incomplete', mergedPrNumbers: [], supersededPrNumbers: [] };
          continue;
        }
        try {
          const groupAbandoned = abandoned.filter(
            (pr) => extractAbandonedDraftPrGoalId(pr.branch) === group.goalId,
          );
          const snapshot = listMergedPrHeads(deps.spawnGh, {
            mergedSince: mergedSinceFromAbandoned(groupAbandoned),
          });
          group.lookup = classifyMergedGoalLookup(group, snapshot.heads, {
            incomplete: snapshot.incomplete,
            truncated: snapshot.truncated,
          });
        } catch {
          group.lookup = { state: 'unavailable', mergedPrNumbers: [], supersededPrNumbers: [] };
        }
      }
    }
    report.lookedUpAt = (deps.now ?? (() => new Date().toISOString()))();
  }
  report.abandoned = abandoned.map((pr, index) => ({ ...pr, currentStatus: currentStatus.statuses[index]! }));
  deps.write(opts.json ? JSON.stringify(report) : renderAbandonedDraftPrs(report, { storeNames: opts.storeNames }));
  return 0;
}
