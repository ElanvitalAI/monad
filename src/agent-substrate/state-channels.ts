// Typed 채널 + reducer 프리미티브 (공용·중립 · 2026-07-20 C1 승격).
//
// 원본: src/autopilot/pipeline/mission-state-channels.ts(조율자 격상 P1 foundation). LangGraph StateGraph
// 의 typed channels + reducer 이식. blackboard 의 모든 필드가 LastValue(덮어쓰기)라 한 번 undefined 로
// 덮이면 조용히 소실되는 손실체인(INCIDENT-archint-parse-collapse)을 채널별 reducer(lastValue=덮어쓰기 ·
// append=누적)로 구조적으로 차단한다.
//
// ★ 이 모듈은 **미션-무관 제네릭 코어**만 담는다(DESIGN-cross-surface-autonomy-membrane §16 C1). 미션
//   채널 스키마(MISSION_CHANNEL_REDUCERS)·arcHint·cursor 등 미션 특화는 autopilot 잔류. 스몰-폼 하니스는
//   자기 채널 스키마를 정의해 이 제네릭 reducer 를 재사용한다(§15c 문맥교환 anti-downgrade primitive).
// 전부 순수·결정론. I/O 없음.

/** 채널 reducer 종류 — lastValue: 새 값으로 덮어씀(LangGraph 기본) · append: 배열에 누적(add reducer). */
export type ReducerKind = 'lastValue' | 'append';

/** 채널명 → 그 채널이 쓰는 reducer. 소비자(미션·하니스)가 각자 스키마를 정의해 넘긴다. */
export type ChannelReducers = Record<string, ReducerKind>;

/** 채널 상태 — 채널명 → 값(append 채널은 배열). 미기록 채널 부재. */
export type ChannelState = Record<string, unknown>;

/** 채널 1건 갱신에 reducer 적용(순수). append: 기존 배열(또는 빈)에 next 를 누적(null/undefined 는 무시해
 *  손실 방지) · lastValue: next 로 덮어씀. */
export function reduceChannel(kind: ReducerKind, prev: unknown, next: unknown): unknown {
  if (kind === 'append') {
    const base = Array.isArray(prev) ? prev.slice() : (prev === undefined ? [] : [prev]);
    if (next === null || next === undefined) return base;   // ★ 빈 값은 누적 이력을 덮지 않는다
    if (Array.isArray(next)) return [...base, ...next];
    return [...base, next];
  }
  return next; // lastValue
}

/** State 에 채널 갱신 1건 적용(reducers 조회 → reduceChannel). 새 State 반환(불변). 순수.
 *  알 수 없는 채널은 lastValue 로 취급(보수적·비파괴). */
export function applyChannelUpdate(
  state: ChannelState,
  channel: string,
  value: unknown,
  reducers: ChannelReducers,
): ChannelState {
  const kind = reducers[channel] ?? 'lastValue';
  return { ...state, [channel]: reduceChannel(kind, state[channel], value) };
}

/** 여러 채널 갱신을 순서대로 fold(부분 State 업데이트 배치). 순수. */
export function applyChannelUpdates(
  state: ChannelState,
  updates: Array<{ channel: string; value: unknown }>,
  reducers: ChannelReducers,
): ChannelState {
  return updates.reduce((s, u) => applyChannelUpdate(s, u.channel, u.value, reducers), state);
}

/** append 채널 이력에서 마지막 non-null 유한수 반환(손실차단의 일반형 — arcHint=5 후 undefined 가 와도
 *  5 유지). 이력 없으면 undefined. 순수. (미션의 effectiveArcHint 가 이걸 arcHint 채널에 특화해 재사용.) */
export function effectiveLastNumber(state: ChannelState, channel: string): number | undefined {
  const hist = state[channel];
  const arr = Array.isArray(hist) ? hist : (hist === undefined ? [] : [hist]);
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}
