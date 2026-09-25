// 표준 강제 가드 — "권고" 는 반드시 새로 샌다. 소스를 직접 스캔해서 막는다.
//
// 이 결함(ISO 저장 ↔ SQLite `datetime()` 문자열 비교)은 **하루의 절반만 틀리기** 때문에
// 리뷰·테스트가 잘 못 잡는다. 실제로 33곳이 조용히 살아 있었고, 그중 하나가 우연히 빨간
// 테스트로 드러나기 전까지 아무도 몰랐다. 그래서 사람 규율이 아니라 **기계 가드**로 둔다.
//
// 새 위반이 걸리면: `src/time/db-window.ts` 의 두 축 중 하나를 쓰라.
//   축① `within(col)` / `olderThan(col)` / `windowCompare(col, op)` — 저장 형식이 섞여도 옳다
//   축② `sinceTs(windowMs, nowMs?)` + raw 비교 — 저장이 ISO 균일일 때(인덱스 보존·시계 주입)

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');
/** 이 모듈 자신과 가드 테스트는 패턴을 **설명**하므로 제외. */
const EXEMPT = ['db-window.ts', 'db-window.test.ts', 'db-window-guard.test.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !EXEMPT.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

/** 주석을 지운 본문 — 줄 수는 유지해 줄번호가 어긋나지 않게 한다.
 *
 *  ⚠️ **정규식으로 하면 안 된다** — `VALUES ('a // b', datetime('now'))` 처럼 **문자열 안의
 *     `//`** 를 주석 시작으로 오인해 뒤를 지우고, 그 안의 실제 위반이 사라진다. 가드가
 *     "없다" 고 말하는데 실제로는 있는 최악이다.
 *  ⚠️ 백틱 템플릿 안은 **SQL** 이라 `--` 줄 주석도 지워야 한다 — 안 지우면 주석에 든 `>=` 가
 *     lookbehind 를 속여 바로 뒤의 `datetime('now')` 를 "비교 우변" 으로 통과시킨다.
 *  ⚠️⚠️ 그런데 그 `--` 처리도 **SQL 문자열 안에서는 하면 안 된다**(5차 리뷰 must-fix) —
 *     `VALUES ('a -- b', datetime('now'))` 의 `--` 를 주석으로 먹으면 또 위반이 사라진다.
 *     ⇒ 백틱 안에서 **중첩 SQL 문자열**(`'…'` · `"…"` · SQL 식 `''` 이스케이프)을 따로 추적한다.
 *
 *  세 층(JS 주석 · JS 문자열 · SQL 문자열)을 각각 상태로 들고 가는 작은 파서다. */
function stripComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  let quote: string | null = null;      // 열린 JS 따옴표(' " `)
  let sqlQuote: string | null = null;   // 백틱 안에서 열린 SQL 따옴표(' ")
  const blank = (n: number) => { for (let k = 0; k < n; k += 1) out.push(' '); };
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (quote) {
      if (c === '\\') { out.push(c, next ?? ''); i += 2; continue; }      // JS 이스케이프
      if (quote === '`') {
        if (sqlQuote) {                                                   // ── SQL 문자열 안 ──
          if (c === sqlQuote && next === sqlQuote) { out.push(c, next); i += 2; continue; }  // SQL '' 이스케이프
          if (c === sqlQuote) sqlQuote = null;
          out.push(c); i += 1; continue;
        }
        if (c === "'" || c === '"') { sqlQuote = c; out.push(c); i += 1; continue; }
        if (c === '-' && next === '-') {                                  // SQL 줄 주석
          while (i < src.length && src[i] !== '\n') { blank(1); i += 1; }
          continue;
        }
      }
      if (c === quote) { quote = null; sqlQuote = null; }
      out.push(c); i += 1; continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out.push(c); i += 1; continue; }
    if (c === '/' && next === '/') {                                      // JS 줄 주석
      while (i < src.length && src[i] !== '\n') { blank(1); i += 1; }
      continue;
    }
    if (c === '/' && next === '*') {                                      // JS 블록 주석(줄바꿈 보존)
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i += 1) out.push(src[i] === '\n' ? '\n' : ' ');
      continue;
    }
    out.push(c); i += 1;
  }
  return out.join('');
}

const FILES = walk(SRC);

/** ⚠️ 정확한 주석 제거는 문자 단위 상태기계라 비싸다(580파일 전수 = 수십 초). 후보 토큰이
 *  아예 없는 파일은 **읽자마자 건너뛴다** — 대부분이 그렇다. 정확도는 그대로, 시간은 수백 배.
 *  (건너뛴 파일은 정의상 위반이 있을 수 없으므로 커버리지 손실이 없다.) */
const CANDIDATE_TOKEN = /datetime\s*\(|CURRENT_TIMESTAMP/i;
const SCANNABLE: Array<{ file: string; body: string }> = FILES
  .map((file) => ({ file, raw: readFileSync(file, 'utf-8') }))
  .filter(({ raw }) => CANDIDATE_TOKEN.test(raw))
  .map(({ file, raw }) => ({ file, body: stripComments(raw) }));

/** raw 비교 탐지 — ⚠️ 표기 변형에 관대해야 한다(리뷰 must-fix). 대소문자(`DATETIME`)·
 *  함수 괄호 뒤 공백(`datetime( 'now')`)·쌍따옴표(`datetime("now")`) 전부 같은 결함이다.
 *  좁게 잡으면 가드가 **있는데도 새는** 최악이 된다. */
const RAW_COMPARE_SOURCE = String.raw`(?<!datetime\s?\(\s?)\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\s*(?:<=|>=|<|>)\s*datetime\s*\(\s*['"]now['"]`;
const RAW_COMPARE = new RegExp(RAW_COMPARE_SOURCE, 'i');
/** ⚠️ 비교도 여러 줄로 쓴다(`ts >=\n  datetime('now', ?)`) — 쓰기 가드와 같은 이유로 파일 전체를 훑는다. */
const rawCompareScanner = (): RegExp => new RegExp(RAW_COMPARE_SOURCE, 'gi');

/** SQL 안에서 시간을 **만들 때**의 위반 — `datetime('now')`·`CURRENT_TIMESTAMP` 는 공백 형식이라
 *  ISO 와 갈린다. 저장에 쓰려면 `sqlNowIso()`(= `strftime('%Y-%m-%dT%H:%M:%fZ', …)`)여야 한다.
 *
 *  ⚠️ 이 규칙이 **저장 균일성의 유일한 방벽**이다(2026-07-27 대표 결정). `ORDER BY` 72곳을
 *     감싸는 대신 저장을 ISO 로 통일했으므로, 여기가 뚫리면 정렬이 조용히 틀리기 시작한다.
 *
 *  ⚠️⚠️ **거리로 판별하지 않는다**(2차 리뷰 must-fix). 종전엔 `INSERT[\s\S]{0,400}?VALUES…`
 *     처럼 키워드와 시간함수 사이 **문자 수**를 세었는데, 컬럼 목록이 길면 그 창을 넘겨 통과했고
 *     반대로 창 안에 무관한 `SELECT` 가 끼면 오탐이었다. 거리 개념 자체를 버린다:
 *
 *       · `CURRENT_TIMESTAMP` — 이 레포에 정당한 읽기 용례가 없다 ⇒ **어디에 있든 위반**.
 *       · `datetime('now'` — 정당한 용례는 **비교 우변** 하나뿐이다(`datetime(col) >= datetime('now'`).
 *         그래서 **직전 토큰이 비교 연산자가 아니면 위반**으로 본다. 쓰기 문맥에서는 앞이
 *         `(`(VALUES) 또는 `=`(SET) 라 자연히 걸린다.
 *         ⚠️ lookbehind 의 공백은 `\s*`(가변 길이)여야 한다 — `\s{0,8}` 같은 상한은 **또 다른
 *            거리**이고, 들여쓰기가 깊은 여러 줄 비교(`>=\n            datetime('now')`)를
 *            쓰기 위반으로 오탐한다(2차 리뷰 must-fix).
 *
 *     문장 경계·길이를 몰라도 되고, 새 SQL 표기가 나와도 안 샌다. */
const SQL_NOW_WRITE_SOURCES = [
  String.raw`\bCURRENT_TIMESTAMP\b`,
  // 비교 우변(`>= datetime('now'`)이 **아닌** 모든 `datetime('now'`
  String.raw`(?<!(?:<=|>=|<|>)\s*)datetime\s*\(\s*['"]now['"]`,
];
const RAW_SQL_NOW_WRITE = new RegExp(SQL_NOW_WRITE_SOURCES.join('|'), 'i');
/** 위치를 알려면 전역 플래그가 필요하다. 호출마다 새로 만든다 — `lastIndex` 공유 금지. */
const sqlNowWriteScanner = (): RegExp => new RegExp(SQL_NOW_WRITE_SOURCES.join('|'), 'gi');

describe('db-window 표준 가드', () => {
  test('★시간 컬럼을 `datetime(\'now\')` 와 raw 비교하지 않는다', () => {
    // `ts >= datetime('now', …)` 는 타입 없는 **문자열 비교**로 떨어진다.
    // 왼쪽이 이미 `datetime(...)` 로 감싸였으면 통과(축①).
    const offenders: string[] = [];
    for (const { file, body } of SCANNABLE) {
      for (const m of body.matchAll(rawCompareScanner())) {
        const line = body.slice(0, m.index ?? 0).split('\n').length;
        offenders.push(`${file.slice(SRC.length + 1)}:${line}  ${m[0].replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('★SQL 로 시간을 쓸 때 ISO 형식을 벗어나지 않는다 (저장 균일성의 방벽)', () => {
    // 프로덕션은 `toISOString()`(T·Z)으로 쓴다. SQL 이 `datetime('now')`/`CURRENT_TIMESTAMP`
    // (공백 형식)로 쓰면 같은 컬럼에 **두 형식이 섞이고**, 그 순간 raw 정렬·비교가 저장 형식에
    // 좌우된다. 테스트도 예외가 아니다 — 테스트만 다른 형식으로 넣으면 **테스트에서만 맞는**
    // 상태가 된다(이 결함이 오래 산 구조적 이유). 쓰기 경로는 `sqlNowIso()` 하나로 모은다.
    const offenders: string[] = [];
    for (const { file, body } of SCANNABLE) {
      for (const m of body.matchAll(sqlNowWriteScanner())) {
        const line = body.slice(0, m.index ?? 0).split('\n').length;
        offenders.push(`${file.slice(SRC.length + 1)}:${line}  ${m[0].replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('가드가 헛돌지 않는다 — 표기 변형까지 실제로 잡는지', () => {
    // 가드가 Goodhart 가 되지 않게, 정규식이 진짜 위반을 잡는지 직접 확인한다.
    // ⚠️ 특히 **표기 변형**을 넣는다 — 좁은 정규식은 "가드가 있는데도 새는" 최악을 만든다.
    for (const bad of [
      `WHERE ts >= datetime('now', ?)`,
      `WHERE e.ts > datetime('now','-24 hours')`,
      `WHERE fetch_ts < datetime('now', ?)`,
      `WHERE ts >= DATETIME('now', ?)`,          // 대문자
      `WHERE ts >= datetime( 'now', ?)`,         // 괄호 뒤 공백
      `WHERE ts >= datetime("now", ?)`,          // 쌍따옴표
      `WHERE ts>=datetime('now',?)`,             // 공백 없음
    ]) expect({ bad, hit: RAW_COMPARE.test(bad) }).toEqual({ bad, hit: true });

    // 표준을 쓴 형태는 통과해야 한다
    for (const ok of [
      `WHERE datetime(ts) >= datetime('now', ?)`,
      `WHERE datetime(e.ts) < datetime('now', ?)`,
      `WHERE ts >= ?`,
    ]) expect({ ok, hit: RAW_COMPARE.test(ok) }).toEqual({ ok, hit: false });

    // 비교도 여러 줄로 쓴다 — 줄 단위 스캔이 놓치던 형태
    expect(RAW_COMPARE.test(`WHERE ts >=\n       datetime('now', ?)`)).toBe(true);

    // SQL 쓰기 가드 — 쓰기 경로 전부 · 여러 줄 · **긴 SQL(거리 함정)** 까지
    const longCols = Array.from({ length: 40 }, (_, i) => `col${i}`).join(', ');
    for (const bad of [
      `INSERT INTO t(ts) VALUES (datetime('now'))`,
      `INSERT INTO t(ts) VALUES (DATETIME( "now" ))`,
      `UPDATE t SET ts = datetime('now') WHERE id = ?`,
      `UPDATE t SET read_at = DATETIME('now'), read = 1`,
      `CREATE TABLE t(ts TEXT DEFAULT (datetime('now')))`,
      `CREATE TABLE t(ts TEXT DEFAULT CURRENT_TIMESTAMP)`,
      // CURRENT_TIMESTAMP 는 DEFAULT 밖 **값 자리**에서도 공백 형식을 쓴다
      `INSERT INTO t(ts) VALUES (CURRENT_TIMESTAMP)`,
      `UPDATE t SET ts = CURRENT_TIMESTAMP WHERE id = ?`,
      // 여러 줄 SQL — 줄 단위 스캔이 놓치던 형태
      `UPDATE t\n     SET ts = datetime('now')\n   WHERE id = ?`,
      `INSERT INTO t(id, ts)\n     VALUES (?, datetime('now'))`,
      // ⭐ 거리 함정 — 컬럼 목록이 길어 종전 `{0,400}` 창을 넘기던 형태
      `INSERT INTO t(${longCols}, ts)\n     VALUES (${'?, '.repeat(40)}datetime('now'))`,
      `UPDATE t\n     SET ${longCols.split(', ').map((c) => `${c} = ?`).join(',\n         ')},\n         ts = CURRENT_TIMESTAMP`,
    ]) expect({ bad: bad.replace(/\s+/g, ' ').slice(0, 60), hit: RAW_SQL_NOW_WRITE.test(bad) })
      .toEqual({ bad: bad.replace(/\s+/g, ' ').slice(0, 60), hit: true });

    // 표준(sqlNowIso)·파라미터 바인딩·**비교 우변**은 통과해야 한다
    for (const ok of [
      `INSERT INTO t(ts) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      `INSERT INTO t(id, ts)\n     VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      `UPDATE t SET ts = ? WHERE id = ?`,
      `SELECT * FROM t WHERE datetime(ts) >= datetime('now', ?)`,
      `SELECT * FROM t WHERE datetime(ts) <\n       datetime('now', ?)`,
    ]) expect({ ok: ok.replace(/\s+/g, ' ').slice(0, 60), hit: RAW_SQL_NOW_WRITE.test(ok) })
      .toEqual({ ok: ok.replace(/\s+/g, ' ').slice(0, 60), hit: false });

    // 주석 제거 — 줄번호 보존(오탐 보고의 신뢰성)과 **문자열 보호**(누락 방지)
    const src = `line1\n/* block\n   comment */\nline4 // trailing\nline5`;
    expect(stripComments(src).split('\n').length).toBe(src.split('\n').length);
    expect(stripComments(src)).not.toContain('block');
    expect(stripComments(src)).not.toContain('trailing');

    // ⭐ 문자열 안의 `//` 를 주석으로 오인하면 **뒤의 실제 위반이 사라진다**
    const tricky = `db.run(\`INSERT INTO t(u, ts) VALUES ('a // b', datetime('now'))\`)`;
    expect(stripComments(tricky)).toContain("datetime('now')");
    expect(RAW_SQL_NOW_WRITE.test(stripComments(tricky))).toBe(true);
    const url = `db.run(\`INSERT INTO t(u, ts) VALUES ('https://x', CURRENT_TIMESTAMP)\`)`;
    expect(RAW_SQL_NOW_WRITE.test(stripComments(url))).toBe(true);

    // ⭐ SQL **문자열** 안의 `--` 는 주석이 아니다 — 먹으면 뒤의 실제 위반이 사라진다
    const sqlStr = 'db.run(`INSERT INTO t(u, ts) VALUES (\'a -- b\', datetime(\'now\'))`)';
    expect(stripComments(sqlStr)).toContain("datetime('now')");
    expect(RAW_SQL_NOW_WRITE.test(stripComments(sqlStr))).toBe(true);
    const sqlEsc = 'db.run(`INSERT INTO t(u, ts) VALUES (\'it\'\'s -- x\', CURRENT_TIMESTAMP)`)';
    expect(RAW_SQL_NOW_WRITE.test(stripComments(sqlEsc))).toBe(true);

    // ⭐ SQL 주석 안의 비교 연산자로 lookbehind 를 속이지 못한다
    const sqlComment = 'db.run(`UPDATE t\n     SET ts = -- >=\n         datetime(\'now\')`)';
    expect(RAW_SQL_NOW_WRITE.test(stripComments(sqlComment))).toBe(true);

    // 깊게 들여쓴 여러 줄 비교는 여전히 통과해야 한다(거리 상한을 없앤 이유)
    expect(RAW_SQL_NOW_WRITE.test(`WHERE datetime(ts) >=\n                    datetime('now', ?)`)).toBe(false);
  });
});
