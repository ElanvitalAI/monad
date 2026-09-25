// 미션 채널 스키마 + 미션-바인딩 래퍼 (C1 승격 후 · 2026-07-20)
//
// ★ 제네릭 reducer 코어(reduceChannel/applyChannelUpdate/effectiveLastNumber)는 공용 중립층
//   `src/agent-substrate/state-channels.ts` 로 승격됐다(DESIGN-cross-surface-autonomy-membrane §16 C1).
//   여기엔 **미션 특화**만 남는다: 미션 채널 스키마(MISSION_CHANNEL_REDUCERS)·arcHint 유효값·재개 커서.
//   기존 import 처(10곳)는 무접촉 — 시그니처·심볼 전부 보존(applyChannelUpdate 3-arg 등은 미션 스키마 바인딩).
// 전부 순수·결정론. I/O 없음.

import {
  reduceChannel,
  applyChannelUpdate as applyChannelUpdateWith,
  applyChannelUpdates as applyChannelUpdatesWith,
  effectiveLastNumber,
  type ReducerKind,
  type ChannelReducers,
} from '../../agent-substrate/state-channels.js';

// 제네릭 코어 재-export — 이 경로에서 reduceChannel/ReducerKind 를 import 하던 곳 무접촉.
export { reduceChannel };
export type { ReducerKind };

/** MissionState 채널 스키마 — 각 채널이 쓰는 reducer. RFC 아키텍처 다이어그램의 채널 집합.
 *  ★ arcHint=append — undefined/후속 빈 값이 확정 아크 수를 덮어쓰지 못하게(INCIDENT 손실체인 차단).
 *  failures/retro=append(누적 회고). 나머지 stage 결과·decisions=lastValue(최신 단면). */
export const MISSION_CHANNEL_REDUCERS: ChannelReducers = {
  research: 'lastValue', ground: 'lastValue', dedup: 'lastValue',
  shape: 'lastValue', decompose: 'lastValue', critique: 'lastValue', granularity: 'lastValue',
  decisions: 'lastValue',
  arcHint: 'append',      // ★ 손실체인 차단 — 기여 이력 누적, effective = 마지막 non-null
  failures: 'append',
  retro: 'append',
  // ★ 실행 채널(UR0 통합 런타임 foundation·2026-07-19) — read-through 조립기가 4소스에서 파생한
  //   현재 단면(snapshot). frames/phases 는 전체 리스트를 매번 세팅하는 뷰라 lastValue(누적 log 는
  //   exec-frame 저널이 담당). progress=Ledger 판정 단면. UR1+ 에서 coordinatorStep write 로 cutover.
  phases: 'lastValue', frames: 'lastValue', progress: 'lastValue',
  // ★ workingMemory 채널(일원화 RFC U1·2026-07-19) — UR0 이 4소스로 지목했으나 fold 안 한 워킹메모리를
  //   중앙 State 로 통합. frames 와 대칭(저널 jsonl → 채널 파생 snapshot)이라 lastValue(누적 저장은
  //   working-memory.jsonl 이 담당·dedup 리스트를 매번 세팅). 코디네이터가 reusables/decisions 를 본다.
  workingMemory: 'lastValue',
  // ★ lifecycle 채널(LG1 빌드 가시화·2026-07-19) — apmStatus + 빌드/exec 프레임에서 파생한 생애주기 단면
  //   (phase: pending/building/executing/done). decompose 전(phases=[]·exec=[]) 미션도 조율자가 "빌드 중"으로
  //   인지(라이브 갭 수복). lastValue snapshot(저장은 프레임 저널·apmStatus).
  lifecycle: 'lastValue',
  // ★ routing 채널(UR2·2026-07-19) — 조율자 라우팅 결정(페이즈→프레임워크)을 State 가 소유. append 로
  //   결정 이력 누적, effective=페이즈별 마지막. 재실행/재개 시 State 에서 라우팅을 읽어 durable(재litigate
  //   방지). LangGraph Command.update 가 State 채널에 write 하는 것과 동형.
  routing: 'append',
  // ★ review 채널(R1·RFC-autonomous-pr-review·2026-07-20) — 자율 PR 리뷰 판정(verdict/PR/findings)을 State 가
  //   소유. append 로 리뷰 이력 누적(재작업 라운드마다 1건), effective=페이즈별 마지막. durable(resume 시 재리뷰
  //   방지·리뷰 압력 회상). routing 동형(coordinator write·4소스 파생 아님 → assemble carry-over 필요).
  review: 'append',
  // ★ cursor 채널(UR3·2026-07-19) — 리플레이 goto 가 지정한 '현재 재개 위치'를 State 가 소유. lastValue
  //   (최신 커서만·클리어=undefined). run-mission 이 시작 시 소비해 그 페이즈를 ready 로 리셋(executor 재개).
  cursor: 'lastValue',
  // ★ signal 채널(CW3 signal control·RFC-coordinator-walker-control-plane P4·2026-07-21) — 조율자가
  //   실행 중(mid-phase) walker 에 보내는 신호(abort/pause). walker turn 루프(llm.ts)가 매 turn
  //   pollSignal 로 폴링·graceful 수신. lastValue(최신 신호만·클리어=null·1회 소비). 종전엔 cancel=SIGTERM
  //   kill·pause=phase 경계뿐이라 mid-phase 양방향 채널 0(audit #59 (b)). turn 관측(방출↑)의 대칭 수신(↓).
  signal: 'lastValue',
};

/** 중앙 상태 — 채널명 → 값(append 채널은 배열). 미기록 채널 부재. */
export type MissionState = Record<string, unknown>;

/** State 에 채널 갱신 1건 적용(미션 스키마 바인딩). 새 State 반환(불변). 순수. */
export function applyChannelUpdate(state: MissionState, channel: string, value: unknown): MissionState {
  return applyChannelUpdateWith(state, channel, value, MISSION_CHANNEL_REDUCERS);
}

/** 여러 채널 갱신을 순서대로 fold(미션 스키마 바인딩). 순수. */
export function applyChannelUpdates(state: MissionState, updates: Array<{ channel: string; value: unknown }>): MissionState {
  return applyChannelUpdatesWith(state, updates, MISSION_CHANNEL_REDUCERS);
}

/** ★ arcHint 손실 차단의 실체 — append 이력에서 마지막 non-null 숫자를 유효 arcHint 로. 한 번 5 가
 *  들어오면 이후 undefined 기여가 와도 5 가 유지된다(INCIDENT 근본 차단). 이력 없으면 undefined. 순수. */
export function effectiveArcHint(state: MissionState): number | undefined {
  return effectiveLastNumber(state, 'arcHint');
}

// ── UR3 재개 커서 — State 가 '현재 재개 위치'를 소유(2026-07-19) ────────────────
/** 재개 커서 — 리플레이 goto/rewind 가 지정한 재개 대상 페이즈. run-mission 이 소비(ready 리셋). */
export interface ResumeCursor { phaseId: string; phaseTitle?: string; reason?: string; }

/** 재개 커서 → cursor 채널 갱신(lastValue). null 로 클리어. 순수. */
export function cursorUpdate(cursor: ResumeCursor | null): { channel: string; value: ResumeCursor | null } {
  return { channel: 'cursor', value: cursor };
}

/** 중앙 State 에서 재개 커서 읽기(유효 phaseId 있을 때만). 순수. undefined=커서 없음. */
export function readCursor(state: { cursor?: unknown }): ResumeCursor | undefined {
  const c = state.cursor;
  if (c && typeof c === 'object' && typeof (c as ResumeCursor).phaseId === 'string' && (c as ResumeCursor).phaseId.length > 0) {
    return c as ResumeCursor;
  }
  return undefined;
}

// ── CW3 signal control — 조율자→walker mid-phase 신호(2026-07-21) ────────────────
/** 조율자→walker 실행 중 신호. abort=graceful 중단(부분 결과 반환) · pause=graceful 정지(재개는 상위).
 *  reason=관측/표면화용 사유. at=발신 시각(관측). walker turn 루프가 매 turn 폴링·1회 소비. */
export interface MissionSignal { kind: 'abort' | 'pause'; reason?: string; at?: number; /** ★ 신호가 향한 페이즈(2026-07-23) — 소비자가 현재 페이즈와 대조해 다른(이전) 페이즈용 신호 누수를 차단. 없으면 global(TTL 만 적용·레거시). */ phaseId?: string; }

/** 미션 신호 → signal 채널 갱신(lastValue). null 로 클리어(소비 후). 순수. */
export function signalUpdate(sig: MissionSignal | null): { channel: string; value: MissionSignal | null } {
  return { channel: 'signal', value: sig };
}

/** 중앙 State 에서 미션 신호 읽기(유효 kind 있을 때만). 순수. undefined=신호 없음. */
export function readSignal(state: { signal?: unknown }): MissionSignal | undefined {
  const s = state.signal;
  if (s && typeof s === 'object' && ((s as MissionSignal).kind === 'abort' || (s as MissionSignal).kind === 'pause')) {
    return s as MissionSignal;
  }
  return undefined;
}
