// 미션 빌드 파이프라인 — 재실행 (P4·rerun·프롬프트/모델 튜닝 실험)
//
// ★ 관측성+자기인지의 실험 팔: rewind/goto(P3)가 "상태 되감기"라면, rerun 은 저장된 그 단계의 LLM
//   입력(critique/clarify sidecar 프롬프트 원문)을 꺼내 **모델·effort·추가지시를 바꿔 다시 LLM 을 돌린다**.
//   "이 프롬프트를 sol 대신 terra 로 돌리면?"·"이 지시를 덧붙이면 오탐이 사라지나?"를 데이터로 본다.
//   저널을 오염시키지 않는다(실험) — 새 프레임을 append 하지 않고 old vs new 만 비교 반환. debug.log 로 관측.
// planRerun 은 순수(저장 프롬프트 + 튜닝 인자 → 실행 계획). LLM 호출(runRerunLlm)만 부수효과(lazy import).
import { lookupLlmTierSpec } from '../../model-tier/index.js'; // 순수 표 조회(config 안 읽음) — planRerun 의 순수성 유지

/** 저장 프롬프트 + 튜닝 인자 → 실행 계획. append 는 프롬프트 끝에 지시를 덧붙인다(프롬프트 보강 실험). */
export interface RerunPlan {
  prompt: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  appended: boolean;
}

/** effort 문자열 정규화(허용값 밖은 medium). */
export function normalizeEffort(effort?: string): 'low' | 'medium' | 'high' {
  return effort === 'low' || effort === 'high' ? effort : 'medium';
}

/** 저장 프롬프트 + 튜닝 인자 → RerunPlan(순수). model 미지정이면 저장 모델, 그것도 없으면 terra.
 *  append 지정 시 프롬프트 끝에 "## 추가 지시(rerun 튜닝)" 섹션으로 덧붙인다((b) 프롬프트 보강 실험). */
export function planRerun(
  saved: { prompt: string; model?: string },
  opts: { model?: string; effort?: string; append?: string } = {},
): RerunPlan {
  const model = (opts.model || saved.model || lookupLlmTierSpec('openai-codex', 'balanced').model).trim();
  const append = (opts.append || '').trim();
  const prompt = append ? `${saved.prompt}\n\n## 추가 지시(rerun 튜닝)\n${append}` : saved.prompt;
  return { prompt, model, effort: normalizeEffort(opts.effort), appended: !!append };
}

/** 실행 계획으로 LLM 재호출(부수효과·lazy import). defaultJudge 와 동일 패턴(provider 명시). */
export async function runRerunLlm(plan: RerunPlan): Promise<string> {
  const { streamLLM, resolveDefaultProvider } = await import('../../llm.js');
  const provider = resolveDefaultProvider(plan.model);
  return streamLLM([{ role: 'user', content: plan.prompt }], () => {}, {
    model: plan.model, reasoningEffort: plan.effort, ...(provider ? { provider } : {}),
  });
}
