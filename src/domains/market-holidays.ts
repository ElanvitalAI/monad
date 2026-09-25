// ── Market holiday calendar (2026-07-05) ───────────────────────────────
//
// Static holiday tables so the market clock reports 휴장 (not "OPEN") on
// non-trading days. Dates are the MARKET-LOCAL calendar date (YYYY-MM-DD):
// US = America/New_York, KR = Asia/Seoul.
//
// Sources (cross-referenced 2026-07-05 via omni-crawl):
//   • US (NYSE/NASDAQ): nyse.com/markets/hours-calendars — 2026-2027 full
//     closures + 1:00pm ET early closes.
//   • KR (KRX): calendarlabs KRX 2026 + 공휴일 교차확인 (설날/추석/대체공휴일/
//     근로자의날/연말폐장 포함).
//
// REFRESH: US covers 2026-2027; KR covers 2026 only (2027 lunar holidays —
// 설날/추석 — need re-fetch). Re-run omni-crawl each December for the next year.
// Fail-open: an unlisted date is treated as a normal trading day.

/** 이 캘린더가 요구하는 시간대. 모든 `isUsHoliday`/`isUsEarlyClose` 인자는
 *  **이 시간대 기준 YYYY-MM-DD** 여야 한다. 호출자가 로컬/UTC 날짜를 넣으면 조용히
 *  어긋난다(2026-07-24 market-quote.ts 가 그랬다 — 수동 -4h 후 toISOString 으로 다시 UTC).
 *  계약을 주석이 아니라 상수로 내보내 양쪽이 같은 값을 참조하게 한다. */
export const US_MARKET_TIME_ZONE = 'America/New_York';

/** US (NYSE/NASDAQ) full-day closures. */
const US_CLOSED = new Set<string>([
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/** US early closes — regular session ends 13:00 ET (1:00pm). */
const US_EARLY_CLOSE = new Set<string>([
  '2026-11-27', '2026-12-24',
  '2027-11-26', '2027-12-23',
]);

/** KR (KRX) full-day closures — 2026. Includes 대체공휴일 + 근로자의날 +
 *  연말폐장(12/31). */
const KR_CLOSED = new Set<string>([
  '2026-01-01',                               // 신정
  '2026-02-16', '2026-02-17', '2026-02-18',   // 설날 연휴
  '2026-03-02',                               // 삼일절 대체(3/1 일)
  '2026-05-01',                               // 근로자의 날
  '2026-05-05',                               // 어린이날
  '2026-05-25',                               // 부처님오신날 대체(5/24 일)
  '2026-08-17',                               // 광복절 대체(8/15 토)
  '2026-09-24', '2026-09-25', '2026-09-28',   // 추석 연휴(+9/26 토 대체 9/28 월)
  '2026-10-05',                               // 개천절 대체(10/3 토)
  '2026-10-09',                               // 한글날
  '2026-12-25',                               // 크리스마스
  '2026-12-31',                               // 연말 폐장
]);

/** True when `date` (America/New_York YYYY-MM-DD) is a US market holiday. */
export function isUsHoliday(dateET: string): boolean {
  return US_CLOSED.has(dateET);
}

/** True when the US session closes early (13:00 ET) on `date`. */
export function isUsEarlyClose(dateET: string): boolean {
  return US_EARLY_CLOSE.has(dateET);
}

/** True when `date` (Asia/Seoul YYYY-MM-DD) is a KR market holiday.
 *  KR coverage is 2026 only — dates outside that fail open (normal day). */
export function isKrHoliday(dateKST: string): boolean {
  return KR_CLOSED.has(dateKST);
}

/** Whether the KR holiday table covers `date`'s year (so callers can caveat
 *  "휴장일 미확인" for uncovered years instead of silently assuming open). */
export function krCalendarCovers(dateKST: string): boolean {
  return dateKST.startsWith('2026-');
}
