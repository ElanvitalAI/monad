// ── 스케줄 실행 관측성 3계층 공통 창구 (RFC-scheduler-execution-observability·2026-07-15) ──────
//
// 크론이 실제 파이어할 때 그 실행을 3계층에 기록하는 단일 헬퍼(래퍼·데몬 runner·trigger 공통):
//   ① logs.db (활동·매 실행)   — debug.log('schedule.run', ...) → `elanous logs --surface scheduler`
//   ② 레지스트리 (인지·최신)    — markResult 제자리 갱신(1행/잡·바운디드)
//   ③ 자기기억 (최적화·이상만)  — recordAutonomousActionSafe(loop='scheduler') 를 error 온셋에만
//
// 기억 최적화(대표 지시): 정상 파이어(ok)와 연속 실패는 자기기억에 안 남긴다(오버플로 방지). 오직
// ok→error 전이(새 이상)만 기억한다. 각 다리 fail-soft(관측이 실제 잡을 절대 안 깬다).

import type { Database } from 'bun:sqlite';
import { markResult } from './schedule-registry.js';
import { debug } from '../debug/log.js';
import { recordAutonomousActionSafe } from './autonomy-log.js';

export interface ScheduledExecutionRecord {
  status: 'ok' | 'error';
  exit?: number | null;
  durationMs?: number | null;
  via?: string;                 // crontab | tick | catchup | trigger | manual
  error?: string | null;
  at?: string;                  // 발화 시각(ISO) — 미지정 시 now(데몬 경로가 정시 전달).
}

/** 순수 — 자기기억에 이상을 남길까? error 이고 직전이 error 가 아닐 때만(온셋). 정상·연속실패는 false. */
export function shouldRecordAnomaly(status: 'ok' | 'error', prevStatus: string | null | undefined): boolean {
  return status === 'error' && prevStatus !== 'error';
}

/**
 * 크론 실행 1건을 3계층에 기록. id/db 있으면 레지스트리(②)도 갱신, 없으면 logs.db(①)만. error 온셋만
 * 자기기억(③). 각 다리 독립 fail-soft. via 기본 'crontab'(래퍼) — 데몬은 'tick'/'catchup'/'trigger' 전달.
 */
export function recordScheduledExecution(
  name: string,
  result: ScheduledExecutionRecord,
  opts: { db?: Database; id?: string; prevStatus?: string | null } = {},
): void {
  const via = result.via ?? 'crontab';
  // ① logs.db — 매 실행(고볼륨·retention). sink 등록된 프로세스에서만 실제 도달(래퍼/데몬).
  try {
    debug.log('schedule.run', name, {
      status: result.status, exit: result.exit ?? null, ms: result.durationMs ?? null, via,
      ...(result.error ? { error: result.error.slice(0, 200) } : {}),
    }, { level: 'info' });
  } catch { /* fail-soft */ }
  // ② 레지스트리 — 최신 상태 제자리 갱신(바운디드·1행/잡).
  if (opts.db && opts.id) {
    try {
      markResult(opts.db, opts.id, {
        ...(result.at ? { at: result.at } : {}),
        status: result.status, exit: result.exit ?? null,
        durationMs: result.durationMs ?? null, via, error: result.error ?? null,
      });
    } catch { /* fail-soft */ }
  }
  // ③ 자기기억 — 이상 온셋만(ok→error). 정상·연속실패는 안 남긴다(오버플로 방지·대표 지시).
  if (shouldRecordAnomaly(result.status, opts.prevStatus)) {
    try {
      recordAutonomousActionSafe({
        loop: 'scheduler',
        action: `크론 실패: ${name} (exit ${result.exit ?? '?'})`,
        rationale: '예약 실행 비정상 종료 — 스케줄러 자기인지(이상 온셋·연속실패는 미기록)',
        ...(result.error ? { outcome: result.error.slice(0, 300) } : {}),
        refs: { name, exit: result.exit ?? null, via },
        tags: 'scheduler,anomaly',
      });
    } catch { /* fail-soft */ }
  }
}
