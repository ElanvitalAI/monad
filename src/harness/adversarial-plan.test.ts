// adversarialPlanCritique — H2 레드팀(실행 前 계획 공격·보강) 테스트

import { describe, test, expect } from 'bun:test';
import { adversarialPlanCritique, parseAdversarialVerdict, multiAngleCritique, DEFAULT_CRITIC_LENSES } from './adversarial-plan.js';

describe('parseAdversarialVerdict — 관대한 JSON 추출', () => {
  test('순수 JSON', () => {
    const v = parseAdversarialVerdict('{"sound":false,"issues":["엣지케이스 누락"],"revisedSteps":["a","b"]}');
    expect(v).toEqual({ sound: false, issues: ['엣지케이스 누락'], revisedSteps: ['a', 'b'] });
  });
  test('서론/코드펜스 섞여도 첫 오브젝트 추출', () => {
    const v = parseAdversarialVerdict('분석 결과입니다:\n```json\n{"sound":true,"issues":[],"revisedSteps":[]}\n```');
    expect(v?.sound).toBe(true);
  });
  test('깨진 JSON → null', () => {
    expect(parseAdversarialVerdict('no json here')).toBeNull();
    expect(parseAdversarialVerdict('{broken')).toBeNull();
  });
  test('비-문자열 issues/steps 필터', () => {
    const v = parseAdversarialVerdict('{"sound":false,"issues":["ok",1,null],"revisedSteps":["s1","",2]}');
    expect(v?.issues).toEqual(['ok']);
    expect(v?.revisedSteps).toEqual(['s1']);
  });
});

describe('adversarialPlanCritique — 보강/건전/실패', () => {
  const steps = ['스키마', '구현', '테스트'];

  test('sound=false + revisedSteps → 보강된 스텝 반환', async () => {
    const critic = async () => '{"sound":false,"issues":["마이그레이션 누락"],"revisedSteps":["스키마","마이그레이션","구현","테스트"]}';
    const r = await adversarialPlanCritique('기능', steps, critic);
    expect(r?.revisedSteps).toEqual(['스키마', '마이그레이션', '구현', '테스트']);
    expect(r?.issues).toEqual(['마이그레이션 누락']);
    expect(r?.byAxis).toEqual({ scope: [] });
  });

  test('scope issue를 별도 축으로 귀속하고 보강한다', async () => {
    const critic = async () => '{"sound":false,"issues":["[scope] add an unrequested production deployment"],"revisedSteps":["스키마","구현","테스트"]}';
    const r = await adversarialPlanCritique('기능', steps, critic);
    expect(r?.revisedSteps).toEqual(steps);
    expect(r?.byAxis).toEqual({ scope: ['[scope] add an unrequested production deployment'] });
  });

  test('명시 요구의 필수 의존성은 scope issue로 귀속하지 않는다', async () => {
    const critic = async () => '{"sound":false,"issues":["migration is required by the requested schema change"],"revisedSteps":[]}';
    const r = await adversarialPlanCritique('기능', steps, critic);
    expect(r?.issues).toEqual(['migration is required by the requested schema change']);
    expect(r?.byAxis).toEqual({ scope: [] });
  });

  test('sound=true → null(무변경·과잉수정 금지)', async () => {
    const critic = async () => '{"sound":true,"issues":[],"revisedSteps":[]}';
    expect(await adversarialPlanCritique('기능', steps, critic)).toBeNull();
  });

  test('sound=false 인데 revisedSteps 비면 → 이슈만(revisedSteps [])', async () => {
    const critic = async () => '{"sound":false,"issues":["순서 의심"],"revisedSteps":[]}';
    const r = await adversarialPlanCritique('기능', steps, critic);
    expect(r?.revisedSteps).toEqual([]);
    expect(r?.issues).toEqual(['순서 의심']);
  });

  test('파싱 실패 → null(원 계획 유지)', async () => {
    expect(await adversarialPlanCritique('기능', steps, async () => 'garbage')).toBeNull();
  });

  test('critic throw → null(fail-soft)', async () => {
    expect(await adversarialPlanCritique('기능', steps, async () => { throw new Error('LLM down'); })).toBeNull();
  });

  test('빈 스텝 → null(크리틱 미호출)', async () => {
    let called = false;
    const r = await adversarialPlanCritique('기능', [], async () => { called = true; return '{}'; });
    expect(r).toBeNull();
    expect(called).toBe(false);
  });

  test('context 를 프롬프트에 전달', async () => {
    let seen = '';
    await adversarialPlanCritique('기능', steps, async (p) => { seen = p; return '{"sound":true,"issues":[],"revisedSteps":[]}'; }, 'GROUND_XYZ');
    expect(steps.length).toBeGreaterThan(0);
    expect(seen).toContain('GROUND_XYZ');
    expect(seen).toContain('adversarial'.toUpperCase());   // 레드팀 프롬프트
    expect(seen).toContain('scope: required work must not expand');
    expect(seen).toContain('[scope]');
  });
});

describe('multiAngleCritique — N 렌즈 병렬 + 종합', () => {
  const steps = ['스키마', '구현', '테스트'];
  // correctness·risk 렌즈만 이슈, 나머지 건전. 종합=수정안.
  const critic = async (p: string): Promise<string> => {
    if (/multi-lens red-team panel/.test(p)) return '{"revisedSteps":["스키마","검증","구현","테스트"]}';
    if (/lens: \*\*correctness/.test(p)) return '{"issues":["잘못된 접근"]}';
    if (/lens: \*\*risk/.test(p)) return '{"issues":["엣지케이스 누락"]}';
    return '{"issues":[]}';
  };

  test('4 렌즈 병렬 → 이슈 종합(렌즈 태그) + 수정안', async () => {
    const r = await multiAngleCritique('기능', steps, critic);
    expect(r).not.toBeNull();
    expect(r!.issues).toEqual(['[correctness] 잘못된 접근', '[risk] 엣지케이스 누락']);
    expect(r!.revisedSteps).toEqual(['스키마', '검증', '구현', '테스트']);
    expect(r!.byLens.map((b) => b.lens).sort()).toEqual(['correctness', 'risk']);
  });

  test('전 렌즈 건전 → null(종합 미호출)', async () => {
    let synthCalled = false;
    const r = await multiAngleCritique('기능', steps, async (p) => {
      if (/multi-lens red-team panel/.test(p)) { synthCalled = true; return '{"revisedSteps":["x"]}'; }
      return '{"issues":[]}';
    });
    expect(r).toBeNull();
    expect(synthCalled).toBe(false);   // 이슈 0 → 종합 스킵
  });

  test('한 렌즈 throw 여도 나머지로 진행(fail-soft)', async () => {
    const r = await multiAngleCritique('기능', steps, async (p) => {
      if (/lens: \*\*correctness/.test(p)) throw new Error('lens down');
      if (/multi-lens red-team panel/.test(p)) return '{"revisedSteps":["보강"]}';
      if (/lens: \*\*risk/.test(p)) return '{"issues":["위험"]}';
      return '{"issues":[]}';
    });
    expect(r!.issues).toEqual(['[risk] 위험']);   // correctness 죽어도 risk 살아남음
  });

  test('종합 실패 → 이슈만(revisedSteps [])', async () => {
    const r = await multiAngleCritique('기능', steps, async (p) => {
      if (/multi-lens red-team panel/.test(p)) return 'garbage';   // 종합 파싱 실패
      if (/lens: \*\*ordering/.test(p)) return '{"issues":["순서"]}';
      return '{"issues":[]}';
    });
    expect(r!.issues).toEqual(['[ordering] 순서']);
    expect(r!.revisedSteps).toEqual([]);
  });

  test('빈 스텝 → null', async () => {
    expect(await multiAngleCritique('기능', [], critic)).toBeNull();
  });

  test('기존 4 렌즈와 scope 렌즈', () => {
    expect(DEFAULT_CRITIC_LENSES).toEqual(['correctness', 'completeness', 'ordering', 'risk', 'scope']);
  });
});
