// ── Autopilot Triage 라우터 (2026-07-08 · P1.1) ───────────────────────────
//
// 빠진 오케스트레이션 층(RESEARCH-autopilot §11). intake categorize(task 종류 7종)
// 위에 **실행모델 축**을 신설한다: "이 골을 어떤 실행 모델로 풀지"를 상황에 따라
// 라우팅. 실행조각(TOX·dig-goal-armer·cron·monitor·fanout·delegate)은 다 있고, 빠진
// 것은 "골 → 실행모델 분류 → 엔진 배선" 뿐이다.
//
// 8 실행모델(RESEARCH §2 팔레트):
//   task           유한·완료조건        → TOX task graph
//   goal-loop      달성/충분까지 반복    → dig-goal-armer·continuation
//   scheduler      주기·상시           → schedule_manage
//   monitor-trigger 이벤트("~되면")     → monitor + 조건 게이트
//   hybrid         조합·전환           → 파이프라인(스케줄러가 loop 기동 등)
//   fanout         다관점 동시          → multi-agent
//   single-shot    즉답               → LLM 직답
//   hitl-delegate  승인 게이트          → verify + HITL
//
// 설계(PLAN §A·categorize.ts 패턴): 결정론 휴리스틱 baseline(항상) + 주입 LLM refine
// (선택·soft). ratchet-up only — 가벼움→무거움 방향만 조정(무한 확대 방지). 순수 모듈.

import { detectDomain } from './domain/detect.js';
import type { Domain } from './domain/types.js';
import { budgetModel } from '../llm/model-defaults.js';

// ──────────────────── Closed sets ──────────────────────────────────────

export const EXECUTION_MODELS = [
  'task', 'goal-loop', 'scheduler', 'monitor-trigger',
  'hybrid', 'fanout', 'single-shot', 'hitl-delegate',
  // coordinator(2026-07-10 · PLAN-trade-coordinator-mission): fanout(발산)의 역 —
  // 여러 하위 에이전트/계약의 의도를 blackboard 로 모아 조망·밸런싱·통합 판정(fan-in).
  // 매매 포트폴리오 오케스트레이터가 첫 인스턴스. 실 배선은 후속(C3)·C0 은 팔레트 등록.
  'coordinator',
] as const;
export type ExecutionModel = (typeof EXECUTION_MODELS)[number];

export function isExecutionModel(v: unknown): v is ExecutionModel {
  return typeof v === 'string' && (EXECUTION_MODELS as readonly string[]).includes(v);
}

/** 작업 규모 tier — ultrawork 차용(P1.2). 규모가 process 를 사이징한다. ratchet-up only. */
export type Tier = 'light' | 'heavy';

/** 실행모델 → 배선 엔진(기존 자산·신규 금지·PLAN §A2). */
export const ENGINE_BY_MODEL: Record<ExecutionModel, string> = {
  task: 'tox',
  'goal-loop': 'dig-goal-armer',
  scheduler: 'schedule_manage',
  'monitor-trigger': 'monitor',
  hybrid: 'pipeline',
  fanout: 'multi-agent',
  'single-shot': 'llm-direct',
  'hitl-delegate': 'verify-hitl',
  coordinator: 'orchestrator',
};

export interface TriageInput {
  /** 사용자가 던진 골(원문). */
  goal: string;
  /** intake categorize 결과(있으면 tier/모델 힌트로 활용·선택). */
  category?: string;
}

export interface TriageResult {
  executionModel: ExecutionModel;
  tier: Tier;
  /** 도메인(WHAT 축·coding/investment/research/general) — HOW 축과 직교. D1. */
  domain: Domain;
  /** 배선 대상 엔진(ENGINE_BY_MODEL). */
  engine: string;
  /** 왜 이 모델인가(comprehension-debt·회상). */
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  /** LLM refine 이 baseline 을 바꿨나(관측용). */
  refined: boolean;
}

// ──────────────────── 휴리스틱 baseline (결정론·항상) ────────────────────

interface Signal { model: ExecutionModel; rationale: string }

/** 키워드 규칙 — 첫 매치 우선순위(monitor > scheduler > goal-loop > fanout > hitl >
 *  single-shot > task). 조합 신호(2+)면 hybrid 로 승격. 순수함수(테스트 용이). */
function detectSignals(goal: string): Signal[] {
  const g = goal.toLowerCase();
  const has = (...ws: string[]): boolean => ws.some(w => g.includes(w));
  const sig: Signal[] = [];
  // 이벤트 조건 트리거 — "~되면/~하면/급락/if/when" + 감시 성격.
  if (/되면|하면|넘으면|이하로|돌파|급락|급등|\bif\b|\bwhen\b/.test(g))
    sig.push({ model: 'monitor-trigger', rationale: '조건 이벤트("~되면") — 감시 후 조건 충족 시 발화' });
  // 주기·상시.
  if (has('매일', '매주', '매시', '매월', '주기', '정기', '아침마다', '밤마다', 'daily', 'every ', 'each day', 'weekly'))
    sig.push({ model: 'scheduler', rationale: '주기·상시 — 스케줄러로 정기 실행' });
  // 달성/충분까지 반복.
  if (has('끝까지', '충분히', '파봐', '파헤', '완성될 때까지', '될 때까지', 'deep', 'until ', 'thoroughly', '깊게'))
    sig.push({ model: 'goal-loop', rationale: '달성/충분까지 반복 — goal-loop(continuation)' });
  // 다관점 동시.
  if (has('관점', '여러 의견', '다양한 의견', '패널', 'panel', 'consensus', 'n명', '여러 전문가'))
    sig.push({ model: 'fanout', rationale: '다관점 동시 평가 — 병렬 fanout' });
  // 수렴·조율·밸런싱(fan-in) — 여럿을 모아 전체 조망·통합 판정. fanout(발산)의 역.
  if (has('조율', '밸런싱', '리밸런', '오케스트레이', '포트폴리오', '통합 관리', '전체를 조망', '종합 조율', 'orchestrate', 'coordinate', 'balance'))
    sig.push({ model: 'coordinator', rationale: '여럿을 조율·밸런싱(fan-in) — coordinator 오케스트레이터' });
  // 승인 게이트.
  if (has('승인받고', '확인받고', '허락', '검토받고', 'approve', 'confirm first', '물어보고'))
    sig.push({ model: 'hitl-delegate', rationale: '승인 게이트 — verify + HITL' });
  return sig;
}

/** 즉답성(single-shot) — 짧은 질문형. */
function looksSingleShot(goal: string): boolean {
  const g = goal.trim();
  if (g.length > 60) return false;
  return /(뭐야|무엇|어디|누구|왜|언제|얼마|\bwhat\b|\bwho\b|\bwhere\b|\bhow much\b)\??$/.test(g)
    || (g.endsWith('?') && g.length <= 40);
}

/** tier 휴리스틱 — 규모 신호(대대적/전체/리팩토링/마이그레이션/장문/다문장)면 heavy. */
export function detectTier(goal: string): Tier {
  const g = goal.toLowerCase();
  const heavyKw = ['대대적', '전면', '전체', '리팩토링', '마이그레이션', 'refactor', 'migrat', 'architecture', '아키텍처', '재설계', '대규모'];
  if (heavyKw.some(w => g.includes(w))) return 'heavy';
  if (goal.length > 240) return 'heavy';
  const sentences = goal.split(/[.!?。\n]/).filter(s => s.trim().length > 8).length;
  if (sentences >= 4) return 'heavy';
  return 'light';
}

/** 결정론 baseline 분류 — LLM 없이도 항상 동작(fallback·검증 seam). */
export function heuristicTriage(input: TriageInput): TriageResult {
  const goal = input.goal.trim();
  const signals = detectSignals(goal);
  let model: ExecutionModel;
  let rationale: string;
  let confidence: TriageResult['confidence'];

  if (signals.length >= 2) {
    model = 'hybrid';
    rationale = `복합 신호(${signals.map(s => s.model).join('+')}) — 하이브리드 체인`;
    confidence = 'medium';
  } else if (signals.length === 1) {
    model = signals[0]!.model;
    rationale = signals[0]!.rationale;
    confidence = 'high';
  } else if (looksSingleShot(goal)) {
    model = 'single-shot';
    rationale = '짧은 질문형 — LLM 즉답';
    confidence = 'medium';
  } else {
    model = 'task';
    rationale = '유한·완료조건 작업 — TOX task 분해(기본)';
    confidence = 'medium';
  }

  return {
    executionModel: model,
    tier: detectTier(goal),
    domain: detectDomain(goal),
    engine: ENGINE_BY_MODEL[model],
    rationale,
    confidence,
    refined: false,
  };
}

// ──────────────────── LLM refine (선택·주입·ratchet-up only) ─────────────

/** 주입 LLM 분류기 — 없으면 heuristic baseline 그대로. categorize.ts CategorizeCallable 패턴. */
export type TriageCallable = (prompt: string) => Promise<string>;

/** 실행모델 무게 순위(ratchet 방향 판정) — 낮을수록 가벼움. LLM 은 승격만 허용. */
const MODEL_WEIGHT: Record<ExecutionModel, number> = {
  'single-shot': 0, task: 1, fanout: 2, 'monitor-trigger': 3,
  scheduler: 3, 'goal-loop': 4, 'hitl-delegate': 4, hybrid: 5,
  // coordinator = 가장 무거움(여럿을 fan-in 조율·전체 리스크 조망). ratchet-up 최상위.
  coordinator: 6,
};

export function buildTriagePrompt(input: TriageInput, baseline: TriageResult): string {
  return [
    'You are the Autopilot triage router. Classify how to EXECUTE a user goal.',
    `Execution models: ${EXECUTION_MODELS.join(', ')}.`,
    'task=finite. goal-loop=repeat until enough. scheduler=periodic. monitor-trigger=on-event.',
    'hybrid=combination/chain. fanout=parallel multi-view. single-shot=instant answer. hitl-delegate=needs approval.',
    'coordinator=fan-in: gather many sub-agents/contracts, balance & decide as a whole (opposite of fanout).',
    `Goal: ${input.goal}`,
    input.category ? `Task category(intake): ${input.category}` : '',
    `Heuristic baseline: ${baseline.executionModel} (tier=${baseline.tier}).`,
    'Only escalate to a HEAVIER execution model if clearly warranted (ratchet-up only).',
    // ★ tier 는 규모 판정(2026-07-16) — 키워드가 아니라 실제 의미적 범위로 본다.
    'tier=heavy if the goal implies re-architecture, multiple subsystems/concerns, or ambiguous LARGE scope',
    'that needs multiphase decomposition; tier=light if a single focused change.',
    'Do NOT rely on keywords — judge by ACTUAL scope. Words like "강화/개선/추가/enhance/improve" can be huge',
    'or tiny; decide by semantic breadth. When a goal reshapes a whole loop/system into a new structure, it is heavy.',
    'Reply JSON: {"executionModel":"<model>","tier":"light|heavy","rationale":"<why, 1 line>"}',
  ].filter(Boolean).join('\n');
}

/** LLM 응답 파싱 — 순수함수(inline ternary 금지·LLM node 규칙). 실패=null. */
export function parseTriageResponse(raw: string): { executionModel: ExecutionModel; tier: Tier; rationale: string } | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    if (!isExecutionModel(j.executionModel)) return null;
    const tier: Tier = j.tier === 'heavy' ? 'heavy' : 'light';
    const rationale = typeof j.rationale === 'string' ? j.rationale : '';
    return { executionModel: j.executionModel, tier, rationale };
  } catch {
    return null;
  }
}

/** 완전 triage — heuristic baseline + 선택 LLM refine. refine 실패=baseline.
 *  ★ tier 는 luna 주도(2026-07-16 대표 지시) — 규모(tier)와 형태(executionModel)는 직교라 tier 승격을
 *  executionModel 승격에 종속시키지 않는다(종전 버그: "강화" 같은 키워드-빈약·의미-풍부 골이 executionModel
 *  =task 유지 → tier 도 light 로 조기 return). 이제 tier 는 LLM 이 독립 판정하고 휴리스틱 heavy 를 floor 로
 *  (ratchet-up: LLM 은 light→heavy 승격만·명백히 큰 골의 축소 오판 방지). executionModel 은 기존대로 승격만. */
export async function triageGoal(
  input: TriageInput,
  deps: { classify?: TriageCallable } = {},
): Promise<TriageResult> {
  const baseline = heuristicTriage(input);
  if (!deps.classify) return baseline;
  let parsed: ReturnType<typeof parseTriageResponse> = null;
  try {
    parsed = parseTriageResponse(await deps.classify(buildTriagePrompt(input, baseline)));
  } catch {
    return baseline;
  }
  if (!parsed) return baseline;
  // tier — LLM 주도 + 휴리스틱 heavy floor(ratchet-up·executionModel 과 독립).
  const tier: Tier = parsed.tier === 'heavy' || baseline.tier === 'heavy' ? 'heavy' : 'light';
  // executionModel — ratchet-up only(무한 확대 방지): 더 무거운 모델 제안만 승격.
  const escalateModel = MODEL_WEIGHT[parsed.executionModel] > MODEL_WEIGHT[baseline.executionModel];
  const executionModel = escalateModel ? parsed.executionModel : baseline.executionModel;
  const refined = escalateModel || tier !== baseline.tier;
  if (!refined) return baseline;
  return {
    executionModel,
    tier,
    domain: baseline.domain,   // 도메인(WHAT)은 실행모델/tier refine 과 무관 — baseline 유지.
    engine: ENGINE_BY_MODEL[executionModel],
    rationale: parsed.rationale || `LLM refine: model=${executionModel}·tier=${tier}`,
    confidence: 'medium',
    refined: true,
  };
}

// ★ 판단 모델 = luna(경량·고속·대표 지시 2026-07-16) — tier/실행모델 분류처럼 "동적 상황을 섬세히 보는"
//   판단은 빠른 LLM 에(휴리스틱은 fail-soft floor). [[feedback_mission_fabric_llm_logic_balance_2026_07_16]].
const TRIAGE_JUDGE_MODEL = () => process.env.ELANOUS_TRIAGE_MODEL || budgetModel();
/** 기본 triage 분류기(luna). NODE_ENV=test 는 호출측이 주입 안 함(seam) — 실 LLM 호출 방지. */
export async function defaultTriageClassify(prompt: string): Promise<string> {
  const { streamLLM } = await import('../llm.js');
  return streamLLM([{ role: 'user', content: prompt }], () => {}, {
    model: TRIAGE_JUDGE_MODEL(),
    reasoningEffort: 'low', // 경량 분류 — 무거운 추론 불필요(luna 속도 살림)
  });
}
