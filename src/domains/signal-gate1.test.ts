// 1차 게이트 분류 규칙 단위테스트 — 순수(classifySeverityRules). L1/L4 튜닝(대표 2026-07-15).
import { test, expect, describe } from 'bun:test';
import { classifySeverityRules } from './signal-gate1.js';
import type { Signal } from './signal-pool.js';

const base = (over: Partial<Signal>): Signal => ({
  eventId: 'e', source: 'community', observedAt: '2026-07-15T05:00:00Z',
  collectedAt: '2026-07-15T05:00:00Z', origin: 'x', trust: 0.4, raw: '', ...over,
});
const FOCUS = ['005930.KO', '122630.KO', 'KORU.US'];

describe('L1 — 반복 하락 급증(bearish-flood) → 보호신호 후보 S3', () => {
  test('bearish-flood dedupGroup 은 focus 서사로 S3 승격(gate2 회부)', () => {
    const s = base({ asset: '005930.KO', dedupGroup: 'bearish-flood:005930.KO', proposedAction: 'protection', raw: '반복 하락 버즈 급증 14건' });
    expect(classifySeverityRules(s, { focusAssets: FOCUS }).severity).toBe('S3');
  });
  test('일반 커뮤니티 잡담(비 bearish-flood)은 단일=S1 상한 유지', () => {
    const s = base({ asset: '000660.KO', dedupGroup: '000660.KO', raw: '하닉 어쩌구' });
    expect(classifySeverityRules(s, { dedupCount: 1, focusAssets: FOCUS }).severity).toBe('S1');
  });
});

describe('L4 — 무포지션·비focus 1h 모멘텀은 gate2 회부 제외(S2)', () => {
  test('무포지션·비focus(0193W0) 급락 모멘텀 → S2(관망·gate2 제외)', () => {
    const s = base({ source: 'market', asset: '0193W0', proposedAction: 'watch momentum', trust: 1, raw: 'price-move 0193W0 1h 급락 -10.8% [watch·무포지션]; 현재 ...' });
    expect(classifySeverityRules(s, { focusAssets: FOCUS }).severity).toBe('S2');
  });
  test('focus 종목(122630) 급등 모멘텀 → S4(즉시 심층 유지)', () => {
    const s = base({ source: 'market', asset: '122630.KO', proposedAction: 'watch momentum', trust: 1, raw: 'price-move 122630 1h 급등 12.9% [watch·무포지션]; 현재 ...' });
    expect(classifySeverityRules(s, { focusAssets: FOCUS }).severity).toBe('S4');
  });
  test('보유([held]) 종목 모멘텀은 비focus 라도 S4', () => {
    const s = base({ source: 'market', asset: '999999', proposedAction: 'watch momentum', trust: 1, raw: 'price-move 999999 1h 급락 -5% [held]; 현재 ...' });
    expect(classifySeverityRules(s, { focusAssets: FOCUS }).severity).toBe('S4');
  });
  test('price-guard 보호 신호(protect·보유 게이팅됨)는 기존대로 S4', () => {
    const s = base({ source: 'market', asset: '005930.KO', proposedAction: 'protect exit_all', trust: 1, raw: 'price-guard 급락 005930.KO -8% [held]; ...' });
    expect(classifySeverityRules(s, { focusAssets: FOCUS }).severity).toBe('S4');
  });
});
