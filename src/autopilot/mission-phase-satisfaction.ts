// 미션 실행 페이즈 충족 판정 (S1·긍정 발산 스킵 2026-07-19)
//
// ★ "이 페이즈가 이미 충족됐나?" 를 실행 전에 판정해, 충족이면 실행을 생략(빠른 스킵)한다.
//   대표 방침(2026-07-19): luna 디폴트 + 결정론 fast-path. LLM/로직 균형([[feedback_mission_
//   fabric_llm_logic_balance_2026_07_16]]) — "이미 충족" 은 코드 실독이 필요한 섬세 판단이라 luna 가
//   주력, 단 필수 산출물이 이미 전부 존재하는 명백한 경우만 결정론 fast-path 로 LLM 을 아낀다.
// ★ 보수적: 모호/판정누락/실패 = 미충족(실행). 잘못 skip 은 산출물 부재로 후속에서 드러나지만,
//   그래도 근거 없는 skip 은 금지(오탐이 미션 불완전으로 이어지지 않게).

import type { Task } from '../task-orchestrator/types.js';
import { extractRequiredArtifacts, checkArtifactExistence } from './mission-artifact-discipline.js';

export interface SatisfactionVerdict {
  satisfied: boolean;
  reason: string;
  /** 판정 경로 — artifacts=결정론 fast-path·luna=LLM 판단·none=미판정(실행). */
  via: 'artifacts' | 'luna' | 'none';
}

/** luna 응답 파싱(순수) — "SATISFIED: yes|no" + "REASON: ...". 판정 누락/모호 = 미충족(보수적 실행). */
export function parseSatisfactionResponse(text: string): { satisfied: boolean; reason: string } {
  const t = (text || '').trim();
  const m = t.match(/SATISFIED\s*[:：]\s*(yes|no|예|아니오|아니요)/i);
  const reasonM = t.match(/REASON\s*[:：]\s*(.+)/i);
  const reason = (reasonM?.[1] ?? t).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!m) return { satisfied: false, reason: reason || '판정 누락(보수적 실행)' };
  const v = (m[1] ?? '').toLowerCase();
  const satisfied = v === 'yes' || v === '예';
  return { satisfied, reason: reason || (satisfied ? '이미 충족' : '미충족') };
}

/** luna 프롬프트(순수·ASCII+한글·특수문자 회피) — 아크커버/기존구현 여부를 grounding 근거로 판단. */
export function buildSatisfactionPrompt(args: {
  title: string; prompt: string; goal: string; acceptance: string; grounding: string;
}): string {
  return [
    '너는 미션 실행 전 "이 페이즈가 이미 충족됐는지" 판정한다.',
    '아래 페이즈 목표가 현재 코드베이스나 선행 아크(이전 페이즈) 산출물로 이미 달성됐으면 yes.',
    '조금이라도 미구현/불확실하면 no(보수적 실행). 근거 없이 yes 금지 — 실제 코드/산출물 근거만.',
    '',
    `[페이즈] ${args.title}`,
    `[페이즈 목표] ${args.prompt.slice(0, 500)}`,
    `[미션 골] ${args.goal.slice(0, 300)}`,
    args.acceptance ? `[완료기준]\n${args.acceptance.slice(0, 400)}` : '',
    args.grounding ? `[선행 산출물/현재 지형]\n${args.grounding.slice(0, 1500)}` : '',
    '',
    '형식(정확히 두 줄):',
    'SATISFIED: yes|no',
    'REASON: <한 줄 근거>',
  ].filter(Boolean).join('\n');
}

/** 페이즈 충족 판정 — fast-path(결정론 artifacts 존재) → luna(grounding). classify/statFn DI(테스트·비용). */
export async function evaluatePhaseSatisfaction(
  task: Task,
  ctx: {
    cwd: string; goal: string; acceptanceText: string; groundingBlock: string;
    statFn?: (abs: string) => { size: number } | null;
  },
  deps: { classify?: (prompt: string) => Promise<string> } = {},
): Promise<SatisfactionVerdict> {
  const basePrompt = task.surface.kind === 'subagent' ? task.surface.prompt : task.title;
  const required = extractRequiredArtifacts(`${basePrompt}\n${ctx.acceptanceText}`);
  // fast-path (결정론) — 필수 산출물이 선언됐고 전부 이미 존재(크기>0) → 이미 충족(luna 없이).
  if (required.length > 0) {
    const states = checkArtifactExistence(required, { cwd: ctx.cwd, ...(ctx.statFn ? { statFn: ctx.statFn } : {}) });
    if (states.every((s) => s.exists && s.sizeBytes > 0)) {
      return { satisfied: true, reason: `필수 산출물 ${required.length}건 이미 존재(결정론)`, via: 'artifacts' };
    }
  }
  // luna 디폴트 — classify 미주입이면 미판정(실행). grounding(선행 아크 산출물)로 아크커버 판단.
  if (!deps.classify) return { satisfied: false, reason: 'luna 미주입(실행)', via: 'none' };
  let text = '';
  try {
    text = await deps.classify(buildSatisfactionPrompt({
      title: task.title, prompt: basePrompt, goal: ctx.goal, acceptance: ctx.acceptanceText, grounding: ctx.groundingBlock,
    }));
  } catch {
    return { satisfied: false, reason: 'luna 실패(보수적 실행)', via: 'none' };
  }
  const p = parseSatisfactionResponse(text);
  return { satisfied: p.satisfied, reason: p.reason, via: 'luna' };
}
