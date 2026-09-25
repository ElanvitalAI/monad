// ── 턴 UX 시뮬레이터 — 프레임 생성 ───────────────────────────────────────────
//
// ⛔⭐⭐⭐ 이 파일의 유일한 규율: ***실제 위젯의 `render()` 를 부른다.***
//   흉내 낸 렌더러를 쓰면 「위쪽 층이 옳게 공급했는데 렌더 매핑이 필드를 떨어뜨리는」
//   부류의 버그를 «원리상» 못 잡는다 — 2026-08-19 에 정확히 그 버그를 놓쳤다.

import logWidget, { type LogWidgetState } from '../../widgets/log/widget.js';
import type { TurnSimSpec } from './turn-states.js';
import { simFooterLine, simLines } from './turn-states.js';

export interface SimFrameOptions {
  width?: number;
  height?: number;
  focused?: boolean;
  /** 로그 위젯 state 에 얹을 추가 필드(새 UX 필드를 시험할 때). */
  extraState?: Record<string, unknown>;
  /** 위젯 render ctx 의 origin — 심으면 `lastRenderOriginRow` 로 돌아온다. */
  originRow?: number;
  /** 위젯 render ctx 의 origin — 심으면 `lastRenderOriginCol` 로 돌아온다. */
  originCol?: number;
}

/**
 * 렌더 «뒤» 클릭 매핑에 필요한 필드만. 배열은 복사·동결이라 호출자가 원본을 못 흔든다.
 * ⛔ 전체 `LogWidgetState` 를 그대로 노출하지 않는다 — `Readonly<T>` 는 splice 를 막지 못한다.
 */
export interface SimFrameState {
  readonly lastVisibleLineIndices: ReadonlyArray<number>;
  readonly lastRenderOriginRow?: number;
  readonly lastRenderOriginCol?: number;
}

export interface SimFrame {
  /** 위젯이 낸 줄들(제목 + 본문). */
  lines: string[];
  /** 한 덩어리 문자열 — grep·스냅샷용. */
  text: string;
  /**
   * 실제 위젯 `render()` 가 값을 심은 뒤의 클릭 매핑 스냅샷.
   * 읽기 전용 — 호출자가 바꿔도 시뮬레이터 내부·다음 렌더·입력 extraState 는 안 흔들린다.
   */
  state: SimFrameState;
}

function snapshotRenderedState(state: LogWidgetState): SimFrameState {
  const snapshot: SimFrameState = {
    lastVisibleLineIndices: Object.freeze([...(state.lastVisibleLineIndices ?? [])]),
    ...(state.lastRenderOriginRow !== undefined
      ? { lastRenderOriginRow: state.lastRenderOriginRow }
      : {}),
    ...(state.lastRenderOriginCol !== undefined
      ? { lastRenderOriginCol: state.lastRenderOriginCol }
      : {}),
  };
  return Object.freeze(snapshot);
}

/**
 * ★ 한 국면의 화면을 «실제 위젯»으로 그려 낸다. LLM·PTY·터미널 없이 즉시.
 *
 * ⭐ `extraState` 가 이 장치의 핵심 쓰임이다 — 새 UX 필드를 붙일 때
 *   ***「공급하면 실제로 그려지나」***를 «한 줄»로 물을 수 있다.
 */
export function simRenderLogFrame(spec: TurnSimSpec, opts: SimFrameOptions = {}): SimFrame {
  const width = opts.width ?? 120;
  const height = opts.height ?? 20;
  const state = {
    ...logWidget.initialState({ lines: simLines(spec) }),
    lines: simLines(spec),
    scrollOffset: -1,
    focused: opts.focused ?? false,
    footerLine: simFooterLine(spec),
    ...(opts.extraState ?? {}),
  } as LogWidgetState;
  // ⚠️ 위젯 render 는 (state, ctx, host) 3인자다 — 시뮬레이터는 host 를 안 쓴다.
  const lines = (logWidget.render as unknown as (
    s: unknown, c: unknown, h: unknown,
  ) => string[])(state, {
    width,
    height,
    focused: opts.focused ?? false,
    ...(opts.originRow !== undefined ? { originRow: opts.originRow } : {}),
    ...(opts.originCol !== undefined ? { originCol: opts.originCol } : {}),
  }, undefined);
  return { lines, text: lines.join('\n'), state: snapshotRenderedState(state) };
}
