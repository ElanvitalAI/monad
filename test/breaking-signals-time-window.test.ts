// 시간창 비교 형식 불일치 — 2026-07-27.
//
// `ts` 는 JS 가 `toISOString()` 으로 넣어 `2026-07-27T02:49:07.469Z` 인데
// `datetime('now', ?)` 는 `2026-07-26 14:49:07` 을 준다. 그냥 비교하면 **문자열 비교**가 되고
// 10번째 글자에서 `'T'`(0x54) > `' '`(0x20) 이라 **날짜만 같으면 시각과 무관하게 통과**한다.
//
// ⚠️ 이 테스트들은 창 밖 행을 **cutoff 와 같은 UTC 날짜**에 놓는다. 그래야 결함이 재현된다 —
//    날짜가 갈리면 문자열 비교도 우연히 맞아서 통과해 버린다(원래 이 결함이 하루의 절반만
//    빨갛던 이유이고, 그래서 `-24 hours` 같은 고정 오프셋으로는 회귀를 못 잡는다).
//    그 배치를 `outsideWindow()` 가 **시각 분기 없이** 만든다 — 자세한 건 그 주석 참고.

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openSignalsDb, recentAlertedTexts, recentSentSignals, topSignals, periodStats, pruneOld,
} from '../src/domains/breaking-signals.js';

function withDb<T>(fn: (db: ReturnType<typeof openSignalsDb>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'signals-window-'));
  const db = openSignalsDb(join(dir, 's.db'));
  try { return fn(db); } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}

/** 창 밖이면서 **cutoff 와 같은 UTC 날짜**인 시각을 만든다 — 결함 재현의 핵심 조건이다.
 *
 *  방법: cutoff 의 **그날 00:00:00.000Z**. 정의상 cutoff 와 날짜가 같고 cutoff 보다 이르다.
 *  시각에 의존하는 분기가 없으므로 하루 중 언제 돌려도 같은 결과가 나온다.
 *
 *  ⚠️ 처음엔 "cutoff − 1시간, 날짜가 갈리면 00:05 로 당김" 으로 썼는데, cutoff 가 00:00~00:04
 *     구간이면 그 00:05 가 **cutoff 보다 나중**이 되어 올바른 구현에서도 실패하는 flaky
 *     테스트였다(리뷰 must-fix). 조건 분기를 없애는 쪽으로 다시 썼다.
 *  ⚠️ cutoff 가 정확히 자정이면 floor == cutoff 가 되어 `>=` 경계에 걸리므로, 그때만 1ms 를
 *     더 뺀다(날짜가 갈려 재현 강도는 떨어지지만 **거짓 실패는 없다**). */
function outsideWindow(windowMs: number): { inside: string; outside: string } {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);
  const floor = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate()));
  const outside = floor.getTime() === cutoff.getTime() ? new Date(floor.getTime() - 1) : floor;
  return { inside: now.toISOString(), outside: outside.toISOString() };
}
const HOURS = (h: number) => h * 3600_000;
const DAYS = (d: number) => d * 24 * 3600_000;

// ⭐ 경계값 (리뷰 must-fix · 2026-07-27) — 위 테스트들은 "창 밖 vs 창 안"만 본다. 그러면
//    cutoff 를 하루쯤 밀어놔도 통과한다. **경계 그 자체**(직전·정확히·직후)를 고정해야
//    창의 위치가 잠긴다.
describe('시간창 경계 — cutoff 직전/직후가 갈린다', () => {
  /** cutoff 기준 오프셋(ms)만큼 떨어진 시각. 음수 = 더 과거(창 밖 방향).
   *
   *  ⚠️ 여유를 **1분**으로 잡는다(리뷰 should-fix) — 삽입~조회 사이의 실행 지연이 여유보다
   *     크면 경계를 넘어가 flake 한다. `datetime()` 은 초 해상도라 ±1초는 지연 한 번에 먹힌다.
   *     `now` 를 한 번만 캡처해 두 행이 **같은 기준시각**을 쓰게 하는 것도 함께 필요하다. */
  const EDGE = 60_000;
  const atCutoffOffset = (now: number, windowMs: number, offsetMs: number): string =>
    new Date(now - windowMs + offsetMs).toISOString();

  test('cutoff 직후(창 안)는 포함된다', () => {
    const got = withDb((db) => {
      db.prepare(`INSERT INTO signals(id, ts, text, alerted) VALUES (?,?,?,?)`)
        .run('edge-in', atCutoffOffset(Date.now(), HOURS(12), EDGE), 'just inside', 1);
      return recentAlertedTexts(db, 12);
    });
    expect(got).toEqual(['just inside']);
  });

  test('cutoff 직전(창 밖)은 제외된다', () => {
    const got = withDb((db) => {
      db.prepare(`INSERT INTO signals(id, ts, text, alerted) VALUES (?,?,?,?)`)
        .run('edge-out', atCutoffOffset(Date.now(), HOURS(12), -EDGE), 'just outside', 1);
      return recentAlertedTexts(db, 12);
    });
    expect(got).toEqual([]);
  });

  test('⭐ 경계를 사이에 둔 두 행이 실제로 갈린다(창 위치가 잠긴다)', () => {
    // 둘을 한 DB 에 같이 넣는다 — 창이 통째로 밀려 있으면 둘 다 들어오거나 둘 다 빠져서 실패한다.
    const got = withDb((db) => {
      const ins = db.prepare(`INSERT INTO signals(id, ts, text, alerted) VALUES (?,?,?,?)`);
      const now = Date.now();          // ⭐ 기준시각을 한 번만 캡처 — 두 행이 같은 창을 본다
      ins.run('e-in', atCutoffOffset(now, HOURS(12), EDGE), 'inside', 1);
      ins.run('e-out', atCutoffOffset(now, HOURS(12), -EDGE), 'outside', 1);
      return recentAlertedTexts(db, 12);
    });
    expect(got).toEqual(['inside']);
  });
});

describe('시간창 비교는 ISO 저장 형식에서도 정확해야 한다', () => {
  test('★recentAlertedTexts — 창 밖 발송분은 dedup 스냅샷에 들어오지 않는다', () => {
    // 이게 새면 오래된 발송분을 "최근" 으로 물어 **새 신호를 중복이라며 억제**한다.
    const { inside, outside } = outsideWindow(HOURS(12));
    const got = withDb((db) => {
      const ins = db.prepare(`INSERT INTO signals(id, ts, text, alerted) VALUES (?,?,?,?)`);
      ins.run('in', inside, 'recent alerted', 1);
      ins.run('out', outside, 'stale alerted', 1);
      return recentAlertedTexts(db, 12);
    });
    expect(got).toEqual(['recent alerted']);
  });

  test('★topSignals — 창 밖 신호는 증류 대상이 아니다', () => {
    const { inside, outside } = outsideWindow(DAYS(1));
    const got = withDb((db) => {
      const ins = db.prepare(`INSERT INTO signals(id, ts, text, impact) VALUES (?,?,?,?)`);
      ins.run('in', inside, 'recent', 9);
      ins.run('out', outside, 'stale', 9);
      return topSignals(db, 1, 10).map((r) => r.text);
    });
    expect(got).toEqual(['recent']);
  });

  test('★periodStats — 창 밖 신호는 집계에 섞이지 않는다', () => {
    const { inside, outside } = outsideWindow(DAYS(1));
    const got = withDb((db) => {
      const ins = db.prepare(`INSERT INTO signals(id, ts, text, impact, sector) VALUES (?,?,?,?,?)`);
      ins.run('in', inside, 'recent', 9, 'tech');
      ins.run('out', outside, 'stale', 9, 'tech');
      return periodStats(db, 1);
    });
    expect({ total: got.total, sector: got.bySector }).toEqual({ total: 1, sector: [{ sector: 'tech', n: 1 }] });
  });

  test('★recentSentSignals — 창 밖 발송분은 의미 dedup 대상이 아니다', () => {
    // `recentAlertedTexts` 와 짝인 6h dedup 창. 여기가 새면 오래된 발송분과 의미 비교를 해서
    // 새 신호를 눌러버린다. alerted·digested 두 경로 모두 창 밖이면 안 잡혀야 한다.
    const { inside, outside } = outsideWindow(HOURS(6));
    const got = withDb((db) => {
      const ins = db.prepare(
        `INSERT INTO signals(id, ts, text, alerted, digested, impact) VALUES (?,?,?,?,?,?)`,
      );
      ins.run('in-alerted', inside, 'recent alerted', 1, 0, 9);
      ins.run('in-digested', inside, 'recent digested', 0, 1, 9);
      ins.run('out-alerted', outside, 'stale alerted', 1, 0, 9);
      ins.run('out-digested', outside, 'stale digested', 0, 1, 9);
      return recentSentSignals(db, 6, 6).map((r) => r.text).sort();
    });
    expect(got).toEqual(['recent alerted', 'recent digested']);
  });

  test('ISO 저장과 SQLite 저장이 섞여 있어도 같은 판정을 준다', () => {
    // `datetime(ts)` 정규화가 형식-무관해야 저장 경로가 갈려도 안전하다.
    const { inside, outside } = outsideWindow(HOURS(12));
    const toSqliteForm = (iso: string) => iso.slice(0, 19).replace('T', ' ');
    const got = withDb((db) => {
      const ins = db.prepare(`INSERT INTO signals(id, ts, text, alerted) VALUES (?,?,?,?)`);
      ins.run('iso-in', inside, 'iso recent', 1);
      ins.run('sql-in', toSqliteForm(inside), 'sqlite recent', 1);
      ins.run('iso-out', outside, 'iso stale', 1);
      ins.run('sql-out', toSqliteForm(outside), 'sqlite stale', 1);
      return recentAlertedTexts(db, 12).sort();
    });
    expect(got).toEqual(['iso recent', 'sqlite recent']);
  });

  test('★pruneOld — 보존기간을 넘긴 행은 실제로 지워진다', () => {
    // 여긴 반대 방향으로 샌다 — 문자열 비교면 `ts < cutoff` 가 거짓이 되어 **덜 지운다**.
    const { inside, outside } = outsideWindow(DAYS(1));
    const { deleted, left } = withDb((db) => {
      const ins = db.prepare(`INSERT INTO signals(id, ts, text) VALUES (?,?,?)`);
      ins.run('in', inside, 'keep');
      ins.run('out', outside, 'drop');
      const deleted = pruneOld(db, 1);
      const left = (db.prepare(`SELECT text FROM signals`).all() as Array<{ text: string }>).map((r) => r.text);
      return { deleted, left };
    });
    expect({ deleted, left }).toEqual({ deleted: 1, left: ['keep'] });
  });
});
