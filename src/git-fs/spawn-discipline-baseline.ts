/** `I-T4` 래칫 기준선 — **관문(`src/git-fs/`) 밖에서 git 프로세스를 띄우는 자리**의 파일별 수.
 *
 *  ⛔⭐ **이 수는 「허용」이 아니라 「유예」다.** 2026-08-03 08:5x 실측(`monad self git-discipline`)이고,
 *  ⭐ ***늘어나면 게이트가 막고, 줄이면 이 파일을 낮춘다.*** 줄어든 것은 실패로 치지 않는다 —
 *  유예분을 판정층 입력으로 쓰면 판정이 거짓이 된다.
 *
 *  ⛔ **새 파일을 여기에 추가해서 통과시키지 마라.** 관문 밖 호출이 정말 필요하면 호출 줄에
 *  `git-spawn-allow: <이유>` 표식을 달아라 — 이유가 남아야 다음 사람이 옮길 수 있다(`D3`).
 *
 *  근거 = `GIT-T10`(락 재시도가 `worktree add` 한 곳에만 배선돼 있다) · `GIT-T1`·`GIT-T14`(`index.lock` 이
 *  한 창에 7회·3회) · `#6749`(`I-T2` — 재시도 심 공용화. 그때 배선된 소비처는 **2파일 3호출**뿐이었다).
 */
export const GIT_SPAWN_BASELINE: Readonly<Record<string, number>> = {
  'scripts/ci-ledger-changed.ts': 1,
  'scripts/docs-lint.ts': 2,
  'scripts/drive-tui.ts': 1,
  'scripts/goal-lint-ab.ts': 1,
  'scripts/loop-runner.ts': 1,
  'scripts/run-mission.ts': 6,
  'scripts/se-backend-bench.ts': 3,
  'scripts/se-isolation-verify.ts': 1,
  'scripts/se-monad-self-tune.ts': 3,
  'scripts/smoke-headless-goalloop.ts': 6,
  'scripts/tui-sim-bench.ts': 5,
  'scripts/tui-sim.ts': 4,
  'src/harness/harness-worktree-add.ts': 7,
  'src/harness/harness-worktree-auto.ts': 1,
  'src/harness/harness-worktrees.ts': 1,
  'src/index.ts': 1,
};
