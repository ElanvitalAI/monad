// S1(긍정 발산 스킵 2026-07-19) — 페이즈 충족 판정(결정론 fast-path + luna) 검증.
import { test, expect, describe } from 'bun:test';
import { parseSatisfactionResponse, evaluatePhaseSatisfaction, buildSatisfactionPrompt } from './mission-phase-satisfaction.js';
import { createTask } from '../task-orchestrator/types.js';

function mkTask(title: string, prompt: string) {
  return createTask({
    title, description: '',
    surface: { kind: 'subagent', definitionName: 'general-purpose', prompt },
    goalSlug: 'm', dependsOn: [], status: 'ready',
    generatedBy: { kind: 'user', actorId: 't' },
  }, { allowUncheckedUrgent: true });
}

describe('parseSatisfactionResponse — 보수적 파싱', () => {
  test('yes → 충족', () => {
    const r = parseSatisfactionResponse('SATISFIED: yes\nREASON: 이미 구현됨');
    expect(r.satisfied).toBe(true);
    expect(r.reason).toContain('이미 구현됨');
  });
  test('no → 미충족', () => {
    expect(parseSatisfactionResponse('SATISFIED: no\nREASON: 미구현').satisfied).toBe(false);
  });
  test('판정 누락 → 보수적 미충족(실행)', () => {
    expect(parseSatisfactionResponse('음 잘 모르겠다').satisfied).toBe(false);
  });
  test('한글 예/아니오', () => {
    expect(parseSatisfactionResponse('SATISFIED: 예').satisfied).toBe(true);
    expect(parseSatisfactionResponse('SATISFIED: 아니오').satisfied).toBe(false);
  });
});

describe('evaluatePhaseSatisfaction — fast-path(결정론) + luna', () => {
  test('fast-path — 필수 산출물 전부 존재 → skip(luna 미호출)', async () => {
    const task = mkTask('조사', '결과를 .artifacts/foo.json 에 저장하라');
    let lunaCalled = false;
    const r = await evaluatePhaseSatisfaction(task, {
      cwd: '/x', goal: 'g', acceptanceText: '', groundingBlock: '',
      statFn: () => ({ size: 100 }), // 항상 존재(크기>0)
    }, { classify: async () => { lunaCalled = true; return 'SATISFIED: no'; } });
    expect(r.satisfied).toBe(true);
    expect(r.via).toBe('artifacts');
    expect(lunaCalled).toBe(false); // fast-path 라 luna 안 부름(비용 절감)
  });

  test('fast-path 실패(산출물 부재) → luna 판정', async () => {
    const task = mkTask('조사', '결과를 .artifacts/foo.json 에 저장하라');
    const r = await evaluatePhaseSatisfaction(task, {
      cwd: '/x', goal: 'g', acceptanceText: '', groundingBlock: '',
      statFn: () => null, // 부재
    }, { classify: async () => 'SATISFIED: yes\nREASON: 선행 아크가 커버' });
    expect(r.satisfied).toBe(true);
    expect(r.via).toBe('luna');
    expect(r.reason).toContain('선행 아크');
  });

  test('필수 산출물 미선언 → 바로 luna(no=실행)', async () => {
    const task = mkTask('구현', '무언가 구현하라');
    const r = await evaluatePhaseSatisfaction(task, {
      cwd: '/x', goal: 'g', acceptanceText: '', groundingBlock: '',
    }, { classify: async () => 'SATISFIED: no\nREASON: 미구현' });
    expect(r.satisfied).toBe(false);
    expect(r.via).toBe('luna');
  });

  test('luna 미주입 → 미판정(실행·via none)', async () => {
    const task = mkTask('구현', '무언가');
    const r = await evaluatePhaseSatisfaction(task, { cwd: '/x', goal: 'g', acceptanceText: '', groundingBlock: '' });
    expect(r.satisfied).toBe(false);
    expect(r.via).toBe('none');
  });

  test('luna 실패(throw) → 보수적 미충족', async () => {
    const task = mkTask('구현', '무언가');
    const r = await evaluatePhaseSatisfaction(task, { cwd: '/x', goal: 'g', acceptanceText: '', groundingBlock: '' },
      { classify: async () => { throw new Error('luna down'); } });
    expect(r.satisfied).toBe(false);
    expect(r.via).toBe('none');
  });
});

describe('buildSatisfactionPrompt — grounding 포함·형식', () => {
  test('선행 산출물·완료기준·형식 지시 포함', () => {
    const p = buildSatisfactionPrompt({ title: 'T', prompt: 'P', goal: 'G', acceptance: 'A', grounding: '선행아크산출물X' });
    expect(p).toContain('SATISFIED: yes|no');
    expect(p).toContain('선행아크산출물X');
    expect(p).toContain('근거 없이 yes 금지');
  });
});
