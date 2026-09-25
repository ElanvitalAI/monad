import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogStoreRow } from '../mss/logging/log-store.js';
import { LogStore } from '../mss/logging/log-store.js';
import type { RunLedgerEntry } from '../self-implement/run-ledger.js';
import { collectDegenerateRows, findDegenerateFields, findLedgerDegenerateFields, LedgerScanLimitError, runLogsDegenerate, scanLedgerDegenerateFields, type LogsDegenerateDeps } from './logs-degenerate.js';

let nextId = 1;
function row(event: string, data: Record<string, unknown>): LogStoreRow {
  const tsMs = nextId;
  return {
    id: nextId++, ts: new Date(tsMs).toISOString(), ts_ms: tsMs, level: 'info',
    instance: 'prod', surface: 'harness', category: 'self-implement', event,
    session_id: null, trace_id: null, data: JSON.stringify(data),
  };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function createStore(name: string, records: Array<{ category: string; event: string; data: Record<string, unknown> }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'logs-degenerate-'));
  dirs.push(dir);
  const path = join(dir, `${name}.db`);
  const store = new LogStore(path);
  store.insertBatch(records.map((record) => ({
    rec: { ts: new Date().toISOString(), ...record }, surface: 'test',
  })));
  store.close();
  return path;
}

function depsFor(paths: Array<{ name: string; dbPath: string }>, output: string[], errors: string[]): LogsDegenerateDeps {
  return {
    exists: existsSync,
    openReadOnly: LogStore.openReadOnly,
    resolveTargets: () => ({ targets: paths }),
    runLedgerDir: () => join(tmpdir(), 'missing-run-ledger'),
    scanLedgerDegenerateFields: () => ({ inspectedFields: 0, skippedTypeFields: 0, degenerateFields: [] }),
    write: (line) => output.push(line),
    writeError: (line) => errors.push(line),
  };
}

describe('findDegenerateFields', () => {
  test('시험 입력 표를 글자 그대로 판정한다', () => {
    const rows = [
      ...Array.from({ length: 184 }, () => row('run-rollup', { repeatedReviewFindingCount: 0 })),
      ...Array.from({ length: 1 }, () => row('decomposition-shadow', { candidatePieceCount: 26 })),
      ...Array.from({ length: 90 }, () => row('run-rollup', { roundCount: 2 })),
    ];

    expect(findDegenerateFields(rows, 50)).toEqual([
      { category: 'self-implement', event: 'decomposition-shadow', field: 'candidatePieceCount', n: 1, distinct: 1, constantValue: 26, allZero: false, insufficientSample: true, alwaysSame: false, monotonicIncrease: false, verdict: 'insufficient-sample' },
      { category: 'self-implement', event: 'run-rollup', field: 'repeatedReviewFindingCount', n: 184, distinct: 1, constantValue: 0, allZero: true, insufficientSample: false, alwaysSame: true, monotonicIncrease: false, verdict: 'all-zero' },
      { category: 'self-implement', event: 'run-rollup', field: 'roundCount', n: 90, distinct: 1, constantValue: 2, allZero: false, insufficientSample: false, alwaysSame: true, monotonicIncrease: false, verdict: 'always-same' },
    ]);
  });

  test('minSamples 미만은 all-zero보다 먼저 insufficient-sample 이다', () => {
    expect(findDegenerateFields([row('run-rollup', { repeatedReviewFindingCount: 0 })], 50))
      .toMatchObject([{ verdict: 'insufficient-sample', allZero: true }]);
  });

  test('false와 0 상수는 보존하고 다중 값 필드는 constantValue를 넣지 않는다', () => {
    const rows = [
      row('constant-values', { applied: false, retries: 0, varying: 0 }),
      row('constant-values', { applied: false, retries: 0, varying: 1 }),
    ];
    const fields = findDegenerateFields(rows, 3);

    expect(fields).toContainEqual(expect.objectContaining({ field: 'applied', distinct: 1, constantValue: false }));
    expect(fields).toContainEqual(expect.objectContaining({ field: 'retries', distinct: 1, constantValue: 0 }));
    expect(fields.find((field) => field.field === 'varying')).toEqual(expect.objectContaining({ distinct: 2 }));
    expect(Object.hasOwn(fields.find((field) => field.field === 'applied')!, 'constantValue')).toBe(true);
    expect(Object.hasOwn(fields.find((field) => field.field === 'retries')!, 'constantValue')).toBe(true);
    expect(Object.hasOwn(fields.find((field) => field.field === 'varying')!, 'constantValue')).toBe(false);
  });

  test('decomposition-shadow의 동일 boolean을 always-same으로 내고 string은 검사하지 않는다', () => {
    const rows = Array.from({ length: 12 }, () => row('decomposition-shadow', { splittable: false, note: 'excluded' }));

    expect(findDegenerateFields(rows, 12)).toEqual([
      { category: 'self-implement', event: 'decomposition-shadow', field: 'splittable', n: 12, distinct: 1, constantValue: false, allZero: false, insufficientSample: false, alwaysSame: true, monotonicIncrease: false, verdict: 'always-same' },
    ]);
  });

  test('단일 표본은 minSamples=1이어도 변별 없음으로 산출하지 않는다', () => {
    expect(findDegenerateFields([row('run-rollup', { repeatedReviewFindingCount: 0 })], 1)).toEqual([]);
  });

  test('최근순 1,2,3,4,5는 오래된 순으로 뒤집어 monotonic-increase 이다', () => {
    const chronological = [1, 2, 3, 4, 5].map((value) => row('run-rollup', { registeredCount: value }));
    const newestFirst = [...chronological].reverse();

    expect(findDegenerateFields(newestFirst, 5)).toEqual([
      { category: 'self-implement', event: 'run-rollup', field: 'registeredCount', n: 5, distinct: 5, allZero: false, insufficientSample: false, alwaysSame: false, monotonicIncrease: true, verdict: 'monotonic-increase' },
    ]);
  });

  test('시간 순 3,1,4,1,5는 산출하지 않는다', () => {
    const chronological = [3, 1, 4, 1, 5].map((value) => row('run-rollup', { registeredCount: value }));
    expect(findDegenerateFields([...chronological].reverse(), 5)).toEqual([]);
  });

  test('시간 순 7,7,7,7,7은 always-same 이고 새 이름이 아니다', () => {
    const rows = [7, 7, 7, 7, 7].map((value) => row('run-rollup', { registeredCount: value }));
    expect(findDegenerateFields(rows, 5)).toEqual([
      { category: 'self-implement', event: 'run-rollup', field: 'registeredCount', n: 5, distinct: 1, constantValue: 7, allZero: false, insufficientSample: false, alwaysSame: true, monotonicIncrease: false, verdict: 'always-same' },
    ]);
  });

  test('시간 순 0,0,0,0,0은 all-zero 이고 새 이름이 아니다', () => {
    const rows = [0, 0, 0, 0, 0].map((value) => row('run-rollup', { registeredCount: value }));
    expect(findDegenerateFields(rows, 5)).toEqual([
      { category: 'self-implement', event: 'run-rollup', field: 'registeredCount', n: 5, distinct: 1, constantValue: 0, allZero: true, insufficientSample: false, alwaysSame: true, monotonicIncrease: false, verdict: 'all-zero' },
    ]);
  });

  test('approve 상수는 always-same 이고 새 이름이 아니다', () => {
    const rows = Array.from({ length: 5 }, () => {
      const record = row('approval-shadow', { approve: false });
      return { ...record, category: 'harness.boundary' };
    });
    expect(findDegenerateFields(rows, 5)).toEqual([
      { category: 'harness.boundary', event: 'approval-shadow', field: 'approve', n: 5, distinct: 1, constantValue: false, allZero: false, insufficientSample: false, alwaysSame: true, monotonicIncrease: false, verdict: 'always-same' },
    ]);
  });
});

describe('collectDegenerateRows', () => {
  test('첫 페이지의 all-zero를 더 오래된 값이 반증하면 커서를 넘겨 확정 verdict를 내지 않는다', () => {
    const rows = [row('run-rollup', { repeatedReviewFindingCount: 1 }), row('run-rollup', { repeatedReviewFindingCount: 0 }), row('run-rollup', { repeatedReviewFindingCount: 0 })];
    const store = {
      query: ({ beforeId, limit = rows.length }: { beforeId?: number; limit?: number }) => rows
        .filter((candidate) => beforeId === undefined || candidate.id < beforeId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit),
    } as Pick<LogStore, 'query'>;
    const scan = collectDegenerateRows(store, {}, 10, 2);

    expect(findDegenerateFields(store.query({ limit: 2 }), 2)).toMatchObject([{ verdict: 'all-zero' }]);
    expect(scan).toMatchObject({ truncated: false });
    expect(findDegenerateFields(scan.rows, 2)).toEqual([]);
  });

  test('실제 read-only SQLite 저장소를 복합 커서로 두 페이지 이상 읽는다', () => {
    const path = createStore('paged', [
      { category: 'self-implement', event: 'run-rollup', data: { repeatedReviewFindingCount: 0 } },
      { category: 'self-implement', event: 'run-rollup', data: { repeatedReviewFindingCount: 1 } },
      { category: 'self-implement', event: 'run-rollup', data: { repeatedReviewFindingCount: 0 } },
    ]);
    const store = LogStore.openReadOnly(path);
    try {
      const scan = collectDegenerateRows(store, { categories: ['self-implement'] }, 10, 1);
      expect(scan).toMatchObject({ truncated: false });
      expect(scan.rows).toHaveLength(3);
      expect(findDegenerateFields(scan.rows, 2)).toEqual([]);
    } finally { store.close(); }
  });

  test('안전 상한에서 더 오래된 행이 남으면 truncated로 판정을 거부한다', () => {
    const rows = [row('run-rollup', { repeatedReviewFindingCount: 0 }), row('run-rollup', { repeatedReviewFindingCount: 0 }), row('run-rollup', { repeatedReviewFindingCount: 1 })];
    const store = {
      query: ({ beforeId, limit = rows.length }: { beforeId?: number; limit?: number }) => rows
        .filter((candidate) => beforeId === undefined || candidate.id < beforeId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit),
    } as Pick<LogStore, 'query'>;

    expect(collectDegenerateRows(store, {}, 2, 2)).toMatchObject({ truncated: true });
  });

  test('events 필터를 그대로 넘겨 형제 분석기가 같은 페이지네이션을 재사용한다', () => {
    const seen: Array<{ events?: string[]; limit?: number }> = [];
    const rows = [row('rework-blocked-draft-pr', { number: 1 }), row('rework-salvage', { action: 'parked' })];
    const store = {
      query: (query: { beforeId?: number; limit?: number; events?: string[] }) => {
        seen.push({ events: query.events, limit: query.limit });
        return rows
          .filter((candidate) => query.beforeId === undefined || candidate.id < query.beforeId)
          .sort((a, b) => b.id - a.id)
          .slice(0, query.limit ?? rows.length);
      },
    } as Pick<LogStore, 'query'>;

    const scan = collectDegenerateRows(store, { events: ['rework-blocked-draft-pr', 'rework-salvage'] }, 10, 10);
    expect(seen[0]?.events).toEqual(['rework-blocked-draft-pr', 'rework-salvage']);
    expect(scan).toMatchObject({ truncated: false });
    expect(scan.rows).toHaveLength(2);
  });
});

describe('runLogsDegenerate — read-only storage path', () => {
  test('--include-test 전달은 생략과 명시를 구분한다', () => {
    const output: string[] = [];
    const errors: string[] = [];
    const selected: Array<{ test?: boolean; instance?: string; all?: boolean; includeTest?: boolean }> = [];
    const deps = depsFor([], output, errors);
    deps.resolveTargets = (opts) => {
      selected.push(opts);
      return { targets: [] };
    };

    expect(runLogsDegenerate({ minSamples: '2', all: true }, deps)).toBe(0);
    expect(runLogsDegenerate({ minSamples: '2', all: true, includeTest: true }, deps)).toBe(0);
    expect(selected).toEqual([
      { test: undefined, instance: undefined, all: true, includeTest: undefined },
      { test: undefined, instance: undefined, all: true, includeTest: true },
    ]);
  });

  test('원장 JSONL의 시험 입력 표를 읽어 source별 NDJSON으로 낸다', () => {
    const ledgerDir = mkdtempSync(join(tmpdir(), 'logs-degenerate-ledger-'));
    dirs.push(ledgerDir);
    const runId = 'run-00000000-0000-0000-0000-000000000000';
    const entries: RunLedgerEntry[] = [
      ...Array.from({ length: 184 }, (): RunLedgerEntry => ({ timestamp: '2026-08-08T00:00:00.000Z', runId, event: 'run-rollup', data: { repeatedReviewFindingCount: 0 } })),
      ...Array.from({ length: 3 }, (): RunLedgerEntry => ({ timestamp: '2026-08-08T00:00:00.000Z', runId, event: 'run-rollup', data: { roundCount: 2 } })),
    ];
    const path = join(ledgerDir, `${runId}.jsonl`);
    writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    const before = readFileSync(path, 'utf8');
    const output: string[] = [];
    const errors: string[] = [];
    const deps = depsFor([], output, errors);
    deps.runLedgerDir = () => ledgerDir;
    deps.scanLedgerDegenerateFields = scanLedgerDegenerateFields;

    expect(runLogsDegenerate({ category: 'run-ledger', event: 'run-rollup', since: '2026-08-08T00:00:00.000Z', minSamples: '50' }, deps)).toBe(0);
    expect(errors).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { source: 'ledger', target: 'run-ledger', category: 'run-ledger', event: 'run-rollup', field: 'repeatedReviewFindingCount', n: 184, distinct: 1, constantValue: 0, allZero: true, insufficientSample: false, alwaysSame: true, monotonicIncrease: false, verdict: 'all-zero' },
      { source: 'ledger', target: 'run-ledger', category: 'run-ledger', event: 'run-rollup', field: 'roundCount', n: 3, distinct: 1, constantValue: 2, allZero: false, insufficientSample: true, alwaysSame: true, monotonicIncrease: false, verdict: 'insufficient-sample' },
      { source: 'ledger', target: 'run-ledger', inspectedFields: 2, skippedTypeFields: 0 },
    ]);
  });

  test('64KiB 경계의 멀티바이트 event와 마지막 개행 없는 행을 온전히 판정한다', () => {
    const ledgerDir = mkdtempSync(join(tmpdir(), 'logs-degenerate-ledger-'));
    dirs.push(ledgerDir);
    const runId = 'run-00000000-0000-0000-0000-000000000003';
    const event = '한글-event';
    const entry: RunLedgerEntry & { data: { padding: string; repeatedReviewFindingCount: number } } = {
      timestamp: '2026-08-08T00:00:00.000Z', runId, data: { padding: '', repeatedReviewFindingCount: 0 }, event,
    };
    const unpadded = JSON.stringify(entry);
    const markerOffset = Buffer.byteLength(unpadded.slice(0, unpadded.indexOf('한')), 'utf8');
    entry.data.padding = 'x'.repeat((64 * 1024) - 1 - markerOffset);
    const line = JSON.stringify(entry);
    expect(Buffer.byteLength(line.slice(0, line.indexOf('한')), 'utf8')).toBe((64 * 1024) - 1);
    writeFileSync(join(ledgerDir, `${runId}.jsonl`), line, 'utf8');

    expect(findLedgerDegenerateFields(ledgerDir, 2, { events: [event] })).toContainEqual({
      category: 'run-ledger', event, field: 'repeatedReviewFindingCount',
      n: 1, distinct: 1, constantValue: 0, allZero: true, insufficientSample: true, alwaysSame: false, monotonicIncrease: false, verdict: 'insufficient-sample',
    });
  });

  test('원장 상한은 필터 뒤의 합산 항목으로 적용하고 초과 판정을 거부한다', () => {
    const ledgerDir = mkdtempSync(join(tmpdir(), 'logs-degenerate-ledger-'));
    dirs.push(ledgerDir);
    const firstRun = 'run-00000000-0000-0000-0000-000000000001';
    const secondRun = 'run-00000000-0000-0000-0000-000000000002';
    const entry = (runId: string, event = 'run-rollup') => JSON.stringify({
      timestamp: '2026-08-08T00:00:00.000Z', runId, event, data: { repeatedReviewFindingCount: 0 },
    } satisfies RunLedgerEntry);
    writeFileSync(join(ledgerDir, `${firstRun}.jsonl`), `${Array.from({ length: 2 }, () => entry(firstRun)).join('\n')}\n${entry(firstRun, 'excluded')}\n`, 'utf8');
    writeFileSync(join(ledgerDir, `${secondRun}.jsonl`), `${Array.from({ length: 2 }, () => entry(secondRun)).join('\n')}\n`, 'utf8');

    expect(findLedgerDegenerateFields(ledgerDir, 2, { events: ['run-rollup'] }, 4)).toMatchObject([
      { field: 'repeatedReviewFindingCount', n: 4, verdict: 'all-zero' },
    ]);
    expect(() => findLedgerDegenerateFields(ledgerDir, 2, { events: ['run-rollup'] }, 3)).toThrow(LedgerScanLimitError);
  });

  test('손상된 data도 필터 일치 원장 항목으로 상한에 포함하고 통계에서는 제외한다', () => {
    const ledgerDir = mkdtempSync(join(tmpdir(), 'logs-degenerate-ledger-'));
    dirs.push(ledgerDir);
    const runId = 'run-00000000-0000-0000-0000-000000000004';
    const valid: RunLedgerEntry = {
      timestamp: '2026-08-08T00:00:00.000Z', runId, event: 'run-rollup', data: { repeatedReviewFindingCount: 0 },
    };
    const damaged = JSON.stringify({ timestamp: valid.timestamp, runId, event: valid.event, data: null });
    writeFileSync(join(ledgerDir, `${runId}.jsonl`), `${JSON.stringify(valid)}\n${damaged}\n`, 'utf8');

    expect(() => findLedgerDegenerateFields(ledgerDir, 1, { events: ['run-rollup'] }, 1)).toThrow(LedgerScanLimitError);
    expect(findLedgerDegenerateFields(ledgerDir, 2, { events: ['run-rollup'] }, 2)).toEqual([
      { category: 'run-ledger', event: 'run-rollup', field: 'repeatedReviewFindingCount', n: 1, distinct: 1, constantValue: 0, allZero: true, insufficientSample: true, alwaysSame: false, monotonicIncrease: false, verdict: 'insufficient-sample' },
    ]);
  });

  test('원장 상한 초과는 앞선 로그 결과도 NDJSON 부분 성공 없이 오류로 끝낸다', () => {
    const path = createStore('before-ledger-error', [
      { category: 'self-implement', event: 'run-rollup', data: { repeatedReviewFindingCount: 0 } },
      { category: 'self-implement', event: 'run-rollup', data: { repeatedReviewFindingCount: 0 } },
    ]);
    const output: string[] = [];
    const errors: string[] = [];
    const deps = depsFor([{ name: 'logs-before-ledger', dbPath: path }], output, errors);
    deps.scanLedgerDegenerateFields = () => { throw new LedgerScanLimitError(2); };

    expect(runLogsDegenerate({ minSamples: '2' }, deps)).toBe(1);
    expect(output).toEqual([]);
    expect(errors).toEqual(['monad logs degenerate: run-ledger 스캔이 저장소 안전 상한에서 잘렸다 — 창을 좁혀라(--since).']);
  });

  test('표본 부족 동일 boolean과 string 제외 고유 필드 수를 로그 NDJSON으로 함께 보고한다', () => {
    const path = createStore('boolean-summary', Array.from({ length: 12 }, () => ({
      category: 'self-implement', event: 'decomposition-shadow', data: { splittable: false, candidatePieceCount: 26, reason: 'string-excluded' },
    })));
    const output: string[] = [];
    const errors: string[] = [];

    expect(runLogsDegenerate({ event: 'decomposition-shadow', minSamples: '13' }, depsFor([{ name: 'boolean-summary', dbPath: path }], output, errors))).toBe(0);
    expect(errors).toEqual([]);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { source: 'logs', target: 'boolean-summary', category: 'self-implement', event: 'decomposition-shadow', field: 'candidatePieceCount', n: 12, distinct: 1, constantValue: 26, allZero: false, insufficientSample: true, alwaysSame: true, monotonicIncrease: false, verdict: 'insufficient-sample' },
      { source: 'logs', target: 'boolean-summary', category: 'self-implement', event: 'decomposition-shadow', field: 'splittable', n: 12, distinct: 1, constantValue: false, allZero: false, insufficientSample: true, alwaysSame: true, monotonicIncrease: false, verdict: 'insufficient-sample' },
      { source: 'logs', target: 'boolean-summary', inspectedFields: 2, skippedTypeFields: 1 },
      { source: 'ledger', target: 'run-ledger', inspectedFields: 0, skippedTypeFields: 0 },
    ]);
  });

  test('원장이 없으면 로그 산출은 source: logs로 유지한다', () => {
    const first = createStore('first', [
      { category: 'self-implement', event: 'run-rollup', data: { repeatedReviewFindingCount: 0 } },
      { category: 'self-implement', event: 'other-event', data: { repeatedReviewFindingCount: 7 } },
      { category: 'other', event: 'run-rollup', data: { repeatedReviewFindingCount: 7 } },
    ]);
    const second = createStore('second', [
      { category: 'self-implement', event: 'run-rollup', data: { repeatedReviewFindingCount: 0 } },
    ]);
    const output: string[] = [];
    const errors: string[] = [];

    const result = runLogsDegenerate(
      { category: 'self-implement', event: 'run-rollup', minSamples: '2', all: true },
      depsFor([{ name: 'first', dbPath: first }, { name: 'second', dbPath: second }], output, errors),
    );

    expect(result).toBe(0);
    expect(errors).toEqual([]);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      { source: 'logs', target: 'first', category: 'self-implement', event: 'run-rollup', field: 'repeatedReviewFindingCount', n: 1, distinct: 1, constantValue: 0, allZero: true, insufficientSample: true, alwaysSame: false, monotonicIncrease: false, verdict: 'insufficient-sample' },
      { source: 'logs', target: 'second', category: 'self-implement', event: 'run-rollup', field: 'repeatedReviewFindingCount', n: 1, distinct: 1, constantValue: 0, allZero: true, insufficientSample: true, alwaysSame: false, monotonicIncrease: false, verdict: 'insufficient-sample' },
      { source: 'logs', target: 'first', inspectedFields: 1, skippedTypeFields: 0 },
      { source: 'logs', target: 'second', inspectedFields: 1, skippedTypeFields: 0 },
      { source: 'ledger', target: 'run-ledger', inspectedFields: 0, skippedTypeFields: 0 },
    ]);
  });
});
