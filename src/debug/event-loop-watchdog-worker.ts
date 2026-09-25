// 이벤트루프 stall watchdog 워커 (#24 · 2026-07-21) — 메인스레드 heartbeat 를 감시한다.
// 워커는 자기 이벤트루프라 메인이 blocked 여도 안 굶는다 → 메인 stall 을 확실히 잡아 능동 기록.
// 완전 무한루프여도 heartbeat 정지 자체가 신호(in-process setInterval 은 못 잡음).
//
// heartbeat = SharedArrayBuffer BigInt64(메인이 매 tick Atomics.store). stale > stallMs → stall.
// stall 시 heartbeat 파일에서 lastActivity(범인 후보)를 읽어 stallLog 파일 + stderr 에 append.

import { workerData } from 'node:worker_threads';
import { appendFileSync, readFileSync } from 'node:fs';

interface WD { sab: SharedArrayBuffer; intervalMs: number; stallMs: number; stallLogFile: string; heartbeatFile: string }
const { sab, intervalMs, stallMs, stallLogFile, heartbeatFile } = workerData as WD;
const hb = new BigInt64Array(sab);
let wasStalling = false;

function lastActivity(): { activity: string; ts: number } {
  try {
    const j = JSON.parse(readFileSync(heartbeatFile, 'utf8')) as { activity?: string; ts?: number };
    return { activity: j.activity ?? 'unknown', ts: j.ts ?? 0 };
  } catch {
    return { activity: 'unknown', ts: 0 };
  }
}

function emit(rec: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...rec }) + '\n';
  try { appendFileSync(stallLogFile, line); } catch { /* fail-soft */ }
  try { process.stderr.write(`⚠️ [event-loop-watchdog] ${line}`); } catch { /* fail-soft */ }
}

setInterval(() => {
  const last = Number(Atomics.load(hb, 0));
  const staleMs = Date.now() - last;
  if (staleMs > stallMs) {
    const { activity, ts } = lastActivity();
    // 첫 감지=stall-START, 이후 주기적 stall-ONGOING(지속시간 추적). 둘 다 범인 activity 포함.
    emit({
      event: wasStalling ? 'stall-ONGOING' : 'stall-START',
      staleMs,
      lastActivity: activity,
      lastHeartbeat: new Date(last).toISOString(),
      activityHeartbeatTs: ts ? new Date(ts).toISOString() : null,
    });
    wasStalling = true;
  } else if (wasStalling) {
    emit({ event: 'stall-RECOVERED', staleMs });
    wasStalling = false;
  }
}, intervalMs);
