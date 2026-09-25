// ── Mission Run Lock (대표 2026-07-12) ────────────────────────────────────
//
// 대표 지적: "재실행 후 재실행중이라는 문맥도 모르고 있을수도 있다." → 같은 미션에
// run-mission 프로세스가 둘 이상 뜨면 각자 페이즈를 경쟁 집행(double-fire)한다.
//
// 파일 락 + pid liveness 로 single-flight 를 보장한다. run-mission 이 시작 시 acquire,
// 종료 시 release. rerunMission 은 spawn 전 isRunLockActive 로 "이미 실행 중" 을 인지해
// 리셋·재spawn 을 거부(진행 중인 세대를 오염시키지 않음). stale 락(죽은 pid)은 자동 청소.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { monadStateRoot } from './state-paths.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface RunLockOpts {
  /** 락 디렉토리(테스트 격리). 기본 ~/.monad/autopilot/run-locks. */
  baseDir?: string;
  /** 이 프로세스 pid(테스트 주입). 기본 process.pid. */
  pid?: number;
  /** pid 생존 판정(테스트 주입). 기본 process.kill(pid,0). */
  isAlive?: (pid: number) => boolean;
}

function lockDir(opts?: RunLockOpts): string {
  return opts?.baseDir ?? join(monadStateRoot(), 'autopilot', 'run-locks');
}

/** 미션 id → 락 파일 경로(id 해시로 파일명 안전화). 순수(경로 계산만). */
export function runLockPath(missionId: string, opts?: RunLockOpts): string {
  const hash = createHash('sha1').update(missionId).digest('hex').slice(0, 16);
  return join(lockDir(opts), `${hash}.lock`);
}

function defaultIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as { code?: string })?.code === 'EPERM'; } // EPERM=살아있으나 권한없음
}

/** 미션에 살아있는 run-mission 락이 있나. stale(죽은 pid) 락은 발견 즉시 청소하고 false. */
export function isRunLockActive(missionId: string, opts?: RunLockOpts): boolean {
  const p = runLockPath(missionId, opts);
  if (!existsSync(p)) return false;
  try {
    const pid = Number.parseInt(readFileSync(p, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return false;
    const alive = (opts?.isAlive ?? defaultIsAlive)(pid);
    if (alive) return true;
    try { rmSync(p); } catch { /* fail-soft */ } // stale 청소
    return false;
  } catch { return false; }
}

/** 락 획득 — 이미 살아있는 락이 있으면 false(다른 프로세스 소유). 성공 시 pid 기록·true. */
export function acquireRunLock(missionId: string, opts?: RunLockOpts): boolean {
  if (isRunLockActive(missionId, opts)) return false;
  try {
    mkdirSync(lockDir(opts), { recursive: true });
    writeFileSync(runLockPath(missionId, opts), String(opts?.pid ?? process.pid));
    return true;
  } catch { return false; }
}

/** 락 해제 — 파일 제거(fail-soft). run-mission 종료 경로에서 항상 호출. */
export function releaseRunLock(missionId: string, opts?: RunLockOpts): void {
  try { rmSync(runLockPath(missionId, opts)); } catch { /* fail-soft */ }
}
