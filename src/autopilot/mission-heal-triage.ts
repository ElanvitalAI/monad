// ── 중앙 맥락-인지 heal triage (대표 2026-07-22) ────────────────────────────
//
// 종전 triage 는 파편·리지드였다: recommendHeal(로컬 failClass→rebuild/split)·seTriageClassify(SE 재시도
// 갈림길)·decideArcEdit(구조/크기)가 따로 놀아, 실패를 무조건 budget-exhausted→rebuild/split 로 오귀속
// (라이브 81b18c: 선언문 잘림→split·승인요청 HITL 페이즈→rebuild 무한). 대표 진단 = "신호가 올라오면
// 문맥을 더 넓게 보고 판단하는 중앙 조율자 층이 없다".
//
// 이 모듈 = 그 중앙 층. 실패 신호를 **넓은 맥락**(phaseKind LLM 분류 히스토리·선언문·criteria·미션골·형제
// 페이즈·실패출력·시도이력) 위에서 LLM 이 근본 분류 + 유연 heal 로 종합판정한다. 조율자(run-mission)가 소비.
// 공용화: 컨텍스트=buildSelfHealContext 재사용(호출측)·폴백=recommendHeal·신규 heal 집행=기존 dispatch 매핑.

import type { HealKind } from './mission-phase-diagnosis.js';

/** 중앙 triage heal — 기존 HealKind + 신규 2종(대표 2026-07-22). 신규는 dispatch 에서 기존 집행으로 매핑
 *  (fix-declaration→revise[텍스트 수정]·route-hitl→escalate[HITL]) — 집행 경로 재발명 0(공용화). */
export type ContextualHeal = HealKind | 'fix-declaration' | 'route-hitl';

export interface HealTriageContext {
  phaseTitle: string;
  phasePrompt: string;
  acceptanceCriteria: string[];
  /** ★ LLM 분류 히스토리(대표 지적 — triage 가 이걸 써야 한다) — 분류는 이미 LLM 이 했고 State 에 영속되나
   *  종전 heal 은 이걸 안 봤다. operational(조사/운영·코드아님)인데 코드 재시도하던 오류의 근본. */
  phaseKind?: 'implementation' | 'operational';
  missionGoal: string;
  siblingTitles: string[];
  failureOutput: string;
  attemptCount: number;
  priorHeals: string[];
  failClass?: string;
}

export interface HealTriageDecision {
  heal: ContextualHeal;
  reason: string;
  confidence: 'high' | 'med' | 'low';
}

export type HealTriageResolve = (prompt: string) => Promise<string>;

const HEALS: readonly ContextualHeal[] = ['rebuild', 'split', 'revise', 'skip', 'escalate', 'fix-declaration', 'route-hitl'];

/** 넓은-맥락 triage 프롬프트 — 근본별 유연 heal(리지드 budget→rebuild/split 금지). 순수. */
export function healTriagePrompt(ctx: HealTriageContext): string {
  return [
    '너는 미션 조율자의 heal-triage 두뇌다. 실패한 페이즈를 **넓은 맥락**으로 보고 진짜 근본과 최선 대처를 판정하라.',
    '리지드 금지: 무조건 budget→rebuild/split 이 아니라, 아래 근본별로 유연하게 고른다.',
    '',
    '── heal 선택지(정확히 하나) ──',
    '- fix-declaration: 페이즈 선언문/제목/acceptance 가 모호·잘림·불명확해 무엇을 만들지 알 수 없다 → 구현이 아니라 **페이즈 텍스트를 명확히 수정**해야 한다.',
    '- route-hitl: 이 페이즈가 사람 개입(승인 요청·검토 확인) 필수라 자율 에이전트가 코드로 완주 불가 → HITL 라우팅/스킵(코드 재시도 무의미).',
    '- split: 진짜 과대(서로 다른 관심사·파일 다수를 한 번에) → 단일책임 분할.',
    '- revise: 접근/스코프가 틀림(범위 초과·전제 오류) → 범위 재정의.',
    '- rebuild: 접근은 맞으나 구현이 미달(배선 누락·테스트 실패) → 비평을 가이드로 재구현.',
    '- skip: 이미 구현/충족됨 → 정직 skip.',
    '- escalate: 보안경계·환경제약·수렴불가 → 사람 판단.',
    '',
    '── 맥락 ──',
    `미션 골: ${ctx.missionGoal.slice(0, 300)}`,
    ctx.phaseKind ? `이 페이즈 분류(LLM): ${ctx.phaseKind}${ctx.phaseKind === 'operational' ? ' (조사/운영 — 코드작성 아님·코드게이트 미달을 rebuild 로 무한재시도 말 것)' : ' (코드/테스트 작성)'}` : '',
    `실패 페이즈 제목: ${ctx.phaseTitle}`,
    `선언(설명): ${ctx.phasePrompt.slice(0, 400)}`,
    `acceptance: ${ctx.acceptanceCriteria.slice(0, 6).join(' · ') || '(없음·불명확 신호)'}`,
    ctx.siblingTitles.length ? `형제 페이즈(맥락): ${ctx.siblingTitles.slice(0, 8).join(' · ')}` : '',
    `시도 ${ctx.attemptCount}회 · 이전 heal: ${ctx.priorHeals.slice(-4).join('→') || '(없음)'} · failClass(참고): ${ctx.failClass ?? '?'}`,
    `실패 출력(게이트/비평): ${ctx.failureOutput.slice(0, 500)}`,
    '',
    '판정: 선언이 모호/잘림인가? HITL 필수인가? 진짜 과대인가? 접근오류인가? 구현미달인가? JSON 만:',
    '{"heal":"...","reason":"...","confidence":"high|med|low"}',
  ].filter(Boolean).join('\n');
}

/** JSON heal 판정 파싱(관대·fail=null). 순수. */
export function parseHealTriage(text: string): HealTriageDecision | null {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    const raw = JSON.parse(text.slice(s, e + 1)) as Partial<HealTriageDecision>;
    if (!raw.heal || !HEALS.includes(raw.heal as ContextualHeal)) return null;
    const confidence = raw.confidence === 'high' || raw.confidence === 'low' ? raw.confidence : 'med';
    return { heal: raw.heal as ContextualHeal, reason: (raw.reason ?? '').slice(0, 200), confidence };
  } catch { return null; }
}

/** 중앙 triage — LLM 종합판정 + 결정론 폴백. 조율자(run-mission)가 호출. fail-soft. */
export async function decideHealTriage(ctx: HealTriageContext, resolve: HealTriageResolve, fallback: ContextualHeal): Promise<HealTriageDecision> {
  try {
    const parsed = parseHealTriage(await resolve(healTriagePrompt(ctx)));
    if (parsed) return parsed;
  } catch { /* fail-soft */ }
  return { heal: fallback, reason: 'LLM triage 실패/무효 — 결정론 폴백', confidence: 'low' };
}

/** ★ 신규 heal → 기존 집행 dispatch 매핑(공용화·재발명 0). fix-declaration=revise(선언 수정 코멘트)·
 *  route-hitl=escalate(HITL). 나머지는 그대로. run-mission 이 이걸로 기존 heal 경로에 태운다. */
export function mapContextualHealToDispatch(heal: ContextualHeal): { kind: HealKind; declarationFix?: boolean; hitl?: boolean } {
  if (heal === 'fix-declaration') return { kind: 'revise', declarationFix: true };
  if (heal === 'route-hitl') return { kind: 'escalate', hitl: true };
  return { kind: heal };
}
