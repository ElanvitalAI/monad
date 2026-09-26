import { existsSync } from 'node:fs';
import type { LogQuery, LogStoreRow } from '../mss/logging/log-store.js';
import { LogStore, STORE_SAFETY_MAX } from '../mss/logging/log-store.js';
import { resolveLogTargets } from './logs-cli.js';

type DurationPath = 'chat-surface' | 'headless-core';
interface DurationToolStats { tool: string; count: number; medianMs: number; p90Ms: number; maxMs: number; }
interface DurationPathReport { path: DurationPath; sampleStatus: 'ok' | 'no-samples'; tools: DurationToolStats[]; unmatched: number; }
interface DurationReport { instances: number; rows: number; truncated: boolean; paths: DurationPathReport[]; }
export interface LogsToolDurationsOpts { test?: boolean; instance?: string; all?: boolean; includeTest?: boolean; limit?: string; json?: boolean; }
export interface LogsToolDurationsDeps {
  exists: typeof existsSync;
  openReadOnly: typeof LogStore.openReadOnly;
  resolveTargets: typeof resolveLogTargets;
  write: (line: string) => void;
  writeError: (line: string) => void;
}

interface DurationScan { rows: LogStoreRow[]; readRows: number; truncated: boolean; }
interface DurationPair { path: DurationPath; startCategory: string; startEvent: string; endCategory: string; endEvent: string; }
interface CollectedDurationRow extends LogStoreRow { readonly durationTarget: string; }
const PAIRS: readonly DurationPair[] = [
  { path: 'chat-surface', startCategory: 'chat.tool-call', startEvent: '', endCategory: 'chat.tool-result', endEvent: '' },
  { path: 'headless-core', startCategory: 'core.turn', startEvent: 'dispatch', endCategory: 'core.turn', endEvent: 'dispatch-done' },
];
const DURATION_CATEGORIES = [...new Set(PAIRS.flatMap((pair) => [pair.startCategory, pair.endCategory]))];
const DEFAULT_DEPS: LogsToolDurationsDeps = { exists: existsSync, openReadOnly: LogStore.openReadOnly, resolveTargets: resolveLogTargets, write: console.log, writeError: console.error };

function isDurationRow(row: LogStoreRow): boolean {
  return PAIRS.some((pair) => (row.category === pair.startCategory && (pair.startEvent === '' || row.event === pair.startEvent))
    || (row.category === pair.endCategory && (pair.endEvent === '' || row.event === pair.endEvent)));
}

/**
 * Selects one target's newest relevant rows as a single time range. A probe is
 * only counted as truncation when it finds a real additional relevant row.
 */
/** ⛔⭐⭐ 리뷰 must-fix 2라운드(사후 리뷰 · 2026-08-19): 1차 수리는 «불완전»했다.
 *  「필요한 만큼 얻으면 그만 읽는다」로 «루프»는 끊었지만, ***첫 페이지 자체가*** `STORE_SAFETY_MAX`
 *  였다. 그래서 `--limit 2` 를 줘도 첫 조회가 수만 행을 읽었다 — `--limit` 이 여전히
 *  「조회」가 아니라 「산출」만 자른 것이다.
 *  ⊕ 그리고 그때의 테스트는 `pageSize=2` 를 «주입»해 통과했다 ⇒ 실제 기본 경로를 «한 번도 안 탔다»
 *    (리뷰가 GOODHART 로 지목한 그것).
 *
 *  ✅ 수리: 첫 페이지를 ***`maxRows + 1`***(「더 있다」를 증명할 한 행 포함)에서 시작하고,
 *    한 페이지의 «관련 행 수확률»이 낮으면 페이지를 «키운다»(상한 `STORE_SAFETY_MAX`).
 *    ⇒ 좁은 `--limit` 은 첫 조회부터 좁고, 관련 행이 드문 스토어에서도 페이지 수가 폭발하지 않는다.
 *  ⚠️ `initialPageSize` 는 «테스트 전용 주입»이 아니라 기본값이 계산된다 — 기본 경로가 테스트를 탄다. */
export function collectDurationRows(
  store: Pick<LogStore, 'query'>,
  query: Omit<LogQuery, 'beforeId' | 'limit'>,
  maxRows: number,
  maxPageSize = STORE_SAFETY_MAX,
): DurationScan {
  const rows: LogStoreRow[] = [];
  let readRows = 0;
  let beforeId: number | undefined;
  // 「더 있다」를 증명하려면 maxRows 보다 «한 행» 더 필요하다.
  let pageSize = Math.max(1, Math.min(maxPageSize, maxRows + 1));
  for (;;) {
    const page = store.query({ ...query, ...(beforeId === undefined ? {} : { beforeId }), limit: pageSize });
    readRows += page.length;
    const before = rows.length;
    for (const row of page) {
      if (!isDurationRow(row)) continue;
      rows.push(row);
    }
    if (rows.length > maxRows) break;
    if (page.length < pageSize) break;
    beforeId = page[page.length - 1]!.id;
    // 이 페이지에서 «관련 행이 절반도 안 나왔으면» 다음 페이지를 키운다 —
    // 안 키우면 관련 행이 드문 스토어에서 페이지 수만 늘고 읽는 양은 안 준다.
    if (rows.length - before < page.length / 2) pageSize = Math.min(maxPageSize, pageSize * 4);
  }
  const newest = rows.sort((a, b) => b.ts_ms - a.ts_ms || b.id - a.id);
  return { rows: newest.slice(0, maxRows), readRows, truncated: newest.length > maxRows };
}

function parsedData(row: LogStoreRow): Record<string, unknown> | null {
  if (!row.data) return null;
  try { const data: unknown = JSON.parse(row.data); return data && !Array.isArray(data) && typeof data === 'object' ? data as Record<string, unknown> : null; } catch { return null; }
}
function stringField(data: Record<string, unknown> | null, field: string): string | null {
  const value = data?.[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function coreKey(row: LogStoreRow, data: Record<string, unknown> | null): string | null {
  const sessionId = stringField(data, 'sessionId') ?? row.session_id;
  const dispatchCount = data?.dispatchCount;
  return sessionId && Number.isInteger(dispatchCount) && (dispatchCount as number) > 0 ? `${row.instance}\u0000${sessionId}\u0000${dispatchCount}` : null;
}
function chatKey(row: LogStoreRow, data: Record<string, unknown> | null): string | null {
  const id = stringField(data, 'id');
  return id ? `${row.instance}\u0000${row.session_id ?? ''}\u0000${id}` : null;
}
function pairKey(path: DurationPath, row: LogStoreRow, data: Record<string, unknown> | null): string | null {
  const local = path === 'chat-surface' ? chatKey(row, data) : coreKey(row, data);
  return local ? `${(row as CollectedDurationRow).durationTarget ?? ''}\u0000${local}` : null;
}
function isStart(pair: DurationPair, row: LogStoreRow): boolean { return row.category === pair.startCategory && (pair.startEvent === '' || row.event === pair.startEvent); }
function isEnd(pair: DurationPair, row: LogStoreRow): boolean { return row.category === pair.endCategory && (pair.endEvent === '' || row.event === pair.endEvent); }

/** Pairs only producer-confirmed start/end events from the same target. Every non-paired row is counted as unmatched. */
function summarizePath(pair: DurationPair, rows: readonly LogStoreRow[]): DurationPathReport {
  const pending = new Map<string, string>();
  const samples = new Map<string, number[]>();
  let unmatched = 0;
  for (const row of [...rows].sort((a, b) => a.ts_ms - b.ts_ms || a.id - b.id)) {
    const data = parsedData(row);
    if (isStart(pair, row)) {
      const key = pairKey(pair.path, row, data);
      const tool = pair.path === 'chat-surface' ? row.event : stringField(data, 'tool');
      if (!key || !tool || pending.has(key)) { unmatched += 1; continue; }
      pending.set(key, tool);
      continue;
    }
    if (!isEnd(pair, row)) continue;
    const key = pairKey(pair.path, row, data);
    const completedTool = pair.path === 'chat-surface' ? row.event : stringField(data, 'tool');
    const duration = pair.path === 'chat-surface' ? data?.elapsedMs : data?.durationMs;
    const startedTool = key ? pending.get(key) : undefined;
    if (!key || !startedTool) { unmatched += 1; continue; }
    if (!completedTool || startedTool !== completedTool || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      pending.delete(key);
      unmatched += 2;
      continue;
    }
    pending.delete(key);
    const values = samples.get(startedTool) ?? [];
    values.push(duration);
    samples.set(startedTool, values);
  }
  unmatched += pending.size;
  const tools = [...samples].map(([tool, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const middle = n / 2;
    return { tool, count: n, medianMs: n % 2 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2, p90Ms: sorted[Math.ceil(n * 0.9) - 1]!, maxMs: sorted[n - 1]! };
  }).sort((a, b) => a.tool.localeCompare(b.tool));
  return { path: pair.path, sampleStatus: tools.length ? 'ok' : 'no-samples', tools, unmatched };
}

export function summarizeToolDurations(rows: readonly LogStoreRow[]): DurationReport {
  return { instances: 0, rows: rows.length, truncated: false, paths: PAIRS.map((pair) => summarizePath(pair, rows)) };
}
export function renderToolDurations(report: DurationReport): string {
  const lines = [`tool durations: instances=${report.instances} rows=${report.rows} truncated=${report.truncated ? 'yes (limit reached)' : 'no'}`];
  for (const path of report.paths) {
    lines.push(`\n${path.path}: ${path.sampleStatus === 'no-samples' ? '표본 없음' : 'samples'}; unmatched=${path.unmatched}`);
    if (path.tools.length) {
      lines.push('tool\tcount\tmedianMs\tp90Ms\tmaxMs');
      for (const tool of path.tools) lines.push(`${tool.tool}\t${tool.count}\t${tool.medianMs}\t${tool.p90Ms}\t${tool.maxMs}`);
    }
  }
  return lines.join('\n');
}

export function runLogsToolDurations(opts: LogsToolDurationsOpts, deps: LogsToolDurationsDeps = DEFAULT_DEPS): number {
  const limit = opts.limit === undefined ? STORE_SAFETY_MAX : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1) { deps.writeError('elanous logs durations: --limit 은 양의 정수'); return 1; }
  const resolved = deps.resolveTargets({ test: opts.test, instance: opts.instance, all: opts.all, includeTest: opts.includeTest });
  if (resolved.error) { deps.writeError(`elanous logs durations: ${resolved.error}`); return 1; }
  const allRows: CollectedDurationRow[] = [];
  let rowsRead = 0;
  let truncated = false;
  let instances = 0;
  for (const target of resolved.targets) {
    if (!deps.exists(target.dbPath)) continue;
    instances += 1;
    const store = deps.openReadOnly(target.dbPath);
    try {
      const scan = collectDurationRows(store, { exactCategories: DURATION_CATEGORIES }, limit);
      allRows.push(...scan.rows.map((row) => ({ ...row, durationTarget: target.name })));
      rowsRead += scan.readRows;
      truncated ||= scan.truncated;
    } finally { store.close(); }
  }
  const report = summarizeToolDurations(allRows);
  report.instances = instances;
  report.rows = rowsRead;
  report.truncated = truncated;
  deps.write(opts.json ? JSON.stringify(report) : renderToolDurations(report));
  return 0;
}
