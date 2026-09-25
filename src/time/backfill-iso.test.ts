// 저장 정규화 백필 — 이 도구가 **원인을 없앤다**는 주장을 실제로 확인한다.
//
// 요점: 백필 뒤에는 **raw `ORDER BY`** 가 옳아야 한다. 그게 이 방향을 택한 이유이므로
// (정렬 72곳을 안 고치는 대신 저장을 통일한다), 그 결론을 테스트가 직접 보여야 한다.

import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { backfillIsoTimestamps, formatBackfillResult, type TimeColumnRef } from './backfill-iso.js';
import { nowTs, tsAt } from './db-window.js';

const REF: TimeColumnRef[] = [{ table: 'rows', column: 'ts' }];

function db(): Database {
  const d = new Database(':memory:');
  d.run(`CREATE TABLE rows(id TEXT PRIMARY KEY, ts TEXT)`);
  return d;
}
const toSqlite = (iso: string) => iso.slice(0, 19).replace('T', ' ');

describe('backfillIsoTimestamps', () => {
  test('★기본은 dry-run — 세기만 하고 쓰지 않는다', () => {
    const d = db();
    d.prepare(`INSERT INTO rows VALUES (?,?)`).run('a', toSqlite(nowTs()));
    const [r] = backfillIsoTimestamps(d, REF);
    expect({ candidates: r!.candidates, convertible: r!.convertible, converted: r!.converted })
      .toEqual({ candidates: 1, convertible: 1, converted: 0 });
    // 실제 값이 그대로인지 확인 — "세기만 한다" 는 주장의 증거
    expect((d.prepare(`SELECT ts FROM rows WHERE id='a'`).get() as { ts: string }).ts).not.toContain('T');
    d.close();
  });

  test('★apply — 비-ISO 만 바꾸고 ISO 는 손대지 않는다', () => {
    const d = db();
    const iso = tsAt(Date.UTC(2026, 6, 27, 3, 0, 0, 123));
    const ins = d.prepare(`INSERT INTO rows VALUES (?,?)`);
    ins.run('sqlite', toSqlite(iso));
    ins.run('iso', iso);
    ins.run('null', null);

    const [r] = backfillIsoTimestamps(d, REF, { apply: true });
    expect({ candidates: r!.candidates, converted: r!.converted }).toEqual({ candidates: 1, converted: 1 });

    const rows = Object.fromEntries((d.prepare(`SELECT id, ts FROM rows`).all() as Array<{ id: string; ts: string | null }>)
      .map((x) => [x.id, x.ts]));
    // 변환된 값은 ISO 형식이고 같은 시각을 가리킨다(초 이하는 원본에 없었으니 .000)
    expect(rows.sqlite).toBe('2026-07-27T03:00:00.000Z');
    // 이미 ISO 인 행은 **밀리초까지 그대로** — 백필이 정밀도를 깎지 않는다
    expect(rows.iso).toBe(iso);
    expect(rows.null).toBeNull();
    d.close();
  });

  test('★멱등 — 두 번 돌려도 두 번째는 할 일이 없다', () => {
    const d = db();
    d.prepare(`INSERT INTO rows VALUES (?,?)`).run('a', toSqlite(nowTs()));
    const first = backfillIsoTimestamps(d, REF, { apply: true })[0]!;
    const second = backfillIsoTimestamps(d, REF, { apply: true })[0]!;
    expect({ first: first.converted, second: second.converted, left: second.candidates })
      .toEqual({ first: 1, second: 0, left: 0 });
    d.close();
  });

  test('⚠️★날짜 전용 컬럼은 절대 건드리지 않는다 — 파괴 방지', () => {
    // 라이브 조사에서 `prices.date`(18만건)·`scores.as_of`(4만건) 같은 `YYYY-MM-DD` 컬럼이
    // 대량으로 나왔다. 이걸 `…T00:00:00.000Z` 로 바꾸면 **날짜가 시각이 된다**(의미 변경).
    // "ISO 가 아니다" 로 잡으면 전부 걸리므로, 조건은 **"SQLite datetime 형식이다"** 여야 한다.
    const d = db();
    const ins = d.prepare(`INSERT INTO rows VALUES (?,?)`);
    ins.run('dateonly', '2026-07-27');
    ins.run('datetime', '2026-07-27 03:00:00');
    const [r] = backfillIsoTimestamps(d, REF, { apply: true });
    expect({ candidates: r!.candidates, converted: r!.converted }).toEqual({ candidates: 1, converted: 1 });

    const rows = Object.fromEntries((d.prepare(`SELECT id, ts FROM rows`).all() as Array<{ id: string; ts: string }>)
      .map((x) => [x.id, x.ts]));
    expect(rows.dateonly).toBe('2026-07-27');                     // ⭐ 원문 그대로
    expect(rows.datetime).toBe('2026-07-27T03:00:00.000Z');
    d.close();
  });

  test('★파싱 불가 값은 뭉개지 않고 남긴다', () => {
    const d = db();
    const ins = d.prepare(`INSERT INTO rows VALUES (?,?)`);
    ins.run('junk', 'not-a-timestamp');
    ins.run('ok', toSqlite(nowTs()));
    const [r] = backfillIsoTimestamps(d, REF, { apply: true });
    // 'not-a-timestamp' 는 **형태 자체가 datetime 이 아니라** 후보에도 안 들어온다(더 안전한 방향).
    expect({ candidates: r!.candidates, convertible: r!.convertible, converted: r!.converted })
      .toEqual({ candidates: 1, convertible: 1, converted: 1 });
    expect((d.prepare(`SELECT ts FROM rows WHERE id='junk'`).get() as { ts: string }).ts).toBe('not-a-timestamp');
    d.close();
  });

  test('테이블이 없으면 조용히 skip — 스키마가 갈린 인스턴스에서도 돈다', () => {
    const d = new Database(':memory:');
    const [r] = backfillIsoTimestamps(d, [{ table: 'nope', column: 'ts' }]);
    expect({ missing: r!.missing, converted: r!.converted }).toEqual({ missing: true, converted: 0 });
    d.close();
  });

  test('★테이블은 있는데 컬럼이 없어도 죽지 않는다 — 분기 스키마 안전', () => {
    // 테이블만 확인하면 여기서 SQL 오류로 죽는다(리뷰 should-fix).
    const d = db();
    const [r] = backfillIsoTimestamps(d, [{ table: 'rows', column: 'no_such_col' }], { apply: true });
    expect({ missing: r!.missing, converted: r!.converted }).toEqual({ missing: true, converted: 0 });
    d.close();
  });

  test('마이크로초 입력은 밀리초로 **반올림**된다 — 절단이 아니다(실측 계약)', () => {
    // `strftime('%f')` 는 밀리초까지이고, 그 아래는 **버리는 게 아니라 반올림**한다.
    // (처음엔 '절단' 이라 적었는데 실측이 아니었다 — 리뷰가 잡았다. 경계값으로 고정한다.)
    const d = db();
    const ins = d.prepare(`INSERT INTO rows VALUES (?,?)`);
    ins.run('down', '2026-07-27 03:00:00.123456');   // 내림
    ins.run('up', '2026-07-27 03:00:00.123999');     // ⭐ 올림 — 절단이면 .123 이었을 것
    backfillIsoTimestamps(d, REF, { apply: true });
    const got = Object.fromEntries((d.prepare(`SELECT id, ts FROM rows`).all() as Array<{ id: string; ts: string }>)
      .map((r) => [r.id, r.ts]));
    expect(got).toEqual({
      down: '2026-07-27T03:00:00.123Z',
      up: '2026-07-27T03:00:00.124Z',
    });
    d.close();
  });

  test('식별자가 아니면 던진다', () => {
    const d = db();
    expect(() => backfillIsoTimestamps(d, [{ table: 'rows; DROP TABLE rows', column: 'ts' }])).toThrow();
    expect(() => backfillIsoTimestamps(d, [{ table: 'rows', column: "ts = 'x' --" }])).toThrow();
    d.close();
  });
});

describe('★백필의 목적 — 이후 raw ORDER BY 가 옳아진다', () => {
  test('혼합 상태에서는 raw 정렬이 뒤집히고, 백필 뒤에는 옳다', () => {
    const base = Date.UTC(2026, 6, 27, 3, 0, 0);
    const newest = tsAt(base + 60_000);      // 진짜 최신
    const older = tsAt(base);
    const d = db();
    const ins = d.prepare(`INSERT INTO rows VALUES (?,?)`);
    ins.run('newest', toSqlite(newest));     // 최신을 SQLite 형식으로
    ins.run('older', older);                 // 과거를 ISO 형식으로

    const order = () => (d.prepare(`SELECT id FROM rows ORDER BY ts DESC`).all() as Array<{ id: string }>).map((r) => r.id);

    // 혼합 상태 — ISO 의 'T'(0x54) 가 공백(0x20) 을 이겨 **과거가 먼저** 온다
    expect(order()).toEqual(['older', 'newest']);

    backfillIsoTimestamps(d, REF, { apply: true });

    // 백필 뒤 — raw 정렬이 옳다. ⇒ ORDER BY 72곳을 감쌀 필요가 없다(인덱스 정렬도 유지).
    expect(order()).toEqual(['newest', 'older']);
    d.close();
  });

  test('밀리초 순서도 유지된다 — datetime() 으로 감쌌다면 잃었을 것', () => {
    const base = Date.UTC(2026, 6, 27, 3, 0, 0);
    const d = db();
    const ins = d.prepare(`INSERT INTO rows VALUES (?,?)`);
    ins.run('early', tsAt(base + 100));
    ins.run('late', tsAt(base + 900));       // 같은 초, 밀리초만 다름
    backfillIsoTimestamps(d, REF, { apply: true });

    const raw = (d.prepare(`SELECT id FROM rows ORDER BY ts DESC`).all() as Array<{ id: string }>).map((r) => r.id);
    expect(raw).toEqual(['late', 'early']);

    // 대비 — `datetime()` 축으로 정렬하면 초가 잘려 동률이 되고 순서가 보장되지 않는다
    const truncated = d.prepare(`SELECT datetime(ts) t FROM rows`).all() as Array<{ t: string }>;
    expect(truncated[0]!.t).toBe(truncated[1]!.t);
    d.close();
  });
});

describe('formatBackfillResult', () => {
  test('파싱 불가 잔여를 눈에 띄게 보고한다', () => {
    const line = formatBackfillResult({ table: 't', column: 'ts', missing: false, candidates: 5, convertible: 3, converted: 3 });
    expect(line).toContain('비-ISO 5건');
    expect(line).toContain('파싱불가 2건');
  });

  test('테이블 부재는 skip 으로 보고', () => {
    expect(formatBackfillResult({ table: 't', column: 'ts', missing: true, candidates: 0, convertible: 0, converted: 0 }))
      .toContain('대상 없음');
  });
});
