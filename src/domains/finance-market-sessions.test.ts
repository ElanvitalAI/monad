import { test, expect, describe } from 'bun:test';
import { marketSessions } from './finance.js';

// marketSessions(now)는 결정적(now 주입) — Blue Ocean 오버나이트(주간거래) 게이트 검증.
describe('marketSessions — US 주간거래(Blue Ocean) 오버나이트', () => {
  test('한국 낮(월 11:00 KST=일 22:00 ET) → usOvernight, usLive=false', () => {
    // UTC 월 02:00 = KST 월 11:00 = ET(DST) 일 22:00 (after-hours 종료 후·CLOSED)
    const s = marketSessions(new Date('2026-07-06T02:00:00Z'));
    expect(s.usOvernight).toBe(true);
    expect(s.usLive).toBe(false);           // EODHD ET 세션 아님
    expect(s.us).toContain('주간거래');
    expect(s.anyTradeable).toBe(true);
  });

  test('한국 밤(월 23:00 KST=월 10:00 ET 정규장) → usLive, usOvernight=false', () => {
    // UTC 월 14:00 = KST 월 23:00 = ET(DST) 월 10:00 (정규장 OPEN)
    const s = marketSessions(new Date('2026-07-06T14:00:00Z'));
    expect(s.usLive).toBe(true);
    expect(s.usOvernight).toBe(false);      // ET 세션 중엔 오버나이트 아님(EODHD 라이브)
  });

  test('한국 새벽(월 07:00 KST=일 18:00 ET) → 주간거래 시간 전, overnight=false', () => {
    // UTC 일 22:00 = KST 월 07:00 (09:00 이전) → BO 윈도 밖
    const s = marketSessions(new Date('2026-07-05T22:00:00Z'));
    expect(s.usOvernight).toBe(false);
  });
});
