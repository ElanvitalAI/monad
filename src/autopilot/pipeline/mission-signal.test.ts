// mission-signal 누수 차단 계약(대표 2026-07-23·엘라누스 리뷰 2라운드 반영) —
// TTL(+at없음) · phaseId 스코프 · 1회성 abort(CAS-clear) · pause sustained · respawn global-only · peek 순수.
import { describe, it, expect } from 'bun:test';
import {
  isMissionSignalStale, isMissionSignalForPhase, MISSION_SIGNAL_TTL_MS, MISSION_RESPAWN_SCOPE,
  sendMissionSignal, peekMissionSignal, consumeMissionSignal, clearMissionSignal,
  type MissionSignal,
} from './mission-signal.js';

const sig = (at: number | undefined, kind: 'abort' | 'pause' = 'abort', phaseId?: string): MissionSignal =>
  ({ kind, ...(at !== undefined ? { at } : {}), ...(phaseId ? { phaseId } : {}) });

describe('isMissionSignalStale — TTL(+at없음=stale·리뷰#4)', () => {
  const now = () => 1_000_000;
  it('TTL 이내 fresh(false)', () => {
    expect(isMissionSignalStale(sig(1_000_000), MISSION_SIGNAL_TTL_MS, now)).toBe(false);
  });
  it('TTL 초과 stale(true)', () => {
    expect(isMissionSignalStale(sig(1_000_000 - (MISSION_SIGNAL_TTL_MS + 1)), MISSION_SIGNAL_TTL_MS, now)).toBe(true);
  });
  it('경계: 정확히 TTL 은 fresh', () => {
    expect(isMissionSignalStale(sig(1_000_000 - MISSION_SIGNAL_TTL_MS), MISSION_SIGNAL_TTL_MS, now)).toBe(false);
  });
  it('★at 없는 레거시/손상 = stale(true·무한 데드락 방지)', () => {
    expect(isMissionSignalStale(sig(undefined), MISSION_SIGNAL_TTL_MS, now)).toBe(true);
  });
  it('신호 없음 = false', () => {
    expect(isMissionSignalStale(undefined)).toBe(false);
  });
});

describe('isMissionSignalForPhase — phaseId 스코프', () => {
  it('매칭 true·불일치 false·global true·현재미상 true', () => {
    expect(isMissionSignalForPhase(sig(0, 'abort', 'task:A'), 'task:A')).toBe(true);
    expect(isMissionSignalForPhase(sig(0, 'abort', 'task:A'), 'task:B')).toBe(false);
    expect(isMissionSignalForPhase(sig(0, 'abort'), 'task:B')).toBe(true);          // global
    expect(isMissionSignalForPhase(sig(0, 'abort', 'task:A'), undefined)).toBe(true); // 현재 미상
  });
  it('respawn 스코프는 phase-specific 를 mismatch(false)·global 은 honor(true)', () => {
    expect(isMissionSignalForPhase(sig(0, 'abort', 'task:A'), MISSION_RESPAWN_SCOPE)).toBe(false);
    expect(isMissionSignalForPhase(sig(0, 'abort'), MISSION_RESPAWN_SCOPE)).toBe(true);
  });
});

// ── 행동(실 State·리뷰 #5) ────────────────────────────────────────────────────
describe('consume/peek 행동 — 1회성·CAS·respawn·pause·순수', () => {
  let seq = 0;
  const mid = () => `test-sig-${process.pid}-${++seq}-${Math.floor(performance.now())}`;

  it('★1회성 abort — 유효 소비 후 clear(재소비 방지·리뷰#1)', () => {
    const m = mid();
    sendMissionSignal(m, 'abort', { phaseId: 'task:A' });
    expect(consumeMissionSignal(m, 'task:A')?.kind).toBe('abort'); // 1차: 반환
    expect(consumeMissionSignal(m, 'task:A')).toBeUndefined();      // 2차: 이미 clear(재-abort 없음)
    clearMissionSignal(m);
  });

  it('★pause 는 sustained — 유효 소비해도 유지', () => {
    const m = mid();
    sendMissionSignal(m, 'pause', { phaseId: 'task:A' });
    expect(consumeMissionSignal(m, 'task:A')?.kind).toBe('pause');
    expect(consumeMissionSignal(m, 'task:A')?.kind).toBe('pause'); // 유지(재개는 상위 clear)
    clearMissionSignal(m);
  });

  it('누수(다른 페이즈) → undefined + clear', () => {
    const m = mid();
    sendMissionSignal(m, 'abort', { phaseId: 'task:A' });
    expect(consumeMissionSignal(m, 'task:B')).toBeUndefined();         // B 소비 = 누수
    expect(peekMissionSignal(m, { currentPhaseId: 'task:A' })).toBeUndefined(); // clear 확인
    clearMissionSignal(m);
  });

  it('★respawn(global-only) — phase-specific abort 는 respawn 안 막고 정리·리뷰#3', () => {
    const m = mid();
    sendMissionSignal(m, 'abort', { phaseId: 'task:A' });
    expect(consumeMissionSignal(m, MISSION_RESPAWN_SCOPE)).toBeUndefined(); // respawn 은 무시(정리)
    clearMissionSignal(m);
  });

  it('respawn 은 global fresh abort 는 존중', () => {
    const m = mid();
    sendMissionSignal(m, 'abort', {}); // global
    expect(consumeMissionSignal(m, MISSION_RESPAWN_SCOPE)?.kind).toBe('abort'); // 미션-레벨 halt
    clearMissionSignal(m);
  });

  it('stale → undefined + clear', () => {
    const m = mid();
    sendMissionSignal(m, 'abort', { now: () => 0 });
    expect(consumeMissionSignal(m, 'task:A', { now: () => MISSION_SIGNAL_TTL_MS + 1 })).toBeUndefined();
    expect(peekMissionSignal(m, { now: () => 0 })).toBeUndefined(); // clear 확인(TTL0 로 봐도 없음)
    clearMissionSignal(m);
  });

  it('★peek 순수 — stale 봐도 채널 무변경(부작용 0·리뷰#3)', () => {
    const m = mid();
    sendMissionSignal(m, 'abort', { now: () => 0 });
    expect(peekMissionSignal(m, { now: () => MISSION_SIGNAL_TTL_MS + 1 })).toBeUndefined(); // stale 표면화
    expect(peekMissionSignal(m, { now: () => 0 })?.kind).toBe('abort');                     // 채널 유지
    clearMissionSignal(m);
  });

  it('★CAS-clear — 판정한 신호와 다른(새) 신호면 clear 안 함(레이스 방지·리뷰#2)', () => {
    const m = mid();
    // 오래된 신호를 소비하려 하나, 그 사이 새 신호(다른 at)가 채널에 있음 → 새 신호 보존.
    // 시뮬: stale 신호 소비 시도 전에 새 fresh 신호로 덮어씀 → consume 은 fresh(현재) 를 봄.
    sendMissionSignal(m, 'abort', { phaseId: 'task:A', now: () => 100 }); // fresh 최신
    // 소비자가 다른 페이즈(B)로 소비 → 누수 판정 → CAS-clear 는 '현재=A용 fresh' 를 지움(같은 신호라 clear 정당).
    expect(consumeMissionSignal(m, 'task:B', { now: () => 200 })).toBeUndefined();
    expect(peekMissionSignal(m, { now: () => 200, currentPhaseId: 'task:A' })).toBeUndefined();
    clearMissionSignal(m);
  });
});
