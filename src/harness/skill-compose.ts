// 하니스 멀티 스킬 컴포지션 — fan-out(병렬) + chain(순차) (트랙 S7/S8 · 2026-07-22)
//
// PLAN-execution-cycle-harness-expansion §트랙 S7/S8. skill-select.ts 는 luna 가 복수(limit 8) 픽해도
// **allowlist 첫 매치 하나만** 실행한다(단일 top-1). 이 모듈은 그 복수화:
//   S7 fan-out : luna 픽 ∩ allowlist 를 **병렬 격리 실행**(투자=omni-market+kr-flow+omni-digest 동시)·
//                Promise.all(동시성 캡)·개별 실패 fail-soft·합친 grounding 산출.
//   S8 chain   : skill A 산출 → skill B 입력 **순차 파이프**(수집→요약·크롤→보고서)·중간 산출 carry(S4)·
//                실패 시 체인 중단(fail-soft·부분 결과 반환).
//
// 격리(invokeResearch=withResearchIsolation·Write/Edit deny)·allowlist(HARNESS_EXEC_ALLOWLIST)·fail-soft·
// 관측(harness.skill)은 skill-select/skill-exec 규율을 그대로 재사용(재발명 0). 단일 selectHarnessSkill 은
// 무접촉(무회귀) — 이 모듈은 additive primitive 이며 하니스 배선은 opt-in.
//
// ★ 제1원칙 관측(S4 carry·S5 튜닝): 픽(when)·실행(exec)·전달(carry)을 debug.log('harness.skill').
//   조회: monad logs --category harness.skill.

import { pickSkillsViaLlm } from '../autopilot/mission-codebase-gate.js';
import { getSkillIndex, type SkillIndexEntry } from '../skills/index.js';
import { invokeResearch } from '../research-bridge/invoke.js';
import { HARNESS_EXEC_ALLOWLIST } from './skill-exec.js';
import { debug } from '../debug/log.js';

/** 한 skill 실행 결과 — fan-out/chain 공통 단위. */
export interface HarnessSkillRunResult {
  skill: string;
  ok: boolean;
  output: string;
}

/** S8 체인 스텝 — 같은 skill 다른 모드도 가능(hint 로 스텝 지시). */
export interface HarnessSkillChainStep {
  skill: string;
  /** objective 에 얹을 스텝별 지시(선택·예: 'grok 로 여론' / 'firecrawl 심화'). */
  hint?: string;
}

type InvokeFn = (objective: string, skill: string) => Promise<{ ok: boolean; output: string }>;
type PickFn = (goal: string, index: SkillIndexEntry[], limit: number) => Promise<string[] | null>;

export interface ComposeSkillDeps {
  /** ★ R2 프리셋(2026-07-22) — 고정 skill 세트(주어지면 luna 픽 우회·도메인 프리셋용). allowlist 필터는 여전히 적용. */
  skills?: readonly string[];
  /** skill 인덱스(테스트 우회·기본 getSkillIndex). */
  index?: readonly SkillIndexEntry[];
  /** luna 매칭 seam(테스트 우회·기본 pickSkillsViaLlm). null=실패·[]=관련없음. */
  pickSkills?: PickFn;
  /** skill 실행기(격리·기본 invokeResearch). */
  invoke?: InvokeFn;
  /** luna 상위 N(기본 8). */
  limit?: number;
  /** fan-out 동시성 캡(기본 3·skill 실행은 무거움 — 폭주 방지). */
  maxParallel?: number;
}

const observe = (event: string, data: Record<string, unknown>): void => {
  try { debug.log('harness.skill', event, data); } catch { /* fail-soft */ }
};
const errMsg = (e: unknown): string => String((e as { message?: string })?.message ?? e).slice(0, 120);
const defaultInvoke: InvokeFn = (obj, skill) => invokeResearch(obj, { skill }).then((r) => ({ ok: r.ok, output: r.output }));

/** 성공 산출들을 라벨 붙여 grounding 블록으로 합침(Executor 자식 프롬프트에 실을 형식·skill-select 동형). */
export function combineSkillOutputs(results: readonly HarnessSkillRunResult[]): string {
  return results
    .filter((r) => r.ok && r.output.trim())
    .map((r) => `[skill '${r.skill}' 실행 결과 — 참고·검증 후 사용]\n${r.output.trim().slice(0, 1500)}`)
    .join('\n\n');
}

/** 동시성 캡 병렬 실행 — Promise.all 을 배치로 나눠 maxParallel 초과 방지(skill 실행 폭주 차단·투자 preset 동형). */
async function runPooled<T, R>(items: readonly T[], cap: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += cap) {
    // eslint-disable-next-line no-await-in-loop -- 배치 간 순차(동시성 캡 목적)
    out.push(...await Promise.all(items.slice(i, i + cap).map(fn)));
  }
  return out;
}

/**
 * S7 — 멀티 스킬 fan-out. luna 픽 중 allowlist ∩ 를 병렬 격리 실행해 결과 배열 + 합친 grounding 을 낸다.
 * 단일 objective 가 여러 read-only skill 을 요할 때(투자=market+kr-flow+omni-digest). 개별 실패 fail-soft.
 * luna 무결과/실패/allowlist 밖 → null(호출측이 단일 selectHarnessSkill 로 폴백 — 무회귀).
 */
export async function fanOutHarnessSkills(
  objective: string,
  deps: ComposeSkillDeps = {},
): Promise<{ source: 'luna' | 'preset'; picked: string[]; results: HarnessSkillRunResult[]; combinedOutput: string } | null> {
  if (!objective.trim()) return null;
  const invoke = deps.invoke ?? defaultInvoke;

  let picked: string[] = [];
  let source: 'luna' | 'preset';
  if (deps.skills && deps.skills.length) {
    // ★ R2 프리셋 — 고정 skill 세트(luna 우회). index/pick 불필요·도메인 레시피용.
    picked = [...deps.skills];
    source = 'preset';
    observe('fanout-preset', { skills: picked.slice(0, 8) });
  } else {
    let index: SkillIndexEntry[];
    try { index = (deps.index ?? getSkillIndex()) as SkillIndexEntry[]; } catch { return null; }
    if (!index.length) return null;
    try {
      const pick = await (deps.pickSkills ?? pickSkillsViaLlm)(objective, index, deps.limit ?? 8);
      if (!pick || !pick.length) { observe('fanout-none', { reason: pick ? 'empty' : 'luna-null' }); return null; }
      picked = pick;
    } catch (e) { observe('fanout-pick-failed', { error: errMsg(e) }); return null; }
    source = 'luna';
  }

  const execSkills = picked.filter((n) => HARNESS_EXEC_ALLOWLIST.has(n));
  if (!execSkills.length) { observe('fanout-no-allowlist', { picked: picked.slice(0, 8) }); return null; }

  const cap = Math.max(1, deps.maxParallel ?? 3);
  const results = await runPooled(execSkills, cap, async (skill): Promise<HarnessSkillRunResult> => {
    try {
      const r = await invoke(objective, skill);
      return { skill, ok: r.ok && !!r.output.trim(), output: r.output };
    } catch (e) { observe('fanout-exec-failed', { skill, error: errMsg(e) }); return { skill, ok: false, output: '' }; }
  });
  observe('fanout', { picked: picked.slice(0, 8), executed: execSkills, ok: results.filter((r) => r.ok).length, cap });
  return { source, picked, results, combinedOutput: combineSkillOutputs(results) };
}

/**
 * S8 — 스킬 체이닝(순차 output→input). 각 스텝 입력 = objective(+스텝 hint) + 직전 산출(carry). 크롤→보고서·
 * 수집→점수→집행. 실패 시 체인 중단(fail-soft·부분 결과 반환). 비-allowlist 스텝은 스킵(관측). 격리 실행.
 */
export async function chainHarnessSkills(
  objective: string,
  steps: readonly HarnessSkillChainStep[],
  deps: ComposeSkillDeps = {},
): Promise<{ results: HarnessSkillRunResult[]; finalOutput: string }> {
  const invoke = deps.invoke ?? defaultInvoke;
  const results: HarnessSkillRunResult[] = [];
  let carry = '';
  for (const step of steps) {
    if (!HARNESS_EXEC_ALLOWLIST.has(step.skill)) { observe('chain-skip-allowlist', { skill: step.skill }); continue; }
    const hintBlock = step.hint ? `\n\n[스텝 지시] ${step.hint}` : '';
    const input = carry
      ? `${objective}${hintBlock}\n\n[이전 스텝 산출 — 입력으로 사용]\n${carry.slice(0, 2000)}`
      : `${objective}${hintBlock}`;
    try {
      // eslint-disable-next-line no-await-in-loop -- 체인은 본질적으로 순차(직전 산출이 다음 입력)
      const r = await invoke(input, step.skill);
      const ok = r.ok && !!r.output.trim();
      results.push({ skill: step.skill, ok, output: r.output });
      observe('chain-step', { skill: step.skill, ok, idx: results.length });
      if (!ok) { observe('chain-break', { skill: step.skill, at: results.length }); break; }   // fail-soft 중단
      carry = r.output;
    } catch (e) {
      results.push({ skill: step.skill, ok: false, output: '' });
      observe('chain-step-failed', { skill: step.skill, error: errMsg(e) });
      break;
    }
  }
  return { results, finalOutput: carry };
}
