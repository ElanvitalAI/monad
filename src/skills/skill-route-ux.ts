// skill 트리거 UX 를 SurfaceUx 막으로 리프팅 (트랙 S6 · 2026-07-22)
//
// PLAN-execution-cycle-harness-expansion §트랙 S6. 종전 skill 트리거 UX(auto-run/confirm)는
// TUI 대시보드 프로세스(dashboard/index.ts + skill-route-prompt.ts)의 터미널 전용 프리미티브
// (chatLines/draw/onEscAbort/process.stdin Tab 캡처)에 결합돼, telegram/discord/pwa/acp 등
// 비-TUI 서피스에선 skill 트리거가 아예 뜨지 않았다(크로스서피스 미배선 — S6 조사 판정).
//
// 라우팅 코어(router.ts)와 결정 로직(resolveDashboardSkillRouteDecision→{none|auto|confirm})은 이미
// 서피스무관이라, 남은 결합은 **UX 발사 마지막 한 겹**뿐. 이 모듈이 그 결정을 SurfaceUx.confirm 으로
// 발사하는 서피스무관 헬퍼를 제공한다 — TUI 는 자체 카운트다운/Tab UX 를 그대로 유지(무접촉·회귀0),
// 비-TUI 서피스는 이 primitive 를 채택해 동일 트리거 UX 를 얻는다(C1~C6 크로스서피스 승격 패턴 동형).
//
// ⚠️ 막 규율(제1원칙): 비-interactive 서피스에서 ux.confirm 은 fail-closed(false) → 자동실행 안 함.
//    auto 결정만 confirm 없이 실행(대시보드 autoRoute 정책이 이미 결정단계에서 게이트).

import type { SurfaceUx } from '../agent/surface-ux/types.js';
import type { DashboardSkillRouteDecision } from '../dashboard/skill-route-runtime.js';
import { debug } from '../debug/log.js';

export interface SkillRouteUxResult {
  /** 트리거가 실제로 실행됐나. */
  fired: boolean;
  /** 트리거된(또는 될) skill 이름. kind='none' 이면 undefined. */
  target?: string;
  /** 판정 근거(관측/테스트). */
  reason: 'auto' | 'confirmed' | 'declined' | 'none';
}

const observe = (event: string, data: Record<string, unknown>): void => {
  try { debug.log('skill.router', event, data); } catch { /* fail-soft */ }
};

/**
 * skill 라우팅 결정을 SurfaceUx 로 발사한다(서피스무관). telegram/discord/pwa/acp/tui/cli 어디서든 동일.
 * - kind='auto'    → onExecute 즉시 실행(대시보드 autoRoute 정책이 결정단계에서 이미 게이트)
 * - kind='confirm' → ux.confirm → 승인 시 onExecute. 비-interactive 서피스는 fail-closed(false·자동 안 함)
 * - kind='none'    → no-op
 * @param onExecute 트리거 실행기(예: /run-skill target). throw 는 호출측이 처리.
 */
export async function runSkillRouteWithUx(
  decision: DashboardSkillRouteDecision,
  ux: SurfaceUx,
  onExecute: (target: string) => void | Promise<void>,
): Promise<SkillRouteUxResult> {
  if (decision.kind === 'none') { observe('ux-none', { surface: ux.surface }); return { fired: false, reason: 'none' }; }
  const target = decision.target;
  if (decision.kind === 'auto') {
    observe('ux-auto', { surface: ux.surface, target });
    await onExecute(target);
    return { fired: true, target, reason: 'auto' };
  }
  // confirm — SurfaceUx.confirm(막). 비-interactive=fail-closed(false).
  const ok = await ux.confirm({
    prompt: `skill '${target}' 를 실행할까요?`,
    detail: '이 요청에 맞는 skill 을 트리거합니다.',
    yesLabel: '실행',
    noLabel: '취소',
  });
  observe('ux-confirm', { surface: ux.surface, target, ok, interactive: ux.interactive });
  if (ok) { await onExecute(target); return { fired: true, target, reason: 'confirmed' }; }
  return { fired: false, target, reason: 'declined' };
}
