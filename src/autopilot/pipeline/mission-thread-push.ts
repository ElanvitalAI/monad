// 미션 thread 저지연 push 레이어 — logs.db 내부 tail → govern edge-trigger (UR4d·2026-07-19)
//
// ★ RFC §7 UR4 저지연 push(선택층). 리서치(RESEARCH-agent-activity-detection §66·§69) 결론:
//   detached(monad run-mission) 아키텍처의 truth 는 durable 저장소 폴링 — 하지만 데몬 sweep 이 3분
//   interval 이라 "체감 반응속도"가 interval 에 묶인다. 여기에 logs.db 저지연 tail 을 얹어 worker 활동을
//   edge-trigger 로 감지 → govern/sweep 을 즉시(coalesced) 깨운다. push 는 lossy 라 truth 아님 — interval
//   폴링이 안전망으로 남고(§69 edge-triggered + bounded-timeout), push 는 지연시간만 줄인다. 그래서 interval
//   을 길게 늘려 폴링 부하까지 낮출 수 있다(반응성↔부하 결합 해제 — 대표 직관 정합).
//
// ⚠️ 재귀가드: govern/sweep 자신이 mission.registry.*·mission.coordinator.* 를 방출 → 그걸 wake 신호로
//   쓰면 자기 방출이 자기를 재-wake 하는 피드백 루프. worker 활동(mission.walker/build/exec …)만 wake 로,
//   조율자 자기 방출은 SELF_EMIT_PREFIXES 로 제외한다. + 디바운스(버스트 coalesce) + 최소 wake 간격(thrash 가드).
//   detached·lossy 전제라 놓친 활동은 interval 안전망이 결국 잡는다(push 는 truth 아님·보조층).

import { getDefaultLogStore, type LogStore } from '../../mss/logging/log-store.js';
import { debug } from '../../debug/log.js';

/** 조율자 자기 방출 카테고리 prefix — wake 신호에서 제외(재귀 피드백 가드). worker 활동만 edge-trigger. */
export const SELF_EMIT_PREFIXES = ['mission.registry', 'mission.coordinator'] as const;

/** 카테고리가 조율자 자기 방출인가(worker 활동이 아니라 sweep/govern 관측). */
export function isSelfEmitCategory(category: string): boolean {
  return SELF_EMIT_PREFIXES.some((p) => category === p || category.startsWith(`${p}.`));
}

export interface MissionActivityWatcher {
  /** tail 폴 루프 + 디바운스 타이머 정지(데몬 종료 훅). */
  stop(): void;
}

export interface WatchMissionActivityDeps {
  /** edge-trigger 콜백 — worker 활동 감지 시 coalesced 로 1회 호출(govern/sweep 실행). */
  onWake: () => void;
  /** tail 대상 store(기본 로컬 getDefaultLogStore). null 이면 no-op watcher(관측만). */
  store?: LogStore | null;
  /** tail 폴 주기(기본 1000ms) — 저지연. interval 안전망과 별개(이건 감지, 저건 truth). */
  pollMs?: number;
  /** 버스트 coalesce 창(기본 2000ms) — 활동 폭주를 wake 1회로 접는다. */
  debounceMs?: number;
  /** 연속 wake 최소 간격(기본 10000ms) — govern 재spawn thrash 가드. */
  minWakeGapMs?: number;
  /** 테스트 주입(기본 Date.now). */
  now?: () => number;
}

/** setTimeout 핸들 unref(데몬 종료를 이 타이머가 막지 않게) — 코드베이스 관용 패턴. */
function unref(h: ReturnType<typeof setTimeout>): void {
  if (typeof (h as { unref?: () => void }).unref === 'function') (h as { unref: () => void }).unref();
}

/**
 * ★ UR4d 저지연 push 레이어(2026-07-19) — logs.db 를 저지연 내부 tail 하여 worker 미션 활동(mission.* 중
 * 조율자 자기 방출 제외)을 edge-trigger 로 감지 → onWake 를 디바운스+최소간격으로 1회 호출. 데몬 sweep
 * interval 은 안전망(truth)으로 그대로 두고, 이 층은 "체감 반응속도"만 끌어올린다. 접속 시점(maxId) 이후만
 * — 과거 활동은 부팅 sweep 이 이미 인지. fail-soft(틱 실패는 다음 폴)·전 타이머 unref. store null 이면 no-op.
 */
export function watchMissionActivity(deps: WatchMissionActivityDeps): MissionActivityWatcher {
  const store = deps.store !== undefined ? deps.store : getDefaultLogStore();
  const pollMs = deps.pollMs ?? 1000;
  const debounceMs = deps.debounceMs ?? 2000;
  const minWakeGapMs = deps.minWakeGapMs ?? 10_000;
  const now = deps.now ?? ((): number => Date.now());

  if (!store) {
    try { debug.log('mission.registry', 'push-disabled', { reason: 'no-log-store' }); } catch { /* fail-soft */ }
    return { stop() { /* no-op */ } };
  }

  let cancelled = false;
  let cursor = store.maxId();                 // 접속 시점 이후만 — 과거는 부팅 sweep 소관
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWakeAt = -Infinity;                  // 한 번도 안 깨움 = 첫 wake 즉시 허용(주입 클록에도 무관)

  const fireWake = (): void => {
    debounceTimer = undefined;
    if (cancelled) return;
    const gap = now() - lastWakeAt;
    if (gap < minWakeGapMs) {
      // thrash 가드 — 최소 간격 미달이면 남은 시간만큼 재스케줄(그 사이 활동은 이 타이머로 coalesce).
      debounceTimer = setTimeout(fireWake, minWakeGapMs - gap);
      unref(debounceTimer);
      return;
    }
    lastWakeAt = now();
    try { debug.log('mission.registry', 'push-wake', { cursor }); } catch { /* fail-soft */ }
    try { deps.onWake(); } catch { /* fail-soft — wake 실패가 tail 을 죽이지 않음 */ }
  };

  const scheduleWake = (): void => {
    if (debounceTimer) return;                 // 이미 디바운스 중 — coalesce(새 활동 흡수)
    debounceTimer = setTimeout(fireWake, debounceMs);
    unref(debounceTimer);
  };

  const tick = (): void => {
    if (cancelled) return;
    try {
      const rows = store.query({ categories: ['mission'], afterId: cursor, limit: 200 });
      let workerActivity = false;
      for (const row of rows) {
        cursor = Math.max(cursor, row.id);
        if (!isSelfEmitCategory(row.category)) workerActivity = true;
      }
      // 필터에 안 걸린 신규 행(비-mission)도 커서는 전진시켜 다음 폴 재스캔을 막는다(SSE tail 동형).
      if (rows.length === 0) {
        const m = store.maxId();
        if (m > cursor) cursor = m;
      }
      if (workerActivity) scheduleWake();
    } catch { /* fail-soft — 다음 tick */ }
    if (!cancelled) { const h = setTimeout(tick, pollMs); unref(h); }
  };
  const first = setTimeout(tick, pollMs);
  unref(first);

  return {
    stop(): void {
      cancelled = true;
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = undefined; }
    },
  };
}
