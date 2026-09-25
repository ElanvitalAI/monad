// 하니스 Planner adversarial 레드팀 (H2 · 2026-07-21)
//
// DESIGN §14b/§14f H2("adversarial 크리틱 옵션·prometheus/hyperplan·1 self→N 적대"). 계획을 **실행 전에**
// 적대적 크리틱(red-team)이 공격해 결함(누락 스텝·순서 오류·숨은 위험 가정·미처리 엣지케이스·과/미분해)을
// 찾아 미리 보강한다. 실패로 배우기(replan) 전에 계획 단계에서 잡는 품질 부스터.
//
// ★ 트리거(대표 지시 2026-07-21): (1) 명시 요청(red_team 파라미터·objective 키워드) OR (2) LLM 자율 판단 —
//   ①툴 호출 에이전트 LLM 이 복잡도 보고 red_team 설정(진짜 LLM 판단) ②복잡 계획(스텝≥임계) 자동 발동 +
//   ③크리틱 LLM 스스로 sound(건전) 판정 시 무변경(과잉 수정 금지). 비용=구독/로컬 LLM(대표 확인).
//
// ★ fail-soft: 파싱 실패·크리틱 오류·건전 판정 = null(상위가 원 계획 유지·무회귀).

/** 크리틱 LLM 호출(streamLLM 등) — 호출측 주입. prompt → 텍스트(JSON 기대). */
export type PlanCritic = (prompt: string) => Promise<string>;

export interface AdversarialVerdict {
  /** 계획이 건전한가(수정 불요). */
  sound: boolean;
  /** 발견된 결함(관측/PR 메모용). */
  issues: string[];
  /** 보강된 전체 스텝 목록(sound=false 일 때만·아니면 []). */
  revisedSteps: string[];
}

export interface AdversarialCritiqueResult {
  revisedSteps: string[];
  issues: string[];
  /** 축별 발견. scope는 요구하지 않은 산출물·통합·권한·운영 변경만 담는다. */
  byAxis: { scope: string[] };
}

const SCOPE_ISSUE_PREFIX = '[scope]';
const scopeIssues = (issues: readonly string[]): string[] => issues.filter((issue) => issue.toLowerCase().startsWith(SCOPE_ISSUE_PREFIX));

const CRITIC_PROMPT = (objective: string, steps: readonly string[], context?: string): string =>
  'You are an ADVERSARIAL planning red-team. Attack the plan below for flaws BEFORE it executes:\n'
  + '- missing steps, wrong ordering / dependencies\n'
  + '- unstated risky assumptions, unhandled edge cases / failure modes\n'
  + '- over- or under-decomposition\n'
  + '- scope: required work must not expand into unrequested deliverables, features, integrations, permissions, or operational changes. Prefix every such finding with [scope]. Do not flag an explicitly required dependency, the minimum safety measure, or implementation detail needed to satisfy the objective.\n'
  + 'Be honest: if the plan is genuinely sound, say so — do NOT invent issues.\n'
  + 'Return ONLY compact JSON (no prose, no code fence):\n'
  + '{"sound": boolean, "issues": string[], "revisedSteps": string[]}\n'
  + 'revisedSteps = the improved FULL step list (imperative, concise) ONLY when sound=false; else [].\n\n'
  + `Objective:\n${objective.slice(0, 1200)}\n\n`
  + `Plan steps:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
  + (context ? `\nContext (grounding — reuse, don't re-research):\n${context.slice(0, 1500)}\n` : '');

/** 텍스트에서 첫 JSON 오브젝트를 관대하게 추출·파싱(코드펜스/서론 허용). 실패=null. */
export function parseAdversarialVerdict(text: string): AdversarialVerdict | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<AdversarialVerdict>;
    const issues = Array.isArray(raw.issues) ? raw.issues.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
    const revisedSteps = Array.isArray(raw.revisedSteps) ? raw.revisedSteps.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
    return { sound: raw.sound === true, issues, revisedSteps };
  } catch {
    return null;
  }
}

/**
 * 계획을 적대적으로 검토해 보강된 스텝을 반환(건전/실패 시 null → 원 계획 유지).
 * @param critic LLM 호출(주입·테스트=fake). @param context Planner grounding(재조사 없이 검토).
 * @returns { revisedSteps, issues } — revisedSteps 있으면 상위가 교체. null=무변경.
 */
export async function adversarialPlanCritique(
  objective: string,
  steps: readonly string[],
  critic: PlanCritic,
  context?: string,
): Promise<AdversarialCritiqueResult | null> {
  if (!steps.length) return null;
  try {
    const raw = await critic(CRITIC_PROMPT(objective, steps, context));
    const verdict = parseAdversarialVerdict(raw);
    if (!verdict) return null;                               // 파싱 실패 → 원 계획 유지
    const byAxis = { scope: scopeIssues(verdict.issues) };
    if (verdict.sound || verdict.revisedSteps.length === 0) {
      return verdict.issues.length ? { revisedSteps: [], issues: verdict.issues, byAxis } : null; // 건전(또는 보강 없음)
    }
    return { revisedSteps: verdict.revisedSteps, issues: verdict.issues, byAxis };
  } catch {
    return null; // fail-soft
  }
}

// ── N-크리틱 다각도 점검(multi-angle · HITL 대상 · 2026-07-21 대표 지시) ─────────────────────────
//
// 단일 크리틱(위)의 확장 — 계획을 **N개 렌즈**로 병렬 공격(다양성>중복·hyperplan). 각 렌즈는 한 관점만
// 파고든다(정확성·완전성·순서·위험). 종합해 이슈 union + 수정안 synthesize. 적용은 **HITL**(호출측이
// ux 로 승인) — 이 함수는 발견/수정안만 산출(자동적용 안 함). "플랜 다각도 점검·리뷰" 형태.

/** 기본 렌즈 — 각자 한 관점만 공격(중복 최소·다양성 최대). */
export const DEFAULT_CRITIC_LENSES = ['correctness', 'completeness', 'ordering', 'risk', 'scope'] as const;
const LENS_FOCUS: Record<string, string> = {
  correctness: '논리 오류·잘못된 접근·틀린 기술 가정',
  completeness: '누락된 필수 스텝·빠진 전제/사전작업',
  ordering: '스텝 순서·의존성 오류(먼저 해야 할 게 뒤에)',
  risk: '위험한 가정·미처리 엣지케이스·실패 모드·되돌리기 어려운 작업',
  scope: '명시 요구를 넘는 산출물·기능·통합·권한·운영 변경. 명시 요구의 필수 의존성·최소 안전 조치·요구 충족 세부화는 허용',
};

export interface LensFinding { lens: string; issues: string[]; }
export interface MultiAngleResult {
  /** 종합 수정안(전 렌즈 이슈 반영·비면 []). */
  revisedSteps: string[];
  /** 렌즈 태그 붙은 전체 이슈(`[lens] issue`). */
  issues: string[];
  /** 렌즈별 발견(관측/표면화용). */
  byLens: LensFinding[];
}

const lensPrompt = (lens: string, objective: string, steps: readonly string[], context?: string): string =>
  `You are ONE reviewer on an adversarial plan panel. Your lens: **${lens}** — focus ONLY on: ${LENS_FOCUS[lens] ?? lens}.\n`
  + 'Attack the plan below THROUGH YOUR LENS ONLY (ignore other angles — teammates cover them). Be honest; if sound on your lens, return empty issues.\n'
  + 'Return ONLY compact JSON (no prose/fence): {"issues": string[]}\n\n'
  + `Objective:\n${objective.slice(0, 1000)}\n\nPlan steps:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
  + (context ? `\nContext:\n${context.slice(0, 1200)}\n` : '');

const synthPrompt = (objective: string, steps: readonly string[], issues: readonly string[], context?: string): string =>
  'A multi-lens red-team panel found the issues below in this plan. Produce an IMPROVED full plan that resolves them.\n'
  + 'Return ONLY compact JSON: {"revisedSteps": string[]} (imperative, concise). If the issues do not warrant changing the steps, return {"revisedSteps": []}.\n\n'
  + `Objective:\n${objective.slice(0, 1000)}\n\nCurrent plan:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`
  + `Panel issues:\n${issues.slice(0, 20).map((i) => `- ${i}`).join('\n')}\n`
  + (context ? `\nContext:\n${context.slice(0, 800)}\n` : '');

/** {issues:[]} 만 있는 렌즈 응답 파싱. */
function parseLensIssues(text: string): string[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as { issues?: unknown };
    return Array.isArray(raw.issues) ? raw.issues.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * 다각도 N-크리틱 — N개 렌즈 병렬 공격 → 이슈 종합 + 수정안 synthesize. 전 렌즈 건전 시 null.
 * **자동 적용 안 함** — 호출측이 HITL(ux)로 승인 판단(대표 지시). critic 주입(테스트=fake).
 */
export async function multiAngleCritique(
  objective: string,
  steps: readonly string[],
  critic: PlanCritic,
  opts?: { lenses?: readonly string[]; context?: string },
): Promise<MultiAngleResult | null> {
  if (!steps.length) return null;
  const lenses = opts?.lenses ?? DEFAULT_CRITIC_LENSES;
  // 렌즈별 병렬 공격(각자 독립·fail-soft).
  const byLensRaw = await Promise.all(lenses.map(async (lens): Promise<LensFinding> => {
    try {
      return { lens, issues: parseLensIssues(await critic(lensPrompt(lens, objective, steps, opts?.context))) };
    } catch {
      return { lens, issues: [] };
    }
  }));
  const byLens = byLensRaw.filter((r) => r.issues.length > 0);
  const issues = byLens.flatMap((r) => r.issues.map((i) => `[${r.lens}] ${i}`));
  if (!issues.length) return null; // 전 렌즈 건전 → 수정 불요
  // 종합 수정안(전 렌즈 이슈 반영·1콜). fail-soft(실패=수정안 없이 이슈만).
  let revisedSteps: string[] = [];
  try {
    const synth = parseAdversarialVerdict(await critic(synthPrompt(objective, steps, issues, opts?.context)));
    revisedSteps = synth?.revisedSteps ?? [];
  } catch { /* fail-soft */ }
  return { revisedSteps, issues, byLens };
}
