// ★ CW3 signal control(RFC-coordinator-walker-control-plane P4·2026-07-21) — 조율자→walker mid-phase 신호.
//
// ★ 신호 누수 근본수복(2026-07-23 대표 자율주행 실증 + 모나드 리뷰 2라운드 반영):
//   근본 = mid-phase 신호는 발신 당시 walker 를 위한 1회성인데 walker-dead 시 clear 안 되고 영속 → 이후
//   모든 페이즈의 respawn·pollSignal 이 상속해 self-abort/halt(systemic 데드락·1.5h+ 손실).
//   방어(리뷰 반영):
//     ① phaseId 스코프 — 신호가 향한 페이즈와 소비 페이즈 대조·다르면 무시(레이스 없는 phase-bound).
//     ② TTL(+at 없는 레거시=stale) — 발신 walker 는 TTL 후 확실히 종료·손상 신호 무한 데드락 방지.
//     ③ 1회성 소비 — 유효 abort 는 소비 후 CAS-clear(같은 신호일 때만·재시도 재-abort 방지). pause 는 유지.
//     ④ API 분리 — peekMissionSignal=순수 read(부작용 0) · consumeMissionSignal=소비(정리).
import { debug } from '../../debug/log.js';
import { readMissionState, persistMissionState, assembleMissionState } from './mission-state-assemble.js';
import { applyChannelUpdates, signalUpdate, readSignal, type MissionSignal } from './mission-state-channels.js';

export type { MissionSignal };

/** 신호 TTL — 이 시간 지난 신호는 stale. phaseId 미지정(global) 신호 누수 backstop. */
export const MISSION_SIGNAL_TTL_MS = 15 * 60_000;

/** respawn(미션-레벨) 소비용 센티넬 — 실 phaseId 와 절대 안 겹쳐 phase-specific 신호는 mismatch(무시/정리)되고
 *  global(phaseId 없는) 신호만 존중. 종전 phaseId 미전달 시 phase-specific 도 global 처럼 존중돼 respawn 이
 *  최대 TTL 차단되던 리뷰 지적 해소. */
export const MISSION_RESPAWN_SCOPE = '__respawn__';

/** 조율자→walker 신호 발신. opts.phaseId = 신호가 향한 페이즈(소비자가 대조·누수 차단). 미지정=global(TTL 만).
 *  ★ options 객체(리뷰 반영) — 종전 positional now 인자 호환 보존. */
export function sendMissionSignal(
  missionId: string,
  kind: 'abort' | 'pause',
  opts: { reason?: string; phaseId?: string; now?: () => number } = {},
): MissionSignal {
  const sig: MissionSignal = { kind, ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.phaseId ? { phaseId: opts.phaseId } : {}), at: (opts.now ?? Date.now)() };
  const base = readMissionState(missionId) ?? assembleMissionState(missionId);
  persistMissionState(missionId, applyChannelUpdates(base, [signalUpdate(sig)]));
  try { debug.log('mission.walker', 'signal-sent', { missionId, kind, reason: opts.reason ?? null, phaseId: opts.phaseId ?? null }); } catch { /* fail-soft */ }
  return sig;
}

/** 신호 무조건 clear(CLI clear·명시 해제). fresh 재read 후 signal 채널만 null(다른 채널 보존). */
export function clearMissionSignal(missionId: string): void {
  const fresh = readMissionState(missionId);
  if (!fresh) return;
  persistMissionState(missionId, applyChannelUpdates(fresh, [signalUpdate(null)]));
  try { debug.log('mission.walker', 'signal-cleared', { missionId }); } catch { /* fail-soft */ }
}

/** ★compare-and-clear(리뷰 #2 반영) — fresh 재read 후 **여전히 expected 와 동일한 신호일 때만** null.
 *  판정↔clear 사이 도착한 새 신호는 보존(레이스 방지). 순수 비교(at+kind+phaseId). */
function clearMissionSignalIfMatches(missionId: string, expected: MissionSignal): void {
  const fresh = readMissionState(missionId);
  if (!fresh) return;
  const cur = readSignal(fresh);
  if (!cur) return;
  if (cur.at === expected.at && cur.kind === expected.kind && (cur.phaseId ?? null) === (expected.phaseId ?? null)) {
    persistMissionState(missionId, applyChannelUpdates(fresh, [signalUpdate(null)]));
    try { debug.log('mission.walker', 'signal-consumed-cleared', { missionId, kind: cur.kind, phaseId: cur.phaseId ?? null }); } catch { /* fail-soft */ }
  }
}

/** 신호가 stale 한가(순수·테스트). ★at 없는 레거시/손상 신호=stale(리뷰 #4·무한 데드락 방지). */
export function isMissionSignalStale(
  sig: MissionSignal | undefined,
  ttlMs: number = MISSION_SIGNAL_TTL_MS,
  now: () => number = Date.now,
): boolean {
  if (!sig) return false;
  if (typeof sig.at !== 'number') return true; // fresh 발신은 항상 at 스탬프 → at 없음 = 레거시/손상 = stale
  return sig.at + ttlMs < now();
}

/** 신호가 이 페이즈용인가(순수·테스트) — phaseId 없으면 global(honor) · 있으면 currentPhaseId 일치해야.
 *  currentPhaseId 미지정(레거시)이면 대조 skip(honor). MISSION_RESPAWN_SCOPE 는 실 phaseId 와 안 겹쳐
 *  phase-specific 신호가 mismatch 된다. */
export function isMissionSignalForPhase(sig: MissionSignal | undefined, currentPhaseId?: string): boolean {
  if (!sig) return false;
  if (!sig.phaseId || !currentPhaseId) return true;
  return sig.phaseId === currentPhaseId;
}

/** ★순수 조회(부작용 0·리뷰 #3) — CLI/관측용. stale/페이즈 불일치면 undefined 로 표면화하되 채널 무변경. */
export function peekMissionSignal(
  missionId: string,
  opts: { currentPhaseId?: string; ttlMs?: number; now?: () => number } = {},
): MissionSignal | undefined {
  const base = readMissionState(missionId);
  const sig = base ? readSignal(base) : undefined;
  if (!sig) return undefined;
  if (isMissionSignalStale(sig, opts.ttlMs, opts.now)) return undefined;
  if (!isMissionSignalForPhase(sig, opts.currentPhaseId)) return undefined;
  return sig;
}

/** ★소비(side-effecting·리뷰 반영) — walker pollSignal·respawn 용.
 *  - stale/누수(다른 페이즈)면 CAS-clear + undefined(누수 영구 차단).
 *  - 유효 abort 는 반환하되 **CAS-clear(1회성)** — 같은 페이즈 재시도/respawn 이 같은 abort 재소비 방지(리뷰 #1).
 *  - 유효 pause 는 반환하고 **유지**(sustained·재개는 상위 clear). */
export function consumeMissionSignal(
  missionId: string,
  currentPhaseId?: string,
  opts: { ttlMs?: number; now?: () => number } = {},
): MissionSignal | undefined {
  const base = readMissionState(missionId);
  const sig = base ? readSignal(base) : undefined;
  if (!sig) return undefined;
  const leaked = isMissionSignalStale(sig, opts.ttlMs, opts.now) || !isMissionSignalForPhase(sig, currentPhaseId);
  if (leaked) {
    clearMissionSignalIfMatches(missionId, sig);
    try { debug.log('mission.walker', 'signal-leak-cleared', { missionId, kind: sig.kind, sigPhase: sig.phaseId ?? null, curPhase: currentPhaseId ?? null }); } catch { /* fail-soft */ }
    return undefined;
  }
  if (sig.kind === 'abort') clearMissionSignalIfMatches(missionId, sig); // 유효 abort = 1회성
  return sig;
}
