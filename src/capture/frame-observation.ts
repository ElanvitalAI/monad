// ── S4 P1 · 화면-상태 관측 (판단 없음 · 순수) ─────────────────────────────────────────
//
// [[DESIGN-s4-react-l2-observes-l3-2026-07-26]] P1 = "brain seam + 관측만". 개입은 하지 않고
// **무슨 화면-상태를 언제 얼마나 오래 겪었나**만 기록해, P2(suggestion)·P3(자동 개입)의 임계값을
// 추측이 아니라 실측으로 정하게 한다(§G.5 안전 규율: suggestion-only 먼저).
//
// ⭐ 왜 필요했나 (P0-③ 실측): self 경로는 `classifyFrameState` 를 매 render(~1.5s) **실제로 호출**하는데,
// 그 결과가 **키프레임 PNG 쓰기 성공에 종속**돼서만 로그에 남았다(`if (moment)` → renderScreenPng →
// writeKeyframePng → 그 다음 debug.log). PNG 가 안 나오면 분류를 계산하고 **버렸다** → 실 run 의
// 화면-상태 로그가 0건이라 "blocked 판정이 신뢰할 만한가"를 데이터로 답할 수 없었다.
//
// ⭐ 두 신호가 다른 클래스다 (P0-③ 규칙셋 독해):
//   · `blocked` = **명시적 대화형 프롬프트**(커서-마킹 옵션·`(y/n)`·`esc to cancel`). 규칙이 좁아 오탐은 낮다.
//   · 그런데 진짜 hang 은 프롬프트가 없다 — 스피너가 남아 `working`, 정적이면 `unknown` 이다.
//     ⇒ `blocked` 트리거만으로는 그 클래스를 구조적으로 못 잡는다. **동일 프레임 정지**를 별도 관측한다.
//
// ⚠️ **계약 범위(리뷰 should-fix로 축소)**: 이 stall 신호는 "hang 포착"이 아니라 **"동일 프레임 정지 포착"**
// 이다. raw 화면 완전일치 기준이라 **스피너 애니메이션·커서 깜박임이 있는 무진행 hang 은 놓친다**(프레임이
// 매번 달라진다). 정규화(스피너 글리프·커서 제거)로 넓힐 수 있으나, 무엇을 노이즈로 볼지는 P1 데이터를
// 보고 정해야 한다(추측 금지) → **P2 입력**. 지금은 잡히는 것만 정직하게 신고한다.
//
// 순수 함수 + 상태 캐리 방식(주입·시간 인자) → 시간 조작 없이 단위 테스트 가능.

import type { FrameState } from './frame-state-detect.js';

/** stall 관측 사다리(ms) — 이 문턱을 **넘을 때 1회만** 기록해 매 tick 로그 폭주를 막는다.
 *  값은 관측용 눈금일 뿐 개입 임계값이 아니다(P2 가 실측으로 정한다). */
export const STALL_RUNGS_MS: readonly number[] = [15_000, 60_000, 300_000];

export interface FrameObservationState {
  readonly lastState: FrameState | null;
  /** lastState 가 시작된 시각(ms). 0 = 아직 없음. */
  readonly stateSinceMs: number;
  readonly lastScreen: string | null;
  /** **현재 화면이 처음 나타난 시각**(ms). 화면이 바뀔 때만 갱신 → `atMs - screenSinceMs` = 무변화 경과.
   *  ⚠️ "동일 구간의 시작 시각"이라 현재 시각으로 잡으면 경과가 영원히 0 이 된다(초기 구현의 버그). */
  readonly screenSinceMs: number;
  /** 이미 기록한 stall 사다리 인덱스. -1 = 없음. */
  readonly stallRung: number;
}

export const INITIAL_FRAME_OBSERVATION: FrameObservationState = {
  lastState: null, stateSinceMs: 0, lastScreen: null, screenSinceMs: 0, stallRung: -1,
};

export interface FrameTransition {
  readonly from: FrameState | null;
  readonly to: FrameState;
  /** 직전 상태가 유지된 시간(ms). 첫 관측이면 0. */
  readonly heldMs: number;
}

export interface FrameStall {
  readonly state: FrameState;
  /** 화면이 바뀌지 않은 시간(ms). */
  readonly sameScreenMs: number;
  /** 넘은 사다리 인덱스(0=15s·1=60s·2=5min). */
  readonly rung: number;
}

export interface FrameObservation {
  readonly next: FrameObservationState;
  /** 상태가 바뀐 경우에만. 관측 이벤트 1건. */
  readonly transition?: FrameTransition;
  /** stall 사다리를 새로 넘은 경우에만. 관측 이벤트 1건. */
  readonly stall?: FrameStall;
}

/** 사다리에서 heldMs 가 넘은 **가장 높은** 인덱스(못 넘으면 -1). */
function stallRungFor(heldMs: number): number {
  let r = -1;
  for (let i = 0; i < STALL_RUNGS_MS.length; i += 1) if (heldMs >= STALL_RUNGS_MS[i]!) r = i;
  return r;
}

/**
 * 한 render 샘플을 관측 상태에 반영한다(순수 — 로깅·개입 없음).
 *
 * 계약:
 *  · 상태 전이 시 `transition`(from/to/heldMs) 1건. 같은 상태면 없음.
 *  · 화면이 직전과 **동일**하면 동일화면 구간이 누적되고, 사다리 문턱을 **새로** 넘을 때만 `stall` 1건.
 *  · 화면이 바뀌면 동일화면 구간·사다리가 리셋된다(진행 중이면 stall 아님).
 *  · 상태와 화면은 **직교** — `working` 이어도 화면이 멈춰 있으면 stall 이다(스피너가 프레임에 안 남는
 *    렌더러에서 실제로 일어난다). 이 직교성이 P0-③ 이 드러낸 "blocked 로는 hang 을 못 잡는다"의 반영.
 */
export function observeFrame(
  prev: FrameObservationState,
  cur: { state: FrameState; screen: string; atMs: number },
): FrameObservation {
  //   ⚠️ 초기 여부는 **`lastState === null`** 로 판정한다(리뷰 must-fix) — 시각을 truthy sentinel 로 쓰면
  //   `atMs=0` 에서 시작한 run 이 "시작 시각 없음"으로 오인돼 이후 heldMs 가 전부 틀린다(0 은 유효 시각).
  const first = prev.lastState === null;
  const transitioned = prev.lastState !== cur.state;
  const transition: FrameTransition | undefined = transitioned
    ? { from: prev.lastState, to: cur.state, heldMs: first ? 0 : Math.max(0, cur.atMs - prev.stateSinceMs) }
    : undefined;

  // 화면이 바뀌었나 — 첫 샘플(lastScreen===null)도 "바뀜"으로 본다(구간 시작).
  const screenChanged = prev.lastScreen === null || prev.lastScreen !== cur.screen;
  const screenSinceMs = screenChanged ? cur.atMs : prev.screenSinceMs;
  const sameScreenMs = Math.max(0, cur.atMs - screenSinceMs);
  const rung = screenChanged ? -1 : stallRungFor(sameScreenMs);
  const stall: FrameStall | undefined = !screenChanged && rung > prev.stallRung
    ? { state: cur.state, sameScreenMs, rung }
    : undefined;

  return {
    next: {
      lastState: cur.state,
      stateSinceMs: transitioned ? cur.atMs : prev.stateSinceMs,
      lastScreen: cur.screen,
      screenSinceMs,
      stallRung: screenChanged ? -1 : Math.max(prev.stallRung, rung),
    },
    ...(transition ? { transition } : {}),
    ...(stall ? { stall } : {}),
  };
}

/**
 * ⭐ 종료 관측(리뷰 should-fix) — 루프가 끝날 때 **마지막 상태의 유지시간**을 낸다.
 *
 * `observeFrame` 은 **전이 시점**에만 `heldMs` 를 낸다. 그래서 run 의 **마지막 상태**는 전이가 없어
 * 지속시간이 영원히 기록되지 않는다 → P2 가 상태-지속 분포를 볼 때 **우측 절단(right-censored)** 이
 * 된다(특히 "마지막에 오래 멈춰 있다 끝난" 케이스가 통째로 빠진다 — 우리가 가장 보고 싶은 것이다).
 *
 * 관측 없음(lastState===null)이면 null. 순수.
 */
export function finalizeFrameObservation(
  prev: FrameObservationState,
  atMs: number,
): { state: FrameState; heldMs: number; sameScreenMs: number } | null {
  if (prev.lastState === null) return null;
  return {
    state: prev.lastState,
    heldMs: Math.max(0, atMs - prev.stateSinceMs),
    sameScreenMs: Math.max(0, atMs - prev.screenSinceMs),
  };
}
