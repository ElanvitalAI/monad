// ⛔⭐ **왜 이 시험이 있나** — 「분모가 0인 비율」을 사람 화면에 어떻게 적을지가 이 저장소에 «두 벌»로
//   구현돼 있다(2026-08-28 · `#13634` 퍼널 · `#13650` review-stats). 둘을 «한 함수»로 합치지 않은 것은
//   의도다 — 도메인 결합이 생긴다(그 판단과 위험은 `src/index.ts` 의 그 함수 주석에 적혀 있다).
//   ⇒ 그러나 「위험을 적어 두었다」는 «한쪽만 고쳐지는 것»을 막지 못한다.
//   ⇒ 그래서 ***모듈을 결합하지 않고 «행위»를 결합한다*** — 두 벌이 같은 낱말을 쓰는지 여기서 문다.
//
// ⛔ 이 시험이 «빨개지는» 정당한 경우: 어휘를 바꾸기로 «결정»했을 때. 그때는 두 벌을 «같이» 고치고
//   이 시험의 낱말도 같이 바꾼다. 한쪽만 고치면 여기서 걸린다 — 그것이 이 시험의 목적이다.
import { describe, expect, it } from 'bun:test';
import { formatReviewStatsPercentage } from '../src/index';
import { buildFunnelReport } from '../src/domains/signal-funnel';

/** 이 저장소가 「측정 불가」를 사람에게 적는 낱말. 두 벌이 이것을 공유한다. */
const UNMEASURED = '미측정';

describe('「측정 불가」 어휘 계약 — 두 구현이 갈라지지 않는다', () => {
  it('review-stats 포매터는 분모가 0이면 그 낱말을 낸다', () => {
    expect(formatReviewStatsPercentage(0, 0)).toBe(UNMEASURED);
  });

  it('review-stats 포매터는 분모가 있으면 «퍼센트»를 낸다 — 0% 를 지우지 않는다', () => {
    expect(formatReviewStatsPercentage(0, 5)).toBe('0%');
    expect(formatReviewStatsPercentage(0.6, 5)).toBe('60%');
  });

  it('퍼널 화면도 분모가 0인 줄에 «같은» 낱말을 쓴다', () => {
    const report = buildFunnelReport({
      total: 0, classified: 0, criticalRaised: 0, gate2Judged: 0, confirmed: 0,
      falsePositive: 0, pendingDigest: 0, execPaper: 0, execRefused: 0,
      outcomeVerified: 0, outcomeCorrect: 0, bySeverity: {},
    } as Parameters<typeof buildFunnelReport>[0]);
    const joined = report.lines.join('\n');
    expect(joined).toContain(UNMEASURED);
  });

  it('퍼널 화면은 분모가 있으면 «퍼센트»를 낸다', () => {
    const report = buildFunnelReport({
      total: 100, classified: 100, criticalRaised: 10, gate2Judged: 10, confirmed: 4,
      falsePositive: 6, pendingDigest: 0, execPaper: 1, execRefused: 1,
      outcomeVerified: 4, outcomeCorrect: 2, bySeverity: {},
    } as Parameters<typeof buildFunnelReport>[0]);
    const joined = report.lines.join('\n');
    expect(joined).toMatch(/\d+\.\d%/);
  });
});
