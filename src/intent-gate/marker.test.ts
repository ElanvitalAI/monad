// 미션 마커 파서 결정론 검증(Narrow Waist V1 · §8 마커 문법).
import { describe, it, expect } from 'bun:test';
import { parseMissionMarker } from './marker.js';

describe('parseMissionMarker', () => {
  it('접두 콜론 마커 — 미션: / mission:', () => {
    expect(parseMissionMarker('미션: 삼성 급락하면 매매 검토')).toEqual({ isMission: true, goal: '삼성 급락하면 매매 검토' });
    expect(parseMissionMarker('mission: watch NVDA gap')).toEqual({ isMission: true, goal: 'watch NVDA gap' });
    expect(parseMissionMarker('MISSION: caps ok')).toEqual({ isMission: true, goal: 'caps ok' });
    // ★ 미션-콜론 사이 공백 허용(대표 실사례 2026-07-17 "미션 : <골>" 이 passthrough 로 샘)
    expect(parseMissionMarker('미션 : 콘텐츠 흡수 파이프라인 만들기')).toEqual({ isMission: true, goal: '콘텐츠 흡수 파이프라인 만들기' });
    expect(parseMissionMarker('미션　: 전각 공백도')).toEqual({ isMission: true, goal: '전각 공백도' });
    expect(parseMissionMarker('mission  : two spaces')).toEqual({ isMission: true, goal: 'two spaces' });
  });

  it('문두 구절 마커 — 이건 미션이야 …(구분자 정리)', () => {
    expect(parseMissionMarker('이건 미션이야: 매일 아침 반도체 뉴스 정리')).toEqual({ isMission: true, goal: '매일 아침 반도체 뉴스 정리' });
    expect(parseMissionMarker('이거 미션 이 주제 끝까지 파봐')).toEqual({ isMission: true, goal: '이 주제 끝까지 파봐' });
  });

  it('슬래시 /mission <text> (여러 줄 허용)', () => {
    expect(parseMissionMarker('/mission 삼성 매매\n둘째 줄')).toEqual({ isMission: true, goal: '삼성 매매\n둘째 줄' });
    expect(parseMissionMarker('/mission@example_monad_bot hello')).toEqual({ isMission: true, goal: 'hello' });
  });

  it('마커 없으면 passthrough', () => {
    expect(parseMissionMarker('지금 삼성 얼마야?')).toEqual({ isMission: false, goal: '' });
    expect(parseMissionMarker('안녕 오늘 뭐해')).toEqual({ isMission: false, goal: '' });
  });

  it('마커만 있고 골이 비면 passthrough(빈 미션 방지)', () => {
    expect(parseMissionMarker('미션:')).toEqual({ isMission: false, goal: '' });
    expect(parseMissionMarker('미션:   ')).toEqual({ isMission: false, goal: '' });
    expect(parseMissionMarker('/mission')).toEqual({ isMission: false, goal: '' });
    expect(parseMissionMarker('')).toEqual({ isMission: false, goal: '' });
  });

  it('앞뒤 공백·여러 문장 보존', () => {
    expect(parseMissionMarker('  미션: 첫 문장. 둘째 문장.  ')).toEqual({ isMission: true, goal: '첫 문장. 둘째 문장.' });
  });

  // ★ 첫 줄 단독 마커(실사건 2026-07-14) — "미션\n\n<골>" 콜론 부재 제출이 passthrough 로
  // 새서 챗 에이전트 재량 처리(codex 위임 승인 프롬프트)된 회귀 가드.
  it('첫 줄 단독 "미션"/"mission" — 줄바꿈 뒤 전체가 골', () => {
    expect(parseMissionMarker('미션\n\n로컬 LLM 2종을 상시 자원으로 문서 정련')).toEqual({ isMission: true, goal: '로컬 LLM 2종을 상시 자원으로 문서 정련' });
    expect(parseMissionMarker('미션 \n여러 줄\n골 텍스트')).toEqual({ isMission: true, goal: '여러 줄\n골 텍스트' });
    expect(parseMissionMarker('MISSION\nwatch NVDA gap')).toEqual({ isMission: true, goal: 'watch NVDA gap' });
  });

  it('첫 줄에 다른 단어 동반 시 여전히 passthrough(오탐 0 원칙)', () => {
    expect(parseMissionMarker('미션 목록 보여줘')).toEqual({ isMission: false, goal: '' });
    expect(parseMissionMarker('미션 상태 어때?\n어제 던진 거')).toEqual({ isMission: false, goal: '' });
    expect(parseMissionMarker('미션')).toEqual({ isMission: false, goal: '' });      // 골 없음
    expect(parseMissionMarker('미션\n   ')).toEqual({ isMission: false, goal: '' }); // 골 공백뿐
  });

  // ★ 분해 검증 마커(대표 지시 2026-07-11) — 크기 무관 강제 분해(리서치 포함)+HITL 까지만.
  it('분해 검증 마커 — forceDecompose 세팅', () => {
    expect(parseMissionMarker('미션 분해 검증: persistence 마이그레이션')).toEqual({ isMission: true, goal: 'persistence 마이그레이션', forceDecompose: true });
    expect(parseMissionMarker('분해 검증 ops 상대시간 표시')).toEqual({ isMission: true, goal: 'ops 상대시간 표시', forceDecompose: true });
    // "미션:" 보다 먼저 매칭돼야(접두 겹침).
    const r = parseMissionMarker('미션 분해 검증: 작은 수정');
    expect(r.forceDecompose).toBe(true);
    // 일반 "미션:" 은 forceDecompose 없음.
    expect(parseMissionMarker('미션: 작은 수정').forceDecompose).toBeUndefined();
    // 마커만·골 없으면 passthrough.
    expect(parseMissionMarker('분해 검증').isMission).toBe(false);
  });
});
