// ── coding 도메인팩 — D2 (기존 자산 흡수·회귀0) ────────────────────────────
//
// 지금까지 미션 fabric 의 유일한(하드코딩된) 도메인. mission-engine 분해의
// goalKind:'coding' + "…구현한다" 프리앰블, research-gate 의 assessNeed/invoke
// (omni-crawl) 기본값을 이 팩으로 이관한다. **문자열·동작 그대로**(회귀0 리트머스).
//
// executor = monad-self 격리 worktree(승인→멀티페이즈 executor·umbrella §9)와 D2/D3 합류
// 예정. verifier=build/test·safetyGate=HITL PR 은 그 배선에서 채워짐(현재 미배선).
//
// 설계: 내부 문서 `PLAN-domain-pack-registry-2026-07-11` §4.1.

import type { DomainPack } from './types.js';
import { llmJson, parseJsonLoose } from './research-util.js';
import { promotePhasesRespectingDeps } from './phase-exec.js';
import { budgetModel } from '../../llm/model-defaults.js';

/** 코딩 미션의 외부조사 필요 판단 — ★ luna 주도(대표 2026-07-16). "외부 웹조사가 이 골 계획을 실제로
 *  풍부하게 하나"는 동적·섬세 판단이라 활성 provider의 budget tier(effort low·경량 고속)로. 무거운 모델은 불필요.
 *  [[feedback_mission_fabric_llm_logic_balance_2026_07_16]]. 기존 monad 자산 확장 같은 내부 구현 골은
 *  needed=false 로 걸러 딥리서치 낭비를 막는다(heavy 여도 판단은 이 함수·research-gate force 우회 제거). */
async function assessNeed(goal: string): Promise<{ needed: boolean; reason: string }> {
  const raw = await llmJson([
    'You decide whether a coding mission for the **monad** codebase needs EXTERNAL web research before planning.',
    'CONTEXT: monad is a large, mature agent codebase that ALREADY integrates most common external services',
    '(content digest, YouTube, X/Twitter, web crawl, Obsidian, market data, LLM providers, storage, etc.).',
    'So a goal merely MENTIONING such a service is NOT a reason to research — the integration very likely already',
    'exists internally and grounding (codebase search) will surface it.',
    '',
    'Default to needed=FALSE. Only answer needed=TRUE when the plan genuinely depends on a VOLATILE or NOVEL',
    'external fact that cannot be determined from the existing codebase — e.g. a brand-new third-party API/library',
    'monad has never used, current pricing/rates, a "latest/current" claim, or an unfamiliar external protocol.',
    'Building/extending features with capabilities monad likely already has → needed=FALSE.',
    '', `Mission goal:\n${goal}`, '',
    'Respond with ONE JSON object, no fences: {"needed": <bool>, "reason": "<one line>"}',
  ].join('\n'), { model: process.env.MONAD_RESEARCH_NEED_MODEL || budgetModel(), effort: 'low' });
  const j = parseJsonLoose(raw);
  return { needed: j?.needed === true, reason: typeof j?.reason === 'string' ? j.reason : '' };
}

/** 코딩 미션의 외부조사 소스 = omni-crawl(research-bridge). 기존 defaultInvoke 이관·문자열 동일. */
async function invoke(goal: string): Promise<{ ok: boolean; output: string }> {
  const { invokeResearch } = await import('../../research-bridge/index.js');
  const r = await invokeResearch(`${goal}\n\n(이 목표의 계획을 풍부하게 할 외부 정보를 조사: 최신 사실 확인, 더 나은 접근/도구, 놓친 제약, 참고 사례. 인용 포함)`, {});
  return { ok: r.ok, output: r.output };
}

export const CODING_PACK: DomainPack = {
  domain: 'coding',
  label: '코딩',
  decompose: {
    goalKind: 'coding',
    // ★ 회귀0 — mission-engine.ts 기존 첫 줄 문자열 그대로.
    objectivePreamble: (goal: string) => `monad 에 다음 미션을 구현한다: "${goal}"`,
    // 기존 mission-engine tail(코딩 가이드) 이관 — 파일/재사용/불변코어(내용 보존).
    phaseShapeHint: '각 태스크 description 에 건드릴 파일과 재사용할 기존 함수를 명시한다. 새 엔진/직렬화기 금지·재사용 우선. 매매/arming/safety/재부팅 등 불변 코어는 건드리지 않는다.',
  },
  research: { assessNeed, invoke },
  // 승인 후 — 페이즈를 dependsOn 존중으로 스테이징(root ready·나머지 blocked). 실제 실행은
  // monad-self 격리 worktree phase-driver(umbrella §9·arming 게이트)가 이어받음.
  executor: async (missionId, ctx) => {
    const activated = promotePhasesRespectingDeps(ctx.store, missionId, ctx.now);
    return { ok: true, activated, note: `${activated} root 페이즈 ready (나머지 deps 대기)` };
  },
};
