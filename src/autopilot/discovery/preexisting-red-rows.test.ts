// Self-Evolution SE1 preexisting-red-rows 단위테스트 — 순수(무 fs/db/network).
import { describe, test, expect } from 'bun:test';
import { collectPreexistingRedRows } from './preexisting-red-rows.js';
import { scanPreexistingRed } from './preexisting-red-scan.js';

const payload = { failures: [{ attribution: 'preexisting', file: 'src/a.test.ts' }] };
const ts = '2026-08-22T00:00:00.000Z';
const truncation = { _meta: { type: 'log-query-limit' as const, limitReached: true as const } };

describe('collectPreexistingRedRows', () => {
  test('data 칸이 JSON 문자열인 행 → 객체로 풀려 목록에 들어간다', () => {
    const result = collectPreexistingRedRows([
      { event: 'gate.baseline', ts, data: JSON.stringify(payload) },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.failures).toEqual(payload.failures);
    expect(typeof result.rows[0]!.failures).toBe('object');
    expect(scanPreexistingRed(result.rows).map(c => c.file)).toEqual(['src/a.test.ts']);
  });

  test('data 칸이 이미 객체인 행 → 그대로 목록에 들어간다', () => {
    const result = collectPreexistingRedRows([
      { event: 'gate.baseline', ts, data: payload },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.failures).toBe(payload.failures);
  });

  test('data 칸이 깨진 JSON 문자열인 행 → 못 읽은 수 1, 목록에 없다', () => {
    const result = collectPreexistingRedRows([
      { event: 'gate.baseline', ts, data: '{not-json' },
    ]);
    expect(result.unreadable).toBe(1);
    expect(result.rows).toEqual([]);
  });

  test('event 가 gate.baseline 이 아닌 행은 목록에 없다', () => {
    const result = collectPreexistingRedRows([
      { event: 'gate.baseline', ts, data: payload },
      { event: 'gate.tsc', ts, data: { failures: [{ attribution: 'preexisting', file: 'src/other.test.ts' }] } },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(scanPreexistingRed(result.rows).map(c => c.file)).toEqual(['src/a.test.ts']);
  });

  test('조회 결과에 절단 표시가 있다 → 절단 칸이 참이다', () => {
    const result = collectPreexistingRedRows([
      { event: 'gate.baseline', ts, data: payload },
      truncation,
    ]);
    expect(result.truncated).toBe(true);
  });

  test('조회 결과에 절단 표시가 없다 → 절단 칸이 거짓이다', () => {
    const result = collectPreexistingRedRows([
      { event: 'gate.baseline', ts, data: payload },
    ]);
    expect(result.truncated).toBe(false);
  });

  test('시각을 가진 행 → 그 값이 산출에 보존된다', () => {
    const result = collectPreexistingRedRows([
      { event: 'gate.baseline', ts, data: payload },
    ]);
    expect(result.rows[0]!.ts).toBe(ts);
  });

  test('행을 0개 준다 → 빈 목록이고 본 수가 0이고 예외를 던지지 않는다', () => {
    const result = collectPreexistingRedRows([]);
    expect(result.rows).toEqual([]);
    expect(result.seen).toBe(0);
    expect(result.unreadable).toBe(0);
    expect(result.truncated).toBe(false);
  });
});
