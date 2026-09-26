// ── 미션 자율 revise 추천(관측->판단 브릿지 · 대표 2026-07-14) ─────────────
//
// 근본(대표 요구): 미션 self-cognition 향상. 관측(OBSERVE)은 이미 최대치인데
// (working memory·reconcile·execution context·rerunHistory), 그 관측을 근거로
// "이 골을 어떻게 revise 할지"를 스스로 판단(DECIDE)해 정정 프롬프트(comment)를
// 자동 생성하는 다리가 없었다. 지금까지 revise comment 는 사람이 프리셋(5종) 또는
// 직접입력으로만 줬다. 이 모듈이 그 DECIDE 다리다.
//
// 흐름: gatherReviseObservation(디스크 관측 수집) -> heuristicReviseRecommendation
// (결정론 baseline·fallback) -> LLM 정련(classify DI) -> ReviseRecommendation.
// 자율 경계(대표 2026-07-14): 추천만 생성. 실제 트리거(spawnMissionPrepare)는
// 원탭 승인 게이트 뒤(P2 텔레그램 카드). 여기는 순수 판단·fail-soft.
//
// 패턴: mission-retry-triage.triageRetry 와 동형(결정론 휴리스틱 + LLM 정련 2겹·DI seam).

import { tierModel } from '../llm/model-defaults.js';
import { getMissionRevisions, buildMissionExecutionContext } from './mission-lifecycle.js';
import { readWorkingMemory, formatWorkingMemoryDigest } from './mission-working-memory.js';

/** revise 방향 — 기존 HITL 프리셋(mission-notify.HITL_REVISE_PRESETS)과 1:1 정렬 + custom.
 *  custom = 사람/맥락이 준 자유 지시(프리셋에 안 맞는 정정). 프리셋 정렬로 카드 표시·계보 일관. */
export type ReviseKind =
  | 'revise-smaller'   // 더 잘게(세분화)
  | 'revise-simpler'   // 간소화(과분해 통합)
  | 'revise-scope'     // 범위축소(부가 제외)
  | 'revise-reuse'     // 기존 재사용(신규 최소)
  | 'revise-research'  // 조사강화
  | 'revise-custom';   // 자유 정정

/** 각 방향의 기본 정정 지시(프리셋 comment 미러 · 순수·telegram deps 회피 위해 로컬 복제).
 *  mission-notify.HITL_REVISE_PRESETS 와 문구 동기화(변경 시 양쪽). */
const KIND_BASE: Record<ReviseKind, { label: string; base: string }> = {
  'revise-smaller': { label: '더 잘게', base: '각 페이즈를 더 세분화하라(더 잘게 분해).' },
  'revise-simpler': { label: '간소화', base: '핵심 페이즈로 통합하라(과분해를 간소화).' },
  'revise-scope': { label: '범위축소', base: '핵심 요구사항만 다루고 부가 기능은 제외하라(범위 축소).' },
  'revise-reuse': { label: '기존재사용', base: '기존 grounding 파일을 확장/재사용하고 신규 파일 생성을 최소화하라.' },
  'revise-research': { label: '조사강화', base: '외부조사와 기존 코드 조사를 더 깊게 하라.' },
  'revise-custom': { label: '직접정정', base: '' },
};

const REVISE_KINDS: readonly ReviseKind[] = [
  'revise-smaller', 'revise-simpler', 'revise-scope', 'revise-reuse', 'revise-research', 'revise-custom',
];
export function isReviseKind(v: string): v is ReviseKind { return (REVISE_KINDS as readonly string[]).includes(v); }
export function reviseKindLabel(k: ReviseKind): string { return KIND_BASE[k].label; }

/** 추천 결과 — 방향 + 재분해에 넘길 정정 지시(comment) + 신뢰도 + 근거. */
export interface ReviseRecommendation {
  shouldRevise: boolean;
  reviseKind: ReviseKind;
  /** spawnMissionPrepare 에 넘길 정정 지시(골 재분해 comment). shouldRevise=false 면 ''. */
  comment: string;
  confidence: 'high' | 'med' | 'low';
  rationale: string;
  source: 'llm' | 'heuristic';
}

/** 관측 패킷 — recommender 가 판단 근거로 읽는 미션 self-cognition(디스크). 테스트 DI seam. */
export interface ReviseObservation {
  goal?: string;
  currentGeneration: number;
  /** 이전 세대 골들(rerunHistory) — 이미 시도한 정정 방향 파악(같은 revise 반복 방지). */
  priorGoals: string[];
  /** formatWorkingMemoryDigest — 각 페이즈가 무엇을 조사/결정/재사용/산출했나. */
  workingMemoryDigest: string;
  /** buildMissionExecutionContext — 어떤 페이즈가 왜 실패했나(없으면 ''). */
  executionContext: string;
  /** reconcile self-perception 이 감지한 drift 건수(working memory 에서 집계). */
  driftCount: number;
  /** 텔레그램 맥락 메시지(사람이 준 정정 방향·자유서술). recommend 의 1차 동인. */
  userContext?: string;
}

// ── 결정론 baseline / fallback ──────────────────────────────────────────

/** userContext 자유서술 -> 프리셋 방향 키워드 매칭(순수·한글). 안 맞으면 revise-custom. */
function classifyKindFromText(text: string): ReviseKind {
  const t = text || '';
  if (/축소|제외|줄여|범위|빼|제거/.test(t)) return 'revise-scope';
  if (/간소|단순|통합|합쳐/.test(t)) return 'revise-simpler';
  if (/잘게|세분|나눠|쪼개|분할/.test(t)) return 'revise-smaller';
  if (/재사용|기존.*활용|기존.*확장/.test(t)) return 'revise-reuse';
  if (/조사|리서치|찾아|더 알아/.test(t)) return 'revise-research';
  return 'revise-custom';
}

/** 결정론 추천 — LLM 없이도 동작(baseline·fallback). fail-soft 로 항상 유효한 결과.
 *  우선순위: userContext(사람 의도) > executionContext(실패 페이즈) > 없음(추천 안 함). 순수함수. */
export function heuristicReviseRecommendation(obs: ReviseObservation): ReviseRecommendation {
  const uc = (obs.userContext ?? '').replace(/\s+/g, ' ').trim();
  if (uc) {
    const kind = classifyKindFromText(uc);
    // 사람이 준 실제 문구를 comment 로(현행 raw 동작 보존) — LLM 이 없을 때 정확히 오늘과 동일하게 degrade.
    return {
      shouldRevise: true, reviseKind: kind, comment: uc,
      confidence: kind === 'revise-custom' ? 'med' : 'high',
      rationale: `사용자 맥락 기반(${KIND_BASE[kind].label})`, source: 'heuristic',
    };
  }
  // 사람 맥락 없음 — 실패 페이즈가 있으면 범위축소를 기본 추천(하드 피처 제외).
  if (obs.executionContext.trim()) {
    return {
      shouldRevise: true, reviseKind: 'revise-scope', comment: KIND_BASE['revise-scope'].base,
      confidence: 'med',
      rationale: '자율 구현 실패 페이즈 존재 — 하드 피처 제외(범위축소) 추천', source: 'heuristic',
    };
  }
  // 정정 근거 없음 — 추천 안 함.
  return { shouldRevise: false, reviseKind: 'revise-custom', comment: '', confidence: 'low', rationale: '정정 근거 없음(실패 페이즈/사용자 맥락 모두 없음)', source: 'heuristic' };
}

// ── LLM 정련 ─────────────────────────────────────────────────────────────

/** revise 추천 프롬프트 — 관측 패킷 + baseline 을 주고 정확한 정정 지시를 확정시킨다.
 *  ASCII 구두점 + 한글만(en-dash 등 특수문자 truncation 방지·feedback_agent_prompt_ascii_only). */
export function buildRevisePrompt(obs: ReviseObservation, baseline: ReviseRecommendation): string {
  const L: string[] = [];
  L.push('자율 미션의 골(goal)을 어떻게 정정(revise)해 재분해할지 판단하라. revise 는 골을 재분해하며,');
  L.push('원본(gen 0)은 항상 보존되어 되돌릴 수 있다(비파괴). 목표는 "이 상황에서 골이 무엇을 바꿔야');
  L.push('구현 가능/의미 있게 되는가"를 정확한 한 줄 정정 지시로 만드는 것이다.');
  L.push('');
  if (obs.goal) L.push(`현재 골: ${obs.goal.slice(0, 300)}`);
  L.push(`세대: gen ${obs.currentGeneration}${obs.priorGoals.length ? ` (이전 정정 ${obs.priorGoals.length}회)` : ''}`);
  if (obs.priorGoals.length) {
    L.push('이전 세대 골(이미 시도한 방향 - 같은 정정 반복 금지):');
    for (const g of obs.priorGoals.slice(-3)) L.push(`- ${g.slice(0, 160)}`);
  }
  L.push('');
  if (obs.userContext && obs.userContext.trim()) {
    L.push('사용자(대표) 맥락 메시지 - 이것이 1차 정정 방향(최우선 반영):');
    L.push(obs.userContext.trim().slice(0, 800));
    L.push('');
  }
  if (obs.executionContext.trim()) {
    L.push('실행 상황(어떤 페이즈가 왜 실패했나):');
    L.push(obs.executionContext.trim().slice(0, 800));
    L.push('');
  }
  if (obs.driftCount > 0) L.push(`self-perception drift ${obs.driftCount}건 감지(기록 상태 vs 현실 불일치).`);
  if (obs.workingMemoryDigest.trim() && obs.workingMemoryDigest.length < 1200) {
    L.push('미션 워킹 메모리(지금까지 조사/결정/산출):');
    L.push(obs.workingMemoryDigest.trim().slice(0, 800));
    L.push('');
  }
  L.push(`baseline 추천(결정론): ${baseline.reviseKind}(${KIND_BASE[baseline.reviseKind].label}) - ${baseline.rationale}`);
  L.push('이 추천을 확인하거나, 관측이 다른 방향을 가리키면 override 하라.');
  L.push('');
  L.push('방향 선택지:');
  L.push('- revise-smaller: 더 잘게 세분화 | revise-simpler: 과분해 간소화 | revise-scope: 범위축소(부가 제외)');
  L.push('- revise-reuse: 기존 재사용 | revise-research: 조사강화 | revise-custom: 위에 안 맞는 자유 정정');
  L.push('');
  L.push('정확히 이 형식으로만 답하라(다른 말 금지):');
  L.push('REVISE: yes 또는 no (골 정정이 지금 필요한가)');
  L.push('KIND: <위 6개 방향 중 하나>');
  L.push('COMMENT: <재분해에 넘길 구체적 정정 지시 한 줄. 실패한 하드 피처가 있으면 명시 제외/단순화>');
  L.push('CONFIDENCE: high 또는 med 또는 low');
  L.push('WHY: <근거 1-2문장>');
  return L.join('\n');
}

/** LLM 응답 파서 — REVISE/KIND/COMMENT/CONFIDENCE/WHY 추출. 파싱 실패/무효는 fallback. 순수함수. */
export function parseReviseResponse(text: string, fallback: ReviseRecommendation): ReviseRecommendation {
  const t = text ?? '';
  const reviseM = t.match(/REVISE:\s*(yes|no|예|아니오)/i);
  const kindM = t.match(/KIND:\s*(revise-[a-z]+)/i);
  const commentM = t.match(/COMMENT:\s*(.+)/i);
  const confM = t.match(/CONFIDENCE:\s*(high|med|low)/i);
  const whyM = t.match(/WHY:\s*(.+)/i);

  const kindRaw = kindM?.[1]?.toLowerCase();
  const kind: ReviseKind = kindRaw && isReviseKind(kindRaw) ? kindRaw : fallback.reviseKind;
  const shouldRevise = reviseM ? /yes|예/i.test(reviseM[1]!) : fallback.shouldRevise;
  const commentRaw = commentM?.[1]?.trim();
  // comment 비면 방향 기본 지시로 폴백(revise-custom 은 fallback.comment 유지=사용자 맥락).
  const comment = commentRaw && !/^none$/i.test(commentRaw)
    ? commentRaw.slice(0, 600)
    : (KIND_BASE[kind].base || fallback.comment);
  const confidence = (confM?.[1]?.toLowerCase() as ReviseRecommendation['confidence']) ?? fallback.confidence;
  const rationale = whyM?.[1]?.trim().slice(0, 300) || fallback.rationale;

  return {
    shouldRevise,
    reviseKind: kind,
    comment: shouldRevise ? comment : '',
    confidence,
    rationale,
    source: 'llm',
  };
}

// ── 관측 수집(디스크) ─────────────────────────────────────────────────────

export interface GatherDeps {
  getRevisions?: typeof getMissionRevisions;
  readMemory?: typeof readWorkingMemory;
  execContext?: typeof buildMissionExecutionContext;
}

/** 미션 self-cognition 을 디스크에서 수집(순수 조회·READ-ONLY). reconcile 은 부작용(git fetch·
 *  self-write)이 있어 여기서 실행하지 않고, 이미 기록된 self-perception 엔트리에서 drift 를 집계한다.
 *  fail-soft — 조회 실패는 빈 값으로 degrade(추천을 막지 않음). */
export function gatherReviseObservation(
  missionId: string,
  opts: { userContext?: string } = {},
  deps: GatherDeps = {},
): ReviseObservation {
  const getRev = deps.getRevisions ?? getMissionRevisions;
  const readMem = deps.readMemory ?? readWorkingMemory;
  const execCtx = deps.execContext ?? buildMissionExecutionContext;

  let goal: string | undefined;
  let currentGeneration = 0;
  let priorGoals: string[] = [];
  try {
    const rev = getRev(missionId);
    if (rev) {
      goal = rev.currentGoal;
      currentGeneration = rev.currentGeneration;
      priorGoals = rev.history.map((h) => h.goal).filter((g): g is string => !!g && g.trim().length > 0);
    }
  } catch { /* fail-soft */ }

  let workingMemoryDigest = '';
  let driftCount = 0;
  try {
    const entries = readMem(missionId);
    workingMemoryDigest = formatWorkingMemoryDigest(entries);
    driftCount = entries.filter((e) => (e.provenance ?? 'self') === 'reconcile' && /DRIFT/.test(e.summary)).length;
  } catch { /* fail-soft */ }

  let executionContext = '';
  try { executionContext = execCtx(missionId); } catch { /* fail-soft */ }

  return {
    ...(goal ? { goal } : {}),
    currentGeneration,
    priorGoals,
    workingMemoryDigest,
    executionContext,
    driftCount,
    ...(opts.userContext ? { userContext: opts.userContext } : {}),
  };
}

// ── 오케스트레이터 ─────────────────────────────────────────────────────────

export interface RecommendReviseDeps {
  /** LLM classify(프롬프트->텍스트). 미주입 시 결정론 휴리스틱만(테스트/오프라인). */
  classify?: (prompt: string) => Promise<string>;
  gather?: GatherDeps;
  /** 관측 패킷 직접 주입(테스트) — 주어지면 gatherReviseObservation 스킵. */
  observation?: ReviseObservation;
}

/** 미션 자율 revise 추천 — 관측 수집 -> 결정론 baseline -> (LLM 정련) -> ReviseRecommendation.
 *  어떤 경우에도 유효한 추천 반환(fail-soft). 실제 트리거는 호출측(원탭 승인 게이트). */
export async function recommendRevise(
  missionId: string,
  opts: { userContext?: string } = {},
  deps: RecommendReviseDeps = {},
): Promise<{ recommendation: ReviseRecommendation; observation: ReviseObservation }> {
  const observation = deps.observation
    ?? gatherReviseObservation(missionId, opts.userContext ? { userContext: opts.userContext } : {}, deps.gather ?? {});
  const baseline = heuristicReviseRecommendation(observation);
  if (!deps.classify) return { recommendation: baseline, observation };
  try {
    const raw = await deps.classify(buildRevisePrompt(observation, baseline));
    return { recommendation: parseReviseResponse(raw, baseline), observation };
  } catch {
    return { recommendation: baseline, observation };
  }
}

/** 프로덕션 LLM classify(대표 2026-07-14) — 분해/triage 와 동일 sol 리즈닝. 테스트에선 미사용(DI).
 *  ELANOUS_REVISE_RECOMMEND_MODEL > ELANOUS_DECOMPOSE_MODEL > gpt-5.6-sol. */
export async function reviseClassifyDefault(prompt: string): Promise<string> {
  const { streamLLM, resolveDefaultProvider } = await import('../llm.js');
  const model = process.env.ELANOUS_REVISE_RECOMMEND_MODEL || process.env.ELANOUS_DECOMPOSE_MODEL || tierModel('better');
  const provider = resolveDefaultProvider(model);
  return streamLLM([{ role: 'user', content: prompt }], () => {}, { model, reasoningEffort: 'medium', ...(provider ? { provider } : {}) });
}
