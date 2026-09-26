// Centralized resolver for the elanous config / daemon root directory.
//
// **Public surface (single source of truth)**:
//   - `--config-dir <dir>` CLI flag (extracted in
//     src/cli/config-dir-flag.ts) → routes through `setElanousConfigDir`
//   - `setElanousConfigDir(dir)` programmatic setter for tests + library
//     consumers (calls bg-launch propagates the same value via
//     `--config-dir` argv to child processes — env-var-free)
//
// **Removed (2026-05-13 · config-dir-unify)**:
//   - `ELANOUS_DAEMON_DIR` env var read AND env mirror. Children inherit
//     the override via `--config-dir <dir>` re-appended in
//     `bg-launch.ts`, not via process.env.
//
// Resolution order:
//   1. Programmatic override set via `setElanousConfigDir(dir)` (incl.
//      from the `--config-dir` CLI flag).
//   2. `~/.elanous` — default daily-driver root.

import { homedir } from 'node:os';
import { join } from 'node:path';

let override: string | undefined;

/** Resolve the current elanous config / daemon root directory. Caller
 *  decides what subpath to append (`workflows/`, `config.json`,
 *  `acp-token`, ...). */
export function getElanousConfigDir(): string {
  if (override !== undefined) return override;
  // ★ §4d (P3 · 2026-07-26) — **config-dir 은 state-dir 을 따라간다.**
  //
  //   `ELANOUS_STATE_DIR` 은 env 라 전 자손에 자동 전파되는데 config-dir 은 argv 재부착 **7곳**
  //   에서만 전파된다. 그 7곳을 안 타는 자식(특히 PTY 안에서 사람/에이전트가 친 명령)은
  //   `state=test / config=prod` 로 갈라진다 — 2026-07-19 미션 누출과 같은 클래스다.
  //   명시 `--config-dir` 이 없으면 state-dir 을 따라가 그 어긋남을 구조적으로 없앤다.
  //
  //   ⚠️ prod 루트(`~/.elanous`)와 같으면 종전과 동일(무변경). 격리 루트일 때만 따라간다.
  //   설계 = 내부 문서 `DESIGN-instance-leader-and-default-test-2026-07-26` §4d.
  //   ★ **effectiveInstanceRoot 를 소비**한다 — state 축(elanousStateRoot)과 **같은 함수**를 거쳐
  //     두 축이 한 뿌리로 수렴한다. 로직을 여기 중복 구현하지 않는다.
  //     (`configDirFollowingStateDir` 은 §4d 계약을 문서화·테스트하는 순수 함수로 남는다 —
  //      실제 해석 경로는 이 리졸버 하나다.)
  const { effectiveInstanceRoot } = require('./instance/resolve.js') as typeof import('./instance/resolve.js');
  return effectiveInstanceRoot();
}

/** Programmatic override. Trims, rejects empty/blank. Child processes
 *  inherit by re-appending `--config-dir <dir>` to argv (see
 *  `src/cli/bg-launch.ts`). No env-var mirror — env vars were a
 *  shared-state footgun that masked unintended redirects (see the
 *  2026-05-13 `--test` config-dir regression). */
export function setElanousConfigDir(dir: string): void {
  const trimmed = dir.trim();
  if (trimmed.length === 0) {
    throw new Error('setElanousConfigDir: empty directory');
  }
  override = trimmed;
}

/** Clear the override (test cleanup). Idempotent. */
export function resetElanousConfigDir(): void {
  override = undefined;
}

/** The explicit override, or undefined when running on the `~/.elanous`
 *  default. Lets consumers (nexus/paths.ts) rank an EXPLICIT
 *  `--config-dir` above the legacy `ELANOUS_NEXUS_DIR` env fallback
 *  without changing default-path behavior. */
export function getElanousConfigDirOverride(): string | undefined {
  return override;
}
