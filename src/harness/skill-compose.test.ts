// 트랙 S7/S8 — fan-out(병렬) + chain(순차) 컴포지션 테스트. luna pick/invoke 는 fake 주입.
import { test, expect, describe } from 'bun:test';
import { fanOutHarnessSkills, chainHarnessSkills, combineSkillOutputs } from './skill-compose.js';
import type { SkillIndexEntry } from '../skills/index.js';

// allowlist = {omni-digest, omni-market, kr-flow}. 인덱스는 존재만 하면 됨(luna pick 이 fake).
const idx = [{ name: 'omni-market' }, { name: 'kr-flow' }, { name: 'omni-digest' }, { name: 'diagram-master' }] as unknown as SkillIndexEntry[];

describe('S7 — fanOutHarnessSkills(병렬 fan-out)', () => {
  test('luna 픽 ∩ allowlist 를 모두 병렬 실행·합친 grounding', async () => {
    const calls: string[] = [];
    const r = await fanOutHarnessSkills('삼성전자 매력도', {
      index: idx,
      pickSkills: async () => ['omni-market', 'kr-flow', 'diagram-master'],   // diagram=allowlist 밖 → 제외
      invoke: async (_obj, skill) => { calls.push(skill); return { ok: true, output: `${skill} 산출` }; },
    });
    expect(r).not.toBeNull();
    expect(calls.sort()).toEqual(['kr-flow', 'omni-market']);   // allowlist ∩ 만
    expect(r!.results.filter((x) => x.ok).length).toBe(2);
    expect(r!.combinedOutput).toContain("omni-market' 실행 결과");
    expect(r!.combinedOutput).toContain("kr-flow' 실행 결과");
  });

  test('★ R2 프리셋 — skills 고정 세트면 luna 우회(pickSkills 안 부름)·source=preset', async () => {
    let pickCalled = false;
    const r = await fanOutHarnessSkills('goal', {
      skills: ['omni-market', 'kr-flow', 'diagram-master'],   // diagram=allowlist 밖 → 제외
      pickSkills: async () => { pickCalled = true; return null; },
      invoke: async (_o, skill) => ({ ok: true, output: `${skill} out` }),
    });
    expect(pickCalled).toBe(false);   // 고정 세트라 luna 우회
    expect(r?.source).toBe('preset');
    expect(r?.results.map((x) => x.skill).sort()).toEqual(['kr-flow', 'omni-market']);
  });

  test('개별 실패 fail-soft — 하나 실패해도 나머지 산출 보존', async () => {
    const r = await fanOutHarnessSkills('goal', {
      index: idx,
      pickSkills: async () => ['omni-market', 'kr-flow'],
      invoke: async (_o, skill) => skill === 'kr-flow' ? { ok: false, output: '' } : { ok: true, output: 'ok' },
    });
    expect(r!.results.length).toBe(2);
    expect(r!.results.filter((x) => x.ok).length).toBe(1);
    expect(r!.combinedOutput).toContain("omni-market'");
    expect(r!.combinedOutput).not.toContain("kr-flow' 실행");   // 실패는 grounding 에서 제외
  });

  test('luna 무결과/실패 → null(단일 셀렉터 폴백)', async () => {
    expect(await fanOutHarnessSkills('g', { index: idx, pickSkills: async () => null })).toBeNull();
    expect(await fanOutHarnessSkills('g', { index: idx, pickSkills: async () => [] })).toBeNull();
  });

  test('allowlist 밖 픽만 있으면 → null', async () => {
    const r = await fanOutHarnessSkills('g', { index: idx, pickSkills: async () => ['diagram-master', 'webtoon'] });
    expect(r).toBeNull();
  });

  test('동시성 캡 — maxParallel 초과 동시실행 없음', async () => {
    let inFlight = 0; let peak = 0;
    await fanOutHarnessSkills('g', {
      index: idx,
      maxParallel: 2,
      pickSkills: async () => ['omni-market', 'kr-flow', 'omni-digest'],   // 3개, 캡 2
      invoke: async () => { inFlight += 1; peak = Math.max(peak, inFlight); await Promise.resolve(); inFlight -= 1; return { ok: true, output: 'x' }; },
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('S8 — chainHarnessSkills(순차 output→input)', () => {
  test('직전 산출이 다음 입력에 carry', async () => {
    const inputs: string[] = [];
    const r = await chainHarnessSkills('원 objective', [{ skill: 'omni-digest' }, { skill: 'omni-market' }], {
      invoke: async (input, skill) => { inputs.push(input); return { ok: true, output: `${skill}-out` }; },
    });
    expect(r.results.map((x) => x.skill)).toEqual(['omni-digest', 'omni-market']);
    expect(inputs[0]).toBe('원 objective');                          // 첫 스텝=objective 만
    expect(inputs[1]).toContain('[이전 스텝 산출');                    // 둘째=carry 포함
    expect(inputs[1]).toContain('omni-digest-out');
    expect(r.finalOutput).toBe('omni-market-out');
  });

  test('실패 시 체인 중단(fail-soft·부분 결과)', async () => {
    const r = await chainHarnessSkills('g', [{ skill: 'omni-digest' }, { skill: 'omni-market' }, { skill: 'kr-flow' }], {
      invoke: async (_i, skill) => skill === 'omni-market' ? { ok: false, output: '' } : { ok: true, output: 'ok' },
    });
    expect(r.results.map((x) => x.skill)).toEqual(['omni-digest', 'omni-market']);   // kr-flow 미도달
    expect(r.results[1].ok).toBe(false);
  });

  test('비-allowlist 스텝은 스킵', async () => {
    const ran: string[] = [];
    const r = await chainHarnessSkills('g', [{ skill: 'diagram-master' }, { skill: 'omni-market' }], {
      invoke: async (_i, skill) => { ran.push(skill); return { ok: true, output: 'ok' }; },
    });
    expect(ran).toEqual(['omni-market']);   // diagram 스킵
    expect(r.results.map((x) => x.skill)).toEqual(['omni-market']);
  });

  test('step hint 가 입력에 실림', async () => {
    let captured = '';
    await chainHarnessSkills('base', [{ skill: 'omni-market', hint: 'forward PE 위주' }], {
      invoke: async (input) => { captured = input; return { ok: true, output: 'x' }; },
    });
    expect(captured).toContain('[스텝 지시] forward PE 위주');
  });
});

describe('combineSkillOutputs', () => {
  test('성공 산출만 라벨 붙여 합침', () => {
    const out = combineSkillOutputs([
      { skill: 'a', ok: true, output: 'A출력' },
      { skill: 'b', ok: false, output: '' },
      { skill: 'c', ok: true, output: 'C출력' },
    ]);
    expect(out).toContain("[skill 'a' 실행 결과");
    expect(out).toContain("[skill 'c' 실행 결과");
    expect(out).not.toContain("'b'");
  });
});
