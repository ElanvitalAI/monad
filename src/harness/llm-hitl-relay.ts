// LLM 자율 HITL relay — 자율 실행의 HITL 을 LLM 이 응답해 무인 완주 (트랙 HITL 완주 / X2·X3 · 2026-07-22)
//
// 대표 지시(2026-07-22): "hitl 내용도 (클로드/LLM 이) 응답해서 해결." 자율 실행(6h 무인)이 HITL(confirm/
// question)에서 dead-end 하지 않고, LLM 이 목표 맥락으로 응답해 완주하게 한다. detached-hitl 의 HitlRelay
// 계약을 그대로 구현(재발명 0) — 부모(daemon/detached)나 front-door 가 이 relay 를 꽂으면 자식 HITLREQ 가
// LLM 응답으로 해결된다.
//
// ⚠️ X3 규율(불변식·[[feedback_signal_wiring_via_mission]]): **부작용(apply-in-place·배포·투자 집행·실 FS 쓰기)은
//    기본 fail-closed** — LLM 이 임의 승인 못 함(approveSideEffects=true 로 명시 허용해야 승인 고려). 비부작용
//    confirm과 명확화 question만 LLM 이 응답하며, PR-open을 포함한 부작용은 LLM 질의 없이 거부한다. 모든 판정
//    관측(harness.hitl) — 왜 승인/거부했나.

import type { HitlRelay } from './detached-hitl.js';
import type { ConfirmRequest } from '../hitl/confirm.js';
import type { AskUserQuestionRequest, AskUserQuestionResult } from '../ask-user-question/types.js';
import { debug } from '../debug/log.js';

/** 부작용(실 FS 쓰기·배포·집행) 신호 — 이런 confirm 은 X3 규율상 기본 fail-closed. */
export const SIDE_EFFECT_RE = /apply|배포|deploy|집행|in-?place|실\s*위치|실제\s*파일|overwrite|덮어\s*쓰|송금|주문|매수|매도|push\b|merge\b|머지|PR\s*(을|를)?\s*(열|생성|만들|올(리|릴|려))|open(ing)?\s+(a\s+)?pr|pull\s+request|draft\s+pr/i;

export interface LlmHitlRelayDeps {
  /** LLM 호출(질문 답변·confirm 판단). 프롬프트→텍스트. */
  ask: (prompt: string) => Promise<string>;
  /** 자율 작업 설명. 질문 판단에만 선택적으로 제공하며, 공백이면 기존 프롬프트를 보존한다. */
  context?: string;
  /** 부작용 confirm 자동승인 허용(X3: 기본 false=명시 승인 필요·fail-closed). */
  approveSideEffects?: boolean;
  /** 관측 seam(기본 debug.log harness.hitl). */
  observe?: (event: string, data: Record<string, unknown>) => void;
}

/** LLM 이 텍스트로 낸 첫 JSON 객체 추출(코드펜스·서두 무시). 실패=null. */
export function extractJsonObject(s: string): Record<string, unknown> | null {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const o = JSON.parse(m[0]); return o && typeof o === 'object' ? (o as Record<string, unknown>) : null; } catch { return null; }
}

/**
 * 자율 실행 HITL 을 LLM 이 응답하는 relay. confirm=저위험만 LLM 판단(부작용은 X3 fail-closed)·question=옵션 택1.
 * fail-soft: LLM 실패/파싱 실패 → confirm=false·question=null(안전측 = 미승인). 모든 결정 관측.
 */
export function buildLlmHitlRelay(deps: LlmHitlRelayDeps): HitlRelay {
  const observe = deps.observe ?? ((e: string, d: Record<string, unknown>) => { try { debug.log('harness.hitl', e, d); } catch { /* fail-soft */ } });

  return {
    async confirm(req: ConfirmRequest): Promise<boolean> {
      const text = `${req.prompt} ${req.detail ?? ''}`;
      if (SIDE_EFFECT_RE.test(text) && !deps.approveSideEffects) {
        observe('confirm-fail-closed', { reason: 'side-effect', prompt: req.prompt.slice(0, 80) });
        return false;   // X3 — 실행 부작용은 명시 승인 필요(자율 임의 집행 금지)
      }
      try {
        const ans = await deps.ask(
          `자율 실행 중 승인 요청이다. 목표 달성에 안전하고 타당하면 승인, 위험하거나 불명확하면 거부한다. 한 단어로만 답하라(yes 또는 no):\n\n요청: ${req.prompt}\n${req.detail ? `상세: ${req.detail}` : ''}`,
        );
        const yes = /\byes\b|승인|approve|허용|동의/i.test(ans);
        const no = /\bno\b|거부|deny|반대|취소/i.test(ans);
        const ok = yes && !no;
        observe('confirm', { ok, prompt: req.prompt.slice(0, 80) });
        return ok;
      } catch (e) {
        observe('confirm-error', { error: String((e as { message?: string })?.message ?? e).slice(0, 120) });
        return false;   // fail-closed
      }
    },

    async question(req: AskUserQuestionRequest): Promise<AskUserQuestionResult | null> {
      if (!req.questions.length) return null;
      try {
        const spec = req.questions
          .map((q) => `[${q.id}] ${q.question}\n  옵션: ${q.options.map((o) => o.label).join(' | ')}`)
          .join('\n\n');
        const context = deps.context?.trim();
        const contextPrefix = context
          ? `작업 맥락:\n${context.slice(0, 2000)}${context.length > 2000 ? '\n[작업 맥락이 2000자로 잘렸습니다.]' : ''}\n\n`
          : '';
        const raw = await deps.ask(
          `${contextPrefix}자율 실행 중 아래 질문에 목표 맥락에 맞게 답하라. 각 질문마다 제시된 옵션 라벨 중 하나를 골라 JSON 으로만 답하라(다른 텍스트 금지): {"질문id":"고른 라벨"}\n\n${spec}`,
        );
        const parsed = extractJsonObject(raw);
        if (!parsed) { observe('question-parse-fail', { qs: req.questions.length }); return null; }
        const answers: Record<string, string | string[]> = {};
        let usedFallback = false;
        for (const q of req.questions) {
          const picked = parsed[q.id];
          // LLM 이 고른 라벨이 실제 옵션에 있으면 채택, 아니면 첫 옵션(안전 기본).
          const hasValidPick = typeof picked === 'string' && q.options.some((o) => o.label === picked);
          const label = hasValidPick ? picked : q.options[0]?.label;
          if (!hasValidPick) usedFallback = true;
          if (label) answers[q.id] = label;
        }
        observe('question', { qs: req.questions.length, answered: Object.keys(answers).length });
        return Object.keys(answers).length ? { answers, ...(usedFallback ? {} : { answeredBy: 'agent' as const }) } : null;
      } catch (e) {
        observe('question-error', { error: String((e as { message?: string })?.message ?? e).slice(0, 120) });
        return null;   // fail-closed
      }
    },
  };
}
