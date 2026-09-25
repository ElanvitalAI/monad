// ── phaseReviewActions — 페이즈 리뷰 버튼 의미론(대표 2026-07-12 버그 수정) ──
import { describe, it, expect } from 'bun:test';
import { phaseReviewActions, phaseSummaryExcerpt, cleanPhaseSummary, PHASE_SUMMARY_ATTACH_THRESHOLD, isPhaseTooBig, parsePhaseCallbackData, buildPhaseCallbackData, effectiveCardHeal, chunkButtonRows } from './mission-notify.js';

describe('phaseReviewActions', () => {
  it('구현 페이즈 성공(done+PR) → PR 리뷰 + 승인 + 재구현', () => {
    expect(phaseReviewActions({ status: 'done', prUrl: 'https://github.com/o/r/pull/9' }))
      .toEqual({ pr: true, approve: true, rebuild: true, split: false, revise: false, skip: false, check: false });
  });

  it('조사/운영 페이즈 성공(done·PR 없음) → 승인 없음(재구현만)', () => {
    // 산출물(PR)이 없으니 승인할 대상이 없다 — 대표 지적의 핵심.
    expect(phaseReviewActions({ status: 'done' }))
      .toEqual({ pr: false, approve: false, rebuild: true, split: false, revise: false, skip: false, check: false });
  });

  it('실패 페이즈(failed·평범한 실패) → 재구현 + 골정정 + 건너뛰기(분할 없음)', () => {
    expect(phaseReviewActions({ status: 'failed', summary: '전제 부재로 진행 불가' }))
      .toEqual({ pr: false, approve: false, rebuild: true, split: false, revise: true, skip: true, check: true });
  });

  it('★ 실패 + 너무 큼 신호(최대 예산·opus 소진) → 분할 + 골정정 + 건너뛰기(대표 2026-07-12/13)', () => {
    expect(phaseReviewActions({ status: 'failed', summary: '⏱️ terra 예산 150→300→1000턴 + opus 4.8 폴백까지 시도했으나 실패' }))
      .toEqual({ pr: false, approve: false, rebuild: true, split: true, revise: true, skip: true, check: true });
  });

  it('진행 중(running) → 버튼 없음(알림만)', () => {
    expect(phaseReviewActions({ status: 'running' }))
      .toEqual({ pr: false, approve: false, rebuild: false, split: false, revise: false, skip: false, check: false });
  });
});

describe('chunkButtonRows — 한 줄 최대 4개 배치(대표 2026-07-14·라벨 잘림 해소)', () => {
  const b = (t: string) => ({ text: t, data: t });
  it('5버튼 + 기본(4) → 2줄(4+1)', () => {
    const rows = chunkButtonRows([b('a'), b('b'), b('c'), b('d'), b('e')]);
    expect(rows.map((r) => r.length)).toEqual([4, 1]);
    expect(rows[0]!.map((x) => x.text)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('4버튼 이하 → 1줄', () => {
    expect(chunkButtonRows([b('a'), b('b'), b('c'), b('d')]).map((r) => r.length)).toEqual([4]);
  });
  it('명시 perRow 존중(2개/줄)', () => {
    expect(chunkButtonRows([b('a'), b('b'), b('c'), b('d'), b('e')], 2).map((r) => r.length)).toEqual([2, 2, 1]);
  });
  it('빈 배열 → 빈 줄 목록 · 1버튼 → 1줄', () => {
    expect(chunkButtonRows([])).toEqual([]);
    expect(chunkButtonRows([b('only')]).map((r) => r.length)).toEqual([1]);
  });
});

describe('effectiveCardHeal — 카드 권장/버튼에 triage 오버라이드 반영(대표 2026-07-14 버그)', () => {
  it('★ SE triage: split 마커면 결정론 rebuild 를 split 로 오버라이드(분할 버튼 누락 버그)', () => {
    // 실제 인시던트 요약: 결정론 진단은 gate-failed-critique→rebuild 였으나 SE triage 는 split 권장.
    const summary = '[SE triage: split] ✂️ 분할 필요 — 새 계약·함수가 실행 경로에 연결 안 된 dead-code 구조 문제. VERDICT: FAIL';
    expect(effectiveCardHeal('rebuild', summary)).toBe('split');
  });
  it('walker triage: revise 마커도 오버라이드', () => {
    expect(effectiveCardHeal('rebuild', '[재시도 triage 권장: revise — 전제 부재]')).toBe('revise');
  });
  it('retry-* 마커는 rebuild 로(자동 재시도 경로 유지)', () => {
    expect(effectiveCardHeal('split', '[SE triage: retry-escalate] 재시도')).toBe('rebuild');
  });
  it('triage 마커 없으면 결정론 그대로', () => {
    expect(effectiveCardHeal('rebuild', '[FAIL] 그냥 실패·마커 없음')).toBe('rebuild');
    expect(effectiveCardHeal('escalate', undefined)).toBe('escalate');
  });
});

describe('isPhaseTooBig — 분할 신호 감지(대표 2026-07-12)', () => {
  it('예산 계단+opus 폴백 소진 → true', () => {
    expect(isPhaseTooBig('terra 예산 150→300→1000턴 + opus 4.8 폴백까지 시도했으나 실패')).toBe(true);
  });
  it('비평 "계획 핵심 파일 미수정/미완" → true', () => {
    expect(isPhaseTooBig('[LLM] 계획 핵심 파일인 pack.ts, write.ts가 수정되지 않아 미완')).toBe(true);
    expect(isPhaseTooBig('계획 대상인 sqlite-store.ts가 전혀 수정되지 않았다')).toBe(true);
  });
  it('평범한 실패(전제부재·일시오류) → false(분할 무의미)', () => {
    expect(isPhaseTooBig('전제 부재로 진행 불가')).toBe(false);
    expect(isPhaseTooBig('네트워크 일시 오류')).toBe(false);
    expect(isPhaseTooBig(undefined)).toBe(false);
  });
});

describe('parsePhaseCallbackData — split 액션 왕복(대표 2026-07-12)', () => {
  it('split 콜백 데이터 빌드→파싱 왕복', () => {
    const data = buildPhaseCallbackData('task:abc123', 'split');
    expect(parsePhaseCallbackData(data)).toEqual({ phaseKey: 'abc123', action: 'split' });
  });
  it('기존 액션(approve/rebuild)도 유지', () => {
    expect(parsePhaseCallbackData(buildPhaseCallbackData('task:x', 'rebuild'))?.action).toBe('rebuild');
  });
  it('★ 골 정정 탈출구 액션(revise) 왕복(대표 2026-07-12)', () => {
    expect(parsePhaseCallbackData(buildPhaseCallbackData('task:y', 'revise'))?.action).toBe('revise');
  });
  it('★ 건너뛰기 탈출구 액션(skip) 왕복(대표 2026-07-13)', () => {
    expect(parsePhaseCallbackData(buildPhaseCallbackData('task:z', 'skip'))).toEqual({ phaseKey: 'z', action: 'skip' });
  });
  it('★ HITL 확인 액션(check) 왕복(대표 2026-07-13·슬라이스 2)', () => {
    expect(parsePhaseCallbackData(buildPhaseCallbackData('task:c', 'check'))).toEqual({ phaseKey: 'c', action: 'check' });
  });
});

describe('phaseSummaryExcerpt — 페이즈 산출물 피드백(대표 2026-07-12·summary 가 note 로 잘못 읽혀 버려진 버그)', () => {
  it('summary 를 그대로 표시(짧으면 트림 없음)', () => {
    expect(phaseSummaryExcerpt('기존 M1-M5 확인·크론 미등록 갭 발견')).toBe('기존 M1-M5 확인·크론 미등록 갭 발견');
  });

  it('VERDICT 판정 마커 줄은 제거(사람에겐 노이즈)', () => {
    expect(phaseSummaryExcerpt('조사 결과: cold 이관 배선 필요\nVERDICT: PASS')).toBe('조사 결과: cold 이관 배선 필요');
  });

  it('max 초과 시 트림 + 말줄임(구조 없는 텍스트=폴백)', () => {
    const long = 'a'.repeat(700);
    const out = phaseSummaryExcerpt(long, 600);
    expect(out.length).toBeLessThanOrEqual(602);
    expect(out.endsWith('…')).toBe(true);
  });

  it('★ 긴 구조 텍스트는 단어 중간 컷이 아니라 제목 개요로 요약(대표 2026-07-12)', () => {
    const long = [
      '## 페이즈 0 조사 결과',
      '### 1. 저장소 확인',
      'Repository root 는 /Users/x/monad-agent 이고 브랜치는 main 이다. ' + 'x'.repeat(300),
      '### 2. KGS 스키마',
      'KnowledgeCard v2 저장 스키마를 기준으로 식별했다. ' + 'y'.repeat(300),
      '### 3. 재사용 export',
      'sqlite-store 의 migration helper 를 재사용한다. ' + 'z'.repeat(300),
    ].join('\n');
    const out = phaseSummaryExcerpt(long, 400);
    // 단어 중간 컷(xxxx…)이 아니라 각 섹션 제목이 개요에 포함
    expect(out).toContain('저장소 확인');
    expect(out).toContain('KGS 스키마');
    expect(out).toContain('•'); // 제목 불릿
    expect(out.length).toBeLessThanOrEqual(402);
  });

  it('빈/undefined → 빈 문자열(알림에 요약 줄 생략)', () => {
    expect(phaseSummaryExcerpt(undefined)).toBe('');
    expect(phaseSummaryExcerpt('')).toBe('');
  });

  it('과도한 빈 줄은 압축', () => {
    expect(phaseSummaryExcerpt('첫 줄\n\n\n\n둘째 줄')).toBe('첫 줄\n\n둘째 줄');
  });
});

describe('cleanPhaseSummary — 실행 접두/판정 마커 제거(대표 2026-07-12 긴 내용 첨부)', () => {
  it('[PASS·시도N] 실행 접두 제거', () => {
    expect(cleanPhaseSummary('[PASS·시도2] ## 조사 결과\n본문')).toBe('## 조사 결과\n본문');
  });
  it('[FAIL·budget·3회내 시도] 접두 제거', () => {
    expect(cleanPhaseSummary('[FAIL·budget·3회내 시도] 예산 소진')).toBe('예산 소진');
  });
  it('VERDICT 마커 줄도 함께 제거', () => {
    expect(cleanPhaseSummary('[PASS·시도1] 결과\nVERDICT: PASS')).toBe('결과');
  });
  it('접두 없으면 원본 유지', () => {
    expect(cleanPhaseSummary('[SE·PR] 격리 구현 완료 → PR https://x/pull/1')).toBe('[SE·PR] 격리 구현 완료 → PR https://x/pull/1');
  });
});

describe('긴 산출물 첨부 임계', () => {
  it('임계는 900자', () => {
    expect(PHASE_SUMMARY_ATTACH_THRESHOLD).toBe(900);
  });
  it('임계 초과 판정 — 발췌는 400자 트림', () => {
    const long = '가'.repeat(1000);
    // 인라인 발췌(400)는 전문(1000)보다 훨씬 짧다.
    expect(phaseSummaryExcerpt(long, 400).length).toBeLessThan(long.length);
    expect(long.length).toBeGreaterThan(PHASE_SUMMARY_ATTACH_THRESHOLD);
  });
});
