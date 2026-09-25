// ★ split 자동재개(대표 2026-07-21·기본 안정화 첫 타겟) — split(자율 폐루프)이 run-mission 프로세스가
//   락 보유 중 일어나 즉시 재spawn 이 "이미 실행 중" 조기종료 → 서브페이즈 재개자 0 → 정지(라이브 705308
//   3회 실증·수동 rerun 강요). 재개를 프로세스 exit 후 락 해제 뒤로 지연하는 결정 로직을 순수 seam 으로
//   추출한다: 정상완료·SIGTERM(→process.exit→exit 핸들러) 모든 종료 경로가 이 함수를 거치고 idempotent
//   (중복 spawn 차단). 관측(대표 필수·자기인지)=respawn-after-unlock(성공)/respawn-failed(실패)로 재개
//   실패를 탐지 가능(spawn 후 판정·예외 은폐 금지). 부기≠판단: 여기는 재개 배선.

export interface SplitResumeDeps {
  /** split 이 이 프로세스에서 일어났나(재개 대상). false 면 무동작(무회귀). */
  splitOccurred: boolean;
  /** idempotent 가드 — 이미 재개 처리했으면 true(정상완료+exit 핸들러 중복 방지). */
  alreadyDone: () => boolean;
  /** 재개 처리 마킹(1회성). */
  markDone: () => void;
  /** exit 핸들러/teardown 이 child 락(다른 pid)을 지우지 않게 보호 마킹(race 차단). releaseLock 전에 호출. */
  markSkipRelease: () => void;
  /** 이 프로세스 락 명시 해제 — child 가 acquire 가능하게. */
  releaseLock: () => void;
  /** detached 재spawn(서브페이즈 순회 재개). 반환=spawn 성공 여부(관측용). */
  spawnRun: () => boolean;
  /** 관측 — 재개 성공/실패를 spawn 후 기록(자기인지·정지 탐지). */
  observe: (event: 'respawn-after-unlock' | 'respawn-failed') => void;
}

/**
 * split 후 재개 결정(순수·seam 주입). splitOccurred·미처리면: skip-release 마킹 → 락 해제 → detached
 * 재spawn → 성공/실패 관측. idempotent(alreadyDone). 반환: 재개를 시도했으면 true, split 없음/이미 처리면 false.
 *
 * 순서 불변식(race 차단): markSkipRelease → releaseLock(부모 락 삭제) → spawnRun(child acquire 가능).
 * spawnRun 은 releaseLock **후**여야 child 가 락을 얻을 수 있고, markSkipRelease 는 releaseLock **전**이어야
 * exit 핸들러가 그 사이 child 락을 지우지 않는다. 관측은 spawnRun **후**여야 실제 결과를 반영한다.
 */
export function resumeAfterSplit(deps: SplitResumeDeps): boolean {
  if (!deps.splitOccurred || deps.alreadyDone()) { return false; }
  deps.markDone();
  deps.markSkipRelease();
  deps.releaseLock();
  let ok = false;
  try { ok = deps.spawnRun(); } catch { ok = false; }
  deps.observe(ok ? 'respawn-after-unlock' : 'respawn-failed');
  return true;
}
