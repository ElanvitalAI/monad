import { describe, expect, test } from 'bun:test';
import type { LogStoreRow } from '../mss/logging/log-store.js';
import { findDegenerateFields } from './logs-degenerate.js';
import { findLogFields, runLogsFields, type LogsFieldsDeps } from './logs-fields.js';

function row(id: number, ts: string, data: unknown, category = 'review-loop', event = 'rework-start'): LogStoreRow {
  return { id, ts, ts_ms: Date.parse(ts), level: 'info', instance: 'prod', surface: 'test', category, event, session_id: null, trace_id: null, data: JSON.stringify(data) };
}

const rows = [
  row(3, '2026-08-12T21:55:00.000Z', { reworkBackendSource: 'cli', onlySome: { nested: true }, list: [1], nil: null }),
  row(2, '2026-08-12T20:55:00.000Z', { stable: false, onlySome: 'later' }),
  row(1, '2026-08-11T18:22:00.000Z', { stable: true }),
];

describe('findLogFields', () => {
  test('모든 최상위 타입의 존재·기간을 값 없이 세며 일부 존재 필드는 전체 행 수와 다르다', () => {
    expect(findLogFields(rows, false)).toEqual([
      { category: 'review-loop', event: 'rework-start', field: 'list', n: 1, total: 3, types: ['array'], firstSeen: '2026-08-12T21:55:00.000Z', lastSeen: '2026-08-12T21:55:00.000Z', firstSeenScope: 'complete' },
      { category: 'review-loop', event: 'rework-start', field: 'nil', n: 1, total: 3, types: ['null'], firstSeen: '2026-08-12T21:55:00.000Z', lastSeen: '2026-08-12T21:55:00.000Z', firstSeenScope: 'complete' },
      { category: 'review-loop', event: 'rework-start', field: 'onlySome', n: 2, total: 3, types: ['object', 'string'], firstSeen: '2026-08-12T20:55:00.000Z', lastSeen: '2026-08-12T21:55:00.000Z', firstSeenScope: 'complete' },
      { category: 'review-loop', event: 'rework-start', field: 'reworkBackendSource', n: 1, total: 3, types: ['string'], firstSeen: '2026-08-12T21:55:00.000Z', lastSeen: '2026-08-12T21:55:00.000Z', firstSeenScope: 'complete' },
      { category: 'review-loop', event: 'rework-start', field: 'stable', n: 2, total: 3, types: ['boolean'], firstSeen: '2026-08-11T18:22:00.000Z', lastSeen: '2026-08-12T20:55:00.000Z', firstSeenScope: 'complete' },
    ]);
    expect(findDegenerateFields(rows, 1)).toEqual([]);
  });

  test('값 분포는 primitive falsy를 포함해 빈도순으로 내고 표시 초과와 기억 상한을 밝힌다', () => {
    const distributionRows = [
      row(4, '2026-08-12T22:00:00.000Z', { value: false, ignored: { nested: true } }),
      row(3, '2026-08-12T21:00:00.000Z', { value: 0, ignored: [1] }),
      row(2, '2026-08-12T20:00:00.000Z', { value: '' }),
      row(1, '2026-08-12T19:00:00.000Z', { value: false }),
    ];
    expect(findLogFields(distributionRows, false, 2).find((field) => field.field === 'value')).toMatchObject({
      distinct: 3,
      values: [{ value: false, n: 2 }, { value: '', n: 1 }],
      valuesTruncated: true,
    });
    expect(findLogFields(distributionRows, false, 10).find((field) => field.field === 'ignored')).toMatchObject({ distinct: 0, values: [], valuesTruncated: false });

    const retainedRows = Array.from({ length: 1_000 }, (_, index) => row(index, '2026-08-12T22:00:00.000Z', { value: index }));
    expect(findLogFields(retainedRows, false, 1_000).find((field) => field.field === 'value')).toMatchObject({ distinct: 1_000, valuesTruncated: false });
    expect(findLogFields(retainedRows, false, 1_000).find((field) => field.field === 'value')).not.toHaveProperty('valuesCapped');

    const cappedRows = Array.from({ length: 1_001 }, (_, index) => row(index, '2026-08-12T22:00:00.000Z', { value: index }));
    expect(findLogFields(cappedRows, false, 1_000).find((field) => field.field === 'value')).toMatchObject({ distinct: 1_000, valuesTruncated: true, valuesCapped: true });

    const sharedPrefix = 'x'.repeat(200);
    const longValueRows = [
      row(2, '2026-08-12T22:00:00.000Z', { value: `${sharedPrefix}a` }),
      row(1, '2026-08-12T21:00:00.000Z', { value: `${sharedPrefix}b` }),
    ];
    expect(findLogFields(longValueRows, false, 10).find((field) => field.field === 'value')).toMatchObject({
      distinct: 2,
      values: [{ value: sharedPrefix, n: 1 }, { value: sharedPrefix, n: 1 }],
      valuesTruncated: false,
    });
  });

  test('상한에 닿은 scan은 firstSeen이 질의 창 안에서만 처음임을 표시한다', () => {
    expect(findLogFields(rows.slice(0, 2), true).find((field) => field.field === 'onlySome')).toMatchObject({ firstSeenScope: 'within-query-window' });
  });

  test('서로 다른 ISO 오프셋 표현이 섞여도 ts_ms 순서로 첫·마지막 관측 시각을 고른다', () => {
    const offsetRows = [
      row(1, '2026-08-12T03:00:00.000+01:00', { source: 'earlier' }),
      row(2, '2026-08-12T02:30:00.000Z', { source: 'later' }),
    ];
    expect(findLogFields(offsetRows, false).find((field) => field.field === 'source')).toMatchObject({
      firstSeen: '2026-08-12T03:00:00.000+01:00',
      lastSeen: '2026-08-12T02:30:00.000Z',
    });
  });
});

describe('runLogsFields', () => {
  test('수집 재사용 결과와 truncated 요약을 target별 NDJSON으로 낸다', () => {
    const output: string[] = [];
    const errors: string[] = [];
    const deps: LogsFieldsDeps = {
      exists: () => true,
      openReadOnly: () => ({ query: ({ limit = rows.length }: { limit?: number }) => rows.slice(0, limit), close() {} }) as never,
      resolveTargets: () => ({ targets: [{ name: 'fixture', dbPath: '/fixture.db' }] }),
      write: (line) => output.push(line),
      writeError: (line) => errors.push(line),
    };
    expect(runLogsFields({ exactCategory: 'review-loop', event: 'rework-start' }, deps)).toBe(0);
    expect(errors).toEqual([]);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      ...findLogFields(rows, false).map((field) => ({ source: 'logs', target: 'fixture', ...field })),
      { source: 'logs', target: 'fixture', rows: 3, truncated: false, kind: 'summary' },
    ]);
  });

  test('--since만으로 이전 기록을 배제해도 firstSeenScope가 질의 창임을 밝힌다', () => {
    const output: string[] = [];
    const deps: LogsFieldsDeps = {
      exists: () => true,
      openReadOnly: () => ({ query: () => rows.slice(0, 2), close() {} }) as never,
      resolveTargets: () => ({ targets: [{ name: 'fixture', dbPath: '/fixture.db' }] }),
      write: (line) => output.push(line),
      writeError: () => {},
    };
    expect(runLogsFields({ since: '2026-08-12T00:00:00.000Z' }, deps)).toBe(0);
    const parsed = output.map((line) => JSON.parse(line));
    expect(parsed.find((line) => line.field === 'stable')).toMatchObject({ firstSeenScope: 'within-query-window' });
    expect(parsed.at(-1)).toEqual({ source: 'logs', target: 'fixture', rows: 2, truncated: false, kind: 'summary' });
  });

  test('--since와 명시 상한이 함께 이전 기록을 배제해도 firstSeenScope가 질의 창임을 밝힌다', () => {
    const output: string[] = [];
    const deps: LogsFieldsDeps = {
      exists: () => true,
      openReadOnly: () => ({
        query: ({ beforeId, limit = rows.length }: { beforeId?: number; limit?: number }) => rows.filter((candidate) => beforeId === undefined || candidate.id < beforeId).slice(0, limit),
        close() {},
      }) as never,
      resolveTargets: () => ({ targets: [{ name: 'fixture', dbPath: '/fixture.db' }] }),
      write: (line) => output.push(line),
      writeError: () => {},
    };
    expect(runLogsFields({ since: '2026-08-12T00:00:00.000Z', limit: '2' }, deps)).toBe(0);
    const parsed = output.map((line) => JSON.parse(line));
    expect(parsed.find((line) => line.field === 'onlySome')).toMatchObject({ firstSeenScope: 'within-query-window' });
    expect(parsed.at(-1)).toEqual({ source: 'logs', target: 'fixture', rows: 2, truncated: true, kind: 'summary' });
  });

  test('명시 상한이 더 오래된 행을 남기면 요약과 firstSeenScope가 잘림을 밝힌다', () => {
    const output: string[] = [];
    const deps: LogsFieldsDeps = {
      exists: () => true,
      openReadOnly: () => ({
        query: ({ beforeId, limit = rows.length }: { beforeId?: number; limit?: number }) => rows.filter((candidate) => beforeId === undefined || candidate.id < beforeId).slice(0, limit),
        close() {},
      }) as never,
      resolveTargets: () => ({ targets: [{ name: 'fixture', dbPath: '/fixture.db' }] }),
      write: (line) => output.push(line),
      writeError: () => {},
    };
    expect(runLogsFields({ limit: '2' }, deps)).toBe(0);
    const parsed = output.map((line) => JSON.parse(line));
    expect(parsed.find((line) => line.field === 'onlySome')).toMatchObject({ n: 2, total: 2, firstSeenScope: 'within-query-window' });
    expect(parsed.at(-1)).toEqual({ source: 'logs', target: 'fixture', rows: 2, truncated: true, kind: 'summary' });
  });
});
