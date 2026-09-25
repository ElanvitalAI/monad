import { test, expect, describe, afterEach } from 'bun:test';
import {
  computeTrailingStops, computeLadderTriggers, evaluateKoruSwing,
  loadSwingState, formatOrderPlan, shouldAlert, nextDefense,
  KORU_LADDER, KORU_ENTRY_DEFAULT, type KoruSwingEval,
} from './koru-trailing.js';

/** 테스트용 최소 eval(상태 주입). */
function mkEval(current: number, highwater: number, lastNotifiedPrice = 0): KoruSwingEval {
  return {
    current,
    ladder: { triggered: [], nextRung: null },
    stops: computeTrailingStops(highwater, KORU_ENTRY_DEFAULT, current),
    state: { highwater, entryPrice: KORU_ENTRY_DEFAULT, firedLadder: [], lastNotifiedHigh: highwater, lastNotifiedPrice, updatedAt: '' },
  };
}
import { existsSync, unlinkSync } from 'node:fs';

const TMP = '/tmp/koru-swing-test.json';
afterEach(() => { if (existsSync(TMP)) unlinkSync(TMP); });

describe('익절 래더 (§1 시나리오C)', () => {
  test('레더 물량 정합: $700=코어유지선 450, $800=250 코어', () => {
    expect(KORU_LADDER.find(r => r.level === 700)?.remaining).toBe(450);
    expect(KORU_LADDER.find(r => r.level === 700)?.sellQty).toBe(40);
    expect(KORU_LADDER.find(r => r.level === 800)?.remaining).toBe(250);
    expect(KORU_LADDER.find(r => r.level === 800)?.sellQty).toBe(150);
  });

  test('현재가 $670 → $655 발동(25주), 다음 $680', () => {
    const t = computeLadderTriggers(670, []);
    expect(t.triggered.map(r => r.level)).toEqual([655]);
    expect(t.triggered[0].sellQty).toBe(25);
    expect(t.nextRung?.level).toBe(680);
  });

  test('현재가 $700 → 655·680·700 발동', () => {
    const t = computeLadderTriggers(700, []);
    expect(t.triggered.map(r => r.level)).toEqual([655, 680, 700]);
    expect(t.nextRung?.level).toBe(750);
  });

  test('중복 방지: 이미 발동한 레벨은 재발동 안 함', () => {
    const t = computeLadderTriggers(700, [655, 680]);
    expect(t.triggered.map(r => r.level)).toEqual([700]); // 655·680 제외
  });
});

describe('트레일링 손절 §4', () => {
  test('고가 $610 → $580/$561/$540(본전 클램프)', () => {
    const s = computeTrailingStops(610, 539.5, 610);
    expect(s.trim25).toBeCloseTo(579.5, 1);
    expect(s.trim50).toBeCloseTo(561.2, 1);
    expect(s.exitAll).toBeCloseTo(539.85, 1);
  });
  test('고가 $700 → $665/$644/$620', () => {
    const s = computeTrailingStops(700, 539.5, 700);
    expect(s.trim25).toBeCloseTo(665, 0);
    expect(s.trim50).toBeCloseTo(644, 0);
    expect(s.exitAll).toBeCloseTo(619.5, 1);
  });
  test('본전 아래 금지: 고가 낮으면 전량선 본전 클램프', () => {
    const s = computeTrailingStops(580, 539.5, 580);
    expect(s.exitAll).toBe(539.5);
    expect(s.entryFloorApplied).toBe(true);
  });
  test('액션: 손절선 이탈 → TRIM/EXIT', () => {
    expect(computeTrailingStops(700, 539.5, 660).action).toBe('TRIM_25');
    expect(computeTrailingStops(700, 539.5, 640).action).toBe('TRIM_50');
    expect(computeTrailingStops(700, 539.5, 615).action).toBe('EXIT_ALL');
    expect(computeTrailingStops(700, 539.5, 690).action).toBe('HOLD');
  });
});

describe('evaluateKoruSwing — 통합(익절+손절, 동적 트레일링)', () => {
  test('주가 오르면 highwater 상향 + 익절 발동 기록', () => {
    const e1 = evaluateKoruSwing(670, '2026-07-06T00:00:00Z', TMP);
    expect(e1.ladder.triggered.map(r => r.level)).toEqual([655]);
    expect(e1.state.highwater).toBe(670);
    expect(e1.state.firedLadder).toEqual([655]);

    const e2 = evaluateKoruSwing(700, '2026-07-06T01:00:00Z', TMP);
    expect(e2.ladder.triggered.map(r => r.level)).toEqual([680, 700]); // 655 이미 발동
    expect(e2.state.highwater).toBe(700);
    expect(e2.stops.trim25).toBeCloseTo(665, 0); // 손절선도 상향(700 기준)
  });

  test('주가 내려도 highwater 유지 → 손절선 고가 기준 유지(트레일링)', () => {
    evaluateKoruSwing(700, '2026-07-06T00:00:00Z', TMP);
    const down = evaluateKoruSwing(660, '2026-07-06T01:00:00Z', TMP);
    expect(down.state.highwater).toBe(700);          // 유지
    expect(down.stops.action).toBe('TRIM_25');       // 660 ≤ 665
    expect(down.ladder.triggered).toEqual([]);        // 660<680 신규 익절 없음
  });

  test('상향 후 급락 → 전량 EXIT', () => {
    evaluateKoruSwing(700, '2026-07-06T00:00:00Z', TMP);
    const crash = evaluateKoruSwing(615, '2026-07-06T02:00:00Z', TMP);
    expect(crash.stops.action).toBe('EXIT_ALL');     // 615 ≤ 619.5
  });

  test('sessionHigh(장중 고가) → highwater는 고가, 손절 액션은 현재가', () => {
    // 10분 스냅샷 current=660인데 세션 고가는 700까지 찍힘.
    const e = evaluateKoruSwing(660, '2026-07-06T00:00:00Z', TMP, 700);
    expect(e.state.highwater).toBe(700);          // ★ 스냅샷(660)이 아닌 세션 고가(700)
    expect(e.stops.trim25).toBeCloseTo(665, 0);   // 손절선은 고가 700 기준
    expect(e.ladder.triggered.map(r => r.level)).toEqual([655, 680, 700]); // 고가 700 도달분
    expect(e.stops.action).toBe('TRIM_25');       // 액션은 현재가 660 기준(≤665)
  });

  test('sessionHigh 미주입 → current로 fallback(기존 동작)', () => {
    const e = evaluateKoruSwing(660, '2026-07-06T00:00:00Z', TMP);
    expect(e.state.highwater).toBe(660);
  });

  test('Blue Ocean 리밋: refPrice 주입 → 세션 상하한 ±20% + 상한가 판정', () => {
    // 전일종가 543 → 상한 651.6·하한 434.4. 현재 653(상한 위) = 상한가.
    const e = evaluateKoruSwing(653, '2026-07-06T00:00:00Z', TMP, 654, 543);
    expect(e.sessionLimit).toBeDefined();
    expect(e.sessionLimit!.upper).toBeCloseTo(651.6, 1);
    expect(e.sessionLimit!.lower).toBeCloseTo(434.4, 1);
    expect(e.sessionLimit!.atUpper).toBe(true);   // 653 ≥ 651.6 → 상한가
    // order_plan에 리밋 대기($655은 상한 651.6 위) 표기
    expect(formatOrderPlan(e)).toContain('리밋대기');
  });

  test('Blue Ocean 리밋: refPrice 미주입(정규장) → sessionLimit 없음', () => {
    const e = evaluateKoruSwing(653, '2026-07-06T00:00:00Z', TMP, 654);
    expect(e.sessionLimit).toBeUndefined();
  });
});

describe('하방 방어선 근접 알림 (주간 움직임)', () => {
  // 고가 654 → trim25 621.3 / trim50 601.7 / exit 578.8
  test('nextDefense: 현재가 아래 가장 가까운 방어선', () => {
    expect(nextDefense(mkEval(650, 654))?.action).toBe('TRIM_25'); // 650 > 621
    expect(nextDefense(mkEval(610, 654))?.action).toBe('TRIM_50'); // 610 > 601.7
    expect(nextDefense(mkEval(590, 654))?.action).toBe('EXIT_ALL');
    expect(nextDefense(mkEval(570, 654))).toBeNull();              // 전량 스톱 아래
  });

  test('shouldAlert: 마지막 알림가 대비 −2% 하락 → 발송', () => {
    expect(shouldAlert(mkEval(660, 660, 660))).toBe(false);        // 변화 없음
    expect(shouldAlert(mkEval(645, 660, 660))).toBe(true);         // −2.3% 하락
  });

  test('shouldAlert: 방어선 2% 이내 근접 → 선제 경고 발송', () => {
    // trim25 621.3 · 현재 632 = +1.7% → 근접(2% 이내) → 발송
    expect(shouldAlert(mkEval(632, 654, 632))).toBe(true);
    // 현재 645 = trim25 대비 +3.8% → 아직 → 미발송(하락도 없음)
    expect(shouldAlert(mkEval(645, 654, 645))).toBe(false);
  });

  test('formatOrderPlan: 하방 방어 섹션 + 접근 경고', () => {
    const msg = formatOrderPlan(mkEval(628, 654, 640));
    expect(msg).toContain('하방 방어');
    expect(msg).toContain('접근');   // 628은 trim25 621.3에 +1.1% 근접
  });

  test('첫 실행: 본전 앵커 시작', () => {
    const st = loadSwingState(KORU_ENTRY_DEFAULT, TMP);
    expect(st.highwater).toBe(539.5);
    expect(st.firedLadder).toEqual([]);
    expect(st.lastNotifiedHigh).toBe(0);
  });
});

describe('formatOrderPlan / shouldAlert (예약주문 안내)', () => {
  test('order plan: 미체결 익절 래더 + 스톱로스 표시', () => {
    const e = evaluateKoruSwing(544, '2026-07-06T00:00:00Z', TMP);
    const plan = formatOrderPlan(e);
    expect(plan).toContain('삼성증권 세팅');
    expect(plan).toContain('$655→25주');       // 익절 래더
    expect(plan).toContain('하방 방어');        // 트레일링 방어 섹션
    expect(plan).toContain('다음 익절 $655');
  });

  test('order plan: 익절 도달분은 미체결 목록에서 빠짐', () => {
    const e = evaluateKoruSwing(660, '2026-07-06T00:00:00Z', TMP); // $655 발동
    const plan = formatOrderPlan(e);
    expect(plan).toContain('🎯 $655 도달 → 25주');    // 이벤트
    expect(plan).not.toContain('$655→25주');           // 미체결 목록엔 없음
  });

  test('shouldAlert: 신규 익절·손절·고가갱신 시 true, 아니면 false', () => {
    const fill = evaluateKoruSwing(660, '2026-07-06T00:00:00Z', TMP); // 익절 발동
    expect(shouldAlert(fill)).toBe(true);
    // 같은 고가 재조회(신규 없음) → lastNotifiedHigh 갱신 후엔 false
    const e2 = evaluateKoruSwing(660, '2026-07-06T01:00:00Z', TMP);
    e2.state.lastNotifiedHigh = e2.state.highwater; // 알림 후 마킹 가정
    expect(shouldAlert(e2)).toBe(false);
  });
});
