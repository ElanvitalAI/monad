// ★ I-22 — 미종료 작업 유도의 경계. ⛔ 여기서 고정하는 것은 **셈**이지 **판정**이 아니다.
import { describe, expect, test } from 'bun:test';
import { collectLifecycleRows, findUnclosedOperations, formatAge, parseDuration, selectForReport, LIFECYCLE_PAIRS, type LifecyclePair, type UnclosedOperation } from './logs-unclosed.js';
import type { LogStore } from '../mss/logging/log-store.js';
import type { LogStoreRow } from '../mss/logging/log-store.js';

const PAIR: LifecyclePair = {
  category: 'goal.loop', start: 'start', end: ['complete', 'complete-rejected-tool-call'],
  correlationField: 'sessionId', label: 'goal-loop',
};

let nextId = 1;
function row(event: string, sessionId: string, tsMs: number, category = 'goal.loop'): LogStoreRow {
  return {
    id: nextId++, ts: new Date(tsMs).toISOString(), ts_ms: tsMs, level: 'info',
    instance: 'prod', surface: 'harness', category, event,
    session_id: null, trace_id: null, data: JSON.stringify({ sessionId }),
  };
}

const NOW = 1_000_000;

describe('findUnclosedOperations — 시작만 있고 종료가 없는 것을 센다', () => {
  test('짝이 맞으면 미종료가 아니다', () => {
    const rows = [row('start', 'a', NOW - 5000), row('complete', 'a', NOW - 1000)];
    expect(findUnclosedOperations(rows, NOW, [PAIR])).toEqual([]);
  });

  test('⭐ 종료가 없으면 나이와 함께 낸다 — ⛔ 판정 낱말은 붙이지 않는다', () => {
    const found = findUnclosedOperations([row('start', 'a', NOW - 5000)], NOW, [PAIR]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ label: 'goal-loop', correlationId: 'a', ageMs: 5000, activityAfterStart: 0 });
    // ⛔ 결과에 "행"·"실패" 류 판정 필드가 없다 — 자르는 선은 읽는 쪽이 고른다.
    expect(Object.keys(found[0]!)).not.toContain('isHang');
  });

  // ⛔⭐⭐ **음성 대조** — 종료 이벤트 목록이 불완전하면 **정상 완주가 미종료로 둔갑**한다.
  //    거짓 양성은 진짜 행을 묻어 버리므로, 이 케이스가 이 파일에서 가장 중요하다.
  test('⛔ `complete-rejected-tool-call` 도 종결이다 — 목록에서 빼면 정상 완주가 미종료로 둔갑한다', () => {
    const rows = [row('start', 'a', NOW - 5000), row('complete-rejected-tool-call', 'a', NOW - 1000)];
    expect(findUnclosedOperations(rows, NOW, [PAIR])).toEqual([]);
    // 같은 로그를 **불완전한 짝**으로 보면 거짓 양성이 난다 — 그것이 이 단언의 값이다.
    const narrow: LifecyclePair = { ...PAIR, end: ['complete'] };
    expect(findUnclosedOperations(rows, NOW, [narrow])).toHaveLength(1);
  });

  test('⭐ 재시작은 앞의 것을 대체한다 — 옛 종료가 새 시작을 닫지 않는다', () => {
    const rows = [
      row('start', 'a', NOW - 9000), row('complete', 'a', NOW - 8000),
      row('start', 'a', NOW - 3000),                                   // 두 번째 시작은 안 닫혔다
    ];
    const found = findUnclosedOperations(rows, NOW, [PAIR]);
    expect(found).toHaveLength(1);
    expect(found[0]!.ageMs).toBe(3000);      // ⛔ 9000 이 아니다 — 마지막 시작을 본다
  });

  test('⭐ 시작 뒤 같은 키로 본 이벤트 수를 센다 — ⛔ 0 을 "아무것도 안 했다" 로 해석하지 않는다', () => {
    const rows = [row('start', 'a', NOW - 5000), row('iteration', 'a', NOW - 4000), row('iteration', 'a', NOW - 3000)];
    expect(findUnclosedOperations(rows, NOW, [PAIR])[0]!.activityAfterStart).toBe(2);
  });

  test('시작 없이 온 활동은 세지 않는다(고아 이벤트가 없는 작업을 만들지 않는다)', () => {
    expect(findUnclosedOperations([row('iteration', 'a', NOW - 5000)], NOW, [PAIR])).toEqual([]);
  });

  test('다른 카테고리는 건드리지 않는다', () => {
    expect(findUnclosedOperations([row('start', 'a', NOW - 5000, 'other.thing')], NOW, [PAIR])).toEqual([]);
  });

  test('⛔ 상관키를 못 읽으면 없는 것으로 센다 — 있는 척하지 않는다', () => {
    const broken = { ...row('start', 'a', NOW - 5000), data: 'not json' };
    const missing = { ...row('start', 'a', NOW - 5000), data: JSON.stringify({ other: 'x' }) };
    expect(findUnclosedOperations([broken, missing], NOW, [PAIR])).toEqual([]);
  });

  test('오래된 것부터 낸다', () => {
    const rows = [row('start', 'young', NOW - 1000), row('start', 'old', NOW - 90_000)];
    expect(findUnclosedOperations(rows, NOW, [PAIR]).map((op) => op.correlationId)).toEqual(['old', 'young']);
  });
});

describe('등록된 짝 — ⛔ 추측으로 늘리지 않는다', () => {
  test('실측으로 검증된 것만 있다', () => {
    // ⚠️ 이 단언은 목록을 **고정**하는 것이 아니라, 늘릴 때 **실측했는지 되묻게** 하는 자리다.
    // 짝을 더할 때는 `elanous logs --exact-category <c> --since 3d` 로 종료 이벤트를 먼저 확인한다.
    expect(LIFECYCLE_PAIRS).toEqual([
      expect.objectContaining({ category: 'goal.loop', correlationField: 'sessionId' }),
      expect.objectContaining({
        category: 'self-implement', start: 'headless.spawn', end: ['headless.done'],
        correlationField: 'ptyId', label: 'headless-child',
      }),
    ]);
    for (const pair of LIFECYCLE_PAIRS) {
      expect(pair.end.length).toBeGreaterThan(0);
      expect(pair.correlationField.length).toBeGreaterThan(0);
    }
  });

  test('같은 runId의 headless spawn은 ptyId별로 독립 판정된다', () => {
    const headlessPair = LIFECYCLE_PAIRS.find((pair) => pair.label === 'headless-child')!;
    const headlessRow = (event: string, ptyId: string, tsMs: number): LogStoreRow => ({
      ...row(event, 'unused', tsMs, 'self-implement'),
      data: JSON.stringify({ ptyId, runId: 'run-aca0a6fa' }),
    });
    const found = findUnclosedOperations([
      headlessRow('headless.spawn', 'self_050eb6b6', NOW - 5000),
      headlessRow('headless.spawn', 'self_aad17a52', NOW - 4000),
      headlessRow('headless.done', 'self_050eb6b6', NOW - 1000),
    ], NOW, [headlessPair]);

    expect(found).toMatchObject([{ label: 'headless-child', correlationId: 'self_aad17a52' }]);
  });
});

describe('표기', () => {
  test('나이 표기', () => {
    expect(formatAge(45_000)).toBe('45s');
    expect(formatAge(90_000)).toBe('1m');
    expect(formatAge(3_900_000)).toBe('1h 5m');
    expect(formatAge(90_000_000)).toBe('1d 1h');
  });

  test('기간 파싱은 상대 표기만 받는다', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('nonsense')).toBeNull();
    expect(parseDuration('2026-01-01')).toBeNull();   // ⛔ 절대 시각은 기간이 아니다
  });
});

// ⛔⭐⭐ 리뷰 1R must-fix — **조용한 절단이 거짓 양성을 만든다.**
//    페이지는 id 오름차순이라 잘리는 쪽이 **최신 구간**이고, 종료는 시작보다 **뒤**에 있다
//    ⇒ 절단은 정확히 *"종료만 골라 버리는"* 방향이다. 그래서 사실을 올려 보내고 호출부가 멈춘다.
describe('절단 — ⛔ 조용히 넘기면 정상 완주가 미종료로 둔갑한다', () => {
  /** ⛔ 실제 스토어 계약대로 **id 오름차순**으로 낸다(리뷰 3R) — 입력 순서를 그대로 내면
   *  커서 페이지네이션이 중복·누락을 만들어 테스트가 실물과 다른 것을 잰다. */
  function fakeStore(rows: LogStoreRow[]): LogStore {
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    return {
      query: ({ afterId = 0, limit = 1000 }: { afterId?: number; limit?: number }) =>
        sorted.filter((r) => r.id > afterId).slice(0, limit),
    } as unknown as LogStore;
  }

  test('상한 안이면 truncated=false 이고 전부 온다', () => {
    const rows = [row('start', 'a', NOW - 5000), row('complete', 'a', NOW - 1000)];
    const scan = collectLifecycleRows(fakeStore(rows), 0, 100);
    expect(scan.truncated).toBe(false);
    expect(scan.rows).toHaveLength(2);
  });

  test('⛔ 상한에 걸리면 truncated=true 로 올라온다(조용히 자르지 않는다)', () => {
    const rows = Array.from({ length: 2500 }, (_, i) => row('iteration', `s${i}`, NOW - 5000));
    const scan = collectLifecycleRows(fakeStore(rows), 0, 2000);
    expect(scan.truncated).toBe(true);
  });

  // ⛔⭐ 리뷰 2R must-fix — 경계 셋을 못 박는다. `>= maxRows` 만 보면 **딱 맞게 끝난 로그**를
  //    절단으로 오판하고, 페이지 단위로만 끊으면 **상한을 넘겨** 모은다.
  // ⛔⭐ 리뷰 3R — **마지막 부분 페이지**가 상한을 넘기는 경우를 직접 잰다.
  //    1600행/상한1500 이면 두 번째 페이지(600행)가 부분 페이지인데, 소진 검사를 먼저 하면
  //    1600행을 `truncated: false` 로 내보낸다.
  test.each([
    [1500, 1500, false],   // 딱 맞고 더 없음
    [1501, 1500, true],    // 한 행 더 있음
    [1600, 1500, true],    // ⭐ 마지막 부분 페이지가 상한을 넘는다
    [3000, 1500, true],
  ])('상한 경계 — 총 %i행 / 상한 %i ⇒ truncated=%s', (total, cap, expected) => {
    const rows = Array.from({ length: total }, (_, i) => row('iteration', `s${i}`, NOW - 5000));
    const scan = collectLifecycleRows(fakeStore(rows), 0, cap);
    expect(scan.rows.length).toBeLessThanOrEqual(cap);   // ⛔ 상한을 엄격히 지킨다
    expect(scan.truncated).toBe(expected);
  });

  test('⭐⭐ 절단이 왜 위험한가 — 잘린 뒤쪽에 종료가 있으면 정상 완주가 미종료로 잡힌다', () => {
    // 1000행 채운 뒤 마지막에 complete 가 오는 로그. 상한 1000 이면 complete 가 잘린다.
    const filler = Array.from({ length: 999 }, (_, i) => row('iteration', `noise${i}`, NOW - 6000));
    const rows = [row('start', 'a', NOW - 5000), ...filler, row('complete', 'a', NOW - 1000)];
    const truncatedScan = collectLifecycleRows(fakeStore(rows), 0, 1000);
    expect(truncatedScan.truncated).toBe(true);
    // ⛔ 이 잘린 행들만 보면 'a' 가 미종료로 나온다 = **거짓 양성**
    expect(findUnclosedOperations(truncatedScan.rows, NOW, [PAIR])).toHaveLength(1);
    // ✅ 안 잘리면 정상 완주로 나온다 ⇒ 차이를 만드는 것은 절단뿐이므로 호출부는 멈춰야 한다
    const fullScan = collectLifecycleRows(fakeStore(rows), 0, 100_000);
    expect(fullScan.truncated).toBe(false);
    expect(findUnclosedOperations(fullScan.rows, NOW, [PAIR])).toEqual([]);
  });
});

describe('selectForReport — 나이 필터·정렬(리뷰 1R should-fix)', () => {
  const ops = (ages: number[]): UnclosedOperation[] => ages.map((ageMs, i) => ({
    label: 'goal-loop', category: 'goal.loop', correlationId: `c${i}`,
    startedAtMs: NOW - ageMs, startedAt: new Date(NOW - ageMs).toISOString(),
    ageMs, instance: 'prod', activityAfterStart: 0,
  }));

  test('0 이면 전부 낸다 — ⛔ 기본값이 임계값이 되지 않는다', () => {
    expect(selectForReport(ops([1000, 5000]), 0)).toHaveLength(2);
  });

  test('경계는 이상(>=)이다', () => {
    expect(selectForReport(ops([1000, 5000]), 5000).map((op) => op.ageMs)).toEqual([5000]);
  });

  test('오래된 것부터 정렬한다', () => {
    expect(selectForReport(ops([1000, 9000, 5000]), 0).map((op) => op.ageMs)).toEqual([9000, 5000, 1000]);
  });
});
