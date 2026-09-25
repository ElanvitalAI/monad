import { describe, it, expect } from 'bun:test';
import { buildRfcAuthorPrompt, parseAuthoredRfc, authorMissionRfc, splitWorkItem } from './mission-rfc-author.js';

describe('buildRfcAuthorPrompt — 재료 조건부 포함 + 파싱 블록 지시', () => {
  it('골만 있으면 grounding/research/clarify 섹션 없음', () => {
    const p = buildRfcAuthorPrompt({ goal: 'X 를 배선하라' });
    expect(p).toContain('X 를 배선하라');
    expect(p).not.toContain('## 내부 조사');
    expect(p).not.toContain('## 외부 조사');
    expect(p).not.toContain('## 확정 설계');
    // 구조화 블록 지시는 항상 포함
    expect(p).toContain('```work-breakdown');
    expect(p).toContain('### 아크 1:');
  });

  it('재료가 있으면 해당 섹션 포함 + grounding 재조사 금지 규칙', () => {
    const p = buildRfcAuthorPrompt({
      goal: 'G', groundingContext: 'src/telegram.ts 에 핸들러', researchContext: '외부 API v2',
      clarifyAnswers: '범위: YouTube 만', domainLabel: 'coding',
    });
    expect(p).toContain('## 내부 조사');
    expect(p).toContain('src/telegram.ts 에 핸들러');
    expect(p).toContain('## 외부 조사');
    expect(p).toContain('## 확정 설계');
    expect(p).toContain('범위: YouTube 만');
    expect(p).toContain('재조사 금지');
    expect(p).toContain('도메인: coding');
  });

  it('HITL/검증 페이즈 억제 규칙 명시', () => {
    const p = buildRfcAuthorPrompt({ goal: 'G' });
    expect(p).toContain('HITL 페이즈 금지');
    expect(p).toContain('검증 페이즈 별도 생성 금지');
  });

  it('구조화 블록 — title/detail 분리 + 80자 초과 금지 + §2 직후 배치 지시', () => {
    const p = buildRfcAuthorPrompt({ goal: 'G' });
    expect(p).toContain('- title:');
    expect(p).toContain('detail:');
    expect(p).toContain('80자 초과 금지');
    expect(p).toContain('"## 2. 설계" 섹션 바로 뒤에');
  });

  it('R3 amend 모드 — priorRfc+reviseReason 시 수정 지시(전면 재작성 금지)', () => {
    const p = buildRfcAuthorPrompt({ goal: 'G', priorRfc: '# RFC — 기존\n### 아크 1: A\n- [ ] p1', reviseReason: 'p1 이 과대함' });
    expect(p).toContain('기존 RFC');
    expect(p).toContain('전면 재작성 금지');
    expect(p).toContain('# RFC — 기존');
    expect(p).toContain('정정 지시');
    expect(p).toContain('p1 이 과대함');
  });

  it('amend 모드 아니면(priorRfc 없음) 수정 섹션 없음', () => {
    const p = buildRfcAuthorPrompt({ goal: 'G', reviseReason: 'x' });
    expect(p).not.toContain('기존 RFC (수정 대상');
  });
});

describe('parseAuthoredRfc — 제목 + 아크/페이즈 추출', () => {
  const md = [
    '# RFC — Telegram YouTube 흡수 배선',
    '',
    '## 0. 왜',
    '골 설명...',
    '## 2. 설계',
    '기존 dispatchYoutubeTranscript 재사용.',
    '',
    '```work-breakdown',
    '### 아크 1: 인입·회신 배선',
    '- [ ] Telegram YouTube 인입 배선 계약 확정',
    '- [ ] 빠른 요약 회신 배선',
    '### 아크 2: 저장',
    '- [ ] Knowledge 저장 경로 배선',
    '```',
  ].join('\n');

  it('제목 추출', () => {
    expect(parseAuthoredRfc(md).title).toBe('RFC — Telegram YouTube 흡수 배선');
  });

  it('아크 2개 · 페이즈 3개 추출', () => {
    const r = parseAuthoredRfc(md);
    expect(r.arcs).toHaveLength(2);
    expect(r.arcs[0]!.heading).toBe('인입·회신 배선');
    expect(r.arcs[0]!.workItems.map((w) => w.title)).toEqual([
      'Telegram YouTube 인입 배선 계약 확정',
      '빠른 요약 회신 배선',
    ]);
    expect(r.arcs[1]!.workItems).toHaveLength(1);
  });

  it('설계 산문(## 2. 설계)은 아크로 오인하지 않음 (### 아크 만 파싱)', () => {
    const r = parseAuthoredRfc(md);
    // 아크 헤딩은 정확히 2개 — 산문 ## 섹션은 제외
    expect(r.arcs.map((a) => a.heading)).toEqual(['인입·회신 배선', '저장']);
  });

  it('work-breakdown 펜스 없으면 전체에서 ### 아크 폴백 탐색', () => {
    const noFence = ['# RFC — X', '### 아크 1: A', '1. 첫 페이즈', '2. 둘째 페이즈'].join('\n');
    const r = parseAuthoredRfc(noFence);
    expect(r.arcs).toHaveLength(1);
    expect(r.arcs[0]!.workItems).toHaveLength(2);
  });

  it('작업항목 없는 아크는 제외(빈 껍데기 방지)', () => {
    const r = parseAuthoredRfc('# RFC — X\n### 아크 1: 빈것\n### 아크 2: 채움\n- [ ] 페이즈');
    expect(r.arcs).toHaveLength(1);
    expect(r.arcs[0]!.heading).toBe('채움');
  });

  it('#2 openQuestions — open-questions 블록 파싱(불확실 설계 결정)', () => {
    const md = [
      '# RFC — X', '```open-questions', '- 비YouTube URL 도 이번 범위인가?', '- 저장 경로 충돌 시 정책은?', '```',
    ].join('\n');
    expect(parseAuthoredRfc(md).openQuestions).toEqual(['비YouTube URL 도 이번 범위인가?', '저장 경로 충돌 시 정책은?']);
  });

  it('#2 openQuestions — 플레이스홀더(예시)·빈 블록은 제외', () => {
    expect(parseAuthoredRfc('# RFC — X').openQuestions).toEqual([]);
    expect(parseAuthoredRfc('# RFC — X\n```open-questions\n- <불확실한 설계 결정 1 — 무엇을 정해야 하나>\n```').openQuestions).toEqual([]);
  });

  it('신규 title:/detail: 형식 — 제목/상세 분리 파싱', () => {
    const md = [
      '# RFC — X', '```work-breakdown',
      '### 아크 1: 배선',
      '- title: 인입 배선 계약 확정',
      '  detail: dispatchYoutubeTranscript 재사용·새 엔진 금지·완료계약 명시',
      '- title: 요약 회신 배선',
      '  detail: 빠른 요약을 Telegram 으로 회신',
      '```',
    ].join('\n');
    const r = parseAuthoredRfc(md);
    expect(r.arcs).toHaveLength(1);
    expect(r.arcs[0]!.workItems[0]!.title).toBe('인입 배선 계약 확정');
    expect(r.arcs[0]!.workItems[0]!.detail).toBe('dispatchYoutubeTranscript 재사용·새 엔진 금지·완료계약 명시');
    expect(r.arcs[0]!.workItems[1]!.title).toBe('요약 회신 배선');
    expect(r.arcs[0]!.workItems[1]!.detail).toBe('빠른 요약을 Telegram 으로 회신');
  });

  it('구형 "제목 — 상세" 형식 — em-dash 로 title/detail 분리(하위호환)', () => {
    const r = parseAuthoredRfc('# RFC — X\n```work-breakdown\n### 아크 1: A\n- [ ] landing 판정표 확정 — 커버리지·carry-through 증거 수준 분리 기록\n```');
    expect(r.arcs[0]!.workItems[0]!.title).toBe('landing 판정표 확정');
    expect(r.arcs[0]!.workItems[0]!.detail).toBe('커버리지·carry-through 증거 수준 분리 기록');
  });

  it('제목 80자 초과는 캡(Task.title 한도 무회귀 — 분해 실패 근절)', () => {
    const long = '가'.repeat(150);
    const r = parseAuthoredRfc(`# RFC — X\n\`\`\`work-breakdown\n### 아크 1: A\n- [ ] ${long}\n\`\`\``);
    expect(r.arcs[0]!.workItems[0]!.title.length).toBe(80);
  });
});

describe('splitWorkItem — 제목/상세 분리 순수 함수', () => {
  it('신규 title: 프리픽스 제거', () => {
    expect(splitWorkItem('title: 인입 배선')).toEqual({ title: '인입 배선' });
  });
  it('구형 공백감싼 em-dash 분리', () => {
    expect(splitWorkItem('제목 — 상세 설명')).toEqual({ title: '제목', detail: '상세 설명' });
  });
  it('구분자 없으면 통째 title', () => {
    expect(splitWorkItem('단일 제목')).toEqual({ title: '단일 제목' });
  });
  it('하이픈 포함 단어는 안 쪼갬(공백 감싼 구분자만)', () => {
    expect(splitWorkItem('plan↔build carry-through 검증')).toEqual({ title: 'plan↔build carry-through 검증' });
  });
  it('title 80자 캡', () => {
    expect(splitWorkItem('가'.repeat(100)).title.length).toBe(80);
  });
});

describe('authorMissionRfc — resolve 주입 저작·파싱 왕복', () => {
  it('주입된 resolve 결과를 파싱해 반환', async () => {
    const fakeRfc = '# RFC — 테스트\n```work-breakdown\n### 아크 1: A\n- [ ] 페이즈 1\n```';
    const r = await authorMissionRfc({ goal: 'G' }, async () => fakeRfc);
    expect(r.title).toBe('RFC — 테스트');
    expect(r.arcs).toHaveLength(1);
    expect(r.arcs[0]!.workItems[0]!.title).toBe('페이즈 1');
  });
});
