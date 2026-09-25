// ── 세션 표현법 정책 (PLAN §P4 · C7 서버스냅샷+서피스렌더 · 2026-07-16) ────────────
//
// 세션 출력(SessionOutputEvent)은 **서버-권위 스냅샷**이다. 표현법 정책은 그 스냅샷을 각
// 구독자 서피스로 fan-out 할 때 "어떻게 렌더할지"를 결정하는 얇은 오케스트레이션 계층 —
// 기존 포맷터(telegram-format·outbound/format·agent-event-relay)를 재사용하고 정책만 신설.
//
// 대표 확정(§4-1): **Stage A(원본 방출)부터 점증** → dogfood 후 C(서피스별 맞춤).
//   Stage A — 최초 서피스 표현 그대로 전 구독자에(identity·최소·즉시). ← 현재 기본.
//   Stage B — 공통 중간표현 → 발송 시 채널 포맷터 일괄 변환. (확장점)
//   Stage C — 같은 스냅샷을 각 서피스 최적 표현으로(tg 버튼/HTML·PWA 리치·TUI pane·voice TTS). (확장점)
//
// 제1원칙 heal(§P4): 표현 변환 실패 → **원본/plain 폴백**(방출 안 막음). render 관측.

import type { SessionSurface } from './index.js';
import type { SessionOutputEvent } from './session-fanout.js';
import { recordSessionObservation } from './session-observation.js';

export type ExpressionStage = 'A' | 'B' | 'C';

export interface RenderPolicy {
  /** 표현 단계. 기본 A(원본 방출). */
  stage: ExpressionStage;
}

export const DEFAULT_RENDER_POLICY: RenderPolicy = { stage: 'A' };

/** 서피스별 렌더러 — 스냅샷 텍스트를 그 서피스 최적 표현으로(Stage C). throw 시 원본 폴백. */
export interface SurfaceRenderer {
  render: (event: SessionOutputEvent) => string;
}

export interface RenderedOutput {
  /** 배달할 최종 텍스트. */
  text: string;
  /** 표현 변환 실패로 원본 폴백했나(정직성). */
  degraded: boolean;
  /** 적용된 단계(관측/디버그). */
  stage: ExpressionStage;
}

/**
 * 한 스냅샷을 한 서피스로 렌더. Stage A = identity(원본). Stage C = 등록 렌더러(있으면).
 * 렌더러 throw → 원본 폴백(degraded·방출은 계속). B 는 아직 A 로 폴백(확장점).
 */
export function renderForSurface(
  surface: SessionSurface,
  event: SessionOutputEvent,
  policy: RenderPolicy = DEFAULT_RENDER_POLICY,
  renderers?: Map<SessionSurface, SurfaceRenderer>,
  sessionId?: string,
): RenderedOutput {
  const original = event.text ?? '';
  // Stage A(기본) · B(미구현 폴백) — 원본 그대로.
  if (policy.stage !== 'C') {
    return { text: original, degraded: false, stage: policy.stage };
  }
  // Stage C — 서피스별 렌더러 적용(있으면). 실패 시 원본 폴백.
  const r = renderers?.get(surface);
  if (!r) return { text: original, degraded: false, stage: 'C' };
  try {
    return { text: r.render(event), degraded: false, stage: 'C' };
  } catch {
    if (sessionId) {
      recordSessionObservation({
        sessionId, subsystem: 'render', event: 'fallback', surface,
        rationale: `${surface} Stage C 렌더 실패 → 원본 폴백`, importance: 4,
      });
    }
    return { text: original, degraded: true, stage: 'C' };
  }
}
