// ── 이벤트루프 stall watchdog (#24 · 2026-07-21) ─────────────────────────────────────
//
// 증상: 텔레그램 턴 후 메인스레드 JS 무한루프 → 이벤트루프 굶김 → telegram 폴링 정지(무응답).
// bun 은 JIT 라 `sample` 이 함수명까지 심볼화 못 하고, 데몬은 `--inspect` 없이 떠 attach 불가 →
// **근본 프레임 미특정(관측 갭)**. 이 watchdog 가 그 갭을 메운다(제1원칙: 관측이 스스로 증가).
//
// 메커니즘:
//   ① 메인이 매 intervalMs 마다 heartbeat(SharedArrayBuffer 의 BigInt ts)를 갱신 + heartbeat 파일에
//      {ts, activity} overwrite. **메인이 blocked 면 heartbeat 가 멈춘다.**
//   ② 별도 **worker 스레드**(자기 이벤트루프라 안 굶음)가 heartbeat 를 폴링 → stale > stallMs 면 stall!
//      → stallLog 파일 + stderr 에 능동 기록(데몬 blocked 여도 워커는 씀).
//   ③ 메인은 의심 경로 진입 시 setEventLoopActivity(label) → logs.db 기록(blocked 前 flush).
//   ⇒ 재현 후: 워커 stall 시각 + logs.db 마지막 activity + heartbeat 파일 lastActivity = **범인 특정**.
//
// ⚠️ 완전 무한루프여도 워커가 stall 을 확실히 잡는다(heartbeat 정지 자체가 신호). in-process setInterval
//    lag 감지는 루프가 끝나야만 잡혀 무한루프엔 무용 → 워커 필수.

import { Worker } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { debug } from './log.js';

/** stall 판정(순수·테스트 가능) — 워커/메인이 공유하는 핵심 로직. */
export function evaluateStall(
  lastHeartbeatMs: number,
  nowMs: number,
  stallMs: number,
  wasStalling: boolean,
): { stalling: boolean; event: 'stall-START' | 'stall-ONGOING' | 'stall-RECOVERED' | 'ok'; staleMs: number } {
  const staleMs = nowMs - lastHeartbeatMs;
  if (staleMs > stallMs) {
    return { stalling: true, event: wasStalling ? 'stall-ONGOING' : 'stall-START', staleMs };
  }
  return { stalling: false, event: wasStalling ? 'stall-RECOVERED' : 'ok', staleMs };
}

let hbView: BigInt64Array | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let worker: Worker | undefined;
let currentActivity = 'idle';
let activitySince = Date.now();
let heartbeatFilePath: string | undefined;

/** 메인스레드가 지금 무슨 작업 중인지 표시(stall 시 범인 특정). 의심 경로 진입/이탈에 심는다.
 *  logs.db 에도 남겨(blocked 前 flush) 워커 stall 시각과 대조. label 은 짧게(`<comp>:<op>`). */
export function setEventLoopActivity(label: string): void {
  currentActivity = label;
  activitySince = Date.now();
  try { debug.log('watchdog', 'activity', { label }); } catch { /* fail-soft */ }
}

/** 현재 activity(테스트/진단). */
export function currentEventLoopActivity(): { label: string; sinceMs: number } {
  return { label: currentActivity, sinceMs: activitySince };
}

export interface WatchdogOptions {
  /** heartbeat 파일 — 매 tick {ts,activity,pid} overwrite(post-mortem lastActivity). */
  heartbeatFile: string;
  /** stall 능동 기록 append 파일(워커가 씀). */
  stallLogFile: string;
  intervalMs?: number;   // heartbeat/poll 주기(기본 500)
  stallMs?: number;      // stall 임계(기본 5000)
}

/** watchdog 기동(idempotent). 메인 heartbeat + 워커 감시. 워커 생성 실패 시 fail-soft(경고만·데몬 정상). */
/** 관측/테스트용 — 워치독이 이 프로세스에서 도는가. */
export function isEventLoopWatchdogActive(): boolean {
  return timer !== undefined;
}

export function startEventLoopWatchdog(opts: WatchdogOptions): void {
  // ★ gate 격리(2026-07-21·병렬 dogfood 실측) — 무결성 게이트의 `bun test`/build 서브프로세스에선
  //   워치독을 끈다. 이유: ① 워치독 stall 로그가 gate 출력(bun test stderr)을 오염 ② 워커스레드+
  //   setInterval 가 병렬 부하(N goal-loop·N gate)에 오버헤드 가중. 워치독은 데몬/goal-loop 실행용이지
  //   test 러너용이 아니다. gate(integrity-gate.defaultRunCmd)가 이 env 를 주입. [[ROADMAP-monad-is-all-pty-unified-autonomy-2026-07-21]].
  if (process.env.MONAD_NO_WATCHDOG === '1') return;
  if (timer) return;
  const intervalMs = opts.intervalMs ?? 500;
  const stallMs = opts.stallMs ?? 5000;
  heartbeatFilePath = opts.heartbeatFile;
  const sab = new SharedArrayBuffer(8);
  hbView = new BigInt64Array(sab);
  Atomics.store(hbView, 0, BigInt(Date.now()));

  timer = setInterval(() => {
    const now = Date.now();
    Atomics.store(hbView!, 0, BigInt(now));
    try {
      writeFileSync(heartbeatFilePath!, JSON.stringify({ ts: now, activity: currentActivity, activitySince, pid: process.pid }));
    } catch { /* fail-soft */ }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    // 워커 파일 URL — 현재 모듈의 확장자를 그대로 파생(source=.ts·번들=.js 자동 매칭).
    const workerUrl = import.meta.url.replace(/event-loop-watchdog\.(ts|js|mjs)$/, 'event-loop-watchdog-worker.$1');
    worker = new Worker(new URL(workerUrl), {
      workerData: { sab, intervalMs, stallMs, stallLogFile: opts.stallLogFile, heartbeatFile: opts.heartbeatFile },
    });
    worker.unref();
    worker.on('error', (e: Error) => { try { debug.log('watchdog', 'worker-error', { error: String(e?.message ?? e).slice(0, 200) }, { level: 'error' }); } catch { /* */ } });
    debug.log('watchdog', 'started', { intervalMs, stallMs, stallLogFile: opts.stallLogFile });
  } catch (e) {
    // 워커 생성 실패(번들/해상도) → 데몬은 정상 유지(watchdog 만 비활성). 관측 남김.
    try { debug.log('watchdog', 'worker-spawn-failed', { error: String((e as { message?: string })?.message ?? e).slice(0, 200) }, { level: 'error' }); } catch { /* */ }
  }
}

export function stopEventLoopWatchdog(): void {
  if (timer) { clearInterval(timer); timer = undefined; }
  if (worker) { void worker.terminate(); worker = undefined; }
  hbView = undefined;
}
