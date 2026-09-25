import { test, expect, describe } from 'bun:test';
import { buildDecomposePrompt } from './generator-prompt.js';
import type { DecomposeInput } from './generator.js';

const baseInput: DecomposeInput = { objective: '적응형 투자 코디네이터를 구현하라' };

describe('buildDecomposePrompt — G1 분해기 근본(정의/배선 분리·한 관심사)', () => {
  test('기본 구조 — STRICT JSON·single-responsibility 지시 포함', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 7 });
    expect(p).toContain('single-responsibility');
    expect(p).toContain('## Output (STRICT JSON)');
    expect(p).toContain('## Objective');
    expect(p).toContain(baseInput.objective);
  });

  test('goal-author coarse 프로필 없이 기본 미션 패브릭 규칙을 유지한다', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 7 });
    expect(p).toContain('Break the objective into 3-7 concrete, single-responsibility tasks.');
    expect(p).toContain('ONE CONCERN PER PHASE');
    expect(p).toContain('SEPARATE DEFINE FROM WIRE');
    expect(p).not.toContain('Goal-author coarse slicing');
  });

  test('goal-author coarse 프로필은 1-6개의 큰 구현 조각을 구체적 코드 대상으로 묶는다', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 6, profile: 'goal-author-coarse' });
    expect(p).toContain('Break the objective into 1-6 larger, concrete implementation slices.');
    expect(p).toContain('Goal-author coarse slicing');
    expect(p).toContain('One implementation run can complete a large multi-file slice, including its tests');
    expect(p).toContain('do not split work that fits in one run');
    expect(p).toContain('related definition, tests, and runtime wiring together');
    expect(p).toContain('multiple related concerns and a larger change scope');
    expect(p).toContain('Every slice title MUST name at least one actual file path or function name because only the title is passed to the next stage');
    expect(p).not.toContain('title or description MUST name at least one actual file path or function name');
    expect(p).toContain('Fold non-code investigation or design into the implementation slice that needs it');
    expect(p).toContain('Coarse scope: permit a larger implementation slice');
    expect(p).not.toContain('ONE CONCERN PER PHASE');
    expect(p).not.toContain('SEPARATE DEFINE FROM WIRE');
    expect(p).not.toContain('keep each task ≈≤250 LOC');
  });

  test('arcCount 배선 — 아크 구조 가이드(하한 완화·padding 금지·P4c 2026-07-21)', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 25, arcCount: 5 });
    expect(p).toContain('arcCount: 5 arcs');
    expect(p).toContain('20~25 total'); // 타겟은 유지
    expect(p).toContain('guidance, NOT a hard floor'); // ★ 하한 완화(가치 무관 padding 압력 제거)
    expect(p).toContain('Do NOT invent low-value phases'); // padding 금지 명시
    expect(p).toContain('integration acceptance'); // 아크 통합 계약은 유지
    expect(p).not.toContain('arc collapse'); // 死 게이트 참조 死신호 제거
  });

  test('arcCount 미지정 — 아크 제약 없음(종전 LLM 재량)', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 7 });
    expect(p).not.toContain('arcCount:');
  });

  test('G1 — ONE CONCERN PER PHASE 원칙 명시', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 7 });
    expect(p).toContain('ONE CONCERN PER PHASE');
    // 관심사 클래스 열거(스킬-카운트 정합)
    expect(p).toMatch(/investigate.*design.*add-one-unit.*wire-into-existing.*verify/);
  });

  test('G1 — SEPARATE DEFINE FROM WIRE 원칙 명시(dead-code 예방)', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 7 });
    expect(p).toContain('SEPARATE DEFINE FROM WIRE');
    expect(p).toContain('dead-code');
  });

  test('B0 dependsOn 완결성 — 소비 심볼의 산출 페이즈를 dependsOn에 강제(ungrounded 미충족의존 방지)', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 7 });
    expect(p).toContain('DEPENDENCY COMPLETENESS');
    // 소비 심볼→산출 페이즈 추적·wire/verify 는 모든 define 페이즈 dependsOn·자가검증
    expect(p).toContain('the CREATING phase MUST appear in this phase');
    expect(p).toContain('wire/verify phase MUST dependsOn EVERY define phase');
    expect(p).toContain('Self-check before returning');
  });

  test('B0 축① — 페이즈 kind별 리지드 명세 bar(critique와 shared rubric)', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 7 });
    expect(p).toContain('Phase kind-specific spec bar');
    // 설계=항목 열거·구현=구체 결정 강제(호스트/스킴)·상류 계약 의존 명시
    expect(p).toContain('ENUMERATES every item the design must decide');
    expect(p).toContain('DECIDE the concrete inputs the code needs');
    expect(p).toMatch(/hosts\/schemes|hosts\|.*youtu/);
    expect(p).toContain('Upstream contracts');
  });

  test('G1 — few-shot 에 bundled define+wire BAD 예시 + 분리된 GOOD 예시', () => {
    const p = buildDecomposePrompt(baseInput, { maxTasks: 7 });
    expect(p).toContain('BAD (bundled define+wire');
    expect(p).toContain('define/wire separated');
    // GOOD 예시가 정의(구현+단위테스트)와 배선을 별 task 로 나눔
    expect(p).toContain('no wiring yet');
    expect(p).toMatch(/Wire .* into existing/);
  });

  test('maxTasks / budget / depth 제약 반영', () => {
    const p = buildDecomposePrompt(
      { ...baseInput, depth: 1, constraints: { budgetUsdRemaining: 12.5 } },
      { maxTasks: 5 },
    );
    expect(p).toContain('maxTasks: 5');
    expect(p).toContain('budgetUsdRemaining: $12.50');
    expect(p).toContain('depth: 1');
  });
});

describe('TaskGenerator maxTasks — 아크 붕괴 근본수복(B0 축①·2026-07-18)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  test('arcCount 확정 시 낮은 maxTasks 를 arcCount*4 로 끌어올린다(모순 제거)', async () => {
    const { TaskGenerator } = await import('./generator.js');
    let seen = '';
    const gen = new TaskGenerator({ callable: async ({ prompt }: { prompt: string }) => { seen = prompt; throw new Error('STOP'); } });
    try { await gen.decompose({ objective: 'x', constraints: { maxTasks: 8, arcCount: 5 } }); } catch { /* STOP */ }
    // maxTasks=8(기본급) 이지만 arcCount=5 → max(8, 20)=20 으로 상향(붕괴 방지).
    expect(seen).toContain('maxTasks: 20');
    expect(seen).toContain('arcCount: 5 arcs');
  });

  test('arcCount 미지정 시 사용자 maxTasks 존중(종전)', async () => {
    const { TaskGenerator } = await import('./generator.js');
    let seen = '';
    const gen = new TaskGenerator({ callable: async ({ prompt }: { prompt: string }) => { seen = prompt; throw new Error('STOP'); } });
    try { await gen.decompose({ objective: 'x', constraints: { maxTasks: 7 } }); } catch { /* STOP */ }
    expect(seen).toContain('maxTasks: 7');
    expect(seen).not.toContain('arcCount:');
    expect(seen).not.toContain('Goal-author coarse slicing');
  });

  test('coarse 프로필은 초기와 validation 재시도 프롬프트 모두에 전달된다', async () => {
    const { TaskGenerator } = await import('./generator.js');
    const prompts: string[] = [];
    const gen = new TaskGenerator({ callable: async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      return { text: 'not JSON' };
    } });
    await expect(gen.decompose({ objective: 'x', promptProfile: 'goal-author-coarse' })).rejects.toThrow('VALIDATION_FAILED');
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) => prompt.includes('Goal-author coarse slicing'))).toBe(true);
  });
});
