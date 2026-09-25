import { test, expect, describe } from 'bun:test';
import {
  mapAssetFlow, mapMacroRates, mapKrFlow, mapKrSector, mapKrPulse, mapCommunityBuzz, mapUsSector, mapUsPulse, mapGeopolitics, mapDislocation,
  collectAxisSignals, AXIS_ORDER, freshnessDecay,
} from './regime-fetchers.js';

describe('mapCommunityBuzz — 커뮤니티 감정 축', () => {
  test('양수 감정=risk-on·표본 10글=만충 confidence(대표 2026-07-15·L3 상향)', () => {
    const s = mapCommunityBuzz({ avgSentiment: 0.4, points: 10 });
    expect(s.axis).toBe('community_buzz');
    expect(s.direction).toBe(1);
    expect(s.confidence).toBe(1);   // points/10 — 15→10 상향(커뮤니티 비중 중간 상향)
  });
  test('음수 감정=risk-off·표본 적으면 conf 낮음', () => {
    const s = mapCommunityBuzz({ avgSentiment: -0.3, points: 3 });
    expect(s.direction).toBe(-1);
    expect(s.confidence).toBeCloseTo(0.3, 5);   // 3/10 (이전 3/15=0.2 → 상향)
  });
  test('중립(0)=direction 0', () => {
    expect(mapCommunityBuzz({ avgSentiment: 0, points: 10 }).direction).toBe(0);
  });
});

describe('regime-fetchers — 축 방향 매핑 (대표 승인 기본규칙)', () => {
  test('asset_flow — riskOnScore 부호=방향·|score|=강도', () => {
    expect(mapAssetFlow({ riskOnScore: 0.6, conf: 0.8 })).toMatchObject({ axis: 'asset_flow', direction: 1, strength: 0.6, confidence: 0.8 });
    expect(mapAssetFlow({ riskOnScore: -0.4, conf: 1 }).direction).toBe(-1);
    expect(mapAssetFlow({ riskOnScore: 0, conf: 1 }).direction).toBe(0);
  });

  test('kr_flow — 외국인/기관 순매수 부호(양수=risk-on)', () => {
    expect(mapKrFlow({ netQtySum: 2e6, points: 10 })).toMatchObject({ axis: 'kr_flow', direction: 1 });
    expect(mapKrFlow({ netQtySum: -1e6, points: 5 }).direction).toBe(-1);
    expect(mapKrFlow({ netQtySum: 1e6, points: 0 }).confidence).toBe(0); // 데이터 없음=fail-soft
  });

  test('kr_sector — 섹터 모멘텀 부호 · 외국인 확증 시 conf↑', () => {
    const aligned = mapKrSector({ topMom: 2.4, foreignAligned: true, points: 5 });
    const notAligned = mapKrSector({ topMom: 2.4, foreignAligned: false, points: 5 });
    expect(aligned.direction).toBe(1);
    expect(aligned.confidence).toBeGreaterThan(notAligned.confidence); // 외국인 확증이 신뢰도↑
    expect(mapKrSector({ topMom: -1.5, foreignAligned: true, points: 5 }).direction).toBe(-1);
  });

  test('kr_pulse — 종목 평균등락 부호', () => {
    expect(mapKrPulse({ avgChgPct: 1.5, points: 20 }).direction).toBe(1);
    expect(mapKrPulse({ avgChgPct: -2.0, points: 20 }).direction).toBe(-1);
    expect(mapKrPulse({ avgChgPct: 6, points: 20 }).strength).toBe(1); // 클램프
  });

  test('us_sector — 13F 발산 부호', () => {
    expect(mapUsSector({ divergence: 0.5, conf: 0.7 }).direction).toBe(1);
    expect(mapUsSector({ divergence: -0.3, conf: 0.7 }).direction).toBe(-1);
  });

  test('us_pulse — 주간변동 부호(선행)', () => {
    expect(mapUsPulse({ avgWeekPct: 3, points: 15 }).direction).toBe(1);
    expect(mapUsPulse({ avgWeekPct: -12, points: 15 }).strength).toBe(1);
  });

  test('geopolitics — 고impact 몰림=risk-off 근사·아니면 중립(risk-on 안 함)', () => {
    expect(mapGeopolitics({ highImpactCount: 8, avgImpact: 7 }).direction).toBe(-1); // 몰림
    expect(mapGeopolitics({ highImpactCount: 2, avgImpact: 7 }).direction).toBe(0);  // 중립
    // 방향 근사라 신뢰도 낮게(≤0.35)
    expect(mapGeopolitics({ highImpactCount: 8, avgImpact: 7 }).confidence).toBeLessThanOrEqual(0.35);
    // risk-on(+1)은 절대 안 함
    expect(mapGeopolitics({ highImpactCount: 0, avgImpact: 0 }).direction).not.toBe(1);
  });

  test('dislocation(전환 축) — gap 부호 · strong 시 강도/신뢰↑', () => {
    const strong = mapDislocation({ gap: 0.5, strong: true });
    expect(strong).toMatchObject({ axis: 'dislocation', direction: 1, strength: 0.7 });
    expect(strong.confidence).toBe(0.6);
    expect(mapDislocation({ gap: -0.2, strong: false }).direction).toBe(-1);
  });
});

describe('mapMacroRates — B 매크로 금리·달러', () => {
  test('금리↑ + 원화약세 → risk-off(-1)·conf 0.7', () => {
    const s = mapMacroRates({ ust10yChange: 0.15, usdkrwChange: 12 });
    expect(s.direction).toBe(-1);
    expect(s.confidence).toBe(0.7);   // 둘 일치
  });
  test('금리↓ + 원화강세 → risk-on(+1)', () => {
    expect(mapMacroRates({ ust10yChange: -0.15, usdkrwChange: -12 }).direction).toBe(1);
  });
  test('불일치(금리↑·원화강세) → 방향 상쇄 0·conf 0.4', () => {
    const s = mapMacroRates({ ust10yChange: 0.15, usdkrwChange: -12 });
    expect(s.direction).toBe(0);
    expect(s.confidence).toBe(0.4);
  });
  test('데이터 부족(임계 미만) → conf 0', () => {
    expect(mapMacroRates({ ust10yChange: 0.01, usdkrwChange: 1 }).confidence).toBe(0);
    expect(mapMacroRates({}).confidence).toBe(0);
  });
});

describe('collectAxisSignals — 오케스트레이터(fail-soft)', () => {
  test('9축 REGIME_AXES 순서 · 주입 축 매핑 · 미주입 축 nil(conf 0)', () => {
    const sigs = collectAxisSignals({
      krFlow: () => ({ netQtySum: 2e6, points: 10 }),
      krPulse: () => ({ avgChgPct: 1.2, points: 20 }),
      geopolitics: () => ({ highImpactCount: 8, avgImpact: 7 }),
      macroRates: () => ({ ust10yChange: 0.15, usdkrwChange: 10 }),  // 금리↑+원화약세=risk-off
    });
    expect(sigs.length).toBe(10);
    expect(sigs.map(s => s.axis)).toEqual(AXIS_ORDER); // 순서 정합(macro_rates·community_buzz 포함)
    expect(sigs.find(s => s.axis === 'kr_flow')!.direction).toBe(1);
    expect(sigs.find(s => s.axis === 'kr_pulse')!.direction).toBe(1);
    expect(sigs.find(s => s.axis === 'macro_rates')!.direction).toBe(-1); // 금리↑+원화약세=risk-off
    expect(sigs.find(s => s.axis === 'asset_flow')!.confidence).toBe(0); // 미주입=nil
    expect(sigs.find(s => s.axis === 'us_sector')!.confidence).toBe(0);
  });

  test('raw fetcher throw → 그 축 nil(fail-soft·전체 안 죽음)', () => {
    const sigs = collectAxisSignals({
      krFlow: () => { throw new Error('db down'); },
      krPulse: () => ({ avgChgPct: -1, points: 5 }),
    });
    expect(sigs.find(s => s.axis === 'kr_flow')!.confidence).toBe(0);      // throw → nil
    expect(sigs.find(s => s.axis === 'kr_pulse')!.direction).toBe(-1);     // 나머지 정상
  });

  test('raw null 반환 → nil', () => {
    const sigs = collectAxisSignals({ krFlow: () => null });
    expect(sigs.find(s => s.axis === 'kr_flow')!.confidence).toBe(0);
  });
});

describe('freshnessDecay — M3.4 신선도 계수', () => {
  const NOW = '2026-07-07T12:00:00.000Z';
  test('0-2일(오늘·어제·주말) → 1.0(감쇠 없음)', () => {
    expect(freshnessDecay('2026-07-07', NOW)).toBe(1);
    expect(freshnessDecay('2026-07-06', NOW)).toBe(1);
    expect(freshnessDecay('2026-07-05', NOW)).toBe(1);
  });
  test('3일 → 0.85 · 4-5일 → 0.6 · 6일+ → 0.35', () => {
    expect(freshnessDecay('2026-07-04', NOW)).toBe(0.85);
    expect(freshnessDecay('2026-07-03', NOW)).toBe(0.6);
    expect(freshnessDecay('2026-07-02', NOW)).toBe(0.6);
    expect(freshnessDecay('2026-07-01', NOW)).toBe(0.35);   // 6일
    expect(freshnessDecay('2026-06-11', NOW)).toBe(0.35);   // 26일(sector stale 케이스)
  });
  test('date 파싱 실패 → 1(감쇠 안 함·안전)', () => {
    expect(freshnessDecay('not-a-date', NOW)).toBe(1);
  });
  test('graceDays(저빈도 소스) → grace 이내 나이는 감쇠 없음', () => {
    // 13F 정상 리듬: 최신 period 98일(2026-03-31) → grace 150 이내 = 신선.
    expect(freshnessDecay('2026-03-31', NOW, 150)).toBe(1);
    // grace 딱 넘겨도 유효나이 ≤2 는 1.0(주말 커버 곡선 재사용).
    expect(freshnessDecay('2026-02-06', NOW, 150)).toBe(1);   // 151일 → 유효 1일
  });
  test('graceDays 초과 방치(다음 분기 ingest 안 됨) → 곡선 감쇠 발동', () => {
    // 유효나이 = 나이 - grace. 155일 → 유효 5일 → 0.6 · 160일 → 유효 10일 → 0.35.
    expect(freshnessDecay('2026-02-02', NOW, 150)).toBe(0.6);   // 155일
    expect(freshnessDecay('2026-01-28', NOW, 150)).toBe(0.35);  // 160일(2분기 방치)
  });
});

describe('collectAxisSignals — 신선도 감쇠 통합 (M3.4)', () => {
  const NOW = '2026-07-07T12:00:00.000Z';
  test('now+asOfDate stale(6일) → 그 축 conf 감쇠 + note에 stale 표기', () => {
    const sigs = collectAxisSignals({
      krFlow: () => ({ netQtySum: 5e6, points: 10, asOfDate: '2026-07-01' }),  // conf 1.0 기대 → ×0.35
    }, NOW);
    const kf = sigs.find(s => s.axis === 'kr_flow')!;
    expect(kf.confidence).toBeCloseTo(0.35, 5);
    expect(kf.note).toContain('stale×0.35');
  });
  test('now 없으면 감쇠 안 함(하위호환)', () => {
    const sigs = collectAxisSignals({
      krFlow: () => ({ netQtySum: 5e6, points: 10, asOfDate: '2026-07-01' }),
    });
    expect(sigs.find(s => s.axis === 'kr_flow')!.confidence).toBe(1);   // 감쇠 없음
  });
  test('신선(어제) → 감쇠 없음', () => {
    const sigs = collectAxisSignals({
      krPulse: () => ({ avgChgPct: 3, points: 10, asOfDate: '2026-07-06' }),
    }, NOW);
    const kp = sigs.find(s => s.axis === 'kr_pulse')!;
    expect(kp.confidence).toBe(1);
    expect(kp.note).not.toContain('stale');
  });
  test('us_sector(13F 분기)는 asOfDate 없어 감쇠 스킵', () => {
    const sigs = collectAxisSignals({
      usSector: () => ({ divergence: 0.5, conf: 0.8 }),   // asOfDate 없음
    }, NOW);
    expect(sigs.find(s => s.axis === 'us_sector')!.confidence).toBeCloseTo(0.8, 5);
  });
  test('us_sector 정상 분기(98일·grace 이내) → 감쇠 없음', () => {
    const sigs = collectAxisSignals({
      usSector: () => ({ divergence: 0.5, conf: 0.8, asOfDate: '2026-03-31' }),  // 98일
    }, NOW);
    const us = sigs.find(s => s.axis === 'us_sector')!;
    expect(us.confidence).toBeCloseTo(0.8, 5);
    expect(us.note).not.toContain('stale');
  });
  test('us_sector 다음 분기 방치(160일·grace 초과) → conf 감쇠', () => {
    const sigs = collectAxisSignals({
      usSector: () => ({ divergence: 0.5, conf: 0.8, asOfDate: '2026-01-28' }),  // 160일 → ×0.35
    }, NOW);
    const us = sigs.find(s => s.axis === 'us_sector')!;
    expect(us.confidence).toBeCloseTo(0.28, 5);   // 0.8 × 0.35
    expect(us.note).toContain('stale×0.35');
  });
});
