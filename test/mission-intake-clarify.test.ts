// Intake Q&A clarify 순수 코어 단위테스트 (I1) — 배선 없이 파서/폴더/게이트 로직 검증.
import { describe, it, expect, afterEach } from 'bun:test';
import {
  parseArcAnswer,
  isBlockingKind,
  buildClarifyPrompt,
  parseClarifyResponse,
  analyzeGoalAmbiguity,
  foldAnswersIntoDesign,
  formatDesignAsDecomposeContext,
  hasUnansweredBlocking,
  clarifyCallbackData,
  clarifyProceedData,
  clarifyEditData,
  parseClarifyCallbackData,
  buildClarifyMessages,
  buildAnsweredText,
  allAnswered,
  type IntakeClarification,
} from '../src/autopilot/mission-intake-clarify.js';
import {
  savePendingClarify, readPendingClarify, clearPendingClarify, recordClarifyAnswer,
} from '../src/autopilot/mission-pending-clarify.js';

describe('parseArcAnswer', () => {
  it('"2아크" → 2', () => expect(parseArcAnswer('2아크')).toBe(2));
  // ★ dogfood 버그(2026-07-17) — sol judge 가 "N개 아크"로 라벨 → arcHint 미전달이던 것 수복.
  it('"6개 아크 — 기반 계약..." → 6(개 허용·라벨 서술)', () => expect(parseArcAnswer('6개 아크 — 기반 계약 → YouTube 파이프라인')).toBe(6));
  it('"7 개 아크" → 7(개 앞뒤 공백)', () => expect(parseArcAnswer('7 개 아크')).toBe(7));
  it('"자동" → undefined', () => expect(parseArcAnswer('자동')).toBeUndefined());
  it('undefined → undefined', () => expect(parseArcAnswer(undefined)).toBeUndefined());
});

describe('isBlockingKind', () => {
  it('scope/arc = 블로킹', () => {
    expect(isBlockingKind('scope')).toBe(true);
    expect(isBlockingKind('arc')).toBe(true);
  });
  it('term/safety = 비블로킹', () => {
    expect(isBlockingKind('term')).toBe(false);
    expect(isBlockingKind('safety')).toBe(false);
  });
});

describe('buildClarifyPrompt', () => {
  // caceb4eb0(2026-07-19)은 이전 4~5-페이즈 약속을 제거하고 아크를 응집 흐름 그룹핑으로 정했다.
  // 이 시험(366af031, 2026-07-17)은 그 결정보다 앞서므로 현행 문면을 정확 일치로 고정한다.
  it('heavy → 응집 흐름 아크 지침 포함(페이즈 수 미약속·분해기 자동 결정)', () => {
    const p = buildClarifyPrompt('테스트 골', { heavy: true });
    expect(p).toContain('몇 갈래의 응집 아크');
    expect(p).toContain('페이즈 수는 약속하지 말라');
    expect(p).toContain('분해기가 골 복잡도에 맞춰 자동 결정한다');
    expect(p).toContain('질문 없으면 []');
  });
  it('light(heavy 아님) → arc 축 미포함', () => {
    const p = buildClarifyPrompt('테스트 골', {});
    expect(p).not.toContain('몇 갈래의 응집 아크');
    expect(p).not.toContain('- arc:');
  });
  it('grounding/research 컨텍스트 fold', () => {
    const p = buildClarifyPrompt('골', { groundContext: 'GROUND_X', researchContext: 'RESEARCH_Y' });
    expect(p).toContain('GROUND_X');
    expect(p).toContain('RESEARCH_Y');
  });
  // ── P3 2단계 되묻기(phase 분리) ──
  it('phase=scope(heavy) → scope/term/safety 만·arc 축 제외', () => {
    const p = buildClarifyPrompt('골', { heavy: true, phase: 'scope' });
    expect(p).toContain('- scope:');
    expect(p).toContain('- term:');
    expect(p).not.toContain('- arc:'); // 1단계는 아크 제외(범위 먼저)
  });
  it('phase=arc → arc 만·scope/term 제외·확정 범위 주입', () => {
    const p = buildClarifyPrompt('골', { heavy: true, phase: 'arc', confirmedScope: ['범위: YouTube만'] });
    expect(p).toContain('아크 경계만'); // arc-only 지침
    expect(p).toContain('- arc:');
    expect(p).not.toContain('- scope:');
    expect(p).not.toContain('- term:');
    expect(p).toContain('확정 범위'); // stage1 확정 범위 컨텍스트
    expect(p).toContain('YouTube만');
  });
});

describe('parseClarifyResponse — 순수 파서', () => {
  it('정상 옵션형 질문 파싱 + questionId 부여', () => {
    const raw = '[{"kind":"scope","header":"범위","question":"A만? 둘 다?","options":[{"label":"A만","recommended":true},{"label":"둘 다"}]}]';
    const qs = parseClarifyResponse(raw);
    expect(qs).toHaveLength(1);
    expect(qs[0].questionId).toBe('q1');
    expect(qs[0].blocking).toBe(true);
    expect(qs[0].options[0].recommended).toBe(true);
  });
  it('빈 배열 = 명확(질문 없음)', () => {
    expect(parseClarifyResponse('[]')).toHaveLength(0);
  });
  it('파싱 실패 → [] (보수적·일방 분해 폴백)', () => {
    expect(parseClarifyResponse('그냥 텍스트 no json')).toHaveLength(0);
  });
  it('고정 상한 없음 — 필요한 만큼 유지(대표 2026-07-17·5개 전부)', () => {
    const one = '{"kind":"term","header":"h","question":"q?","options":[{"label":"a"},{"label":"b"}]}';
    const qs = parseClarifyResponse(`[${one},${one},${one},${one},${one}]`);
    expect(qs).toHaveLength(5); // 3 고정 상한 제거 — 5개 모두 유지
    expect(qs.map((q) => q.questionId)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
  });
  it('폭주 방어 backstop(12 초과분만 버림)', () => {
    const one = '{"kind":"term","header":"h","question":"q?","options":[{"label":"a"},{"label":"b"}]}';
    const qs = parseClarifyResponse(`[${Array(20).fill(one).join(',')}]`);
    expect(qs).toHaveLength(12); // 설계 상한 아님·파싱 방어(폭주 방지)
  });
  it('옵션 2개 미만 질문은 제외', () => {
    const raw = '[{"kind":"scope","header":"h","question":"q?","options":[{"label":"only"}]}]';
    expect(parseClarifyResponse(raw)).toHaveLength(0);
  });
  it('알 수 없는 kind → scope 폴백(블로킹)', () => {
    const raw = '[{"kind":"weird","header":"h","question":"q?","options":[{"label":"a"},{"label":"b"}]}]';
    expect(parseClarifyResponse(raw)[0].kind).toBe('scope');
  });
  it('추천 옵션 중복 → 첫 추천만', () => {
    const raw = '[{"kind":"term","header":"h","question":"q?","options":[{"label":"a","recommended":true},{"label":"b","recommended":true}]}]';
    const opts = parseClarifyResponse(raw)[0].options;
    expect(opts.filter((o) => o.recommended)).toHaveLength(1);
  });
  it('라벨의 "(추천)" 접미 제거(카드가 별도 접미 — 중복 방지)', () => {
    const raw = '[{"kind":"scope","header":"h","question":"q?","options":[{"label":"조정만(추천)","recommended":true},{"label":"전체"}]}]';
    expect(parseClarifyResponse(raw)[0].options.map((o) => o.label)).toEqual(['조정만', '전체']);
  });
});

describe('analyzeGoalAmbiguity — judge 주입 seam', () => {
  it('judge 미주입(test) → [](실 LLM 호출 방지)', async () => {
    expect(await analyzeGoalAmbiguity('골')).toHaveLength(0);
  });
  it('주입된 judge 출력 파싱', async () => {
    const judge = async () => '[{"kind":"arc","header":"아크","question":"몇 아크?","options":[{"label":"2아크","recommended":true},{"label":"자동"}]}]';
    const qs = await analyzeGoalAmbiguity('큰 골', { heavy: true }, { judge });
    expect(qs).toHaveLength(1);
    expect(qs[0].kind).toBe('arc');
  });
  it('judge throw → [](fail-soft)', async () => {
    const judge = async () => { throw new Error('LLM down'); };
    expect(await analyzeGoalAmbiguity('골', {}, { judge })).toHaveLength(0);
  });
  // ── P3 phase 안전망 — LLM 이 지침 어겨도 단계별 kind 강제 ──
  it('phase=scope → LLM 이 낸 arc 질문 제거(범위 단계는 arc 금지)', async () => {
    const judge = async () => '[{"kind":"scope","header":"범위","question":"A? B?","options":[{"label":"A","recommended":true},{"label":"B"}]},{"kind":"arc","header":"아크","question":"몇?","options":[{"label":"2","recommended":true},{"label":"3"}]}]';
    const qs = await analyzeGoalAmbiguity('골', { heavy: true, phase: 'scope' }, { judge });
    expect(qs.map((q) => q.kind)).toEqual(['scope']); // arc 제거·questionId 재부여
    expect(qs[0].questionId).toBe('q1');
  });
  it('phase=arc → arc 만 유지(scope/term 제거)', async () => {
    const judge = async () => '[{"kind":"term","header":"용어","question":"뭐?","options":[{"label":"x","recommended":true},{"label":"y"}]},{"kind":"arc","header":"아크","question":"몇?","options":[{"label":"2아크","recommended":true},{"label":"3아크"}]}]';
    const qs = await analyzeGoalAmbiguity('골', { heavy: true, phase: 'arc' }, { judge });
    expect(qs.map((q) => q.kind)).toEqual(['arc']);
  });
});

describe('foldAnswersIntoDesign — 답변 → 확정 설계', () => {
  const mk = (over: Partial<IntakeClarification>): IntakeClarification => ({
    questionId: 'q1', kind: 'scope', header: 'h', question: 'q?',
    options: [{ label: 'A만', recommended: true }, { label: '둘 다' }], blocking: true, ...over,
  });
  it('arc 답 → arcHint', () => {
    const d = foldAnswersIntoDesign('골', [mk({ kind: 'arc', answer: '2아크' })]);
    expect(d.arcHint).toBe(2);
  });
  // 94205e862(2026-07-22)은 범위 전체의 중복을 막기 위해 구별되는 제외 절만 excluded에 넣었다.
  it('scope 답 → scope, 별도 "후속" 절만 excluded', () => {
    const d = foldAnswersIntoDesign('골', [mk({ kind: 'scope', header: 'B처리', answer: 'A는 이번에, B는 후속' })]);
    expect(d.scope[0]).toContain('A는 이번에, B는 후속');
    expect(d.excluded).toEqual(['B처리: B는 후속']);
  });
  it('scope 답이 단일 "후속" 절이면 excluded에 중복하지 않음', () => {
    const d = foldAnswersIntoDesign('골', [mk({ kind: 'scope', header: 'B처리', answer: 'B는 후속' })]);
    expect(d.scope[0]).toContain('B는 후속');
    expect(d.excluded).toEqual([]);
  });
  it('미응답 질문 → 추천 옵션으로 auto-resolve', () => {
    const d = foldAnswersIntoDesign('골', [mk({ kind: 'scope', header: '범위' })]);
    expect(d.scope[0]).toContain('A만'); // 추천 옵션 채택
  });
  it('term/safety → notes', () => {
    const d = foldAnswersIntoDesign('골', [mk({ kind: 'term', header: '용어', answer: '정의X' })]);
    expect(d.notes[0]).toContain('정의X');
  });
});

describe('formatDesignAsDecomposeContext', () => {
  it('확정 설계를 분해 컨텍스트 문자열로', () => {
    const s = formatDesignAsDecomposeContext({
      goal: '골', arcHint: 2, scope: ['범위: A만'], excluded: ['B: 후속'], notes: [], clarifications: [],
    });
    expect(s).toContain('아크 수: 2개');
    expect(s).toContain('범위: A만');
    expect(s).toContain('제외(후속)');
  });
});

describe('hasUnansweredBlocking', () => {
  const c = (over: Partial<IntakeClarification>): IntakeClarification => ({
    questionId: 'q1', kind: 'scope', header: 'h', question: 'q?', options: [], blocking: true, ...over,
  });
  it('블로킹 미응답 → true(분해 대기)', () => {
    expect(hasUnansweredBlocking([c({})])).toBe(true);
  });
  it('블로킹 응답 완료 → false', () => {
    expect(hasUnansweredBlocking([c({ answer: 'A만' })])).toBe(false);
  });
  it('비블로킹 미응답 → false(진행 가능)', () => {
    expect(hasUnansweredBlocking([c({ kind: 'term', blocking: false })])).toBe(false);
  });
});

describe('clarify 콜백 데이터 (round-trip·형제 stomp 방지)', () => {
  it('조립 → 파싱 라운드트립(answer)', () => {
    const data = clarifyCallbackData('abc123', 'q2', 1);
    expect(data).toBe('apm-clarify:abc123:q2:1');
    expect(parseClarifyCallbackData(data)).toEqual({ token: 'abc123', kind: 'answer', questionId: 'q2', optIdx: 1 });
  });
  it('proceed 콜백 파싱', () => {
    expect(clarifyProceedData('tok')).toBe('apm-clarify:tok:go');
    expect(parseClarifyCallbackData('apm-clarify:tok:go')).toEqual({ token: 'tok', kind: 'proceed' });
  });
  it('edit 콜백 파싱(P4 자유 피드백)', () => {
    expect(clarifyEditData('tok')).toBe('apm-clarify:tok:edit');
    expect(parseClarifyCallbackData('apm-clarify:tok:edit')).toEqual({ token: 'tok', kind: 'edit' });
  });
  it('타 프리픽스/형식 불일치 → null', () => {
    expect(parseClarifyCallbackData('apm-hitl:abc:approve')).toBeNull();
    expect(parseClarifyCallbackData('apm-clarify:abc:x:1')).toBeNull(); // qid 형식 아님
    expect(parseClarifyCallbackData('apm-clarify:abc:q1:-1')).toBeNull();
  });
  it('콜백 데이터 64byte 이내(텔레그램 제약)', () => {
    expect(Buffer.byteLength(clarifyCallbackData('a1b2c3', 'q3', 2))).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(clarifyProceedData('a1b2c3'))).toBeLessThanOrEqual(64);
  });
});

describe('allAnswered', () => {
  const mk = (answer?: string): IntakeClarification => ({ questionId: 'q1', kind: 'term', header: 'h', question: 'q?', options: [{ label: 'a' }], blocking: false, ...(answer ? { answer } : {}) });
  it('전부 답 → true', () => expect(allAnswered([mk('a'), mk('b')])).toBe(true));
  it('일부 미답 → false', () => expect(allAnswered([mk('a'), mk()])).toBe(false));
});

describe('buildClarifyMessages (I3d — 번호 옵션·짧은 번호 버튼)', () => {
  const qs: IntakeClarification[] = [
    { questionId: 'q1', kind: 'scope', header: '범위', question: 'A만? 둘 다?', options: [{ label: '아주 긴 라벨 A만', recommended: true }, { label: '둘 다' }, { label: 'end-to-end' }], blocking: true },
    { questionId: 'q2', kind: 'arc', header: '아크', question: '몇 아크?', options: [{ label: '2아크', recommended: true }, { label: '자동' }], blocking: true },
  ];
  it('질문 하나당 메시지 하나 + 옵션을 텍스트에 1️⃣2️⃣3️⃣ 나열', () => {
    const { questions } = buildClarifyMessages(qs, 'tok');
    expect(questions).toHaveLength(2);
    expect(questions[0].text).toContain('되묻기 1/2');
    expect(questions[0].text).toContain('1️⃣ 아주 긴 라벨 A만'); // 긴 라벨은 텍스트에(버튼 아님)
    expect(questions[0].text).toContain('✅추천');
  });
  it('버튼은 짧은 번호(1️⃣2️⃣3️⃣) 한 줄 — truncation 없음', () => {
    const { questions } = buildClarifyMessages(qs, 'tok');
    expect(questions[0].buttons).toHaveLength(1);       // 한 줄
    expect(questions[0].buttons[0]).toHaveLength(3);    // 1️⃣2️⃣3️⃣
    expect(questions[0].buttons[0][0].text).toBe('1️⃣✅'); // 추천 표기·짧음
    expect(questions[0].buttons[0][0].data).toBe('apm-clarify:tok:q1:0');
    expect(questions[0].buttons[0][2].data).toBe('apm-clarify:tok:q1:2');
  });
  it('control = 전체 추천대로 진행 + ✏️ 직접 수정(P4)', () => {
    const { control } = buildClarifyMessages(qs, 'tok');
    expect(control.text).toContain('[필수] 2');
    expect(control.buttons[0][0].text).toContain('전체 추천대로 진행');
    expect(control.buttons[0][0].data).toBe('apm-clarify:tok:go');
    // P4 — 직접 수정 버튼
    expect(control.buttons[1][0].text).toContain('직접 수정');
    expect(control.buttons[1][0].data).toBe('apm-clarify:tok:edit');
  });
});

describe('buildClarifyPrompt — P4 자유 피드백 재투입', () => {
  it('feedback → 대표 직접 교정 섹션 주입(반영해 다시 만들라)', () => {
    const p = buildClarifyPrompt('골', { heavy: true, phase: 'arc', feedback: '아크를 더 잘게 나눠줘' });
    expect(p).toContain('대표 직접 교정');
    expect(p).toContain('아크를 더 잘게 나눠줘');
  });
});

describe('buildAnsweredText', () => {
  it('답변 완료 질문 편집 텍스트(✓ + 선택값)', () => {
    const c: IntakeClarification = { questionId: 'q1', kind: 'scope', header: '범위', question: 'A만? 둘 다?', options: [{ label: 'A만' }], blocking: true, answer: 'A만' };
    const t = buildAnsweredText(c, 0, 2);
    expect(t).toContain('✓ 되묻기 1/2');
    expect(t).toContain('✅ 선택: A만');
  });
});

describe('mission-pending-clarify store', () => {
  const M = 'apm_test_pending_clarify_zzz';
  const qs: IntakeClarification[] = [
    { questionId: 'q1', kind: 'scope', header: '범위', question: 'q?', options: [{ label: 'A만', recommended: true }, { label: '둘 다' }], blocking: true },
  ];
  afterEach(() => clearPendingClarify(M));

  it('save → read 라운드트립', () => {
    savePendingClarify(M, { clarifications: qs, at: '2026-07-16T00:00:00Z' });
    expect(readPendingClarify(M)?.clarifications).toHaveLength(1);
  });
  it('clear 후 read = null', () => {
    savePendingClarify(M, { clarifications: qs });
    clearPendingClarify(M);
    expect(readPendingClarify(M)).toBeNull();
  });
  it('recordClarifyAnswer → optIdx 라벨을 answer 로', () => {
    savePendingClarify(M, { clarifications: qs });
    const p = recordClarifyAnswer(M, 'q1', 1);
    expect(p?.clarifications[0].answer).toBe('둘 다');
    expect(readPendingClarify(M)?.clarifications[0].answer).toBe('둘 다'); // 영속
  });
  it('범위 밖 optIdx → 무변경(방어)', () => {
    savePendingClarify(M, { clarifications: qs });
    const p = recordClarifyAnswer(M, 'q1', 9);
    expect(p?.clarifications[0].answer).toBeUndefined();
  });
  it('없는 미션/질문 → null', () => {
    expect(recordClarifyAnswer('apm_never_xyz', 'q1', 0)).toBeNull();
  });
});
