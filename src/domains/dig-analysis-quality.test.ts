import { test, expect, describe } from 'bun:test';
import { assessDigAnalysis } from './dig-analysis-quality.js';

// 요구 차원(국면·영향·매매·확신)을 담은 정상 분석 산출물.
const good = [
  '# 반도체 국면 분석',
  '',
  '국면 판단: 외국인 수급이 5거래일 연속 순매수로 돌아서며 위험선호 전환 조짐이 뚜렷하다. 코스피 반도체 업종의 상대강도가 개선되고 있어 단기 반등 국면으로 판단한다.',
  '영향 경로: HBM 수요 확대 → SK하이닉스·삼성전자 실적 개선 → 한미반도체 등 소부장 밸류체인으로 파급. 미국 필라델피아 반도체 지수와의 동조성도 높아지는 중이다.',
  '매매 함의: 관찰 포인트는 외국인 순매수 지속 여부와 환율 안정. 리스크는 원달러 급등 시 수급 되돌림. 관찰 위주로 접근하고 포지션은 분할 대응을 권한다.',
  '확신도: 중간(0.6). 핵심 가정은 미 연준 금리 동결 지속과 HBM 가격 방어이며, 이 가정이 깨지면 재평가가 필요하다.',
  '추가 관찰: 대만 TSMC 실적 가이던스와 마이크론 재고 사이클도 함께 점검할 필요가 있으며, 국내 기관 수급이 외국인과 동행하는지 여부가 추세 지속의 핵심 변수다.',
].join('\n');

describe('assessDigAnalysis — Stage A1 독립 품질 게이트', () => {
  test('정상 분석(4차원·구조·길이) → pass score 3', () => {
    const r = assessDigAnalysis(good);
    expect(r.pass).toBe(true);
    expect(r.score).toBe(3);
    expect(r.reasons).toEqual([]);
  });

  test('300자 넘지만 한 덩어리(1줄) → structure 실패', () => {
    const blob = '국면 '.repeat(80) + '확신 영향'; // 길이 OK·차원 OK·1줄
    const r = assessDigAnalysis(blob);
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.includes('structure'))).toBe(true);
  });

  test('길이 부족 → length 실패', () => {
    const r = assessDigAnalysis('국면\n영향\n확신');
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.includes('length'))).toBe(true);
  });

  test('차원 부족(국면만·길이/구조 충족) → coverage 실패', () => {
    const oneDim = ['제목', '', 'x'.repeat(200), 'y'.repeat(200)].join('\n'); // 차원 키워드 없음
    const r = assessDigAnalysis(oneDim);
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => x.includes('coverage'))).toBe(true);
  });

  test('빈 본문 → fail score 0', () => {
    const r = assessDigAnalysis('');
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
  });
});
