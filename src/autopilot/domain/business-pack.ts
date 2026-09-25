// ── business 도메인팩 — D4 (업무 자동화·지식노동 substrate) ─────────────────
//
// 세 번째 실행 substrate: 리즈닝 + 리서치 + 문서 생성. 전략/마케팅/회계/연구/검증
// 등 여러 discipline 을 담되, executor/verifier/safety 는 동일 — 다른 건 expertise
// (persona·지식소스·어투) 뿐이다(§3.7 discipline 렌즈). 부작용 없음(read/write doc).
//
// research 는 도메인 아닌 횡단 능력(§3.5) — business 는 그 능력을 지식업무 결과물
// (리포트/분석/합성)로 실체화하는 도메인. executor=research-bridge/general 서브에이전트
// (승인→멀티페이즈 executor·umbrella §9 합류·현재 미배선). safetyGate 없음.
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §4.3.

import type { DomainPack } from './types.js';
import { llmJson, parseJsonLoose } from './research-util.js';
import { promotePhasesRespectingDeps } from './phase-exec.js';

/** 지식 업무가 외부조사로 이득 보는가(내부 데이터만 쓰는 정리/작성은 skip 가능). */
async function assessNeed(goal: string): Promise<{ needed: boolean; reason: string }> {
  const raw = await llmJson([
    'You decide whether a KNOWLEDGE-WORK task (report, analysis, strategy, market research, synthesis)',
    'would benefit from EXTERNAL web research (current facts, market/industry data, references, examples).',
    'Tasks over purely internal/given data (reformat, summarize a provided doc) usually do NOT. Tasks about',
    'markets, industries, competitors, "latest/current" facts, or producing a researched report usually DO.',
    '', `Task goal:\n${goal}`, '',
    'Respond with ONE JSON object, no fences: {"needed": <bool>, "reason": "<one line>"}',
  ].join('\n'));
  const j = parseJsonLoose(raw);
  return { needed: j?.needed === true, reason: typeof j?.reason === 'string' ? j.reason : '' };
}

/** 지식 업무 리서치 = 웹 검색·합성(research-bridge/omni-crawl·deep). 횡단 능력의 business 실체화. */
async function invoke(goal: string): Promise<{ ok: boolean; output: string }> {
  const { invokeResearch } = await import('../../research-bridge/index.js');
  const r = await invokeResearch(`${goal}\n\n(이 지식 업무의 결과물을 위한 조사: 관련 사실·시장/산업 데이터·참고 사례·근거. 분야 전문성 관점에서. 인용 포함)`, {});
  return { ok: r.ok, output: r.output };
}

export const BUSINESS_PACK: DomainPack = {
  domain: 'business',
  label: '업무(지식노동)',
  decompose: {
    // 코딩 아님(코딩 nudge 회피) — 지식 업무.
    goalKind: 'business',
    objectivePreamble: (goal: string) => `다음 지식 업무를 조사·분석해 결과물을 만든다: "${goal}"`,
    phaseShapeHint:
      '지식 업무는 [자료 수집·조사 → 분석 → 종합/작성 → 검토] 흐름의 페이즈로 나눈다. 전략/마케팅/'
      + '회계/연구 등 해당 분야의 전문성(persona) 관점을 반영하고, 결과물(리포트/문서)에는 근거·출처·'
      + '인용을 단다. 검증 가능한 acceptance 는 "출처가 달렸는가·주장에 근거가 있는가"로 둔다.',
    // discipline 렌즈(전략/마케팅/회계/연구/…)는 향후 persona 파라미터로 분화(§3.7·D5+).
  },
  research: { assessNeed, invoke },
  // 승인 후 — 페이즈 스테이징(부작용 없는 지식업무). 실행 phase-driver 는 umbrella §9.
  executor: async (missionId, ctx) => {
    const activated = promotePhasesRespectingDeps(ctx.store, missionId, ctx.now);
    return { ok: true, activated, note: `${activated} root 페이즈 ready (나머지 deps 대기)` };
  },
  // safetyGate 없음(부작용 없는 read/write doc).
};
