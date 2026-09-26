// ── logs → 필드 존재 기간 ────────────────────────────────────────────────────
//
// 최상위 data 필드의 존재·관측 타입·시간 범위를 NDJSON으로 내고, 요청 시 primitive 값 분포를 붙인다.
import { existsSync } from 'node:fs';
import type { LogQuery, LogStoreRow } from '../mss/logging/log-store.js';
import { LogStore } from '../mss/logging/log-store.js';
import { collectDegenerateRows } from './logs-degenerate.js';
import { resolveLogTargets } from './logs-cli.js';

export interface LogsFieldsOpts {
  test?: boolean;
  instance?: string;
  all?: boolean;
  includeTest?: boolean;
  category?: string;
  exactCategory?: string;
  event?: string;
  since?: string;
  limit?: string;
  values?: string | boolean;
}

export interface LogsFieldsDeps {
  exists: typeof existsSync;
  openReadOnly: typeof LogStore.openReadOnly;
  resolveTargets: typeof resolveLogTargets;
  write: (line: string) => void;
  writeError: (line: string) => void;
}

interface ValueStats {
  value: string | number | boolean;
  n: number;
}

interface FieldStats {
  n: number;
  types: Set<string>;
  firstSeen: { ts: string; ms: number };
  lastSeen: { ts: string; ms: number };
  values?: Map<string, ValueStats>;
  valuesCapped?: boolean;
}

const DEFAULT_VALUE_LIMIT = 10;
const MAX_DISTINCT_VALUES = 1_000;
const MAX_VALUE_STRING_LENGTH = 200;

const DEFAULT_DEPS: LogsFieldsDeps = {
  exists: existsSync,
  openReadOnly: LogStore.openReadOnly,
  resolveTargets: resolveLogTargets,
  write: console.log,
  writeError: console.error,
};

function parseSince(raw: string): number | null {
  const relative = /^(\d+)(s|m|h|d)$/.exec(raw.trim());
  if (relative) {
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2] as 's' | 'm' | 'h' | 'd'];
    return Date.now() - Number(relative[1]) * unit;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function csv(raw: string | undefined): string[] | undefined {
  const values = raw?.split(',').map((value) => value.trim()).filter(Boolean);
  return values?.length ? values : undefined;
}

function observedType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function sampledValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

function displayValue(value: string | number | boolean): string | number | boolean {
  return typeof value === 'string' ? value.slice(0, MAX_VALUE_STRING_LENGTH) : value;
}

interface LogFieldValue {
  value: string | number | boolean;
  n: number;
}

interface LogFieldReport {
  category: string;
  event: string;
  field: string;
  n: number;
  total: number;
  types: string[];
  firstSeen: string;
  lastSeen: string;
  firstSeenScope: 'complete' | 'within-query-window';
  distinct?: number;
  values?: LogFieldValue[];
  valuesTruncated?: boolean;
  valuesCapped?: boolean;
}

export function findLogFields(rows: readonly LogStoreRow[], withinQueryWindow: boolean, valueLimit?: number): LogFieldReport[] {
  const totals = new Map<string, number>();
  const fields = new Map<string, FieldStats>();
  for (const row of rows) {
    const eventKey = JSON.stringify([row.category, row.event]);
    totals.set(eventKey, (totals.get(eventKey) ?? 0) + 1);
    if (!row.data) continue;
    let data: unknown;
    try { data = JSON.parse(row.data); } catch { continue; }
    if (!data || Array.isArray(data) || typeof data !== 'object') continue;
    for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
      const key = JSON.stringify([row.category, row.event, field]);
      const seen = { ts: row.ts, ms: row.ts_ms };
      const stats = fields.get(key) ?? { n: 0, types: new Set<string>(), firstSeen: seen, lastSeen: seen, ...(valueLimit === undefined ? {} : { values: new Map<string, ValueStats>() }) };
      stats.n += 1;
      stats.types.add(observedType(value));
      const sampled = sampledValue(value);
      if (sampled !== undefined && stats.values) {
        const valueKey = JSON.stringify([typeof sampled, sampled]);
        const current = stats.values.get(valueKey);
        if (current) current.n += 1;
        else if (stats.values.size < MAX_DISTINCT_VALUES) {
          stats.values.set(valueKey, { value: sampled, n: 1 });
        } else stats.valuesCapped = true;
      }
      if (seen.ms < stats.firstSeen.ms) stats.firstSeen = seen;
      if (seen.ms > stats.lastSeen.ms) stats.lastSeen = seen;
      fields.set(key, stats);
    }
  }
  const firstSeenScope: 'complete' | 'within-query-window' = withinQueryWindow ? 'within-query-window' : 'complete';
  return [...fields].map(([key, stats]) => {
    const [category, event, field] = JSON.parse(key) as [string, string, string];
    const report: LogFieldReport = { category, event, field, n: stats.n, total: totals.get(JSON.stringify([category, event]))!, types: [...stats.types].sort(), firstSeen: stats.firstSeen.ts, lastSeen: stats.lastSeen.ts, firstSeenScope };
    if (stats.values && valueLimit !== undefined) {
      const values = [...stats.values.values()].sort((a, b) => b.n - a.n || String(a.value).localeCompare(String(b.value)));
      report.distinct = values.length;
      report.values = values.slice(0, valueLimit).map(({ value, n }) => ({ value: displayValue(value), n }));
      report.valuesTruncated = stats.valuesCapped === true || values.length > valueLimit;
      if (stats.valuesCapped) report.valuesCapped = true;
    }
    return report;
  }).sort((a, b) => a.category.localeCompare(b.category) || a.event.localeCompare(b.event) || a.field.localeCompare(b.field));
}

/** `elanous logs fields` — 모든 최상위 data 필드의 존재 기간을 target별 NDJSON으로 낸다. */
export function runLogsFields(opts: LogsFieldsOpts, deps: LogsFieldsDeps = DEFAULT_DEPS): number {
  const sinceMs = opts.since ? parseSince(opts.since) : undefined;
  if (opts.since && sinceMs === null) {
    deps.writeError(`elanous logs fields: --since 파싱 불가 '${opts.since}' (30s|15m|2h|7d 또는 ISO)`);
    return 1;
  }
  const limit = opts.limit === undefined ? undefined : Number(opts.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    deps.writeError('elanous logs fields: --limit 은 양의 정수');
    return 1;
  }
  const valueLimit = opts.values === undefined ? undefined : opts.values === true ? DEFAULT_VALUE_LIMIT : Number(opts.values);
  if (valueLimit !== undefined && (!Number.isInteger(valueLimit) || valueLimit < 1)) {
    deps.writeError('elanous logs fields: --values 는 양의 정수');
    return 1;
  }
  const resolved = deps.resolveTargets({ test: opts.test, instance: opts.instance, all: opts.all, includeTest: opts.includeTest });
  if (resolved.error) { deps.writeError(`elanous logs fields: ${resolved.error}`); return 1; }
  const validSinceMs: number | undefined = sinceMs ?? undefined;
  const query: Omit<LogQuery, 'beforeId' | 'limit'> = {
    ...(csv(opts.category) ? { categories: csv(opts.category) } : {}),
    ...(csv(opts.exactCategory) ? { exactCategories: csv(opts.exactCategory) } : {}),
    ...(csv(opts.event) ? { events: csv(opts.event) } : {}),
    ...(validSinceMs === undefined ? {} : { sinceMs: validSinceMs }),
  };
  for (const target of resolved.targets) {
    if (!deps.exists(target.dbPath)) continue;
    const store = deps.openReadOnly(target.dbPath);
    try {
      const scan = collectDegenerateRows(store, query, limit);
      for (const field of findLogFields(scan.rows, scan.truncated || validSinceMs !== undefined, valueLimit)) deps.write(JSON.stringify({ source: 'logs', target: target.name, ...field }));
      deps.write(JSON.stringify({ source: 'logs', target: target.name, rows: scan.rows.length, truncated: scan.truncated, kind: 'summary' }));
    } finally { store.close(); }
  }
  return 0;
}
