// SQLite 시간 컬럼 표준 — 저장 형식과 비교 형식이 달라 **조용히 틀리던 것**의 SSOT.
// (2026-07-27 · 대표 지시 "표준을 만들고 한번에 그것을 쓰는 형태로")
//
// ## 무엇이 문제였나
//
// 대부분의 쓰기는 JS `toISOString()` 이고, 비교는 SQLite `datetime('now', …)` 였다:
//
//     저장 : 2026-07-27T02:49:07.469Z    ← ISO-8601 (T 구분자 · Z · 밀리초)
//     비교 : 2026-07-26 14:49:07         ← SQLite datetime() (공백 구분 · 초 절단)
//
// `ts >= datetime('now','-12 hours')` 는 타입이 없으므로 **문자열 비교**로 떨어지고,
// 10번째 글자에서 `'T'`(0x54) > `' '`(0x20) 이라 **날짜만 같으면 시각과 무관하게 참**이 된다.
// ⇒ 12시간 창에 24시간 전 행이 들어온다.
//
// ⚠️ 이게 오래 살아남은 이유: **하루의 절반만 틀린다.** 창 밖 행과 cutoff 가 다른 날짜로
//    갈리면 문자열 비교도 우연히 맞는다. 그래서 테스트가 오전에만 빨갛고 오후엔 초록이었다.
//    (실제로 `breaking-signals` 회귀가 그런 상태로 방치돼 있었다 — #5536.)
//
// ⚠️ 타임존 문제가 **아니다.** 양쪽 다 UTC 다. 순수하게 **문자열 형식 불일치**다.
//
// ## 표준
//
//   쓰기 : `nowTs()` — ISO-8601 UTC. 새 코드는 이것만 쓴다.
//   비교 : `within()` / `olderThan()` — 컬럼을 `datetime()` 으로 감싼 술어를 만든다.
//   정렬 : `newestFirst()` / `oldestFirst()` — 같은 이유로 정렬도 정규화한다.
//   창   : `minutesAgo()` / `hoursAgo()` / `daysAgo()` — modifier 문자열을 만든다.
//
// ⚠️ **읽기 측 정규화**를 택한 이유: 레포에 두 형식이 **실제로 섞여 있다**(ISO 쓰기 173곳 ·
//    SQLite 쓰기 6곳). `datetime(col)` 은 두 형식을 **모두** 파싱하므로 저장이 섞여 있어도
//    옳다. 반대로 "JS 에서 ISO cutoff 를 만들어 raw 비교" 는 인덱스를 살리지만 저장 형식이
//    균일해야만 옳다 — 지금은 그 전제가 성립하지 않는다.
//    ⇒ 비용: 해당 조건절이 `idx_*_ts` 를 못 쓴다. 대상은 보존기간으로 휘발되는 로그성
//      테이블이라 수용한다. 저장이 ISO 로 완전히 통일되면 그때 raw 비교로 되돌릴 수 있다.

/** 식별자 가드 — 이 모듈은 SQL 조각을 **문자열로** 만든다. 컬럼명은 항상 코드 리터럴이지만,
 *  변수를 흘려넣는 순간 주입 통로가 되므로 형태를 강제한다(`ts` · `e.ts` 만 허용). */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;

function assertColumn(column: string): string {
  if (!IDENTIFIER.test(column)) {
    throw new Error(`db-window: 컬럼명이 식별자 형태가 아니다 — ${JSON.stringify(column)}`);
  }
  return column;
}

/** 저장 표준 — 시간 컬럼에 넣을 값. ISO-8601 UTC. */
export function nowTs(): string {
  return new Date().toISOString();
}

/** 저장 표준(임의 시각) — 테스트·백필용. */
export function tsAt(when: Date | number): string {
  return new Date(when).toISOString();
}

/** 저장 표준(**SQL 안에서** 생성해야 할 때) — `nowTs()` 와 **바이트 단위로 같은** 형식을 낸다.
 *
 *      INSERT INTO t(ts) VALUES (${sqlNowIso()})
 *      INSERT INTO t(ts) VALUES (${sqlNowIso("'-5 minutes'")})
 *
 *  ⚠️ SQL 에서 시간을 만들 땐 `datetime('now')` 를 쓰지 마라 — 공백 구분 형식이라
 *     `toISOString()` 로 쓰는 다른 행과 **형식이 갈린다.** 그러면 정렬·비교가 저장 형식에
 *     좌우되고, 특히 **테스트만 통과하는** 상태가 만들어진다(이 결함이 오래 산 구조적 이유). */
export function sqlNowIso(modifier?: string): string {
  const args = modifier ? `'now', ${modifier}` : `'now'`;
  return `strftime('%Y-%m-%dT%H:%M:%fZ', ${args})`;
}

/** 시간 창 비교 연산자. 기존 호출부의 엄밀성(`>` vs `>=`)을 **그대로 보존**하려고 노출한다 —
 *  이관하면서 경계 동작을 조용히 바꾸지 않기 위함이다. */
export type WindowCmp = '>=' | '>' | '<' | '<=';

/** `datetime(col) <op> datetime('now', ?)` — 창 비교의 일반형.
 *  바인딩 인자로 `hoursAgo(12)` 같은 modifier 를 준다.
 *
 *      db.prepare(`SELECT * FROM signals WHERE ${windowCompare('ts', '>=')}`).all(hoursAgo(12))
 */
export function windowCompare(column: string, op: WindowCmp): string {
  return `datetime(${assertColumn(column)}) ${op} datetime('now', ?)`;
}

/** `datetime(col) >= datetime('now', ?)` — **최근 N 이내**(가장 흔한 형태).
 *
 *      db.prepare(`SELECT * FROM signals WHERE ${within('ts')}`).all(hoursAgo(12))
 */
export function within(column: string): string {
  return windowCompare(column, '>=');
}

/** `datetime(col) < datetime('now', ?)` — **N 보다 오래된**(휘발·정리용). */
export function olderThan(column: string): string {
  return windowCompare(column, '<');
}

/** **정밀도 보존** 정규화 키 — `julianday(col)`.
 *
 *  ⚠️ `datetime()` 은 **초 단위로 자른다.** 그래서 `MAX(datetime(ts))` / `MIN(datetime(ts))` 는
 *     같은 초 안의 여러 행을 구분하지 못해 "최신/최초 한 행" 선택이 무너진다(리뷰 must-fix —
 *     형식만 고치려다 정밀도를 잃는 흔한 함정이다).
 *  ⇒ **극값(MIN/MAX)·동률 판정처럼 한 행을 고르는 자리**에서는 `datetime()` 이 아니라 이걸 쓴다.
 *     `julianday` 는 부동소수라 밀리초가 남고, ISO·SQLite 두 형식을 모두 파싱한다.
 *
 *      AND ${timeKey('ts')} = (SELECT MAX(${timeKey('ts')}) FROM t WHERE …)
 *
 *  ⊕ 단순 창 비교(`within`)에는 초 절단이 문제되지 않으므로 그대로 `datetime()` 을 쓴다 —
 *    가독성과 인덱스 힌트 측면에서 낫다. */
export function timeKey(column: string): string {
  return `julianday(${assertColumn(column)})`;
}

// ── 정렬(`ORDER BY`)은 왜 감싸지 않는가 — 저장 균일성 불변식 ────────────────────
//
// 비교(`within`)는 `datetime('now')` 라는 **다른 형식과 마주치므로** 정규화가 필수였다.
// 정렬은 **같은 컬럼끼리**라서, 저장만 균일하면 raw 가 옳고 **인덱스 정렬까지 산다.**
//
//   불변식: **시간 컬럼의 저장 형식은 항상 ISO-8601(`nowTs()` / `sqlNowIso()`)이다.**
//           → 그래서 레포의 `ORDER BY ts DESC` 72곳은 **그대로 두는 것이 옳다.**
//
// 이 불변식은 두 장치가 지킨다:
//   ① 가드(`db-window-guard.test.ts`) — SQL 측 시간 쓰기(INSERT·UPDATE·DEFAULT)를 전면 금지.
//      새 코드가 `datetime('now')` 로 쓰는 순간 테스트가 깨진다.
//   ② 백필(`backfill-iso.ts`) — 가드 도입 이전에 SQL 로 쓰인 **레거시 행**을 1회성 정리.
//
// ⚠️ 불변식이 깨진 컬럼(혼합)에서만 정렬을 감싼다. 그때도 `newestFirst()`(datetime·초 절단)가
//    아니라 **`timeKey()`(julianday·밀리초 보존)** 를 써라 — 정렬에서 초 절단은 동률을 만든다.

/** `datetime(col) DESC` — 최신순. 저장 형식이 섞이면 raw 정렬은 ISO(`T`)를 항상 크게 봐서
 *  **최신순이 저장 형식에 좌우된다**. 소비측이 상한으로 자를 때 엉뚱한 게 살아남는다.
 *  ⚠️ 위 불변식이 성립하면 이걸 **쓰지 마라**(raw 가 옳고 빠르다). 혼합이 확인된 컬럼 전용이고,
 *     그 경우에도 같은 초 안의 순서가 중요하면 `timeKey()` 로 정렬하라(초 절단 없음). */
export function newestFirst(column: string): string {
  return `datetime(${assertColumn(column)}) DESC`;
}

/** `datetime(col) ASC` — 오래된 순. */
export function oldestFirst(column: string): string {
  return `datetime(${assertColumn(column)}) ASC`;
}

// ── 축 ②: JS 에서 임계를 만들어 **raw 비교** ─────────────────────────────────
//
// 위 `within()` 계열은 저장 형식이 섞여 있어도 옳지만 인덱스를 못 쓰고, `datetime('now')` 가
// **SQL 안의 실제 시계**라 테스트에서 시각을 주입할 수 없다. 그래서 시한폭탄 테스트가 생긴다
// (고정 날짜로 seed 해 두면 시간이 흘러 창 밖으로 밀려나며 어느 날 갑자기 빨개진다 — 실제로
// `delivery-ledger` 가 그 상태였다).
//
// 저장이 **ISO 로 균일**한 테이블이라면 이쪽이 낫다:
//
//     const since = sinceTs(hoursAgo(12));                     // 또는 sinceTs(ms, nowMs)
//     db.prepare(`SELECT … WHERE ts >= ?`).all(since)
//
//   · 컬럼에 함수를 씌우지 않으므로 **인덱스가 산다**
//   · 임계가 값이라 **시계를 주입**할 수 있다(결정적 테스트)
//   · 단, 저장 형식이 ISO 가 아니면 틀린다 — 그 경우 축 ①(`within`)을 써라.

/** ISO 임계 문자열 — `nowMs` 로부터 `windowMs` 만큼 과거. raw 비교(`ts >= ?`)에 바인딩한다.
 *  `nowMs` 를 주입할 수 있어 테스트가 실제 시계에 매달리지 않는다. */
export function sinceTs(windowMs: number, nowMs: number = Date.now()): string {
  return new Date(nowMs - windowMs).toISOString();
}

/** 밀리초 창 헬퍼 — `sinceTs(MINUTES(90))` 처럼 읽히게. */
export const SECONDS = (n: number): number => n * 1000;
export const MINUTES = (n: number): number => n * 60_000;
export const HOURS = (n: number): number => n * 3_600_000;
export const DAYS = (n: number): number => n * 86_400_000;

/** SQLite modifier — `'-90 minutes'`. 정수로 반올림한다(SQLite 는 소수 modifier 를 안 받는다). */
export function minutesAgo(n: number): string {
  return `-${Math.round(n)} minutes`;
}

/** SQLite modifier — `'-12 hours'`. */
export function hoursAgo(n: number): string {
  return `-${Math.round(n)} hours`;
}

/** SQLite modifier — `'-90 days'`. */
export function daysAgo(n: number): string {
  return `-${Math.round(n)} days`;
}
