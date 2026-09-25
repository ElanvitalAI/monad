// P4 Phase 1(2026-07-19) — 신호 기반 동적 Question/버튼 빌더 검증.
import { test, expect, describe } from 'bun:test';
import { buildContextualActions, buildContextualQuestions } from './ux-dynamic-builder.js';

describe('buildContextualActions — 신호 기반 동적 액션', () => {
  test('치명 0 → 승인 recommended·기본 액션(동적 옵션 미노출)', () => {
    const opts = buildContextualActions({ signals: { criticalCount: 0 } });
    const ids = opts.map((o) => o.id);
    expect(opts.find((o) => o.id === 'approve')?.recommended).toBe(true);
    // ★ 버튼 다이어트(대표 2026-07-20) — 깨끗한 분해는 [추천]+[보류]+[정정] 3버튼(simplify·reuse 제거).
    expect(ids).toEqual(['approve', 'hold', 'edit']);
    expect(ids).not.toContain('simplify');
    expect(ids).not.toContain('reuse');
    expect(ids).not.toContain('revise-goal'); // 실패 없음
    expect(ids).not.toContain('redecompose-opus'); // 치명 적음
  });

  test('치명 > 0 → 승인 비추천(검토 유도)', () => {
    expect(buildContextualActions({ signals: { criticalCount: 2 } }).find((o) => o.id === 'approve')?.recommended).toBe(false);
  });

  test('반복 실패(>2) → 골 정정 recommended 노출', () => {
    const opts = buildContextualActions({ signals: { failureCount: 3 } });
    expect(opts.find((o) => o.id === 'revise-goal')?.recommended).toBe(true);
  });

  test('치명 다수(>3) → Opus 재분해 활성화', () => {
    expect(buildContextualActions({ signals: { criticalCount: 5 } }).map((o) => o.id)).toContain('redecompose-opus');
  });

  test('범위 초과 → 벗어난 기능 제외', () => {
    expect(buildContextualActions({ signals: { scopeExceeded: true } }).map((o) => o.id)).toContain('descope');
  });

  test('신호 없음 → 기본 액션만(비파괴 안전 default)', () => {
    const ids = buildContextualActions({}).map((o) => o.id);
    expect(ids).toContain('approve');
    expect(ids).toContain('edit');
    expect(ids).not.toContain('revise-goal');
    expect(ids).not.toContain('redecompose-opus');
    expect(ids).not.toContain('descope');
  });
  // ★ CC2(RFC §3d) — 실행 적응 시나리오 재구성 선택지
  test('arcSurgery 신호 → arc-surgery 옵션(recommended)', () => {
    const o = buildContextualActions({ signals: { arcSurgery: true } }).find((x) => x.id === 'arc-surgery');
    expect(o).toBeDefined();
    expect(o?.recommended).toBe(true);
  });
  test('blockedDependency 신호 → dep-mission 옵션', () => {
    expect(buildContextualActions({ signals: { blockedDependency: true } }).map((o) => o.id)).toContain('dep-mission');
  });
  test('phaseFailed 단독 → apply-heal 옵션', () => {
    expect(buildContextualActions({ signals: { phaseFailed: true } }).map((o) => o.id)).toContain('apply-heal');
  });
  // ★ P3(대표 2026-07-21) — 자율 종결(P2) 후 사후 선택지
  test('stuckResolution=graceful-land → 수용 추천·재분해(이어가기) 옵션', () => {
    const opts = buildContextualActions({ signals: { stuckResolution: 'graceful-land', failureCount: 2 } });
    const ack = opts.find((o) => o.id === 'acknowledge');
    expect(ack).toBeDefined(); expect(ack?.recommended).toBe(true); // land=수용 추천
    expect(opts.map((o) => o.id)).toContain('redecompose'); // 이어가기(wired 핸들러)
    expect(opts.map((o) => o.id)).not.toContain('redecompose-arc'); // deadlock 분기와 배타
  });
  test('stuckResolution=stop → 재분해 재시도 추천', () => {
    const opts = buildContextualActions({ signals: { stuckResolution: 'stop' } });
    expect(opts.find((o) => o.id === 'redecompose')?.recommended).toBe(true);
    expect(opts.find((o) => o.id === 'acknowledge')?.recommended).toBe(false);
  });
  test('arcSurgery 있으면 apply-heal 은 생략(중복 방지)', () => {
    const ids = buildContextualActions({ signals: { arcSurgery: true, phaseFailed: true } }).map((o) => o.id);
    expect(ids).toContain('arc-surgery');
    expect(ids).not.toContain('apply-heal');
  });
  test('redesign 신호 → accept-redesign 옵션(recommended·CC2b 골분해 역제안 버튼)', () => {
    const o = buildContextualActions({ signals: { redesign: true } }).find((x) => x.id === 'accept-redesign');
    expect(o).toBeDefined();
    expect(o?.recommended).toBe(true);
  });
  test('deadlock 신호 → redecompose-arc 옵션(recommended·S7 교착)', () => {
    const o = buildContextualActions({ signals: { deadlock: true } }).find((x) => x.id === 'redecompose-arc');
    expect(o).toBeDefined();
    expect(o?.recommended).toBe(true);
  });
  test('시나리오 무신호 → 시나리오 옵션 없음', () => {
    const ids = buildContextualActions({ signals: { criticalCount: 0 } }).map((o) => o.id);
    expect(ids).not.toContain('arc-surgery');
    expect(ids).not.toContain('dep-mission');
    expect(ids).not.toContain('apply-heal');
    expect(ids).not.toContain('accept-redesign');
  });
});

describe('buildContextualQuestions — 신호 촉발 추가 질문', () => {
  test('범위 초과 → clarify:scope 질문(후속 분리 recommended)', () => {
    const qs = buildContextualQuestions('m1', { signals: { scopeExceeded: true } });
    expect(qs.length).toBe(1);
    expect(qs[0]!.flowState).toBe('clarify:scope');
    expect(qs[0]!.options.find((o) => o.id === 'followup')?.recommended).toBe(true);
  });

  test('모호도 높음 → clarify:focus 질문', () => {
    expect(buildContextualQuestions('m1', { signals: { ambiguityHigh: true } })[0]!.flowState).toBe('clarify:focus');
  });

  test('촉발 신호 없음 → 빈 배열(추가 질문 없음)', () => {
    expect(buildContextualQuestions('m1', {})).toEqual([]);
  });

  test('freeform marker·native platform surface 배선', () => {
    const qs = buildContextualQuestions('m1', { signals: { scopeExceeded: true } }, { editMarker: 'ux:edit:m1', surface: { source: 'native', nativePlatform: 'ios', target: '123' } });
    expect(qs[0]!.freeform?.marker).toBe('ux:edit:m1');
    expect(qs[0]!.surface?.source).toBe('native');
    expect(qs[0]!.surface?.nativePlatform).toBe('ios');
  });
});

describe('buildContextualActions — 조율자 recommendedAction 합성(대표 2026-07-20)', () => {
  test('recommendedAction=proceed → 승인 ⭐추천·label 강조', () => {
    const approve = buildContextualActions({ signals: { recommendedAction: 'proceed' } }).find((o) => o.id === 'approve');
    expect(approve?.recommended).toBe(true);
    expect(approve?.label).toContain('추천');
  });

  test('★ recommendedAction=redecompose → 재분해 버튼 추가·추천(actionHint 일치·종전 부재)', () => {
    const opts = buildContextualActions({ signals: { recommendedAction: 'redecompose' } });
    const redec = opts.find((o) => o.id === 'redecompose');
    expect(redec).toBeDefined();
    expect(redec?.recommended).toBe(true);
  });

  test('recommendedAction=redesign + redesign 신호 → 역제안 수용 ⭐추천', () => {
    const ar = buildContextualActions({ signals: { recommendedAction: 'redesign', redesign: true } }).find((o) => o.id === 'accept-redesign');
    expect(ar?.recommended).toBe(true);
    expect(ar?.label).toContain('추천');
  });

  test('recommendedAction 미상 → 기존 폴백(치명 0 승인 추천·회귀 0)', () => {
    const approve = buildContextualActions({ signals: { criticalCount: 0 } }).find((o) => o.id === 'approve');
    expect(approve?.recommended).toBe(true);
    expect(approve?.label).not.toContain('추천'); // 명시적 recAction 없으면 ⭐ 없음
  });
});
