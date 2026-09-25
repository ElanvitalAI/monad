// R3 신호 게이트(판단층·부작용0) 테스트 — 심볼 추출·신호 렌더·fail-soft.
import { describe, test, expect } from 'bun:test';
import { extractSymbolCandidates, buildAttractivenessSignal } from './signal-gate.js';
import type { AttractivenessVerdict } from '../domains/attractiveness-read.js';

describe('extractSymbolCandidates', () => {
  test('6자리 코드 → .KO/.KS/raw 변형 후보', () => {
    const c = extractSymbolCandidates('삼성전자 005930 매력도');
    expect(c).toContain('005930.KO');
    expect(c).toContain('005930.KS');
    expect(c).toContain('005930');
  });
  test('명시 접미(.KO)는 그대로만', () => {
    const c = extractSymbolCandidates('097950.KO 신호 봐줘');
    expect(c).toContain('097950.KO');
    expect(c).not.toContain('097950.KS');
  });
  test('종목 없으면 빈 배열', () => {
    expect(extractSymbolCandidates('리팩토링 코드 정리해줘')).toEqual([]);
  });
});

describe('buildAttractivenessSignal', () => {
  const fake = (map: Record<string, AttractivenessVerdict>) => (sym: string) => map[sym] ?? null;

  test('종목 없음 → null(스킵)', () => {
    expect(buildAttractivenessSignal('코드 정리', fake({}))).toBeNull();
  });

  test('신호 조회 성공 → 렌더 블록 + verdicts', () => {
    const r = buildAttractivenessSignal('005930 매력도 신호', fake({
      '005930.KO': { symbol: '005930.KO', signal: 'BUY', score: 72.1, z: 1.3, asOf: '2026-07-22' },
    }));
    expect(r).not.toBeNull();
    expect(r!.block).toContain('규율 신호');
    expect(r!.block).toContain('005930.KO: BUY');
    expect(r!.block).toContain('z +1.3');
    expect(r!.block).toContain('집행 아님');   // 판단층 명시
    expect(r!.verdicts).toHaveLength(1);
  });

  test('중복 심볼(변형 다중 히트)은 1건으로', () => {
    const v: AttractivenessVerdict = { symbol: '005930.KO', signal: 'HOLD', score: 50, asOf: '2026-07-22' };
    const r = buildAttractivenessSignal('005930 봐줘', fake({ '005930.KO': v, '005930.KS': v, '005930': v }));
    expect(r!.verdicts).toHaveLength(1);   // seen 가드
  });

  test('DB 부재/미스코어 → null(fail-soft)', () => {
    expect(buildAttractivenessSignal('999999 신호', fake({}))).toBeNull();
  });

  test('z 없는 구 스코어 행 → z 없이 렌더', () => {
    const r = buildAttractivenessSignal('005930', fake({
      '005930.KO': { symbol: '005930.KO', signal: 'SELL', score: 30, asOf: '2026-07-20' },
    }));
    expect(r!.block).toContain('005930.KO: SELL');
    expect(r!.block).not.toContain('z ');
  });
});
