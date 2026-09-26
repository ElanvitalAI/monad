// ── Session Working Directory (SWD) ──
//
// Single source of truth for "the project the user is actually
// working on". Distinct from:
//   • process.cwd() — the shell cwd Elanous was launched from. Only the
//     boot default; never mutated (process.chdir never called).
//   • WorkingDirState.cwd — the browser pane's navigation cursor.
//     Purely UI; does not affect shell/edit/gate.
//
// All build / edit / shell / skill / LLM tools that resolve relative
// paths or pick a spawn cwd should read from getSessionCwd(). The
// user promotes a folder to SWD via Ctrl+W in the browser pane
// (WD3) or the /wd slash command (WD8).
//
// Design notes:
//   • Module-local state — a singleton is fine; the TUI is a single
//     session. Reset helper exists for tests.
//   • resolve()+statSync guard on set so bad paths surface immediately
//     rather than silently routing edits into the wrong tree.
//   • Subscribers fire after a real switch (identity sets are no-ops),
//     so the status-bar only redraws when something actually moved.
//   • No process.chdir() — plugin workers and already-spawned PTYs
//     inherit the boot cwd; retroactive chdir would desync them.
//     Every caller reads via the explicit getter instead.
//   • Lazy init — first read auto-seeds from process.cwd(). Explicit
//     initSessionWorkingDir(boot) is offered for test harnesses and
//     for the CLI entry point that wants to pin the boot cwd.

import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

const PROJECT_MARKERS = ['.elanous', '.git', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'] as const;

function canonicalPath(path: string): string {
  const resolvedPath = resolve(path);
  try {
    return realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function isSharedProjectRootBoundary(candidate: string): boolean {
  const canonicalCandidate = canonicalPath(candidate);
  return [tmpdir(), homedir()].some(boundary => canonicalCandidate === canonicalPath(boundary));
}

/** Project-root decision derived from the session working directory.
 * `marker` identifies the nearest ancestor with a supported project marker;
 * `cwd-fallback` deliberately distinguishes an unmarked directory from one
 * whose root happened to equal the session directory. */
export interface SessionProjectRoot {
  readonly path: string;
  readonly source: 'marker' | 'cwd-fallback';
}

/** Where the current SWD came from. 'boot' = process.cwd() at
 *  launch; 'user' = Ctrl+W in browser pane; 'slash' = /wd command;
 *  'tool' = LLM SetWorkingDir tool call. */
export type SessionCwdOrigin = 'boot' | 'user' | 'slash' | 'tool';

export interface SessionWorkingDir {
  readonly cwd: string;
  readonly origin: SessionCwdOrigin;
  /** Epoch ms at the moment the SWD was set. Useful for the HUD
   *  ("set 2m ago") and for /wd show diagnostics. */
  readonly setAt: number;
  /** ★ boundary 모드(walker 미션 격리·2026-07-21) — true 면 이 cwd 를 **쓰기 경계**로
   *  강제한다. `resolveInSession` 이 상대경로만 cwd 로 앵커하고 절대경로는 그대로 통과시키던
   *  누수(walker_phase_main_tree_pollution)를, 쓰기 도구에서 "cwd 밖 절대경로 거부"로 봉쇄.
   *  기본 false = 종전 동작(무회귀). run-mission 이 walker 격리 worktree 에만 켠다. */
  readonly boundary: boolean;
}

type Subscriber = (state: SessionWorkingDir) => void;

let state: SessionWorkingDir | null = null;
const subscribers = new Set<Subscriber>();

/** Lazy init — first access auto-seeds from process.cwd() so callers
 *  that reach for getSessionCwd() before index.ts' explicit init still
 *  get a valid answer. */
function ensureInit(): SessionWorkingDir {
  if (!state) {
    state = {
      cwd: resolve(process.cwd()),
      origin: 'boot',
      setAt: Date.now(),
      boundary: false,
    };
  }
  return state;
}

/** Explicitly seed the SWD from a boot cwd. Called once from
 *  src/index.ts entry points so the boot state is deterministic.
 *  Tests also use this to set a known cwd before calling tools. */
export function initSessionWorkingDir(bootCwd?: string): SessionWorkingDir {
  const cwd = resolve(bootCwd ?? process.cwd());
  state = { cwd, origin: 'boot', setAt: Date.now(), boundary: false };
  return state;
}

/** Absolute SWD path. Every subsystem that used to call process.cwd()
 *  for relative-path resolution or spawn cwd should call this. */
export function getSessionCwd(): string {
  return ensureInit().cwd;
}

/** Resolve the nearest marked project ancestor of the session working
 * directory. A missing or unreadable marker is ignored; callers always get a
 * path and can distinguish the no-project case through `source`. */
export function getSessionProjectRoot(): SessionProjectRoot {
  const cwd = getSessionCwd();
  let candidate = cwd;
  while (true) {
    if (isSharedProjectRootBoundary(candidate)) return { path: cwd, source: 'cwd-fallback' };
    if (PROJECT_MARKERS.some(marker => existsSync(join(candidate, marker)))) {
      return { path: candidate, source: 'marker' };
    }
    const parent = dirname(candidate);
    if (parent === candidate) return { path: cwd, source: 'cwd-fallback' };
    candidate = parent;
  }
}

/** Full SWD state (path + origin + timestamp). Used by status-bar,
 *  /wd show, and tool hint metadata. */
export function getSessionWorkingDir(): SessionWorkingDir {
  return ensureInit();
}

/** Promote a path to the session working directory. Throws when the
 *  path does not exist or is not a directory — callers surface the
 *  message as a toast / chat-log line. Identity sets (same resolved
 *  path) are no-ops and do not fire subscribers. */
export function setSessionCwd(
  path: string,
  origin: SessionCwdOrigin,
  opts?: { boundary?: boolean },
): SessionWorkingDir {
  const abs = resolve(path);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    throw new Error(`session cwd: path does not exist — ${abs}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`session cwd: not a directory — ${abs}`);
  }
  const boundary = opts?.boundary ?? false;
  const prev = state;
  // 경로 동일 + boundary 동일이면 no-op(구독자 미발화). boundary 만 바뀌어도 실질 전환이라 반영.
  if (prev && prev.cwd === abs && prev.boundary === boundary) return prev;
  const next: SessionWorkingDir = { cwd: abs, origin, setAt: Date.now(), boundary };
  state = next;
  for (const fn of subscribers) {
    try { fn(next); } catch { /* subscriber error can't break the switch */ }
  }
  return next;
}

/** ★ boundary 활성 시 경계 경로(=cwd) 반환, 아니면 null. 쓰기 도구가 경계 판정에 쓴다. */
export function getSessionBoundary(): string | null {
  const s = ensureInit();
  return s.boundary ? s.cwd : null;
}

/** ★ 절대경로 `abs` 가 쓰기 허용 범위 안인가. boundary 비활성이면 항상 true(무회귀).
 *  활성이면 경계 디렉토리 자신 또는 그 하위(`<boundary>/…`)만 true. 순수. */
export function isWriteAllowedInBoundary(abs: string): boolean {
  const boundary = getSessionBoundary();
  if (!boundary) return true;
  const b = resolve(boundary);
  const p = resolve(abs);
  return p === b || p.startsWith(b + sep);
}

/** Subscribe to SWD changes. Returns an unsubscribe fn. Subscribers
 *  fire AFTER state has flipped; initial state is not replayed — call
 *  getSessionWorkingDir() once at subscription time if you need it. */
export function subscribeSessionCwd(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** Test-only: clear state + subscribers so each test starts fresh.
 *  Not exported through a stable name; prefix underscore marks it
 *  internal. */
export function __resetSessionWorkingDir(): void {
  state = null;
  subscribers.clear();
}

/** Pick the SWD target from a browser-pane snapshot. Shared between
 *  the Ctrl+W key handler and tests so the "folder under cursor vs
 *  current dir" rule has one source of truth:
 *    • cursor on a real subfolder (not `..`)  → that folder
 *    • cursor on `..`, a file, or empty space → the current dir
 *  Caller is still responsible for running setSessionCwd(target,
 *  'user') + posting the feedback line. */
export function pickSwdTargetFromBrowser(snapshot: {
  cwd: string;
  entries: Array<{ name: string; absPath: string; isDir: boolean }>;
  cursor: number;
}): string {
  const focused = snapshot.entries[snapshot.cursor];
  if (focused && focused.isDir && focused.name !== '..') return focused.absPath;
  return snapshot.cwd;
}
