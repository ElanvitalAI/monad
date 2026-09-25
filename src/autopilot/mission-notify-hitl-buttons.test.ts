import { describe, it, expect } from 'bun:test';
import {
  buildHitlButtonRows, buildHitlCallbackData, parseHitlCallbackData,
} from './mission-notify.js';

const MID = 'apm_big-goal_abc123';

describe('A6-b 성숙도 분리 텔레그램 버튼', () => {
  it('기본 카드에는 성숙도 분리 버튼 없음(비과대)', () => {
    const rows = buildHitlButtonRows(MID);
    const all = rows.flat().map((b) => b.text);
    expect(all).toContain('✅ 승인(실행 시작)');
    expect(all.some((t) => t.includes('성숙도 분리'))).toBe(false);
  });

  it('maturityButton=true 면 성숙도 분리 원탭 추가', () => {
    const rows = buildHitlButtonRows(MID, { maturityButton: true });
    const splitBtn = rows.flat().find((b) => b.text.includes('성숙도 분리'));
    expect(splitBtn).toBeDefined();
    expect(splitBtn!.data).toBe(buildHitlCallbackData(MID, 'maturity-split'));
    // 승인/보류·정정 버튼은 그대로 유지(비파괴)
    expect(rows.flat().some((b) => b.text === '✅ 승인(실행 시작)')).toBe(true);
  });

  it('maturity-split 콜백 데이터 왕복 파싱', () => {
    const data = buildHitlCallbackData(MID, 'maturity-split');
    const parsed = parseHitlCallbackData(data);
    expect(parsed).toEqual({ token: 'abc123', decision: 'maturity-split' });
  });

  it('콜백 data 는 64byte 캡 이내(ascii 토큰)', () => {
    expect(Buffer.byteLength(buildHitlCallbackData(MID, 'maturity-split'))).toBeLessThanOrEqual(64);
  });

  it('기존 액션 파싱 회귀 없음', () => {
    expect(parseHitlCallbackData(buildHitlCallbackData(MID, 'approve'))?.decision).toBe('approve');
    expect(parseHitlCallbackData(buildHitlCallbackData(MID, 'revise-scope'))?.decision).toBe('revise-scope');
    expect(parseHitlCallbackData('apm-hitl:abc123:bogus')).toBeNull();
  });
});
