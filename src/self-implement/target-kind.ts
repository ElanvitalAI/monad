// ── 하니스 개발 대상(target) 종류 감지 (#25 P2 · 2026-07-21) ──────────────────────────
//
// dev-harness 는 monad 자신만이 아니라 임의 디렉토리·config·dotfile 까지 작업 대상으로 삼는다
// (DESIGN-harness-target-generalization-2026-07-21 §2). 종류별로 스테이징/gate/적용 전략이 달라
// 먼저 target 을 분류한다. 이 함수는 순수-ish(fs stat 만)라 테스트 가능.
//
// ⚠️ 안전 우선순위(제1원칙): homedir() 밖 시스템경로는 무엇이든 'outside-home' 으로 최우선 분류한다
//   (git repo 여부·존재 여부보다 앞선다). 홈 경계가 최고위험 안전벽(§4). P2 는 'non-git-dir' 만
//   실제로 처리하고, 'file'/'outside-home' 은 P3(config/OS) 로 넘긴다(여기선 분류만).

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { resolveMainRepoRoot } from '../git-fs/worktree.js';

export type TargetKind =
  | 'git-repo'      // .git 안(monad·~/source/repo) — worktree+PR (현행 P1)
  | 'non-git-dir'   // 비-git 디렉토리(~/temp) — git-init 그림자 스테이징 (P2)
  | 'file'          // 단일 파일(config/dotfile ~/.zshrc) — syntax gate+백업 (P3)
  | 'outside-home'  // homedir 밖 시스템경로(/etc 등) — 안전벽 (P3·거부/추가확인)
  | 'missing';      // 존재하지 않음

/** target 경로를 종류별로 분류. 순서=안전 우선(홈 경계 최우선) → 존재 → git → dir/file.
 *  절대경로로 정규화 후 판정한다(상대경로·`.`/`..` 안전).
 *  @param home 홈 경계(테스트 주입용). 기본 `homedir()`.
 *  ⚠️ 'self'/생략(monad 자신)은 이 함수 호출 전에 처리된다(여기 대상 아님). */
export function resolveTargetKind(target: string, home: string = homedir()): TargetKind {
  const abs = resolve(target);
  const homeAbs = resolve(home);
  // ① 안전벽 최우선 — homedir 밖은 물론 **homedir 루트 자체**도 존재/git 여부 불문 'outside-home'.
  //   홈 루트를 target 으로 편집 = 홈 전체 위험 → 거부. 홈의 **엄격한 하위경로**만 "홈 안"으로 허용한다.
  //   `${home}${sep}` 접두 매칭이라 `/home/user-evil` 이 `/home/user` 로 오탐되지 않고, `/home/user`
  //   자체도 (후행 sep 없어) 매칭 안 됨 → outside-home.
  if (!abs.startsWith(homeAbs + sep)) return 'outside-home';
  // ② 존재 확인.
  if (!existsSync(abs)) return 'missing';
  // ③ git repo(자신 또는 상위에 .git) — worktree+PR 경로.
  if (resolveMainRepoRoot(abs)) return 'git-repo';
  // ④ 비-git — 디렉토리 vs 파일.
  try {
    return statSync(abs).isDirectory() ? 'non-git-dir' : 'file';
  } catch {
    return 'missing'; // stat 실패(race·권한) — 보수적으로 missing.
  }
}
