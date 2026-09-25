// ── Capture substrate · 제어루프 observe 서피스 어댑터 (P3b-2 · 2026-07-25) ──────────────
//
// EMIT-side(#5402·makeMissionObserveStep)가 ReAct 제어루프의 매 스텝 화면을 SelfReportFrame 으로 프레임
// 버스에 발행한다. 이 어댑터는 그 프레임 스트림을 **구조화 진행 다이제스트**(state + 요약 1줄)로 압축해
// observe 서피스(로그 패브릭·TUI 관찰창·텔레그램 out)에 노출한다 — raw 화면(이미 `monad self screen`/manifest
// bridge 가 담당)이 아니라 "지금 무엇을 하고 있나"의 소화된 서사.
//
// ── 재발명 0 · 얇은 어댑터 (PLAN §7-2 P3b-2) ────────────────────────────────────────
//   · 구독 = self-report-frame.subscribeSurfaceFrames(기존 버스 pub/sub·단일 서피스 채널).
//   · state = frame-state-detect.classifyFrameState(기존 #1 상태 분류·idle/working/blocked/…).
//   · lifecycle = frame-recorder.recordSurfaceFromBus 패턴 미러(구독+처리를 단일 stop 으로 소유).
//   엔진(제어루프 brain)은 **무접촉** — 순수 관측축. sink 는 주입(로그/텔레그램/TUI 어느 서피스든 얇게 부착).
//
// ── throttle/dedup (서피스 스팸 방지) ─────────────────────────────────────────────
//   매 프레임이 아니라 **state 전이** 또는 **최소 간격 경과** 시에만 emit(frame-log-diagnosis dedup 정신).
//   단일 서피스 채널 구독이라 throttle 상태도 단일 트랙(직전 emit state/at). 애그리게이트(fleet 관찰창)
//   소비자가 랜딩하면 서피스별 맵 + subscribeAllFrames 로 얇게 확장(재발명 0).

import { AGENT_MISSION_STATE_RULES, classifyFrameState, type FrameState } from './frame-state-detect.js';
import { subscribeSurfaceFrames, type SelfReportFrame } from './self-report-frame.js';
import type { ChannelBus, ChannelSubscription } from '../terminal-matrix/channel-bus.js';
import { debug } from '../debug/log.js';

/** 보호된 관측 로그 — 텔레메트리 자체의 예외가 fail-soft(관측이 관측대상 안 깸)를 깨지 않게 이중 삼킴.
 *  무음 고장(swallow) 진단용: attach/sink 실패를 남기되 미션/구독은 절대 안 깬다. */
function safeObserveLog(event: string, data: Record<string, unknown>): void {
  try { debug.log('capture.observe', event, data, { level: 'warn' }); } catch { /* 텔레메트리 실패도 삼킴 */ }
}

/** 제어루프 진행 다이제스트 — 소비 서피스가 렌더할 최소 구조. */
export interface ControlObserveDigest {
  /** exec:<ptyId> 등 프레임 서피스 id. */
  readonly surfaceId: string;
  /** K4 run-identity(있으면). run 단위 진행 join. */
  readonly runId?: string;
  /** #1 화면 상태 분류(idle/working/blocked/waiting/done/unknown). */
  readonly state: FrameState;
  /** 화면의 마지막 의미있는 1줄(ANSI 제거·압축·잘림) — "지금 뭐 하나" 한눈. */
  readonly summary: string;
  /** unknown일 때만 분류기가 검사한 하단 구역의 정리된 진단 입력. */
  readonly unknownInput?: readonly string[];
  /** 이 서피스에서 관측한 프레임 누계(진행 근사). */
  readonly frameCount: number;
  /** 프레임 렌더 시각(frame.at·ms) — throttle 기준이자 다이제스트 타임스탬프(별도 emit 클록 없음). */
  readonly at: number;
}

export interface ControlObserveOpts {
  /** 동일 state 유지 시 재-emit 최소 간격(ms). 기본 3000. */
  readonly minIntervalMs?: number;
  /** state 전이 시 간격 무관 즉시 emit. 기본 true(전이는 항상 관측 가치). */
  readonly emitOnStateChange?: boolean;
  /** ★ run 필터(strict) — **비어있지 않은** runId 지정 시 그와 **정확히 일치**하는 프레임만 관측한다.
   *  surfaceId(exec:<ptyId>)가 PTY 재사용으로 겹칠 때 타 run 혼입을 막는다. runId 없는 프레임도 **거부**
   *  (어느 run 인지 불명 = "이 run만 관측" 보장을 깨므로). 미지정 **또는 빈 문자열** = 필터 없음(전 프레임 통과·
   *  빈 runId 는 "run 밖"을 뜻하므로 필터 대상이 아님). */
  readonly expectRunId?: string;
}

export interface ControlObserveSession {
  /** 구독 해제(idempotent). 이후 프레임은 sink 로 안 감. */
  stop(): void;
  /** sink 로 실제 전달된 다이제스트 수(throttle 후). */
  readonly digestCount: number;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;

/** 화면 텍스트의 마지막 의미있는 1줄 — ANSI 제거·공백 압축·비어있지 않은 마지막 줄·max 코드포인트 잘림. 순수.
 *  ★ 잘림은 **코드포인트 기준**([...str])이라 경계의 이모지/surrogate pair 를 반토막 내지 않는다(should-fix). */
function digestSummary(text: string, max = 160): string {
  const lines = text
    .replace(ANSI_RE, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1] ?? '';
  const cps = [...last];
  return cps.length <= max ? last : cps.slice(0, max).join('');
}

/** 프레임 → 다이제스트(순수). state 는 classifyFrameState, summary 는 마지막 의미줄. */
function frameToDigest(frame: SelfReportFrame, frameCount: number): ControlObserveDigest {
  const verdict = classifyFrameState(frame.text, AGENT_MISSION_STATE_RULES);
  return {
    surfaceId: frame.surfaceId,
    ...(frame.runId ? { runId: frame.runId } : {}),
    state: verdict.state,
    summary: digestSummary(frame.text),
    ...(verdict.unknownInput ? { unknownInput: verdict.unknownInput } : {}),
    frameCount,
    at: frame.at,
  };
}

/** emit 판정(순수) — 직전 관측이 없거나(첫 프레임), state 가 바뀌었거나(emitOnStateChange), 마지막 emit 이후
 *  minIntervalMs 경과 시 true. throttle 코어. */
function shouldEmit(
  prev: { state: FrameState; at: number } | null,
  next: { state: FrameState; at: number },
  minIntervalMs: number,
  emitOnStateChange: boolean,
): boolean {
  if (!prev) return true;
  if (emitOnStateChange && next.state !== prev.state) return true;
  // ★ 시각 역행 방어(should-fix) — frame.at 은 wall-clock 성격이라 역행 가능(클록 조정·재부팅). 역행 시
  //   next.at - prev.at 이 음수라 minInterval 을 영원히 못 넘겨 동일 state emit 이 장시간 억제된다. 역행이면
  //   기준이 무의미 → 즉시 emit(리셋). 단조 진행이면 종전대로 간격 판정.
  if (next.at < prev.at) return true;
  return next.at - prev.at >= minIntervalMs;
}

/** 내부 — 한 서피스 채널의 프레임을 다이제스트로 변환·throttle·emit 하는 핸들러 팩토리. observeSurfaceFromBus
 *  가 **단일 서피스 채널**을 구독하므로 상태도 단일 트랙(서피스별 맵 불요 — 애그리게이트 소비자 랜딩 시 재도입). */
function makeFrameHandler(
  sink: (d: ControlObserveDigest) => void,
  opts: ControlObserveOpts,
): { onFrame: (f: SelfReportFrame) => void; count: () => number } {
  const minIntervalMs = opts.minIntervalMs ?? 3000;
  const emitOnStateChange = opts.emitOnStateChange ?? true;
  const expectRunId = opts.expectRunId;
  // ★ 관측 누계(frames)와 throttle 기준(lastEmit)을 **분리**(should-fix) — frames 는 모든 프레임에서 증가
  //   (관측은 다 함)하되, lastEmit(state/at)은 **sink 성공 emit 시에만** 전진. 그래야 sink 실패 프레임이 기준을
  //   오전진시켜 이후를 억제(전달실패 은폐)하지 않고, 다음 프레임이 prev=null 로 재시도한다.
  let frames = 0;
  let lastEmit: { state: FrameState; at: number } | null = null;
  let emitted = 0;
  let sinkErrors = 0;
  return {
    onFrame(frame: SelfReportFrame): void {
      // ★ run 필터(strict·should-fix) — expectRunId 지정 시 정확히 일치하는 프레임만 관측(누계에도 미포함).
      //   runId 없거나 다른 run 프레임은 거부 = "이 run만 관측" 보장(PTY 재사용 혼입 방지). 미지정=전 프레임.
      if (expectRunId && frame.runId !== expectRunId) return;
      frames += 1;
      const digest = frameToDigest(frame, frames);
      if (!shouldEmit(lastEmit, { state: digest.state, at: digest.at }, minIntervalMs, emitOnStateChange)) return;
      try {
        sink(digest);
        emitted += 1;
        lastEmit = { state: digest.state, at: digest.at }; // 성공 후에만 기준 전진
      } catch (e) {
        // fail-soft(구독 안 깸) — 기준 미전진 → 다음 프레임이 재시도(전달실패 은폐 방지). 단 무음 고장은
        //   진단 가능하게 보호된 텔레메트리를 남긴다(sink 실패 ≠ 정상 digestCount:0 을 구분·should-fix).
        sinkErrors += 1;
        safeObserveLog('sink-error', { surfaceId: frame.surfaceId, sinkErrors, error: e instanceof Error ? e.message : String(e) });
      }
    },
    count: () => emitted,
  };
}

/** 한 서피스(exec:<ptyId> 등)의 프레임을 구독해 진행 다이제스트를 sink 로 흘린다. 구독+처리를 단일 stop 으로
 *  소유(frame-recorder.recordSurfaceFromBus 패턴). 동일 프로세스만(ChannelBus 프로세스-로컬). */
export function observeSurfaceFromBus(
  bus: ChannelBus,
  surfaceId: string,
  sink: (d: ControlObserveDigest) => void,
  opts: ControlObserveOpts = {},
): ControlObserveSession {
  const handler = makeFrameHandler(sink, opts);
  const sub: ChannelSubscription = subscribeSurfaceFrames(bus, surfaceId, handler.onFrame);
  let stopped = false;
  return {
    stop(): void { if (!stopped) { stopped = true; sub.unsubscribe(); } },
    get digestCount(): number { return handler.count(); },
  };
}

/**
 * ★ observe 생명주기 seam(리뷰 must-fix) — 서피스에 observe 를 부착하고 async body 를 돌린 뒤, **성공·예외
 *  양쪽에서** 반드시 구독을 해제한다. attach 실패도 fail-soft(관측 설정 예외가 body=관측대상을 안 깸). 이
 *  헬퍼로 "attach→run→cleanup" 전 경로를 DI 로 단위 검증(runAgentMission 이 이걸 호출 → 배선이 곧 동작).
 *
 *  @param body 관측하며 돌릴 작업(예: runPtyControlLoop). 이 함수의 반환/예외를 그대로 전파한다.
 *  @param onSettled body 종료 후(성공·예외 불문) 이번 세션의 emit 다이제스트 수를 받는 선택 훅(요약 로그용).
 */
export async function runWithControlObserve<T>(
  bus: ChannelBus,
  surfaceId: string,
  sink: (d: ControlObserveDigest) => void,
  body: () => Promise<T>,
  opts?: { onSettled?: (digestCount: number) => void; observeOpts?: ControlObserveOpts },
): Promise<T> {
  let observe: ControlObserveSession | null = null;
  try {
    observe = observeSurfaceFromBus(bus, surfaceId, sink, opts?.observeOpts ?? {});
  } catch (e) {
    // fail-soft attach — 구독 설정 예외가 body 를 못 막는다. 무음 고장 진단용 보호된 텔레메트리(로깅 예외도
    //   이중 삼킴 → fail-soft 불변). observe=null 로 남아 이후 optional 안전 처리.
    safeObserveLog('attach-error', { surfaceId, error: e instanceof Error ? e.message : String(e) });
  }
  try {
    return await body();
  } finally {
    // ★ stop 과 onSettled 를 **각각 독립** fail-soft(should-fix) — 하나가 throw 해도 다른 하나의 계약이
    //   깨지지 않게(예: stop 실패가 onSettled 훅을 건너뛰지 않게). 둘 다 body 결과·예외를 가리지 않는다.
    const count = observe?.digestCount ?? 0;
    try { observe?.stop(); } catch { /* fail-soft */ }
    try { opts?.onSettled?.(count); } catch { /* fail-soft */ }
  }
}

// NOTE: 애그리게이트 구독(observeAllFramesFromBus)은 실제 소비 경로(관찰창/fleet observe)가 랜딩할 때 함께
//   추가한다. 지금 단일 제어루프 어댑터엔 불필요한 speculative surface라 제거(단일 서피스 채널 구독).
