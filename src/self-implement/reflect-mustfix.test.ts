import { describe, expect, test } from 'bun:test';
import { countReflectFactConflicts, parseReflectResult, reflectMustFix, buildReflectPrompt, observeMustFixCitedPaths, parseMustFixRefutations, hasMustFixRefutationAcknowledgement, parseMustFixRefutationAcknowledgement, MUST_FIX_REFUTATION_ACKNOWLEDGEMENT, MUST_FIX_REFUTATION_ACKNOWLEDGEMENT_WITH_REASON, MISSING_CITED_PATH_REFUTATION_QUOTE, FOUND_CITED_PATH_REFUTATION_QUOTE, snapshotMustFixFindings, stableMustFixId, eligibleMissingCitedPathFindings, eligibleFoundCitedPathFindings, eligibleRefutationGoalLines, REFUTATION_QUOTE_GRAMMAR, refutationQuoteGrammar, renderMustFixCitedPathFacts, renderMustFixRecurrenceHistory } from './reflect-mustfix.js';
import { runSelfImplement } from './orchestrator.js';
import { seams } from './test-seams.js';

const MF = ['버그 A: null 역참조', '스코프 밖: 무관 리팩터 요구', '버그 C: off-by-one'];

describe('parseReflectResult — 보수 default-ACCEPT', () => {
  test('명시 ACCEPT/REJECT 를 항목별로 가른다(REJECT 는 근거 필수)', () => {
    const out = '1: ACCEPT\n2: REJECT — goal 이 요구하지 않은 무관 리팩터라 등가계약 밖\n3: ACCEPT';
    const r = parseReflectResult(out, MF);
    expect(r.accepted).toEqual([MF[0], MF[2]]);
    expect(r.rejected).toEqual([{ item: MF[1]!, reason: 'goal 이 요구하지 않은 무관 리팩터라 등가계약 밖' }]);
  });

  test('파싱 안 되는 항목은 ACCEPT(실버그 놓침 방지)', () => {
    const out = '2: REJECT — 계약 밖 사유'; // 1,3 언급 없음 → accept
    const r = parseReflectResult(out, MF);
    expect(r.accepted).toEqual([MF[0], MF[2]]);
    expect(r.rejected.map((x) => x.item)).toEqual([MF[1]]);
  });

  test('근거 없는 REJECT 는 인정 안 함 → ACCEPT(근거 없이 실버그 기각 금지)', () => {
    const out = '1: REJECT\n2: REJECT —\n3: REJECT — a'; // 근거 4자 미만 전부 accept 로 되돌림
    const r = parseReflectResult(out, MF);
    expect(r.accepted).toEqual(MF); // 전부 accept
    expect(r.rejected).toEqual([]);
  });

  test('빈 출력 → 전부 ACCEPT', () => {
    expect(parseReflectResult('', MF).accepted).toEqual(MF);
  });

  test('모순(같은 번호 REJECT+ACCEPT) → 보수 ACCEPT(명시 accept 우선)', () => {
    const r = parseReflectResult('1: REJECT — 계약 밖 사유\n1: ACCEPT\n2: ACCEPT\n3: ACCEPT', MF);
    expect(r.accepted).toContain(MF[0]); // 모순 → accept(실버그 놓침 방지)
    expect(r.rejected).toEqual([]);
  });
});

describe('REFUTE 문법 — goal 원문 문자열 검증', () => {
  const goal = [
    '## ACCEPTANCE CRITERIA',
    '- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.',
    '- Checkable requested criterion: 요청한 결과 형식을 유지한다.',
    '## SCOPE BOUNDARY',
    '- ⛔ 결정 2: **기각을 자동 수용하지 않는다.** 감독이 판정한다.',
  ].join('\n');

  test('허용 원문을 정확히 인용한 REFUTE를 원본 must-fix 안정 ID에 결합한다', () => {
    const snapshot = snapshotMustFixFindings(['기존 경로를 바꿔라', '요청한 형식을 되돌려라', '자동 수용하라']);
    expect(parseMustFixRefutations([
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify('- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.')} — 기존 경로와 충돌한다.`,
      `REFUTE [${snapshot[1]!.id}] ${JSON.stringify('- Checkable requested criterion: 요청한 결과 형식을 유지한다.')} — 골이 요구한 형식과 충돌한다.`,
      `REFUTE [${snapshot[2]!.id}] ${JSON.stringify('- ⛔ 결정 2: **기각을 자동 수용하지 않는다.** 감독이 판정한다.')} — 자동 수용 요구와 충돌한다.`,
    ].join('\n'), goal, snapshot)).toEqual([
      { findingId: snapshot[0]!.id, finding: '기존 경로를 바꿔라', quote: '- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.', kind: 'preservation-contract', reason: '기존 경로와 충돌한다.' },
      { findingId: snapshot[1]!.id, finding: '요청한 형식을 되돌려라', quote: '- Checkable requested criterion: 요청한 결과 형식을 유지한다.', kind: 'requested-criterion', reason: '골이 요구한 형식과 충돌한다.' },
      { findingId: snapshot[2]!.id, finding: '자동 수용하라', quote: '- ⛔ 결정 2: **기각을 자동 수용하지 않는다.** 감독이 판정한다.', kind: 'preservation-contract', reason: '자동 수용 요구와 충돌한다.' },
    ]);
  });

  test('저작기의 Boundary decision은 SCOPE BOUNDARY 안에서만 경계 계약으로 인용되고 REFUTE 경로에 전달된다', () => {
    const requested = '- Checkable requested criterion: 요청 기준은 계속 구별한다.';
    const legacy = '- ⭐ 결정 1: 종전 경계 결정도 계속 인정한다.';
    const authoredBoundary = '- Boundary decision: 저작기가 실제로 내는 경계 결정이다.';
    const outsideBoundary = '- Boundary decision: 수용 기준 밖의 같은 문면은 인용할 수 없다.';
    const afterScopeBoundary = '- Boundary decision: 다음 절의 같은 문면은 인용할 수 없다.';
    const scopedGoal = [
      '## ACCEPTANCE CRITERIA',
      requested,
      outsideBoundary,
      '## SCOPE BOUNDARY',
      legacy,
      authoredBoundary,
      '## 불변식',
      afterScopeBoundary,
    ].join('\n');
    const eligible = eligibleRefutationGoalLines(scopedGoal);
    const snapshot = snapshotMustFixFindings(['경계 밖 변경을 요구한다']);

    expect(eligible.get(requested)).toBe('requested-criterion');
    expect(eligible.get(legacy)).toBe('preservation-contract');
    expect(eligible.get(authoredBoundary)).toBe('preservation-contract');
    expect(REFUTATION_QUOTE_GRAMMAR).toContain('`- Boundary decision:`');
    expect(refutationQuoteGrammar({ allowInvariantCandidates: true })).toContain('`- Boundary decision:`');
    expect(eligible.has(outsideBoundary)).toBe(false);
    expect(eligible.has(afterScopeBoundary)).toBe(false);
    expect(parseMustFixRefutations(
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify(authoredBoundary)} — 골이 명시한 경계와 충돌한다.`,
      scopedGoal,
      snapshot,
    )).toEqual([{
      findingId: snapshot[0]!.id,
      finding: '경계 밖 변경을 요구한다',
      quote: authoredBoundary,
      kind: 'preservation-contract',
      reason: '골이 명시한 경계와 충돌한다.',
    }]);
  });

  test('Invariant candidate 인용은 명시적 opt-in에서만 열리고 기본 문면은 그대로다', () => {
    const invariant = '- Invariant candidate: 기존 세 인용 형태에 대한 판정 결과는 지금 그대로다.';
    const input = `${goal}\n${invariant}`;
    expect(eligibleRefutationGoalLines(input).has(invariant)).toBe(false);
    expect(eligibleRefutationGoalLines(input, { allowInvariantCandidates: true }).get(invariant)).toBe('invariant-candidate');
    expect(refutationQuoteGrammar()).toBe(REFUTATION_QUOTE_GRAMMAR);
    expect(refutationQuoteGrammar({ allowInvariantCandidates: true })).toContain('`- Invariant candidate:`');
  });

  test('REFUTE 후보의 엄격 문법 탈락 단계를 원문 없이 분류하고 반환값은 계속 무효 처리한다', () => {
    const snapshot = snapshotMustFixFindings(['자동 수용하라']);
    const rejected: Array<{ stage: string; findingId?: string }> = [];
    const output = [
      'REFUTE [not-an-id] "인용" — 이유',
      `REFUTE [${snapshot[0]!.id}] not-json — 이유`,
      `REFUTE [${snapshot[0]!.id}]${JSON.stringify('- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.')} — ID 뒤 공백 없음`,
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify('- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.')} - em dash 아님`,
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify('- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.')} —공백 없음`,
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify('- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.')} —   `,
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify('- Checkable preservation criterion: 존재하지 않는 문면')} — 이유`,
    ].join('\n');

    expect(parseMustFixRefutations(output, goal, snapshot, (rejection) => rejected.push(rejection))).toEqual([]);
    expect(rejected).toEqual([
      { stage: 'prefix' },
      { stage: 'json-quote', findingId: snapshot[0]!.id },
      { stage: 'prefix', findingId: snapshot[0]!.id },
      { stage: 'em-dash', findingId: snapshot[0]!.id },
      { stage: 'em-dash', findingId: snapshot[0]!.id },
      { stage: 'reason', findingId: snapshot[0]!.id },
      { stage: 'eligible-goal-line', findingId: snapshot[0]!.id },
    ]);
  });

  test('REFUTE: NONE과 REFUTEX는 제출 후보가 아니므로 거부 관측을 만들지 않는다', () => {
    const snapshot = snapshotMustFixFindings(['자동 수용하라']);
    const rejected: Array<{ stage: string; findingId?: string }> = [];

    expect(parseMustFixRefutations('REFUTE: NONE\nREFUTEX [MF-deadbeef] "인용" — 이유', goal, snapshot, (rejection) => rejected.push(rejection))).toEqual([]);
    expect(rejected).toEqual([]);
  });

  test('골에 없는 인용·스냅샷에 없는 ID·형식 손상은 무효이며 자연어 사유를 해석하지 않는다', () => {
    const snapshot = snapshotMustFixFindings(['자동 수용하라']);
    const output = [
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify('- Checkable preservation criterion: 존재하지 않는 문면')} — 그럴듯한 이유`,
      `REFUTE [MF-deadbeef] ${JSON.stringify('- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.')} — 스냅샷 밖 ID`,
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify('- ⛔ 결정 2: **기각을 자동 수용하지 않는다.** 감독이 판정한다.')} — x`,
      `REFUTE [${snapshot[0]!.id}] 인용 없음 — 이유`,
    ].join('\n');
    expect(parseMustFixRefutations(output, goal, snapshot)).toEqual([{
      findingId: snapshot[0]!.id,
      finding: '자동 수용하라',
      quote: '- ⛔ 결정 2: **기각을 자동 수용하지 않는다.** 감독이 판정한다.',
      kind: 'preservation-contract',
      reason: 'x',
    }]);
  });

  test('ASCII 따옴표를 포함한 goal 원문은 JSON escaping 후 완전하게 복원하고 순수 문자열 비교한다', () => {
    const quoted = '- Checkable preservation criterion: 출력은 "byte-identical"이어야 한다.';
    const snapshot = snapshotMustFixFindings(['출력을 바꿔라']);
    expect(parseMustFixRefutations(
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify(quoted)} — 충돌`,
      `${goal}\n${quoted}`,
      snapshot,
    )[0]?.quote).toBe(quoted);
  });

  test('동시에 활성인 두 must-fix의 양립 불가 claim은 정렬된 한 쌍으로 회부한다', () => {
    const snapshot = snapshotMustFixFindings(['A 경로만 유지하라', 'B 경로만 유지하라']);
    const [first, second] = [...snapshot].sort((a, b) => a.id.localeCompare(b.id));
    const quote = '- Checkable requested criterion: 요청한 결과 형식을 유지한다.';
    const conflict = `REFUTE [${first!.id}] CONFLICT [${second!.id}] ${JSON.stringify(quote)} — 두 지적을 동시에 만족할 수 없다: A만과 B만을 함께 유지할 수 없다.`;
    expect(parseMustFixRefutations(conflict, goal, snapshot)).toEqual([{
      findingId: first!.id,
      finding: first!.item,
      conflictingFindingId: second!.id,
      conflictingFinding: second!.item,
      quote,
      kind: 'must-fix-conflict',
      reason: '두 지적을 동시에 만족할 수 없다: A만과 B만을 함께 유지할 수 없다.',
    }]);
    expect(hasMustFixRefutationAcknowledgement(conflict)).toBe(true);
  });

  test('충돌 회부는 stale·동일·역순·중복·손상 claim을 수용하지 않고, 자연어 타당성은 감독에 맡긴다', () => {
    const snapshot = snapshotMustFixFindings(['A 경로만 유지하라', 'B 경로만 유지하라', '독립 문서 갱신']);
    const [first, second, third] = [...snapshot].sort((a, b) => a.id.localeCompare(b.id));
    const quote = '- Checkable requested criterion: 요청한 결과 형식을 유지한다.';
    const rejected: Array<{ stage: string; findingId?: string }> = [];
    const valid = `REFUTE [${first!.id}] CONFLICT [${second!.id}] ${JSON.stringify(quote)} — 두 지적을 동시에 만족할 수 없다: 서로 반대 요구다.`;
    const sequentialWording = `REFUTE [${first!.id}] CONFLICT [${third!.id}] ${JSON.stringify(quote)} — 순차 적용해도 동시에 만족할 수 없다: 자식이 판단한 양립 불가 이유.`;
    const output = [
      `REFUTE [MF-deadbeef] CONFLICT [${second!.id}] ${JSON.stringify(quote)} — 두 지적을 동시에 만족할 수 없다: stale`,
      `REFUTE [${first!.id}] CONFLICT [${first!.id}] ${JSON.stringify(quote)} — 두 지적을 동시에 만족할 수 없다: 동일`,
      `REFUTE [${second!.id}] CONFLICT [${first!.id}] ${JSON.stringify(quote)} — 두 지적을 동시에 만족할 수 없다: 역순`,
      valid,
      valid,
      sequentialWording,
      `REFUTE [${first!.id}] CONFLICT [${second!.id}] 인용 없음 — 두 지적을 동시에 만족할 수 없다: 인용이 빠졌다.`,
      `REFUTE [${first!.id}] CONFLICT [${second!.id}] ${JSON.stringify(quote)} —`,
    ].join('\n');
    expect(parseMustFixRefutations(output, goal, snapshot, (rejection) => rejected.push(rejection))).toEqual([
      {
        findingId: first!.id,
        finding: first!.item,
        conflictingFindingId: second!.id,
        conflictingFinding: second!.item,
        quote,
        kind: 'must-fix-conflict',
        reason: '두 지적을 동시에 만족할 수 없다: 서로 반대 요구다.',
      },
      {
        findingId: first!.id,
        finding: first!.item,
        conflictingFindingId: third!.id,
        conflictingFinding: third!.item,
        quote,
        kind: 'must-fix-conflict',
        reason: '순차 적용해도 동시에 만족할 수 없다: 자식이 판단한 양립 불가 이유.',
      },
    ]);
    expect(rejected).toEqual([
      { stage: 'finding-id', findingId: 'MF-deadbeef' },
      { stage: 'conflict-finding-id', findingId: first!.id },
      { stage: 'conflict-order', findingId: second!.id },
      { stage: 'conflict-finding-id', findingId: first!.id },
      { stage: 'json-quote', findingId: first!.id },
      { stage: 'reason', findingId: first!.id },
    ]);
  });

  test('구조적으로 유효한 충돌 회부는 독립 감독 입력에 두 finding과 이유를 보존한다', () => {
    const snapshot = snapshotMustFixFindings(['A만 유지하라', 'B만 유지하라']);
    const [first, second] = [...snapshot].sort((a, b) => a.id.localeCompare(b.id));
    const quote = '- Checkable requested criterion: 요청한 결과 형식을 유지한다.';
    const refutations = parseMustFixRefutations(
      `REFUTE [${first!.id}] CONFLICT [${second!.id}] ${JSON.stringify(quote)} — 순차 적용해도 동시에 만족할 수 없다: 양립 불가다.`,
      goal,
      snapshot,
    );
    const prompt = buildReflectPrompt(['A만 유지하라', 'B만 유지하라'], goal, 'diff', { refutations });
    expect(prompt).toContain(`[${first!.id}] ${first!.item}`);
    expect(prompt).toContain(`충돌 지적: [${second!.id}] ${second!.item}`);
    expect(prompt).toContain('순차 적용해도 동시에 만족할 수 없다: 양립 불가다.');
    expect(prompt).toContain('반드시 네가 ACCEPT 또는 REJECT로 독립 판정하라.');
  });

  test('REFUTE 또는 공유 acknowledgement 한 줄은 반론 검토를 지나갔음으로 식별한다', () => {
    const snapshot = snapshotMustFixFindings(['기존 경로를 바꿔라']);
    const refute = `REFUTE [${snapshot[0]!.id}] ${JSON.stringify('- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.')} — 기존 경로와 충돌한다.`;
    expect(hasMustFixRefutationAcknowledgement(refute)).toBe(true);
    expect(hasMustFixRefutationAcknowledgement(MUST_FIX_REFUTATION_ACKNOWLEDGEMENT)).toBe(true);
    expect(hasMustFixRefutationAcknowledgement('요약만 적고 정해진 줄은 생략')).toBe(false);
    expect(parseMustFixRefutations(refute, goal, snapshot)).toEqual([{
      findingId: snapshot[0]!.id,
      finding: '기존 경로를 바꿔라',
      quote: '- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.',
      kind: 'preservation-contract',
      reason: '기존 경로와 충돌한다.',
    }]);
  });

  test('이유 포함 무반론 선언은 유일한 한 줄일 때만 사유를 보존하고 legacy는 계속 인정한다', () => {
    expect(MUST_FIX_REFUTATION_ACKNOWLEDGEMENT_WITH_REASON).toBe('REFUTE: NONE — <reason>');
    expect(parseMustFixRefutationAcknowledgement('REFUTE: NONE — 모든 finding이 골 계약과 양립한다.')).toEqual({
      acknowledged: true,
      reason: '모든 finding이 골 계약과 양립한다.',
    });
    expect(parseMustFixRefutationAcknowledgement(MUST_FIX_REFUTATION_ACKNOWLEDGEMENT)).toEqual({ acknowledged: true });
    expect(parseMustFixRefutationAcknowledgement('REFUTE: NONE —   ')).toEqual({ acknowledged: false });
    expect(parseMustFixRefutationAcknowledgement('REFUTE: NONE — 첫 이유\nREFUTE: NONE — 둘째 이유')).toEqual({ acknowledged: true });
    expect(parseMustFixRefutationAcknowledgement('REFUTE: NONE — 이유\nREFUTE [MF-deadbeef] "인용" — 제출 사유')).toEqual({ acknowledged: true });
    expect(parseMustFixRefutationAcknowledgement('REFUTE: NONE — 이유\nREFUTE: NONE')).toEqual({ acknowledged: true });
  });

  test('안정 ID는 배열 재정렬과 무관하게 같은 must-fix 문면에 동일하다', () => {
    expect(snapshotMustFixFindings(['B', 'A']).map((finding) => finding.id)).toEqual([stableMustFixId('B'), stableMustFixId('A')]);
    expect(snapshotMustFixFindings(['A', 'B']).map((finding) => finding.id)).toEqual([stableMustFixId('A'), stableMustFixId('B')]);
  });
});

describe('missing cited-path REFUTE eligibility', () => {
  const goal = '- Checkable requested criterion: 기존 골 줄 자격은 그대로다.';

  test('같은 라운드의 missing만 해당 finding에 missing-cited-path 회부 자격을 세운다', () => {
    const snapshot = snapshotMustFixFindings(['`src/missing.ts`을 고쳐라', '`src/real.ts`을 고쳐라', '`Makefile`을 고쳐라', '`src/unknown.ts`을 고쳐라']);
    const [missing, existing, ambiguous, unknown] = snapshot;
    const facts = [
      { round: 2, findingId: missing!.id, path: 'src/missing.ts', existence: 'missing' as const },
      { round: 2, findingId: existing!.id, path: 'src/real.ts', existence: 'exists' as const },
      { round: 2, findingId: ambiguous!.id, path: 'Makefile', existence: 'ambiguous' as const },
      { round: 2, findingId: unknown!.id, path: 'src/unknown.ts', existence: 'unknown' as const },
    ];
    expect(eligibleMissingCitedPathFindings(facts, 2)).toEqual(new Set([missing!.id]));
    const text = snapshot.map(({ id }) => `REFUTE [${id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 기계 관측 경로가 없다.`).join('\n');
    expect(parseMustFixRefutations(text, goal, snapshot, undefined, { citedPathFacts: facts, round: 2 })).toEqual([{
      findingId: missing!.id,
      finding: missing!.item,
      quote: MISSING_CITED_PATH_REFUTATION_QUOTE,
      kind: 'missing-cited-path',
      reason: '기계 관측 경로가 없다.',
    }]);
  });

  test('같은 라운드 missing만 회부하고 다른 라운드·라운드 미기록·다른 finding·관측 없음은 거부하며 기존 goal-line 자격은 보존한다', () => {
    const snapshot = snapshotMustFixFindings(['`src/current.ts`을 고쳐라', '`src/previous.ts`을 고쳐라', '`src/unrecorded.ts`을 고쳐라', '`src/other.ts`을 고쳐라', '기존 골 줄을 어겨라']);
    const requested = '- Checkable requested criterion: 기존 골 줄 자격은 그대로다.';
    const rejected: Array<{ stage: string; findingId?: string }> = [];
    const text = [
      `REFUTE [${snapshot[0]!.id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 같은 라운드 missing`,
      `REFUTE [${snapshot[1]!.id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 다른 라운드 missing`,
      `REFUTE [${snapshot[2]!.id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 라운드 미기록 missing`,
      `REFUTE [${snapshot[3]!.id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 다른 finding의 missing`,
      `REFUTE [${snapshot[4]!.id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 관측 없음`,
      `REFUTE [${snapshot[4]!.id}] ${JSON.stringify(requested)} — 기존 골 줄 근거`,
    ].join('\n');
    expect(parseMustFixRefutations(text, goal, snapshot, (rejection) => rejected.push(rejection), {
      round: 2,
      citedPathFacts: [
        { round: 2, findingId: snapshot[0]!.id, path: 'src/current.ts', existence: 'missing' },
        { round: 1, findingId: snapshot[1]!.id, path: 'src/previous.ts', existence: 'missing' },
        { findingId: snapshot[2]!.id, path: 'src/unrecorded.ts', existence: 'missing' },
        { round: 1, findingId: snapshot[3]!.id, path: 'src/other.ts', existence: 'missing' },
      ],
    })).toEqual([
      { findingId: snapshot[0]!.id, finding: snapshot[0]!.item, quote: MISSING_CITED_PATH_REFUTATION_QUOTE, kind: 'missing-cited-path', reason: '같은 라운드 missing' },
      { findingId: snapshot[4]!.id, finding: snapshot[4]!.item, quote: requested, kind: 'requested-criterion', reason: '기존 골 줄 근거' },
    ]);
    expect(rejected).toEqual([
      { stage: 'eligible-cited-path', findingId: snapshot[1]!.id },
      { stage: 'eligible-cited-path', findingId: snapshot[2]!.id },
      { stage: 'eligible-cited-path', findingId: snapshot[3]!.id },
      { stage: 'eligible-cited-path', findingId: snapshot[4]!.id },
    ]);
    expect(eligibleRefutationGoalLines(goal).get(requested)).toBe('requested-criterion');
  });

  test('다른 라운드 missing만 있는 독립 fixture는 회부 자격을 세우지 않는다', () => {
    const [finding] = snapshotMustFixFindings(['`src/previous-only.ts`을 고쳐라']);
    const rejected: Array<{ stage: string; findingId?: string }> = [];
    const text = `REFUTE [${finding!.id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 이전 라운드 missing`;
    expect(parseMustFixRefutations(text, goal, [finding!], (rejection) => rejected.push(rejection), {
      round: 2,
      citedPathFacts: [{ round: 1, findingId: finding!.id, path: 'src/previous-only.ts', existence: 'missing' }],
    })).toEqual([]);
    expect(rejected).toEqual([{ stage: 'eligible-cited-path', findingId: finding!.id }]);
  });

  test('라운드 미기록 missing만 있는 독립 fixture는 회부 자격을 세우지 않는다', () => {
    const [finding] = snapshotMustFixFindings(['`src/unrecorded-only.ts`을 고쳐라']);
    const rejected: Array<{ stage: string; findingId?: string }> = [];
    const text = `REFUTE [${finding!.id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 라운드 미기록 missing`;
    expect(parseMustFixRefutations(text, goal, [finding!], (rejection) => rejected.push(rejection), {
      round: 2,
      citedPathFacts: [{ findingId: finding!.id, path: 'src/unrecorded-only.ts', existence: 'missing' }],
    })).toEqual([]);
    expect(rejected).toEqual([{ stage: 'eligible-cited-path', findingId: finding!.id }]);
  });
});

describe('found cited-path REFUTE eligibility', () => {
  const goal = '- Checkable requested criterion: 기존 골 줄 자격은 그대로다.';
  const foundSearch = {
    result: 'found' as const,
    observedScope: ['src'],
    tool: 'ast-grep' as const,
    maxResults: 20,
    evidence: { file: 'src/owner.ts', line: 10, text: 'InputOwner' },
  };
  const notFoundSearch = {
    result: 'not-found-within-observed-scope' as const,
    observedScope: ['src'],
    tool: 'ast-grep' as const,
    maxResults: 20,
  };

  test('같은 라운드의 found symbolSearch만 해당 finding에 found-cited-path 회부 자격을 세운다', () => {
    const snapshot = snapshotMustFixFindings(['`InputOwner`가 없다', '`GhostSymbol`가 없다']);
    const [found, missingSearch] = snapshot;
    const facts = [
      { round: 2, findingId: found!.id, path: 'InputOwner', existence: 'ambiguous' as const, symbolSearch: foundSearch },
      { round: 2, findingId: missingSearch!.id, path: 'GhostSymbol', existence: 'ambiguous' as const, symbolSearch: notFoundSearch },
    ];
    expect(eligibleFoundCitedPathFindings(facts, 2)).toEqual(new Set([found!.id]));
    const text = `REFUTE [${found!.id}] ${JSON.stringify(FOUND_CITED_PATH_REFUTATION_QUOTE)} — 기계 관측이 그 심볼을 찾았다.`;
    expect(parseMustFixRefutations(text, goal, snapshot, undefined, { citedPathFacts: facts, round: 2 })).toEqual([{
      findingId: found!.id,
      finding: found!.item,
      quote: FOUND_CITED_PATH_REFUTATION_QUOTE,
      kind: 'found-cited-path',
      reason: '기계 관측이 그 심볼을 찾았다.',
    }]);
  });

  test('symbolSearch fact가 없는 finding의 FOUND-CITED-PATH는 eligible-cited-path로 거부한다', () => {
    const [finding] = snapshotMustFixFindings(['`NoFactSymbol`가 없다']);
    const rejected: Array<{ stage: string; findingId?: string }> = [];
    const text = `REFUTE [${finding!.id}] ${JSON.stringify(FOUND_CITED_PATH_REFUTATION_QUOTE)} — fact 없음`;
    expect(parseMustFixRefutations(text, goal, [finding!], (rejection) => rejected.push(rejection), {
      round: 2,
      citedPathFacts: [],
    })).toEqual([]);
    expect(rejected).toEqual([{ stage: 'eligible-cited-path', findingId: finding!.id }]);
  });

  test('not-found-within-observed-scope finding의 FOUND-CITED-PATH는 eligible-cited-path로 거부한다', () => {
    const [finding] = snapshotMustFixFindings(['`GhostSymbol`가 없다']);
    const rejected: Array<{ stage: string; findingId?: string }> = [];
    const text = `REFUTE [${finding!.id}] ${JSON.stringify(FOUND_CITED_PATH_REFUTATION_QUOTE)} — 관측 범위에서 못 찾음`;
    expect(parseMustFixRefutations(text, goal, [finding!], (rejection) => rejected.push(rejection), {
      round: 2,
      citedPathFacts: [{ round: 2, findingId: finding!.id, path: 'GhostSymbol', existence: 'ambiguous', symbolSearch: notFoundSearch }],
    })).toEqual([]);
    expect(rejected).toEqual([{ stage: 'eligible-cited-path', findingId: finding!.id }]);
  });

  test('다른 라운드 found fact만 있는 finding의 FOUND-CITED-PATH는 eligible-cited-path로 거부한다', () => {
    const [finding] = snapshotMustFixFindings(['`InputOwner`가 없다']);
    const rejected: Array<{ stage: string; findingId?: string }> = [];
    const text = `REFUTE [${finding!.id}] ${JSON.stringify(FOUND_CITED_PATH_REFUTATION_QUOTE)} — 다른 라운드 found`;
    expect(parseMustFixRefutations(text, goal, [finding!], (rejection) => rejected.push(rejection), {
      round: 2,
      citedPathFacts: [{ round: 1, findingId: finding!.id, path: 'InputOwner', existence: 'ambiguous', symbolSearch: foundSearch }],
    })).toEqual([]);
    expect(rejected).toEqual([{ stage: 'eligible-cited-path', findingId: finding!.id }]);
  });

  test('FOUND-CITED-PATH 어휘가 파서에 반환되고 기존 MISSING 토큰 의미는 그대로다', () => {
    expect(FOUND_CITED_PATH_REFUTATION_QUOTE).toBe('FOUND-CITED-PATH');
    expect(MISSING_CITED_PATH_REFUTATION_QUOTE).toBe('MISSING-CITED-PATH');
    const snapshot = snapshotMustFixFindings(['`InputOwner`가 없다', '`src/missing.ts`을 고쳐라']);
    const [found, missing] = snapshot;
    const facts = [
      { round: 2, findingId: found!.id, path: 'InputOwner', existence: 'ambiguous' as const, symbolSearch: foundSearch },
      { round: 2, findingId: missing!.id, path: 'src/missing.ts', existence: 'missing' as const },
    ];
    const text = [
      `REFUTE [${found!.id}] ${JSON.stringify(FOUND_CITED_PATH_REFUTATION_QUOTE)} — 기계 관측이 그 심볼을 찾았다.`,
      `REFUTE [${missing!.id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 기계 관측 경로가 없다.`,
    ].join('\n');
    expect(parseMustFixRefutations(text, goal, snapshot, undefined, { citedPathFacts: facts, round: 2 })).toEqual([
      { findingId: found!.id, finding: found!.item, quote: FOUND_CITED_PATH_REFUTATION_QUOTE, kind: 'found-cited-path', reason: '기계 관측이 그 심볼을 찾았다.' },
      { findingId: missing!.id, finding: missing!.item, quote: MISSING_CITED_PATH_REFUTATION_QUOTE, kind: 'missing-cited-path', reason: '기계 관측 경로가 없다.' },
    ]);
  });
});

describe('observeMustFixCitedPaths — shared cited-symbol extraction', () => {
  test('producer-recorded round flows from observation into same-round missing-cited-path eligibility', async () => {
    const mustFix = ['`src/real.ts`과 `src/missing.ts`을 고쳐라.', '`Makefile`을 고쳐라.'];
    const snapshot = snapshotMustFixFindings(mustFix);
    const facts = await observeMustFixCitedPaths(mustFix, {
      cwd: '/worktree',
      round: 7,
      exists: (path) => path.endsWith('/src/real.ts'),
    });
    expect(facts).toEqual([
      { round: 7, findingId: snapshot[0]!.id, path: 'src/real.ts', existence: 'exists' },
      { round: 7, findingId: snapshot[0]!.id, path: 'src/missing.ts', existence: 'missing' },
      { round: 7, findingId: snapshot[1]!.id, path: 'Makefile', existence: 'ambiguous' },
    ]);
    const text = snapshot.map(({ id }) => `REFUTE [${id}] ${JSON.stringify(MISSING_CITED_PATH_REFUTATION_QUOTE)} — 기계 관측을 근거로 회부한다.`).join('\n');
    expect(parseMustFixRefutations(text, '- Checkable requested criterion: 골 줄 자격은 그대로다.', snapshot, undefined, {
      round: 7,
      citedPathFacts: facts,
    })).toEqual([{
      findingId: snapshot[0]!.id,
      finding: snapshot[0]!.item,
      quote: MISSING_CITED_PATH_REFUTATION_QUOTE,
      kind: 'missing-cited-path',
      reason: '기계 관측을 근거로 회부한다.',
    }]);
  });

  test('existing and missing cited paths retain the finding ID and stable extractor order', async () => {
    const mustFix = ['`src/real.ts`을 고치고 `src/missing.ts`을 고쳐라.'];
    const exists = (path: string) => path.endsWith('/src/real.ts');
    const facts = await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/real.ts', existence: 'exists' },
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/missing.ts', existence: 'missing' },
    ]);
    expect(await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists })).toEqual(facts);
  });

  test('unreadable probes and target-tree escapes are unknown, never missing', async () => {
    const mustFix = ['`src/unreadable.ts`, `../outside.ts`, `/absolute.ts`을 고쳐라.'];
    const facts = await observeMustFixCitedPaths(mustFix, {
      cwd: '/worktree',
      exists: () => { const error = Object.assign(new Error('EACCES'), { code: 'EACCES' }); throw error; },
    });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/unreadable.ts', existence: 'unknown' },
      { findingId: stableMustFixId(mustFix[0]!), path: '../outside.ts', existence: 'unknown' },
      { findingId: stableMustFixId(mustFix[0]!), path: '/absolute.ts', existence: 'unknown' },
    ]);
  });

  test('root files are observed inside the target tree while absolute paths remain unknown', async () => {
    const mustFix = ['`README.md` and `/outside.ts`를 고쳐라.'];
    const probed: string[] = [];
    const facts = await observeMustFixCitedPaths(mustFix, {
      cwd: '/worktree',
      exists: (path) => { probed.push(path); return path === '/worktree/README.md'; },
    });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'README.md', existence: 'exists' },
      { findingId: stableMustFixId(mustFix[0]!), path: '/outside.ts', existence: 'unknown' },
    ]);
    expect(probed).toEqual(['/worktree/README.md']);
  });

  test('extensionless Dockerfile, Makefile, and nested tool paths remain observable with stable tri-state facts', async () => {
    const mustFix = ['`Dockerfile`, `Makefile`, `bin/tool`, and `bin/tool`을 고쳐라.'];
    const exists = (path: string) => path === '/worktree/Dockerfile';
    const facts = await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'Dockerfile', existence: 'exists' },
      // 🪞 2026-08-19 사람 인수 — 종전 기대는 'missing' 이었다. ⛔ 그 판정은 «하드코딩»(symbol==='Makefile')에
      //   기대고 있었고, 그 우회가 무인 리뷰의 3라운드 반복 지적 → UNCONVERGEABLE 을 냈다.
      //   🔑 문면만으로는 `Makefile`(허구일 수 있다)과 `buildRequest`(함수다)를 «가를 수 없다».
      //   ⇒ 그래서 bare 심볼의 부재는 ***`ambiguous`*** 다 — 관측엔 남고 판정엔 안 쓰인다.
      { findingId: stableMustFixId(mustFix[0]!), path: 'Makefile', existence: 'ambiguous' },
      { findingId: stableMustFixId(mustFix[0]!), path: 'bin/tool', existence: 'missing' },
    ]);
    expect(await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists })).toEqual(facts);
  });

  // ⛔⭐ 하드코딩 «재발 방지» — 종전 판정은 symbol==='Dockerfile'||symbol==='Makefile' 이었다.
  //   그 목록은 영영 늙고, 그 우회가 UNCONVERGEABLE 을 냈다(2026-08-19 · rework 3).
  //   ⇒ 이 회귀는 ***목록에 없던 이름***이 같은 규칙으로 처리되는지를 문다.
  test('목록에 «없던» 확장자 없는 이름도 같은 규칙을 따른다 — 실재하면 exists', async () => {
    const mustFix = ['`Justfile`, `Rakefile`, `CODEOWNERS`를 고쳐라.'];
    const facts = await observeMustFixCitedPaths(mustFix, {
      cwd: '/worktree',
      exists: (path) => path === '/worktree/Justfile' || path === '/worktree/CODEOWNERS',
    });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'Justfile', existence: 'exists' },
      { findingId: stableMustFixId(mustFix[0]!), path: 'Rakefile', existence: 'ambiguous' },
      { findingId: stableMustFixId(mustFix[0]!), path: 'CODEOWNERS', existence: 'exists' },
    ]);
  });

  test('함수 이름처럼 보이는 낱말은 «판정»에 쓰이지 않는다 — ambiguous 로만 남는다', async () => {
    const mustFix = ['`buildRequest`를 수정하지 않았다.'];
    const facts = await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists: () => false });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'buildRequest', existence: 'ambiguous' },
    ]);
    // 🔑 ⛔ 이것이 `missing` 이면 ***함수 이름마다 「없는 경로를 요구했다」가 뜬다***(거짓 빨강).
    expect(facts.every((fact) => fact.existence !== 'missing')).toBe(true);
  });

  test('경로 «의도»가 문면에 드러난 허구는 missing 으로 잡힌다 — 이 축의 본래 목적', async () => {
    const mustFix = ['`src/llm/request-builder.ts`의 buildRequest 를 수정하지 않았다.'];
    const facts = await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists: () => false });
    expect(facts).toContainEqual(
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/llm/request-builder.ts', existence: 'missing' },
    );
  });

  test('파일 위치 한정자는 부재면 ambiguous, 실재 경로와 진짜 부재 경로는 기존 판정을 유지한다', async () => {
    const mustFix = ['`src/nexus/api/harness-api.ts:84-85`, `src/nexus/api/harness-api.ts:doSomething`, `src/self-implement/reflect-mustfix.ts`, `src/does-not-exist.ts`를 고쳐라.'];
    const facts = await observeMustFixCitedPaths(mustFix, {
      cwd: '/worktree',
      exists: (path) => path === '/worktree/src/self-implement/reflect-mustfix.ts',
    });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/nexus/api/harness-api.ts:84-85', existence: 'ambiguous' },
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/nexus/api/harness-api.ts:doSomething', existence: 'ambiguous' },
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/self-implement/reflect-mustfix.ts', existence: 'exists' },
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/does-not-exist.ts', existence: 'missing' },
    ]);
  });

  test('공백+빗금 산문은 실재하지 않을 때 missing 이 아니다 — 한 낱말과 같은 ambiguous', async () => {
    const mustFix = [
      '`search all files under src/fixtures`를 고쳐라.',
      '`rg -n "mcp diagnose" docs/`를 고쳐라.',
    ];
    const facts = await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists: () => false });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'search all files under src/fixtures', existence: 'ambiguous' },
      { findingId: stableMustFixId(mustFix[1]!), path: 'rg -n "mcp diagnose" docs/', existence: 'ambiguous' },
    ]);
    expect(facts.every((fact) => fact.existence !== 'missing')).toBe(true);
  });

  test('공백+빗금이어도 실재하는 파일 경로는 exists 를 그대로 쓴다', async () => {
    const mustFix = ['`src/my file.ts`을 고쳐라.'];
    const facts = await observeMustFixCitedPaths(mustFix, {
      cwd: '/worktree',
      exists: (path) => path === '/worktree/src/my file.ts',
    });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/my file.ts', existence: 'exists' },
    ]);
  });

  test('빗금도 공백도 없는 한 낱말은 실재하면 exists, 없으면 ambiguous — 이 착지 이전과 같다', async () => {
    const mustFix = ['`Dockerfile`과 `buildRequest`를 고쳐라.'];
    const facts = await observeMustFixCitedPaths(mustFix, {
      cwd: '/worktree',
      exists: (path) => path === '/worktree/Dockerfile',
    });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'Dockerfile', existence: 'exists' },
      { findingId: stableMustFixId(mustFix[0]!), path: 'buildRequest', existence: 'ambiguous' },
    ]);
  });

  test('공백을 품고 빗금 없는 산문은 missing 이 아니다', async () => {
    const mustFix = ['`node server.js`를 고쳐라.', '`한 번만 표시된 문구`를 고쳐라.'];
    const facts = await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists: () => false });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'node server.js', existence: 'ambiguous' },
      { findingId: stableMustFixId(mustFix[1]!), path: '한 번만 표시된 문구', existence: 'ambiguous' },
    ]);
    expect(facts.every((fact) => fact.existence !== 'missing')).toBe(true);
  });

  test('an unreadable extensionless cited path is unknown instead of missing', async () => {
    const mustFix = ['`bin/tool`을 고쳐라.'];
    const facts = await observeMustFixCitedPaths(mustFix, {
      cwd: '/worktree',
      exists: () => { const error = Object.assign(new Error('EACCES'), { code: 'EACCES' }); throw error; },
    });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'bin/tool', existence: 'unknown' },
    ]);
  });

  test('duplicate citations are deduplicated per finding without inventing a path extractor', async () => {
    const mustFix = ['`src/a.ts` and `src/a.ts`', '`src/a.ts` again'];
    const facts = await observeMustFixCitedPaths(mustFix, { cwd: '/worktree', exists: () => false });
    expect(facts).toEqual([
      { findingId: stableMustFixId(mustFix[0]!), path: 'src/a.ts', existence: 'missing' },
      { findingId: stableMustFixId(mustFix[1]!), path: 'src/a.ts', existence: 'missing' },
    ]);
  });

  test('default bare-symbol path calls the structural probe and records only its completed scope', async () => {
    let calls = 0;
    const [fact] = await observeMustFixCitedPaths(['`observeMustFixCitedPaths`'], {
      cwd: '/worktree',
      hasAstGrep: () => true,
      dispatchAstGrep: async () => {
        calls++;
        return { output: '', mode: 'json', matches: [{ file: 'src/self-implement/reflect-mustfix.ts', line: 265, column: 1, text: 'observeMustFixCitedPaths', lines: '' }], numMatches: 1, numFiles: 1, truncated: false, command: [] };
      },
    });
    expect(calls).toBe(1);
    expect(fact).toMatchObject({
      existence: 'ambiguous',
      symbolSearch: { result: 'found', observedScope: ['src/**/*.ts via ast-grep typescript identifier pattern'], evidence: { file: 'src/self-implement/reflect-mustfix.ts' } },
    });
  });

  test('unavailable or throwing structural probes report no completed scope and never repository absence', async () => {
    for (const options of [
      { hasAstGrep: () => false },
      { hasAstGrep: () => { throw new Error('availability failed'); } },
      { hasAstGrep: () => true, dispatchAstGrep: async () => { throw new Error('search failed'); } },
    ]) {
      const [fact] = await observeMustFixCitedPaths(['`NotInThisRepository`'], { cwd: '/worktree', ...options });
      expect(fact).toMatchObject({ existence: 'ambiguous', symbolSearch: { result: 'not-found-within-observed-scope', observedScope: [] } });
      expect(JSON.stringify(fact)).not.toContain('repository-absent');
    }
  });

  test('symbol observation scope reaches the reflect prompt without asserting repository absence', () => {
    const prompt = buildReflectPrompt(['`NotInThisRepository`'], 'goal', 'diff', {
      citedPathFacts: [{
        findingId: 'MF-test', path: 'NotInThisRepository', existence: 'ambiguous',
        symbolSearch: { result: 'not-found-within-observed-scope', observedScope: ['src/**/*.ts via ast-grep typescript identifier pattern'], tool: 'ast-grep', maxResults: 20 },
      }],
    });
    expect(prompt).toContain('symbol-search=not-found-within-observed-scope');
    expect(prompt).toContain('observed-scope=["src/**/*.ts via ast-grep typescript identifier pattern"]');
    expect(prompt).toContain('이 트리에 없다는 판정이 아니다');
  });
});

describe('observeCitedSymbol — matchCount and multi-location evidence', () => {
  const scope = ['src/**/*.ts via ast-grep typescript identifier pattern'];
  const astGrepResult = (
    matches: Array<{ file: string; line: number; column: number; text: string; lines: string }>,
    truncated = false,
  ) => ({
    output: '',
    mode: 'json' as const,
    matches,
    numMatches: matches.length,
    numFiles: new Set(matches.map((match) => match.file)).size,
    truncated,
    command: [] as string[],
  });
  const match = (file: string, line: number, text = 'SharedSymbol') => ({ file, line, column: 1, text, lines: '' });
  const observe = (matches: ReturnType<typeof match>[], truncated = false) => observeMustFixCitedPaths(['`SharedSymbol`'], {
    cwd: '/worktree',
    hasAstGrep: () => true,
    dispatchAstGrep: async () => astGrepResult(matches, truncated),
  });

  test('zero matches report matchCount 0 and keep the not-found render line', async () => {
    const [fact] = await observe([]);
    expect(fact?.symbolSearch).toMatchObject({ result: 'not-found-within-observed-scope', matchCount: 0, maxResults: 20 });
    expect(fact?.symbolSearch?.evidence).toBeUndefined();
    expect(renderMustFixCitedPathFacts([fact!])).toEqual([
      `[${stableMustFixId('`SharedSymbol`')}] SharedSymbol: ambiguous; symbol-search=not-found-within-observed-scope; observed-scope=${JSON.stringify(scope)}; tool=ast-grep; max-results=20`,
    ]);
  });

  test('one match reports matchCount 1, keeps a single evidence object, and omits the ambiguity qualification', async () => {
    const [fact] = await observe([match('src/self-implement/reflect-mustfix.ts', 360)]);
    expect(fact?.symbolSearch?.matchCount).toBe(1);
    expect(fact?.symbolSearch?.matchCountIsLowerBound).toBe(false);
    expect(Array.isArray(fact?.symbolSearch?.evidence)).toBe(false);
    expect(fact?.symbolSearch?.evidence).toEqual({ file: 'src/self-implement/reflect-mustfix.ts', line: 360, text: 'SharedSymbol' });
    const [line] = renderMustFixCitedPathFacts([fact!]);
    expect(line).toBe(`[${stableMustFixId('`SharedSymbol`')}] SharedSymbol: ambiguous; symbol-search=found; observed-scope=${JSON.stringify(scope)}; tool=ast-grep; max-results=20; evidence=src/self-implement/reflect-mustfix.ts:360`);
    expect(line).not.toContain('자리에 있다');
    expect(line).not.toContain('이 관측은 모른다');
  });

  test('the same symbol in two files reports matchCount 2 and keeps both evidence entries', async () => {
    const [fact] = await observe([
      match('src/boot/daemon-runtime.ts', 741),
      match('src/nexus/index.ts', 1009),
    ]);
    expect(fact?.symbolSearch?.result).toBe('found');
    expect(fact?.symbolSearch?.matchCount).toBe(2);
    expect(fact?.symbolSearch?.matchCountIsLowerBound).toBe(false);
    expect(fact?.symbolSearch?.evidence).toEqual([
      { file: 'src/boot/daemon-runtime.ts', line: 741, text: 'SharedSymbol' },
      { file: 'src/nexus/index.ts', line: 1009, text: 'SharedSymbol' },
    ]);
    const [line] = renderMustFixCitedPathFacts([fact!]);
    expect(line).toContain('이 심볼은 2 자리에 있다 — 어느 자리를 말하는지 이 관측은 모른다');
    expect(line).toContain('evidence=src/boot/daemon-runtime.ts:741,src/nexus/index.ts:1009');
    expect(eligibleFoundCitedPathFindings([{ ...fact!, round: 2 }], 2)).toEqual(new Set([fact!.findingId]));
  });

  test('hitting maxResults marks matchCount as a lower bound and keeps every capped evidence entry', async () => {
    const matches = Array.from({ length: 21 }, (_, index) => match(`src/file-${index}.ts`, index + 1));
    const [fact] = await observe(matches, true);
    expect(fact?.symbolSearch?.matchCount).toBe(20);
    expect(fact?.symbolSearch?.matchCountIsLowerBound).toBe(true);
    expect(fact?.symbolSearch?.evidence).toHaveLength(20);
    expect(fact?.symbolSearch?.evidence).toEqual(matches.slice(0, 20).map(({ file, line, text }) => ({ file, line, text })));
    const [line] = renderMustFixCitedPathFacts([fact!]);
    expect(line).toContain('이 심볼은 20 자리에 있다(이 수는 하한) — 어느 자리를 말하는지 이 관측은 모른다');
  });

  test('exactly maxResults matches with truncated=false still mark matchCount as a lower bound', async () => {
    const matches = Array.from({ length: 20 }, (_, index) => match(`src/file-${index}.ts`, index + 1));
    const [fact] = await observe(matches, false);
    expect(fact?.symbolSearch?.matchCount).toBe(20);
    expect(fact?.symbolSearch?.matchCountIsLowerBound).toBe(true);
    expect(fact?.symbolSearch?.evidence).toHaveLength(20);
    const [line] = renderMustFixCitedPathFacts([fact!]);
    expect(line).toContain('이 심볼은 20 자리에 있다(이 수는 하한) — 어느 자리를 말하는지 이 관측은 모른다');
  });

  test('19 matches under the cap with truncated=false do not claim a lower bound', async () => {
    const matches = Array.from({ length: 19 }, (_, index) => match(`src/file-${index}.ts`, index + 1));
    const [fact] = await observe(matches, false);
    expect(fact?.symbolSearch?.matchCount).toBe(19);
    expect(fact?.symbolSearch?.matchCountIsLowerBound).toBe(false);
    expect(fact?.symbolSearch?.evidence).toHaveLength(19);
    const [line] = renderMustFixCitedPathFacts([fact!]);
    expect(line).toContain('이 심볼은 19 자리에 있다 — 어느 자리를 말하는지 이 관측은 모른다');
    expect(line).not.toContain('이 수는 하한');
  });

  test('omitted matchCountIsLowerBound is unknown and does not assert an exact multi-location count', () => {
    const fact = {
      findingId: 'MF-test',
      path: 'SharedSymbol',
      existence: 'ambiguous' as const,
      symbolSearch: {
        result: 'found' as const,
        observedScope: ['src'],
        tool: 'ast-grep' as const,
        maxResults: 20,
        matchCount: 2,
        evidence: [
          { file: 'src/boot/daemon-runtime.ts', line: 741, text: 'SharedSymbol' },
          { file: 'src/nexus/index.ts', line: 1009, text: 'SharedSymbol' },
        ],
      },
    };
    const [line] = renderMustFixCitedPathFacts([fact]);
    expect(line).toContain('이 심볼은 여러 자리에 있다 — 어느 자리를 말하는지 이 관측은 모른다');
    expect(line).not.toContain('이 심볼은 2 자리에 있다');
    expect(line).not.toContain('이 수는 하한');
  });

  test('a constructed single-match fact without matchCount still renders the historical line', () => {
    const fact = {
      findingId: 'MF-test',
      path: 'InputOwner',
      existence: 'ambiguous' as const,
      symbolSearch: {
        result: 'found' as const,
        observedScope: ['src'],
        tool: 'ast-grep' as const,
        maxResults: 20,
        evidence: { file: 'src/owner.ts', line: 10, text: 'InputOwner' },
      },
    };
    expect(renderMustFixCitedPathFacts([fact])).toEqual([
      '[MF-test] InputOwner: ambiguous; symbol-search=found; observed-scope=["src"]; tool=ast-grep; max-results=20; evidence=src/owner.ts:10',
    ]);
  });
});

describe('runSelfImplement reflectMustFix failure progress', () => {
  test('throwing reflection reports one folded failure line and preserves fail must-fix', async () => {
    const progress: string[] = [];
    const mustFix = ['first must-fix', 'second must-fix'];
    const result = await runSelfImplement({
      feature: 'reflection failure progress',
      maxReworkRounds: 0,
      seams: seams({
        reviewDiff: async () => ({ verdict: 'fail' as const, mustFix, shouldFix: [], summary: 'failed reflection', reviewed: true }),
        reflectMustFix: async () => { throw new Error('judge\n  unavailable'); },
        onProgress: ({ message }) => { progress.push(message); },
      }),
    });

    const failureLines = progress.filter((message) => message.startsWith('반사 실패'));
    expect(failureLines).toEqual(['반사 실패 — judge unavailable']);
    expect(failureLines[0]).not.toContain('\n');
    expect(result.review?.verdict).toBe('fail');
    expect(result.review?.mustFix).toEqual(mustFix);
  });
});

describe('reflectMustFix — DI judge', () => {
  test('judge 결과로 accepted/rejected 분리', async () => {
    const r = await reflectMustFix(MF, { goal: 'g', diff: 'd' }, {
      judge: async () => '1: ACCEPT\n2: REJECT — 등가계약 밖 무관 요구\n3: ACCEPT',
    });
    expect(r.accepted).toEqual([MF[0], MF[2]]);
    expect(r.rejected).toHaveLength(1);
  });

  test('judge 가 throw → fail-safe 전체 accept(무회귀)', async () => {
    const r = await reflectMustFix(MF, { goal: 'g', diff: 'd' }, {
      judge: async () => { throw new Error('llm down'); },
    });
    expect(r.accepted).toEqual(MF);
    expect(r.rejected).toEqual([]);
  });

  test('빈 must-fix → 빈 결과(judge 미호출)', async () => {
    let called = false;
    const r = await reflectMustFix([], { goal: 'g', diff: 'd' }, { judge: async () => { called = true; return ''; } });
    expect(r).toEqual({ accepted: [], rejected: [] });
    expect(called).toBe(false);
  });

  test('프롬프트에 goal·diff·must-fix·저장소 전역 규칙과 모든 보수 guardrail이 담긴다', () => {
    const p = buildReflectPrompt(MF, 'MY_GOAL_TOKEN', 'MY_DIFF_TOKEN');
    expect(p).toContain('MY_GOAL_TOKEN');
    expect(p).toContain('MY_DIFF_TOKEN');
    expect(p).toContain('스코프 밖: 무관 리팩터 요구');
    expect(p).toContain('저장소가 모든 변경에 적용하는 규칙');
    expect(p).toContain('미사용 public export 금지');
    expect(p).toContain('기본은 **ACCEPT**');
    expect(p).toContain('애매하거나 판단 근거가 부족하면 ACCEPT');
    expect(p).toContain('안전·보안·데이터손실·정확성');
    expect(p).toContain('REJECT 는 반드시');
  });

  test('evidenceFacts의 빈 missingEvidence를 증거 부재 must-fix 판정자에게 문자 그대로 준다', () => {
    const prompt = buildReflectPrompt(['필수 증거가 없다'], 'goal', 'diff', {
      evidenceFacts: { requiredEvidence: 8, coveredEvidence: 8, missingEvidence: [] },
    });
    expect(prompt).toContain('requiredEvidence=8, coveredEvidence=8, missingEvidence=[]');
    expect(prompt).toContain('missingEvidence가 비어 있거나');
  });

  test('requiredEvidence=0은 골이 기계 검사 가능한 증거를 요구하지 않았음을 판정자에게 명시한다', () => {
    const prompt = buildReflectPrompt(['필수 증거가 없다'], 'goal', 'diff', {
      evidenceFacts: { requiredEvidence: 0, coveredEvidence: 0, missingEvidence: [] },
    });
    expect(prompt).toContain('requiredEvidence=0, coveredEvidence=0, missingEvidence=[]');
    expect(prompt).toContain('골이 기계 검사 가능한 증거를 요구하지 않았으므로, 이는 모든 증거가 덮였다는 뜻이 아니다.');
  });

  test('requiredEvidence=0의 증거 부재 must-fix는 기계 사실 충돌로 세지 않는다', () => {
    expect(countReflectFactConflicts(['필수 증거가 없다'], {
      evidenceFacts: { requiredEvidence: 0, coveredEvidence: 0, missingEvidence: [] },
    })).toBe(0);
  });

  test('비-module-load unknown의 gateFacts 책임 결론을 판정자에게 문자 그대로 준다', () => {
    const prompt = buildReflectPrompt(['공식 Gate가 2 fail로 종료됐다'], 'goal', 'diff', {
      gateFacts: { introduced: 0, preexisting: 4, unknown: 1, unknownReason: 'infrastructure-failure', childResponsibility: 'none' },
    });
    expect(prompt).toContain('introduced=0, preexisting=4, unknown=1, unknownReason=infrastructure-failure, child-responsibility=none');
  });

  test('base 통과 후 head 시간 초과 gateFacts를 느려진 회귀 사실로 판정자에게 보존한다', () => {
    const prompt = buildReflectPrompt(['공식 Gate가 2 fail로 종료됐다'], 'goal', 'diff', {
      gateFacts: { introduced: 2, preexisting: 0, unknown: 0, timeoutPassedAtBase: 2 },
    });
    expect(prompt).toContain('introduced=2, preexisting=0, unknown=0, timeoutPassedAtBase=2');
    expect(prompt).toContain('introduced 중 timeoutPassedAtBase 2건은 base에서 통과한 시험의 시간 초과다 — 느려진 회귀로 본다.');
    expect(prompt).toContain('- REJECT 는 반드시 "왜 등가계약 밖인가"를 goal과 저장소 전역 규칙 기준으로 한 문장 근거와 함께.');
  });

  test('budget-exceeded gateFacts는 예산과 범위 파일 수를 판정자에게 보존한다', () => {
    const prompt = buildReflectPrompt(['공식 Gate가 2 fail로 종료됐다'], 'goal', 'diff', {
      gateFacts: {
        introduced: 0,
        preexisting: 0,
        unknown: 1,
        unknownReason: 'budget-exceeded',
        baselineBudgetMs: 600_000,
        baselineFileCount: 8,
        childResponsibility: 'none',
      },
    });
    expect(prompt).toContain('unknownReason=budget-exceeded, baselineBudgetMs=600000, baselineFileCount=8, child-responsibility=none');
  });

  test('필수 파괴 검증 증거 부실도 빈 missingEvidence와 충돌로 센다', () => {
    expect(countReflectFactConflicts(['필수 파괴 검증 증거 부실'], {
      evidenceFacts: { requiredEvidence: 11, coveredEvidence: 11, missingEvidence: [] },
    })).toBe(1);
  });

  test('gate 언급만으로는 gateFacts 충돌로 세지 않는다', () => {
    expect(countReflectFactConflicts(['게이트 증거는 verify-by-breaking이 skipped였다고 명시하는데 보고서는 실행 성공을 주장하며, 관련 없는 기존 증거 보고서까지 재사용·변조했다'], {
      gateFacts: { introduced: 0, preexisting: 0, unknown: 0 },
    })).toBe(0);
  });

  test('gate 또는 테스트 실패 청구는 gateFacts 충돌로 계속 센다', () => {
    const gateFacts = { introduced: 0, preexisting: 0, unknown: 0 };
    expect(countReflectFactConflicts(['공식 Gate가 2 fail로 종료됐다'], { gateFacts })).toBe(1);
    expect(countReflectFactConflicts(['게이트가\n실패했다'], { gateFacts })).toBe(1);
    expect(countReflectFactConflicts(['테스트가 실패했다'], {
      gateFacts: { ...gateFacts, childResponsibility: 'none' },
    })).toBe(1);
  });

  test('유효 REFUTE는 자동 수용하지 않고 감독의 ACCEPT/REJECT 판정 대상에만 싣는다', () => {
    const quote = '- Checkable preservation criterion: 기존 must-fix 반영 경로를 바꾸지 않는다.';
    const prompt = buildReflectPrompt(MF, quote, 'diff', {
      refutations: [{ findingId: 'MF-12345678', finding: MF[1]!, quote, kind: 'preservation-contract', reason: '기존 경로와 충돌한다.' }],
    });
    expect(prompt).toContain('자식의 REFUTE 회부 (자동 수용 금지)');
    expect(prompt).toContain('[MF-12345678] 스코프 밖: 무관 리팩터 요구');
    expect(prompt).toContain(`인용: ${JSON.stringify(quote)}`);
    expect(prompt).toContain('반드시 네가 ACCEPT 또는 REJECT로 독립 판정하라.');
  });

  test('인용 경로 사실은 missing을 자동 기각하지 말라는 문면으로 판정자에게 전달한다', () => {
    const prompt = buildReflectPrompt([MF[0]!], 'goal', 'diff', {
      citedPathFacts: [{ findingId: stableMustFixId(MF[0]!), path: 'src/missing.ts', existence: 'missing' }],
    });
    expect(prompt).toContain('## 리뷰 인용 경로 관측');
    expect(prompt).toContain(`[${stableMustFixId(MF[0]!)}] src/missing.ts: missing`);
    expect(prompt).toContain('자동으로 REJECT하지 말고');
  });

  test('반복 이력은 stable ID로 항목별 연결하고, 없는 이력과 불일치를 비어 있음으로 구분한다', () => {
    const firstId = stableMustFixId(MF[0]!);
    const secondId = stableMustFixId(MF[1]!);
    const rendered = renderMustFixRecurrenceHistory(MF, [
      { findingId: firstId, occurrence: 4, observedRounds: [1, 2, 4, 5] },
      { findingId: 'MF-ffffffff', occurrence: 99, observedRounds: [9] },
    ]);
    expect(rendered).toEqual([
      `1. [${firstId}] 반복 이력: occurrence=4, observedRounds=[1,2,4,5]`,
      `2. [${secondId}] 반복 이력: 비어 있음`,
      `3. [${stableMustFixId(MF[2]!)}] 반복 이력: 비어 있음`,
    ]);
  });

  test('반복 이력은 프롬프트에 독립적으로 실리고, 반복만으로 자동 기각하지 말라고 지시한다', () => {
    const prompt = buildReflectPrompt(MF, 'goal', 'diff', {
      recurrenceHistory: [
        { findingId: stableMustFixId(MF[0]!), occurrence: 4, observedRounds: [1, 2, 4, 5] },
        { findingId: stableMustFixId(MF[2]!), occurrence: 2, observedRounds: [3, 5] },
      ],
    });
    expect(prompt).toContain('## must-fix별 반복 이력');
    expect(prompt).toContain(`1. [${stableMustFixId(MF[0]!)}] 반복 이력: occurrence=4, observedRounds=[1,2,4,5]`);
    expect(prompt).toContain(`2. [${stableMustFixId(MF[1]!)}] 반복 이력: 비어 있음`);
    expect(prompt).toContain(`3. [${stableMustFixId(MF[2]!)}] 반복 이력: occurrence=2, observedRounds=[3,5]`);
    expect(prompt).toContain('반복은 의심의 근거일 뿐 그 자체로 REJECT 사유가 아니다');
    expect(prompt).toContain('occurrence와 observedRounds를 그대로 인용하라');
  });

  test('반복 이력만 있는 judge 응답은 자동 기각되지 않고, 인용한 REJECT 사유는 보존한다', async () => {
    const recurrenceHistory = [{ findingId: stableMustFixId(MF[0]!), occurrence: 4, observedRounds: [1, 2, 4, 5] }];
    const accepted = await reflectMustFix([MF[0]!], { goal: 'goal', diff: 'diff', recurrenceHistory }, {
      judge: async () => '1: ACCEPT',
    });
    expect(accepted).toEqual({ accepted: [MF[0]], rejected: [] });

    const rejected = await reflectMustFix([MF[0]!], { goal: 'goal', diff: 'diff', recurrenceHistory }, {
      judge: async () => '1: REJECT — occurrence=4, observedRounds=[1,2,4,5]이고 goal 밖 요구다',
    });
    expect(rejected.rejected).toEqual([{
      item: MF[0],
      reason: 'occurrence=4, observedRounds=[1,2,4,5]이고 goal 밖 요구다',
    }]);
  });

  test('새 입력을 안 주면 undefined facts와 문자 동등이고 기계 사실 블록을 넣지 않는다', () => {
    const legacy = buildReflectPrompt(MF, 'goal', 'diff');
    const absentFacts = buildReflectPrompt(MF, 'goal', 'diff', {});
    expect(absentFacts).toBe(legacy);
    expect(legacy).not.toContain('같은 런의 기계 판정 사실');
    expect(legacy).not.toContain('must-fix별 반복 이력');
  });
});
