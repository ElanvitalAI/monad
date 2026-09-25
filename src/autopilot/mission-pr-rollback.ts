// ── Mission PR Rollback (대표 2026-07-12) ─────────────────────────────────
//
// 대표 지시: "깨끗하게 처음부터 하려면 이전 세대가 만든 PR/브랜치를 먼저 걷어내야 한다."
// 재실행(rerun)은 모든 페이즈를 처음부터 다시 빌드하므로, 이전 세대가 낸 SE PR 은 폐기
// 대상(orphan)이다. 이전엔 수동으로 닫아야 했다(S6: "6 PR 리뷰 후 전부 닫음").
//
// rerunMission 이 리셋 직전, 각 페이즈 notes 의 [SE-PR] URL 을 모아 자동 close(+브랜치 삭제)
// 한다. 실 close 는 gh CLI(주입·fail-soft·테스트 무력화). "완벽하게 걷어내는 능력" 의 git 레벨.

import { spawnSync } from 'node:child_process';

/** PR URL(.../pull/N) → 번호. 순수함수. 아니면 null. */
export function extractPrNumber(prUrl: string): number | null {
  const m = /\/pull\/(\d+)/.exec(prUrl);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

/** notes 목록에서 [SE-PR] 마커의 PR URL 들을 추출. 순수함수(중복 제거). */
export function collectPrUrls(noteLists: readonly (readonly string[])[]): string[] {
  const urls = new Set<string>();
  for (const notes of noteLists) {
    for (const n of notes) {
      const m = /^\[SE-PR\]\s*(\S+)/.exec(n);
      if (m && /\/pull\/\d+/.test(m[1]!)) urls.add(m[1]!);
    }
  }
  return [...urls];
}

/** gh CLI 로 PR close + 브랜치 삭제(기본 closer). fail-soft — 실패해도 재실행은 계속. */
export function defaultClosePr(prUrl: string): boolean {
  const n = extractPrNumber(prUrl);
  if (n === null) return false;
  try {
    const r = spawnSync('gh', ['pr', 'close', String(n), '--delete-branch',
      '--comment', '미션 처음부터 재실행으로 이 페이즈가 재빌드됨 → 이전 세대 PR 자동 폐기(롤백).'],
      { encoding: 'utf8', timeout: 30_000 });
    return r.status === 0;
  } catch { return false; }
}

/** gh CLI 로 PR 머지(squash·브랜치 삭제·기본 merger·대표 2026-07-12). 완료 리뷰 후 clean PR
 *  반영(머지). fail-soft — 실패해도 다음 PR 계속. auto-merge 아님(대표가 버튼/CLI 로 트리거). */
export function defaultMergePr(prUrl: string): boolean {
  const n = extractPrNumber(prUrl);
  if (n === null) return false;
  try {
    const r = spawnSync('gh', ['pr', 'merge', String(n), '--squash', '--delete-branch'],
      { encoding: 'utf8', timeout: 60_000 });
    return r.status === 0;
  } catch { return false; }
}

/** 이전 세대 PR 들을 롤백(close). closePr 주입(기본 gh CLI·테스트 무력화). 반환=닫은 수.
 *  fail-soft — 개별 실패는 건너뛰고 계속(재실행을 막지 않음). */
export function rollbackPrs(
  prUrls: readonly string[],
  closePr: (prUrl: string) => boolean = defaultClosePr,
): { attempted: number; closed: number } {
  let closed = 0;
  for (const url of prUrls) {
    try { if (closePr(url)) closed += 1; } catch { /* fail-soft */ }
  }
  return { attempted: prUrls.length, closed };
}
