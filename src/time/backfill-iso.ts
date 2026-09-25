// 저장 형식 정규화 백필 — "비교/정렬을 감싸는" 대신 **원인을 없앤다**(2026-07-27 대표 결정).
//
// ## 왜 이 방향인가
//
// #5538 은 **비교**를 `datetime(col)` 로 감쌌다. 비교는 `datetime('now')` 라는 *다른 형식*과
// 마주치므로 그 정규화가 필수였다. 그런데 **정렬**(`ORDER BY ts`)은 같은 컬럼끼리라서,
// 저장이 균일하기만 하면 raw 가 옳고 **인덱스 정렬까지 살린다.**
//
//   · `datetime()` 로 정렬을 감싸면 **초가 잘려** 같은 초 행들이 동률이 된다 — raw 보다 나쁘다.
//   · `julianday()` 로 감싸면 정렬은 옳지만 72개 질의가 인덱스 정렬을 잃는다.
//   ⇒ 정렬 72곳을 손대는 대신 **저장을 ISO 로 통일**한다. 그러면 손댈 곳이 0 이다.
//
// ## 지금 무엇이 섞여 있나
//
// #5538 이후 **SQL 측 시간 쓰기는 0곳**이다(가드가 강제). 즉 신규 행은 전부 ISO 다.
// 남은 건 그 이전에 SQL 로 기록된 **레거시 행**뿐이다.
//
// ## 실행 이력 (1회성)
//
//   2026-07-27 · `~/.monad/conatus/community_buzz.db` · `slang_dict.last_seen` 36건 → ISO.
//   적용 후 `ISO 36 / 비-ISO 0` 균일 확인. 백업 `community_buzz.db.bak-iso-backfill-20260727`.
//   ⊕ 같은 조사에서 **다른 컬럼은 전부 컬럼별 균일**이었다(혼합 0건) — 손댈 대상이 없었다.
//
// 대상 목록을 상수로 박아 두지 않는다 — 1회성 정리라 소비자가 없는 **죽은 표면**이 되고
// (리뷰 must-fix), 다음에 필요해지면 그때의 실측으로 대상을 정하는 게 옳다.
// 이후 재발은 가드(`db-window-guard.test.ts`)가 막는다.
//
// ## 안전 규율
//
//   · **기본은 dry-run.** `apply: true` 를 명시해야 쓴다.
//   · 이미 ISO 인 행은 **건드리지 않는다**(idempotent — 여러 번 돌려도 같다).
//   · SQLite 가 **파싱하지 못하는 값은 남긴다**(정체불명 문자열을 뭉개지 않는다).
//   · 밀리초 아래(마이크로초)는 `strftime('%f')` 가 **반올림**한다(절단 아님 · 테스트로 고정).
//   · 컬럼/테이블 이름은 식별자 형태만 허용(문자열 조립 방어).
//   · ⚠️ **트랜잭션이 아니다** — 여러 컬럼을 한 번에 넘기면 중간에 실패했을 때 앞쪽만 적용된
//     상태로 남는다. 멱등이라 다시 돌리면 이어서 끝나지만, 원자성이 필요하면 호출부에서
//     `db.transaction(...)` 으로 감싸라(도구가 임의로 트랜잭션을 여는 편이 더 위험하다 —
//     호출부가 이미 트랜잭션 안일 수 있다).

import type { Database } from 'bun:sqlite';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(name: string, what: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`backfill-iso: ${what} 이 식별자 형태가 아니다 — ${JSON.stringify(name)}`);
  }
  return name;
}

export interface TimeColumnRef {
  table: string;
  /** 시간 값을 담은 TEXT 컬럼. */
  column: string;
}

export interface BackfillResult extends TimeColumnRef {
  /** 테이블 **또는 컬럼**이 없으면 skip(스키마가 갈린 인스턴스에서도 안전하게 돈다). */
  missing: boolean;
  /** SQLite datetime 형식(=변환 후보) 행 수. 날짜 전용·정체불명 값은 여기 안 들어온다. */
  candidates: number;
  /** 그중 SQLite 가 파싱 가능해 실제 변환 대상인 행 수. */
  convertible: number;
  /** 실제로 쓴 행 수(dry-run 이면 0). */
  converted: number;
}

/** 변환 대상 판별 — **SQLite `datetime()` 형식인 값만** 잡는다.
 *
 *      2026-07-27 03:00:00        ← 11번째 = ' ' + 길이 ≥ 19   ⇒ 대상
 *      2026-07-27T03:00:00.000Z   ← 11번째 = 'T'                ⇒ 이미 ISO, 제외
 *      2026-07-27                 ← 길이 10                     ⇒ ⚠️**날짜 전용 · 절대 제외**
 *      not-a-timestamp            ← 형태 불일치                 ⇒ 제외
 *
 *  ⚠️⚠️ **날짜 전용 컬럼을 건드리면 데이터를 파괴한다.** 라이브 조사에서 `prices.date`(18만건)·
 *     `scores.as_of`(4만건) 같은 `YYYY-MM-DD` 컬럼이 대량으로 나왔다. 이들을
 *     `…T00:00:00.000Z` 로 바꾸면 **날짜가 시각이 된다**(의미 변경). 그래서 "ISO 가 아니다" 가
 *     아니라 **"SQLite datetime 형식이다"** 를 조건으로 삼는다 — 넓게 잡으면 안 되는 자리다.
 *
 *  ⚠️ `col NOT LIKE '%T%'` 는 쓰지 않는다 — SQLite `LIKE` 는 ASCII 대소문자를 무시해서
 *     `'not-a-timestamp'` 의 소문자 `t` 가 ISO 로 오인된다(테스트가 잡았다). */
function convertiblePredicate(column: string): string {
  return `${column} IS NOT NULL`
    + ` AND length(${column}) >= 19`                 // 날짜 전용(10자) 제외
    + ` AND substr(${column}, 11, 1) = ' '`          // SQLite datetime 의 공백 구분자
    + ` AND substr(${column}, 5, 1) = '-' AND substr(${column}, 8, 1) = '-'`;
}

function tableExists(db: Database, table: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`).get(table);
}

/** ⚠️ 테이블만 보면 부족하다(리뷰 should-fix) — 스키마가 갈린 인스턴스에서는 테이블은 있는데
 *  **컬럼이 없을** 수 있고, 그러면 "안전한 skip" 대신 SQL 오류로 죽는다. */
function columnExists(db: Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/** 레거시 비-ISO 시간 값을 ISO 로 통일한다. **기본 dry-run.**
 *
 *      backfillIsoTimestamps(db, [{ table: 'slang_dict', column: 'last_seen' }])          // 세어만 봄
 *      backfillIsoTimestamps(db, [...], { apply: true })                                  // 실제 기록
 */
export function backfillIsoTimestamps(
  db: Database,
  refs: readonly TimeColumnRef[],
  opts: { apply?: boolean } = {},
): BackfillResult[] {
  const apply = opts.apply === true;
  return refs.map((ref) => {
    const table = assertIdent(ref.table, '테이블명');
    const column = assertIdent(ref.column, '컬럼명');
    if (!tableExists(db, table) || !columnExists(db, table, column)) {
      return { ...ref, missing: true, candidates: 0, convertible: 0, converted: 0 };
    }
    const target = convertiblePredicate(column);
    const candidates = (db.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${target}`,
    ).get() as { n: number }).n;
    // ⚠️ 파싱 불가 값은 제외한다 — `julianday()` 가 NULL 을 주는 정체불명 문자열을
    //    ISO 로 뭉개면 원래 값이 사라진다. 남겨서 사람이 보게 한다.
    const convertible = (db.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${target} AND julianday(${column}) IS NOT NULL`,
    ).get() as { n: number }).n;
    let converted = 0;
    if (apply && convertible > 0) {
      converted = db.prepare(
        `UPDATE ${table} SET ${column} = strftime('%Y-%m-%dT%H:%M:%fZ', ${column})
          WHERE ${target} AND julianday(${column}) IS NOT NULL`,
      ).run().changes;
    }
    return { ...ref, missing: false, candidates, convertible, converted };
  });
}

/** 사람이 읽는 한 줄 요약 — dry-run 보고용. */
export function formatBackfillResult(r: BackfillResult): string {
  // ⚠️ 사유를 뭉뚱그리지 않는다(리뷰 should-fix) — 테이블이 없는 것과 컬럼이 없는 것은
  //    운영자가 취할 조치가 다르다(스키마 미생성 vs 대상 지정 오류).
  if (r.missing) return `${r.table}.${r.column}: (대상 없음 — 테이블 또는 컬럼 부재 · skip)`;
  const stuck = r.candidates - r.convertible;
  const tail = stuck > 0 ? ` · ⚠️파싱불가 ${stuck}건은 남김` : '';
  return `${r.table}.${r.column}: 비-ISO ${r.candidates}건 · 변환대상 ${r.convertible}건 · 기록 ${r.converted}건${tail}`;
}

