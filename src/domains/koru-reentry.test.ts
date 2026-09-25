import { test, expect, describe } from 'bun:test';
import {
  evaluateReentry, shouldAlertReentry, koruFromEwy, formatReentryAlert,
  formatReentryOrderPlan, EWY_ANCHOR, KORU_ANCHOR,
} from './koru-reentry.js';

// 헬퍼: 앞 n1개=v1, 뒤 n2개=v2 인 EWY EOD 배열(200MA/50MA 제어용).
const series = (v1: number, n1: number, v2: number, n2: number) =>
  [...Array(n1).fill(v1), ...Array(n2).fill(v2)];

describe('koruFromEwy 갭모델', () => {
  test('앵커에서 KORU=ANCHOR', () => {
    expect(koruFromEwy(EWY_ANCHOR)).toBeCloseTo(KORU_ANCHOR, 1);
  });
  test('EWY +8% → KORU ~+24%(3X 근사)', () => {
    expect(koruFromEwy(EWY_ANCHOR * 1.08)).toBeGreaterThan(KORU_ANCHOR * 1.22);
  });
});

describe('evaluateReentry — 캡스톤 국면 종속 + 되돌림 zone', () => {
  test('★ 캡스톤 방어(LONG 아님) → WAIT_REGIME(EWY 되돌림 도달해도 진입 X)', () => {
    const ewy = series(150, 150, 190, 50);       // EWY 200MA 위(구조OK)
    const e = evaluateReentry(600, 188, ewy, false); // capstoneLong=false
    expect(e.regimeOk).toBe(true);               // EWY 구조는 OK지만
    expect(e.zone).toBe('WAIT_REGIME');          // 캡스톤 방어라 대기
    expect(e.signal).toBe(false);
  });

  test('캡스톤 LONG + 급등 직후(50MA 위) → CHASE', () => {
    const ewy = Array(200).fill(180);
    const e = evaluateReentry(650, 195, ewy, true);
    expect(e.zone).toBe('CHASE');
    expect(e.signal).toBe(false);
  });

  test('캡스톤 LONG + EWY 50MA 이하 → ENTER_1', () => {
    const ewy = series(150, 150, 190, 50);
    const e = evaluateReentry(600, 188, ewy, true);
    expect(e.zone).toBe('ENTER_1');
    expect(e.signal).toBe(true);
  });

  test('캡스톤 LONG + 50MA -3% → ENTER_2', () => {
    const e = evaluateReentry(590, 188, series(150, 150, 195, 50), true);
    expect(e.zone).toBe('ENTER_2');
    expect(e.signal).toBe(true);
  });

  test('캡스톤 LONG + 앵커 회귀 → ENTER_CORE', () => {
    const e = evaluateReentry(541, 178, series(150, 150, 185, 50), true);
    expect(e.zone).toBe('ENTER_CORE');
    expect(e.signal).toBe(true);
  });

  test('EWY 200MA 아래 → REGIME_BREAK(캡스톤 무관·구조 붕괴 최우선)', () => {
    const e = evaluateReentry(500, 185, Array(200).fill(190), true);
    expect(e.zone).toBe('REGIME_BREAK');
    expect(e.signal).toBe(false);
  });

  test('캡스톤 LONG + 저변동 급락(vz≤-4) → DEEP_OVERSOLD', () => {
    const ewy = Array.from({ length: 200 }, (_, i) => 130 + i * 0.2);
    const e = evaluateReentry(560, 168, ewy, true);
    expect(e.vz).toBeLessThanOrEqual(-4);
    expect(e.zone).toBe('DEEP_OVERSOLD');
    expect(e.signal).toBe(true);
  });
});

describe('shouldAlertReentry — zone 전환 시에만', () => {
  test('진입·대기 전환 시 발송', () => {
    expect(shouldAlertReentry('ENTER_1', 'CHASE')).toBe(true);
    expect(shouldAlertReentry('WAIT_REGIME', 'WATCH')).toBe(true); // 대기 전환도 고지
    expect(shouldAlertReentry('REGIME_BREAK', 'ENTER_1')).toBe(true);
  });
  test('같은 zone·CHASE 진입은 억제', () => {
    expect(shouldAlertReentry('WAIT_REGIME', 'WAIT_REGIME')).toBe(false);
    expect(shouldAlertReentry('CHASE', 'WATCH')).toBe(false);
  });
});

describe('formatReentryAlert / OrderPlan (동적 EWY 기준)', () => {
  test('LONG 진입 신호 시 동적 래더 + 확인 안내', () => {
    const msg = formatReentryAlert(evaluateReentry(600, 188, series(150, 150, 190, 50), true));
    expect(msg).toContain('재진입');
    expect(msg).toContain('예약주문 매수 래더');
    expect(msg).toContain('KORU $');            // 동적 KORU 지정가
    expect(msg).toContain('매 아침 재계산');      // decay 갱신 안내
  });
  test('캡스톤 방어(WAIT_REGIME) → 예약주문 걸지 말 것', () => {
    const msg = formatReentryOrderPlan(evaluateReentry(600, 188, series(150, 150, 190, 50), false));
    expect(msg).toContain('예약주문 걸지 말 것');
  });
});
