import { describe, expect, it } from 'bun:test';
import { buildQuery, limitReachedHint } from './logs-cli.js';
import { LogCursorNotFoundError, LogStore, STORE_SAFETY_MAX } from '../mss/logging/log-store.js';
import { HTTP_LOG_LIMIT_MAX, parseLogQuery } from '../nexus/api/log-fabric.js';
import type { LogRecord } from '../mss/logging/record.js';

/**
 * ⛔⭐ 2026-07-29 실측이 만든 테스트다.
 * `elanous logs` 는 최근순 정렬 + `--limit` 상한(1000)이라 **`--since` 를 넓혀도 과거로 못 간다**.
 * `frame-stall` 전수 조회가 12h·24h·…·168h **어느 창을 걸어도 정확히 1000행**을 냈고,
 * 두 트랙이 그것을 *"7일치"* 로 읽어 **같은 오독**을 했다(R4 표본 판정에 직접 영향).
 * ⇒ 커서 페이지네이션(`--before`)과 창 닫기(`--until`)를 세운다.
 */

describe('logs 페이지네이션', () => {
  it('--until 이 창의 끝을 닫는다 (--since 와 대칭)', () => {
    const { query, error } = buildQuery({ since: '2h', until: '1h' });
    expect(error).toBeUndefined();
    expect(typeof query.sinceMs).toBe('number');
    expect(typeof query.untilMs).toBe('number');
    expect(query.sinceMs! < query.untilMs!).toBe(true);
  });

  it('⛔ 뒤집힌 창을 조용히 0건으로 내지 않는다 — 빈 창은 부재와 구별되지 않는다', () => {
    const { error } = buildQuery({ since: '1h', until: '2h' });
    expect({ 거부: !!error }).toEqual({ 거부: true });
  });

  it('--before 는 행 id 커서다 (시각이 아니다 — 같은 ms 다중 행에서 누락·중복이 없어야 한다)', () => {
    expect(buildQuery({ before: '1344515' }).query.beforeId).toBe(1344515);
    for (const bad of ['0', '-3', 'abc', '2026-07-29T00:00:00Z']) {
      expect({ bad, 거부: !!buildQuery({ before: bad }).error }).toEqual({ bad, 거부: true });
    }
  });

  it('⭐ 상한에 걸리면 **다음 쪽 명령을 그대로** 찍는다 (초판은 "--since 로 좁혀라" 만 말했고 그건 과거로 못 간다)', () => {
    const hint = limitReachedHint(5, 5, 5, 1344515, false);
    expect(hint).toContain('--before 1344515');
  });

  it('⛔ 연합 조회에서는 커서를 권하지 않는다 — id 가 인스턴스마다 독립이라 딴 지점을 가리킨다', () => {
    const hint = limitReachedHint(5, 5, 5, 1344515, true);
    expect(hint).not.toContain('--before 1344515');
    expect(hint).toContain('--instance');
  });

  it('상한에 안 걸리면 안내하지 않는다 (노이즈 금지)', () => {
    expect(limitReachedHint(3, 5, 5, 999, false)).toBeNull();
  });
});

/**
 * ⛔⭐ **스토어 계약** — 여기가 진짜다. 앞의 테스트는 `buildQuery` 만 봐서
 * 스토어의 `beforeId` WHERE 절을 **통째로 빼도 통과했다**(뮤테이션으로 확인). 즉 vacuous 였다.
 * ⇒ 실제로 **과거로 가는지**를 스토어에 물어본다.
 */
describe('LogStore — 역방향 커서', () => {
  function seeded(n: number): LogStore {
    const store = new LogStore(':memory:');
    for (let i = 0; i < n; i += 1) {
      const r: LogRecord = { ts: new Date(1_700_000_000_000 + i * 1000).toISOString(), category: 'x', event: 'e' };
      store.insertBatch([{ rec: r, surface: 's' }]);
    }
    return store;
  }

  it('⭐ --before 로 페이지를 넘기면 **중복 없이 계속 오래된 쪽**으로 간다', () => {
    const store = seeded(12);
    const p1 = store.query({ limit: 4 });
    expect(p1.length).toBe(4);
    const p2 = store.query({ limit: 4, beforeId: Math.min(...p1.map((r) => r.id)) });
    const p3 = store.query({ limit: 4, beforeId: Math.min(...p2.map((r) => r.id)) });

    const ids = [...p1, ...p2, ...p3].map((r) => r.id);
    expect({ 총: ids.length, 고유: new Set(ids).size }).toEqual({ 총: 12, 고유: 12 });
    expect(Math.max(...p2.map((r) => r.id)) < Math.min(...p1.map((r) => r.id))).toBe(true);
    expect(Math.max(...p3.map((r) => r.id)) < Math.min(...p2.map((r) => r.id))).toBe(true);
    store.close();
  });

  it('⛔ 커서 없이 `--since` 만으로는 과거로 못 간다 — 이 사고의 재현', () => {
    const store = seeded(12);
    // 창을 아무리 넓혀도(sinceMs=0) 최근순 상한만큼만 온다 ⇒ 같은 4건이 반복된다.
    const a = store.query({ limit: 4, sinceMs: 0 }).map((r) => r.id);
    const b = store.query({ limit: 4, sinceMs: 1 }).map((r) => r.id);
    expect({ 같은쪽: a.join() === b.join() }).toEqual({ 같은쪽: true });
    store.close();
  });

  /**
   * ⛔⭐⭐ **초판이 초록불로 놓친 진짜 결함**(2026-07-29 라이브 실측).
   * 위 `seeded()` 는 ts 오름차순으로 넣어서 **id 순서와 ts 순서가 항상 일치**한다 —
   * 그 세계에서는 `id < beforeId` 커서가 옳다. 그러나 정렬은 `ts_ms DESC, id DESC` 이고
   * 실제 로그는 비동기 flush 라 **id 가 큰 행이 ts 는 더 이른** 경우가 흔하다.
   * 그 경계에서 행이 **조용히 유실**된다 — 같은 창 전수 **70건** vs 페이징 **60건**(14%).
   * ⇒ 커서는 **정렬 키와 같은 튜플** `(ts_ms, id)` 여야 한다.
   */
  function seededOutOfOrder(): LogStore {
    const store = new LogStore(':memory:');
    // 삽입 순서(=id 순서)와 ts 순서를 일부러 어긋나게 한다. 뒤죽박죽 오프셋.
    const offsets = [0, 9, 3, 7, 1, 11, 5, 2, 10, 4, 8, 6];
    for (const off of offsets) {
      const r: LogRecord = { ts: new Date(1_700_000_000_000 + off * 1000).toISOString(), category: 'x', event: 'e' };
      store.insertBatch([{ rec: r, surface: 's' }]);
    }
    return store;
  }

  it('⛔⭐ id 순서와 ts 순서가 어긋나도 **한 행도 잃지 않는다** (초판은 여기서 14% 를 잃었다)', () => {
    const store = seededOutOfOrder();
    const truth = store.query({ limit: 100 }).map((r) => r.id).sort((a, b) => a - b);
    expect(truth.length).toBe(12);

    // CLI 가 실제로 쓰는 커서 규칙 그대로: **쪽의 가장 오래된 행**(ts 정렬 마지막)의 id.
    const seen: number[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < 10; page += 1) {
      const rows = store.query({ limit: 4, ...(cursor !== undefined ? { beforeId: cursor } : {}) });
      if (rows.length === 0) break;
      seen.push(...rows.map((r) => r.id));
      cursor = rows[rows.length - 1]!.id;   // 최근순 정렬이라 마지막이 가장 오래된 행
    }

    expect({ 본것: seen.length, 고유: new Set(seen).size, 진실: truth.length })
      .toEqual({ 본것: 12, 고유: 12, 진실: 12 });
    expect([...seen].sort((a, b) => a - b)).toEqual(truth);
    store.close();
  });

  it('⛔ 없는 커서로 **조용히 빈 쪽**을 내주지 않는다 — 그 0 은 "더 없다" 와 구별되지 않는다', () => {
    const store = seededOutOfOrder();
    expect(() => store.query({ limit: 4, beforeId: 999_999 })).toThrow(LogCursorNotFoundError);
    store.close();
  });

  it('--until 이 창의 끝을 실제로 닫는다', () => {
    const store = seeded(6);
    const all = store.query({ limit: 10 });
    const mid = all[3]!.ts_ms;
    const cut = store.query({ limit: 10, untilMs: mid });
    expect(cut.every((r) => r.ts_ms <= mid)).toBe(true);
    expect(cut.length < all.length).toBe(true);
    store.close();
  });
});

/**
 * ⛔⭐ **상한의 자리** (2026-07-29 · 대표 지시 "상한이 왜 생겼는지 보고 필요 없으면 제거").
 * 조사 결과: 1000 은 **LF1 이 HTTP `/v1/logs` 응답을 보호하려고** 넣은 값인데,
 * 같은 `LogStore.query()` 를 **CLI 로컬 직독**도 쓴다. ⇒ 로컬 조회가 HTTP 정책을 물려받아
 * `--since` 를 넓혀도 최근 1000건만 왔다. **없앨 상한이 아니라 자리가 틀린 상한**이었다.
 * ⇒ 정책은 HTTP 경계로, 스토어에는 **OOM 백스톱만** 남긴다.
 */
describe('상한의 자리', () => {
  it('⛔ HTTP 경계는 여전히 막는다 — 상수가 아니라 **적용**을 본다', () => {
    // ⚠️ 초판은 `HTTP_LOG_LIMIT_MAX === 1000` 만 봐서 **clamp 를 통째로 빼도 통과**했다(vacuous).
    //   ⇒ 파서를 실제로 태워 query.limit 이 잘리는지 본다.
    expect(parseLogQuery(new URL('http://x/v1/logs?limit=50000')).query.limit).toBe(HTTP_LOG_LIMIT_MAX);
    expect(parseLogQuery(new URL('http://x/v1/logs?limit=7')).query.limit).toBe(7);
  });

  it('⭐ 스토어는 OOM 백스톱만 — 로컬 직독이 1000 에 갇히지 않는다', () => {
    expect(STORE_SAFETY_MAX > HTTP_LOG_LIMIT_MAX).toBe(true);
    const store = new LogStore(':memory:');
    for (let i = 0; i < 1200; i += 1) {
      store.insertBatch([{ rec: { ts: new Date(1_700_000_000_000 + i).toISOString(), category: 'x', event: 'e' }, surface: 's' }]);
    }
    // ⛔ 옛 동작: 1000 에서 잘렸다. 지금: 요청한 만큼 온다.
    expect(store.query({ limit: 1200 }).length).toBe(1200);
    store.close();
  });

  it('⛔ 백스톱은 살아 있다 — 터무니없는 값은 여전히 잘린다', () => {
    const store = new LogStore(':memory:');
    store.insertBatch([{ rec: { ts: new Date().toISOString(), category: 'x', event: 'e' }, surface: 's' }]);
    // 실행이 아니라 계약을 본다: 요청이 백스톱을 넘어도 SQL LIMIT 은 백스톱으로 잘린다.
    expect(store.query({ limit: STORE_SAFETY_MAX + 5_000 }).length).toBeLessThanOrEqual(STORE_SAFETY_MAX);
    store.close();
  });
});
