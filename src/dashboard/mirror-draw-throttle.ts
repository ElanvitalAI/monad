// ⛔⭐⭐ **로그가 그리기를 부르고, 그리기가 로그를 낸다 — «비동기» 되먹임**
//
// 📏 실측(2026-09-17 · `debug.level=diag` · 진짜 PTY 24x80 · 프로덕션 config):
//   8초 동안 화면 출력 **50MB**. 키는 먹지 않고 프롬프트 행만 계속 다시 그려진다.
//   대표 이 겪은 「커서만 깜빡이고 아무 키도 안 먹는다」가 이 모양이다.
//
// 🔑 고리:
//   `debug.setMirrorHook(line => { …; draw(); })`        로그 한 줄 → 그리기 요청
//   `draw()` 의 flush 마이크로태스크 → `debug.log('dashboard.draw', 'flush-microtask', …)`
//   ⇒ 그리기가 다시 로그를 내고, 그 로그가 다시 그리기를 부른다.
//
// ⛔ **동기 재진입 가드로는 «안 막힌다»** — `draw()` 는 `queueMicrotask` 로 미루고 «바로» 돌아오므로
//    가드 변수는 이미 풀려 있다. 📏 실측: 가드를 넣어도 45MB 였다.
//
// ✅ 그래서 ***시간으로 묶는다*** — 「로그 → 그리기」 방향만 최소 간격을 둔다.
//    그리기 자체(키 입력·스트리밍·리사이즈)는 그대로 돈다.
//    📏 실측: 50MB → **0.11MB**(430배) · 그리고 키가 먹는다(타이핑이 프롬프트에 그대로 들어간다).

/** 로그 미러가 그리기를 부르는 «최소 간격». 이 값이 곧 「로그발 그리기」의 상한(초당 약 8회)이다. */
export const MIRROR_DRAW_MIN_INTERVAL_MS = 120;

/** ⛔ 관측 자체가 «로그»라서 되먹임을 다시 만들 수 있다 ⇒ 평상시엔 «한 줄도» 안 낸다.
 *    한 창에서 이만큼 미뤄졌을 때만(= 진짜 폭주일 때만) 말한다. */
export const MIRROR_DRAW_OBSERVE_SUPPRESSED_THRESHOLD = 20;
/** 그리고 말하더라도 이 간격보다 자주는 안 낸다. */
export const MIRROR_DRAW_OBSERVE_COOLDOWN_MS = 5_000;

export interface MirrorDrawThrottleDeps {
  readonly draw: () => void;
  readonly now?: () => number;
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  /** ⛔ 관측은 «미러를 타지 않는 길»로 내보낸다 — 타면 이 되먹임을 다시 만든다. */
  readonly observe?: (payload: MirrorDrawThrottleObservation) => void;
}

export interface MirrorDrawThrottleObservation {
  /** 이 창에서 «미뤄진» 그리기 요청 수(0이면 상한에 안 닿았다). */
  readonly suppressed: number;
  /** 지금까지 «로그발»로 실제 그린 횟수. */
  readonly drawn: number;
  readonly intervalMs: number;
}

export interface MirrorDrawThrottle {
  /** 로그 한 줄이 들어왔다 — 필요하면 그리기를 부르고, 아니면 미룬다. */
  readonly request: () => void;
  /** 진단용 — 지금까지의 수. */
  readonly stats: () => MirrorDrawThrottleObservation;
}

/**
 * 「로그 → 그리기」에만 최소 간격을 두는 스로틀.
 * ⛔ 그리기를 «버리지» 않는다 — 창이 지나면 «한 번» 그린다(마지막 상태가 반드시 화면에 온다).
 */
export function createMirrorDrawThrottle(deps: MirrorDrawThrottleDeps): MirrorDrawThrottle {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  // ⛔ 0 으로 두면 «시계가 0에서 시작하는 자리»에서 첫 요청이 미뤄진다 — 첫 그리기는 «항상 즉시»여야 한다.
  let lastDrawAt = Number.NEGATIVE_INFINITY;
  let pending = false;
  let suppressed = 0;
  let drawn = 0;
  let lastObservedAt = Number.NEGATIVE_INFINITY;

  const fire = (): void => {
    lastDrawAt = now();
    drawn += 1;
    const observed = { suppressed, drawn, intervalMs: MIRROR_DRAW_MIN_INTERVAL_MS };
    suppressed = 0;
    try { deps.draw(); } catch { /* 부팅 중에는 draw 가 아직 없다 */ }
    // ⛔ 평상시엔 안 낸다 — 관측이 로그이고, 로그가 이 되먹임의 «입력»이기 때문이다.
    if (observed.suppressed >= MIRROR_DRAW_OBSERVE_SUPPRESSED_THRESHOLD
      && (lastObservedAt === Number.NEGATIVE_INFINITY
        || lastDrawAt - lastObservedAt >= MIRROR_DRAW_OBSERVE_COOLDOWN_MS)) {
      lastObservedAt = lastDrawAt;
      deps.observe?.(observed);
    }
  };

  /** ⛔ 예약이 «늦는» 사이에 즉시 그리기가 나면 간격이 깨진다 — 그래서 타이머가 «깨어나서 다시 잰다».
   *    (리뷰 지적 · 2026-09-17) 취소가 아니라 «재검사»로 푼다 — 취소는 스케줄러 계약을 하나 더 요구한다. */
  const arm = (ms: number): void => {
    const timer = schedule(() => {
      const wait = MIRROR_DRAW_MIN_INTERVAL_MS - (now() - lastDrawAt);
      if (wait > 0) { arm(wait); return; }        // 그 사이 누가 그렸다 — 남은 만큼 다시 잔다
      pending = false;
      if (suppressed === 0) return;               // 미룬 것이 없으면 «괜한 그리기»를 안 한다
      fire();
    }, ms);
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  };

  return {
    request: () => {
      const wait = MIRROR_DRAW_MIN_INTERVAL_MS - (now() - lastDrawAt);
      if (wait <= 0) { fire(); return; }
      suppressed += 1;
      if (pending) return;
      pending = true;
      arm(wait);
    },
    stats: () => ({ suppressed, drawn, intervalMs: MIRROR_DRAW_MIN_INTERVAL_MS }),
  };
}
