// ── logs → 퇴화 검사 ────────────────────────────────────────────────────────
//
// 구조적으로 셀 수 있는 네 퇴화 사실만 낸다. 정상 분포를 추측하거나 별도 임계를
// 정하지 않는다. 표본 기준은 호출자가 주는 minSamples 하나뿐이다.
import { closeSync, existsSync, openSync, readSync, readdirSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { LogQuery, LogStoreRow } from '../mss/logging/log-store.js';
import { LogStore, STORE_SAFETY_MAX } from '../mss/logging/log-store.js';
import { runLedgerDir, runLedgerPath, type RunLedgerEntry } from '../self-implement/run-ledger.js';
import { resolveLogTargets } from './logs-cli.js';

const CANONICAL_RUN_LEDGER_FILE = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
const LEDGER_CATEGORY = 'run-ledger';

type DegenerateVerdict = 'always-same' | 'all-zero' | 'insufficient-sample' | 'monotonic-increase';
type InspectableValue = number | boolean;

interface DegenerateField {
  category: string;
  event: string;
  field: string;
  n: number;
  distinct: number;
  constantValue?: InspectableValue;
  allZero: boolean;
  insufficientSample: boolean;
  alwaysSame: boolean;
  monotonicIncrease: boolean;
  verdict: DegenerateVerdict;
}

interface DegenerateReportRow extends DegenerateField {
  target: string;
  source: 'logs' | 'ledger';
}

interface DegenerateReportSummary {
  source: 'logs' | 'ledger';
  target: string;
  inspectedFields: number;
  skippedTypeFields: number;
}

interface FieldStats {
  n: number;
  values: InspectableValue[];
  allZero: boolean;
}

interface DegenerateDataScan {
  fields: Map<string, FieldStats>;
  inspectedFieldKeys: Set<string>;
  skippedTypeFieldKeys: Set<string>;
}

interface DegenerateScan {
  rows: LogStoreRow[];
  truncated: boolean;
}

function isInspectableValue(value: unknown): value is InspectableValue {
  return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function addFieldStats(scan: DegenerateDataScan, category: string, event: string, data: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(data)) {
    const key = JSON.stringify([category, event, field]);
    if (!isInspectableValue(value)) {
      scan.skippedTypeFieldKeys.add(key);
      continue;
    }
    scan.inspectedFieldKeys.add(key);
    const stats = scan.fields.get(key) ?? { n: 0, values: [], allZero: true };
    stats.n += 1;
    stats.values.push(value);
    stats.allZero &&= value === 0;
    scan.fields.set(key, stats);
  }
}

/** 시간 순으로 줄어든 적이 없고 적어도 한 번은 늘었다. 값이 하나뿐이면 증가가 없다. */
function isMonotonicIncrease(values: readonly InspectableValue[]): boolean {
  let increased = false;
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[i - 1]!) return false;
    if (values[i]! > values[i - 1]!) increased = true;
  }
  return increased;
}

function fieldsFromStats(fields: Map<string, FieldStats>, minSamples: number): DegenerateField[] {
  return [...fields].map(([key, stats]): DegenerateField => {
    const [category, event, field] = JSON.parse(key) as [string, string, string];
    const distinct = new Set(stats.values).size;
    const insufficientSample = stats.n < minSamples;
    const allZero = stats.allZero;
    const alwaysSame = stats.n > 1 && distinct === 1;
    const monotonicIncrease = isMonotonicIncrease(stats.values);
    const verdict: DegenerateVerdict = insufficientSample
      ? 'insufficient-sample'
      : allZero
        ? 'all-zero'
        : alwaysSame
          ? 'always-same'
          : 'monotonic-increase';
    const constantValue = distinct === 1 ? stats.values[0] : undefined;
    return {
      category, event, field, n: stats.n, distinct,
      ...(constantValue === undefined ? {} : { constantValue }),
      allZero, insufficientSample, alwaysSame, monotonicIncrease, verdict,
    };
  }).filter((field) => field.insufficientSample || (field.n > 1 && (field.allZero || field.alwaysSame || field.monotonicIncrease)))
    .sort((a, b) => a.category.localeCompare(b.category) || a.event.localeCompare(b.event) || a.field.localeCompare(b.field));
}

/** `data`의 최상위 유한 수치와 boolean 필드를 category/event/field 별로 판정한다. */
function scanDegenerateDataFields(rows: readonly { category: string; event: string; data: Record<string, unknown> }[], minSamples: number): DegenerateDataScan & { inspectedFields: number; skippedTypeFields: number; degenerateFields: DegenerateField[] } {
  const scan: DegenerateDataScan = { fields: new Map(), inspectedFieldKeys: new Set(), skippedTypeFieldKeys: new Set() };
  for (const row of rows) addFieldStats(scan, row.category, row.event, row.data);
  return {
    ...scan,
    inspectedFields: scan.inspectedFieldKeys.size,
    skippedTypeFields: scan.skippedTypeFieldKeys.size,
    degenerateFields: fieldsFromStats(scan.fields, minSamples),
  };
}

/** 로그 조회는 최근순이므로 값 순서는 오래된 것부터로 맞춘다. */
function chronologicalDataRows(rows: readonly LogStoreRow[]): Array<{ category: string; event: string; data: Record<string, unknown> }> {
  const dataRows: Array<{ category: string; event: string; data: Record<string, unknown> }> = [];
  for (const row of [...rows].sort((a, b) => a.ts_ms - b.ts_ms || a.id - b.id)) {
    if (!row.data) continue;
    let data: unknown;
    try { data = JSON.parse(row.data); } catch { continue; }
    if (!data || Array.isArray(data) || typeof data !== 'object') continue;
    dataRows.push({ category: row.category, event: row.event, data: data as Record<string, unknown> });
  }
  return dataRows;
}

/**
 * `data`의 최상위 유한 수치와 boolean 필드를 category/event/field 별로 판정한다.
 * 파싱할 수 없는 data는 입력 대상이 아니다. string 등 검사하지 않는 타입은 산출에서 센다.
 */
export function findDegenerateFields(rows: readonly LogStoreRow[], minSamples: number): DegenerateField[] {
  return scanDegenerateDataFields(chronologicalDataRows(rows), minSamples).degenerateFields;
}

type LedgerDegenerateQuery = Pick<LogQuery, 'categories' | 'events' | 'sinceMs'>;

export class LedgerScanLimitError extends Error {
  constructor(readonly maxRows: number) {
    super(`run ledger scan exceeded storage safety maximum of ${maxRows} entries`);
    this.name = 'LedgerScanLimitError';
  }
}

function scanLedgerLines(path: string, onLine: (line: string) => void): void {
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder('utf8');
  let remainder = '';
  const consume = (decoded: string): void => {
    const lines = (remainder + decoded).split(/\r?\n/);
    remainder = lines.pop() ?? '';
    for (const line of lines) if (line.length > 0) onLine(line);
  };
  try {
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      consume(decoder.write(buffer.subarray(0, bytesRead)));
    }
    consume(decoder.end());
    if (remainder.length > 0) onLine(remainder);
  } finally {
    closeSync(descriptor);
  }
}

/** Read canonical JSONL ledgers only, retaining field counters and type-exclusion counts. */
export function scanLedgerDegenerateFields(
  dir: string,
  minSamples: number,
  query: LedgerDegenerateQuery = {},
  maxRows = STORE_SAFETY_MAX,
): { inspectedFields: number; skippedTypeFields: number; degenerateFields: DegenerateField[] } {
  const scan: DegenerateDataScan = { fields: new Map(), inspectedFieldKeys: new Set(), skippedTypeFieldKeys: new Set() };
  if (!existsSync(dir) || (query.categories && !query.categories.includes(LEDGER_CATEGORY))) {
    return { inspectedFields: 0, skippedTypeFields: 0, degenerateFields: [] };
  }
  const pending: Array<{ event: string; data: Record<string, unknown>; timestamp: number; order: number }> = [];
  let matchedRows = 0;
  let order = 0;
  for (const fileName of readdirSync(dir)) {
    if (!CANONICAL_RUN_LEDGER_FILE.test(fileName)) continue;
    const runId = fileName.slice(0, -'.jsonl'.length);
    scanLedgerLines(runLedgerPath(runId, dir), (line) => {
      const entry = JSON.parse(line) as Partial<RunLedgerEntry>;
      if (typeof entry.event !== 'string' || (query.events && !query.events.includes(entry.event))) return;
      const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
      if (query.sinceMs !== undefined && (!Number.isFinite(timestamp) || timestamp < query.sinceMs)) return;
      matchedRows += 1;
      if (matchedRows > maxRows) throw new LedgerScanLimitError(maxRows);
      if (!entry.data || Array.isArray(entry.data) || typeof entry.data !== 'object') return;
      pending.push({
        event: entry.event,
        data: entry.data,
        timestamp: Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY,
        order: order++,
      });
    });
  }
  pending.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order);
  for (const item of pending) addFieldStats(scan, LEDGER_CATEGORY, item.event, item.data);
  return {
    inspectedFields: scan.inspectedFieldKeys.size,
    skippedTypeFields: scan.skippedTypeFieldKeys.size,
    degenerateFields: fieldsFromStats(scan.fields, minSamples),
  };
}

export function findLedgerDegenerateFields(
  dir: string,
  minSamples: number,
  query: LedgerDegenerateQuery = {},
  maxRows = STORE_SAFETY_MAX,
): DegenerateField[] {
  return scanLedgerDegenerateFields(dir, minSamples, query, maxRows).degenerateFields;
}

/**
 * 커서를 끝까지 넘겨 창 전체를 읽는다. 저장소 OOM 백스톱보다 많은 행은 판정하지
 * 않는다. 잘린 표본의 all-zero/always-same/monotonic-increase는 전체와 반대일 수 있으므로 출력하지 않는다.
 * 형제 읽기 전용 분석기(`logs abandoned-draft-prs`)도 같은 페이지네이션·상한 계약을 재사용한다.
 * 이 함수의 판정(퇴화 verdict)은 바꾸지 않는다.
 */
export function collectDegenerateRows(
  store: Pick<LogStore, 'query'>,
  query: Omit<LogQuery, 'beforeId' | 'limit'>,
  maxRows = STORE_SAFETY_MAX,
  pageSize = STORE_SAFETY_MAX,
): DegenerateScan {
  const rows: LogStoreRow[] = [];
  let beforeId: number | undefined;
  for (;;) {
    const page = store.query({ ...query, ...(beforeId === undefined ? {} : { beforeId }), limit: pageSize });
    if (page.length === 0) return { rows, truncated: false };
    const remaining = maxRows - rows.length;
    if (page.length > remaining) return { rows: rows.concat(page.slice(0, remaining)), truncated: true };
    rows.push(...page);
    const last = page[page.length - 1]!;
    if (rows.length === maxRows) {
      const probe = store.query({ ...query, beforeId: last.id, limit: 1 });
      return { rows, truncated: probe.length > 0 };
    }
    if (page.length < pageSize) return { rows, truncated: false };
    beforeId = last.id;
  }
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

export interface LogsDegenerateOpts {
  test?: boolean;
  instance?: string;
  all?: boolean;
  includeTest?: boolean;
  category?: string;
  event?: string;
  since?: string;
  minSamples?: string;
}

export interface LogsDegenerateDeps {
  exists: typeof existsSync;
  openReadOnly: typeof LogStore.openReadOnly;
  resolveTargets: typeof resolveLogTargets;
  runLedgerDir: typeof runLedgerDir;
  scanLedgerDegenerateFields: typeof scanLedgerDegenerateFields;
  write: (line: string) => void;
  writeError: (line: string) => void;
}

const DEFAULT_DEPS: LogsDegenerateDeps = {
  exists: existsSync,
  openReadOnly: LogStore.openReadOnly,
  resolveTargets: resolveLogTargets,
  runLedgerDir,
  scanLedgerDegenerateFields,
  write: console.log,
  writeError: console.error,
};

/** `elanous logs degenerate` — 수치·boolean 필드의 퇴화와 검사·제외 수를 NDJSON으로 낸다. */
export function runLogsDegenerate(opts: LogsDegenerateOpts, deps: LogsDegenerateDeps = DEFAULT_DEPS): number {
  const minSamples = Number(opts.minSamples ?? '50');
  if (!Number.isInteger(minSamples) || minSamples < 1) {
    deps.writeError('elanous logs degenerate: --min-samples 는 양의 정수');
    return 1;
  }
  const sinceMs = opts.since ? parseSince(opts.since) : undefined;
  if (opts.since && sinceMs === null) {
    deps.writeError(`elanous logs degenerate: --since 파싱 불가 '${opts.since}' (30s|15m|2h|7d 또는 ISO)`);
    return 1;
  }
  const resolved = deps.resolveTargets({ test: opts.test, instance: opts.instance, all: opts.all, includeTest: opts.includeTest });
  if (resolved.error) { deps.writeError(`elanous logs degenerate: ${resolved.error}`); return 1; }
  const validSinceMs: number | undefined = sinceMs ?? undefined;
  const query: LedgerDegenerateQuery = {
    ...(opts.category ? { categories: opts.category.split(',').map((value) => value.trim()).filter(Boolean) } : {}),
    ...(opts.event ? { events: opts.event.split(',').map((value) => value.trim()).filter(Boolean) } : {}),
    ...(validSinceMs === undefined ? {} : { sinceMs: validSinceMs }),
  };

  const reports: DegenerateReportRow[] = [];
  const summaries: DegenerateReportSummary[] = [];
  for (const target of resolved.targets) {
    if (!deps.exists(target.dbPath)) continue;
    const store = deps.openReadOnly(target.dbPath);
    try {
      const scan = collectDegenerateRows(store, query);
      if (scan.truncated) {
        deps.writeError(`elanous logs degenerate: ${target.name} 스캔이 저장소 안전 상한에서 잘렸다 — 창을 좁혀라(--since).`);
        return 1;
      }
      const dataScan = scanDegenerateDataFields(chronologicalDataRows(scan.rows), minSamples);
      for (const field of dataScan.degenerateFields) reports.push({ source: 'logs', target: target.name, ...field });
      summaries.push({ source: 'logs', target: target.name, inspectedFields: dataScan.inspectedFields, skippedTypeFields: dataScan.skippedTypeFields });
    } finally { store.close(); }
  }
  let ledgerScan: ReturnType<typeof scanLedgerDegenerateFields>;
  try {
    ledgerScan = deps.scanLedgerDegenerateFields(deps.runLedgerDir(), minSamples, query);
  } catch (error) {
    if (error instanceof LedgerScanLimitError) {
      deps.writeError(`elanous logs degenerate: run-ledger 스캔이 저장소 안전 상한에서 잘렸다 — 창을 좁혀라(--since).`);
      return 1;
    }
    throw error;
  }
  for (const field of ledgerScan.degenerateFields) reports.push({ source: 'ledger', target: 'run-ledger', ...field });
  summaries.push({ source: 'ledger', target: 'run-ledger', inspectedFields: ledgerScan.inspectedFields, skippedTypeFields: ledgerScan.skippedTypeFields });
  for (const report of reports) deps.write(JSON.stringify(report));
  for (const summary of summaries) deps.write(JSON.stringify(summary));
  return 0;
}
