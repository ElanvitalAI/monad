// ── 공통 스트리밍 코어 — single-flight keep-latest 편집 루프 (C5a · 2026-07-16) ─────────
//
// 세션 패브릭 C5(청크 fan-out) 의 channel-agnostic 스트리밍 코어. hermes-agent·openclaw 조사
// 결과 두 참조 모두 이 루프를 telegram/discord 가 공유한다(참조 = openclaw createDraftStreamLoop).
// 현 monad 는 telegram/discord streamer 가 복붙 쌍둥이(makeStreamer×2) — 이 모듈이 그 공통분모.
//
// 핵심 성질(참조에서 채택):
//  - single-flight: 동시 편집 1건. 진행 중이면 최신 텍스트만 pending 에 보관(중간 프레임 drop).
//  - keep-latest: pending 은 항상 최신(오래된 프레임 버림) — 편집 큐잉 금지.
//  - throttle: 편집 최소 간격(텔레그램/디스코드 ~1s·레이트리밋 회피).
//  - saturated dedup: pending == 마지막 전송 텍스트면 편집 스킵(no-op 편집도 레이트 과금).
//  - minInitialChars: 첫 편집 전 최소 길이(1자 placeholder 로 무의미한 모바일 푸시 방지).
//  - retry_after suspend: rate-limit 에러 시 blind backoff 아니라 retry_after 만큼 park(상한 있음).
//  - maxConsecutiveFailures: 연속 실패 N 후 preview 중단(warn 스팸 금지).
//  - generation guard: 늦게 resolve 되는 편집이 다음 턴 메시지를 clobber 못 하게 세대 검증.
//
// 순수 로직 — I/O(edit)·시계(now)·타이머(schedule) 전부 주입 → 결정론 유닛테스트. 런타임 무연결
// (telegram/discord sink 가 파라미터 주입해 사용·C5b/C5c). flag-OFF 기본이므로 배달 무영향.

/** 주입 의존성 — 채널 편집 fn·시계·타이머. */
export interface DraftStreamLoopDeps {
  /** 채널 편집 — 같은 메시지를 text 로 in-place 갱신. throw = 실패(→retry_after/실패카운트 판정). */
  edit: (text: string) => Promise<void>;
  /** rate-limit 에러에서 retry_after(ms) 추출. rate-limit 아니면 null(→실패카운트). 서피스별 위치 상이. */
  retryAfterMs?: (err: unknown) => number | null;
  /** 현재 시각(ms). 기본 Date.now — 테스트는 가짜 시계 주입. */
  now?: () => number;
  /** ms 후 fn 실행 예약, 취소 fn 반환. 기본 setTimeout — 테스트는 수동 큐 주입. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface DraftStreamLoopConfig {
  /** 편집 최소 간격(ms). 텔레그램/디스코드 ~1000-1100. */
  throttleMs: number;
  /** 첫 편집 전 최소 누적 길이(푸시 품질). 기본 0(즉시). */
  minInitialChars?: number;
  /** 연속 실패 N 회 후 preview stop. 기본 3. */
  maxConsecutiveFailures?: number;
  /** retry_after suspend 상한(ms). 기본 60_000. */
  maxSuspendMs?: number;
}

export interface DraftStreamLoop {
  /** 최신 텍스트 갱신(keep-latest) — throttle/single-flight 로 편집 스케줄. */
  update: (text: string) => void;
  /** pending 즉시 편집(finalize 前 마지막 프레임 강제). throttle/minInitial 우회. inFlight 대기. */
  flush: () => Promise<void>;
  /** 스트림 종료 — pending 버리고 타이머 취소. 이후 update 무시. */
  stop: () => void;
  isStopped: () => boolean;
  /** 현재 세대(generation guard 진단). */
  generation: () => number;
  /** 턴 경계 — 세대++·pending/lastSent 리셋(다음 스트림은 새 정체성). 늦은 편집 clobber 방지. */
  bump: () => void;
}

export function createDraftStreamLoop(
  deps: DraftStreamLoopDeps,
  config: DraftStreamLoopConfig,
): DraftStreamLoop {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  const retryAfterMs = deps.retryAfterMs ?? (() => null);
  const throttleMs = config.throttleMs;
  const minInitialChars = config.minInitialChars ?? 0;
  const maxFailures = config.maxConsecutiveFailures ?? 3;
  const maxSuspendMs = config.maxSuspendMs ?? 60_000;

  let pending: string | null = null;
  let lastSentText: string | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY; // 첫 편집은 즉시(throttle 미적용)

  let inFlight = false;
  /** 진행 중인 편집의 완료 신호 — flush 가 «이것»을 기다린다(마이크로태스크 스핀 금지 · 아래 flush 주석). */
  let inFlightDone: Promise<void> | null = null;
  let releaseInFlight: (() => void) | null = null;
  let stopped = false;
  let suspendedUntil = 0;
  let consecutiveFailures = 0;
  let gen = 0;
  let cancelTimer: (() => void) | null = null;

  function clearTimer(): void {
    if (cancelTimer) { cancelTimer(); cancelTimer = null; }
  }

  /** 다음 편집까지 대기 ms — throttle 간격 + suspend 잔여의 max. */
  function waitMs(): number {
    const t = now();
    const throttleWait = Math.max(0, lastSentAt + throttleMs - t);
    const suspendWait = Math.max(0, suspendedUntil - t);
    return Math.max(throttleWait, suspendWait);
  }

  function scheduleFlush(force = false): void {
    if (stopped || inFlight || pending === null) return;
    // 첫 전송 minInitialChars 게이트 — force(flush)면 우회. 아직 미달이면 더 쌓일 때까지 대기.
    if (!force && lastSentText === null && pending.length < minInitialChars) return;
    const w = force ? 0 : waitMs();
    if (w > 0) {
      if (!cancelTimer) cancelTimer = schedule(() => { cancelTimer = null; void doFlush(force); }, w);
      return;
    }
    void doFlush(force);
  }

  async function doFlush(force = false): Promise<void> {
    if (stopped || inFlight || pending === null) return;
    // force 아니면 재확인(타이머 경과 사이 상태 변화 가능).
    if (!force && waitMs() > 0) { scheduleFlush(force); return; }
    // saturated dedup — 마지막 전송과 동일하면 no-op 편집 스킵(레이트 절약).
    if (pending === lastSentText) { pending = null; return; }
    const toSend = pending;
    pending = null;
    inFlight = true;
    inFlightDone = new Promise<void>((resolve) => { releaseInFlight = resolve; });
    const sendGen = gen;
    try {
      await deps.edit(toSend);
      // generation guard — 편집 resolve 사이 bump/stop 됐으면 상태 갱신 안 함(clobber 방지).
      if (sendGen === gen && !stopped) {
        lastSentText = toSend;
        lastSentAt = now();
        consecutiveFailures = 0;
      }
    } catch (err) {
      const ra = retryAfterMs(err);
      if (sendGen === gen && !stopped) {
        if (ra != null) {
          // rate-limit — retry_after 만큼 suspend(상한). 텍스트 재-pending 해 재시도.
          suspendedUntil = now() + Math.min(ra, maxSuspendMs);
          if (pending === null) pending = toSend;
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) { stop(); }
        }
      }
    } finally {
      inFlight = false;
      const release = releaseInFlight;
      releaseInFlight = null;
      inFlightDone = null;
      release?.();
      if (!stopped && pending !== null) scheduleFlush(force);
    }
  }

  function stop(): void {
    stopped = true;
    pending = null;
    clearTimer();
  }

  return {
    update(text: string): void {
      if (stopped) return;
      pending = text;
      scheduleFlush();
    },
    async flush(): Promise<void> {
      if (stopped) return;
      // inFlight 편집 완료 대기 후 pending 강제 전송(throttle/minInitial 우회).
      // 최대 한 사이클 — 재진입 없이 현재 pending 을 한 번 밀어낸다.
      // 🩸 2026-09-25 운영 사고: `while (inFlight) { await Promise.resolve(); }` 는 «마이크로태스크»에만 양보해
      //   I/O(진행 중인 텔레그램 HTTP 편집)가 영영 완료되지 못했다 → CPU 100% · 이벤트 루프 정지(넥서스 health 무응답).
      //   짧은 답(첫 조각 전송 중에 final 이 옴)에서 난다. ⇒ 진행 중인 편집의 «완료 promise» 를 기다린다.
      while (inFlight && inFlightDone) { await inFlightDone; }
      if (pending !== null && pending !== lastSentText) {
        await doFlush(true);
      }
    },
    stop,
    isStopped: () => stopped,
    generation: () => gen,
    bump(): void {
      gen++;
      pending = null;
      lastSentText = null;
      lastSentAt = Number.NEGATIVE_INFINITY; // 새 스트림 첫 편집도 즉시
      suspendedUntil = 0;
      consecutiveFailures = 0;
      clearTimer();
    },
  };
}
