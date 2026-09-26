// NEXUS · path helpers.
//
// All NEXUS runtime state normally lives under `<config-dir>/nexus/`:
//   .lock          — single-instance pid lock (dotfile · 0600)
//   runtime.json   — sidecar (httpPort · pid · startedAt · template)
//   tabs/          — per-tab persistent spec
//   templates/     — user-saved templates
//   logs/<tabId>/  — per-tab stdout/stderr
//   errors/<tabId>/<ts>.json — fail snapshot for PWA modal
//
// **State root resolution**:
//   1. `getTestStateRoot()` override — set by `--test` mode (or any
//      caller that wants a disposable state subtree without touching
//      the config dir). Single concern: state-only redirect.
//   2. `process.env.ELANOUS_NEXUS_DIR` — LEGACY fallback (restored
//      2026-07-12). The 2026-05-13 config-dir-unify removed this read,
//      which SILENTLY broke isolation in ~49 test files that still set
//      it — full `bun test` runs then acquired/released the REAL
//      `~/.elanous/nexus/.lock`, repeatedly stopping the production
//      daemon (launchd revived it) and clobbering runtime.json.
//      AGENTS.md policy keeps legacy env vars as backward-compat
//      fallbacks; new call sites should use `setTestStateRoot` /
//      `--config-dir` instead.
//   3. `<getElanousConfigDir()>/nexus/` — default. `--config-dir <path>`
//      flows through automatically so nexus state follows the config
//      dir override.

import { join as joinPath } from 'node:path';
import { mkdirSync } from 'node:fs';

import { getElanousConfigDir, getElanousConfigDirOverride } from '../elanous-config-dir.js';

let testStateRoot: string | undefined;

/** Override the nexus state root WITHOUT touching the config dir.
 *  Used by `--test` so `state files (lock/runtime/logs/tabs)` live
 *  under `<repo>/.elanous-test/nexus/` while config.json / secrets stay
 *  in `~/.elanous/`. Pass `null` to clear (test cleanup). */
export function setTestStateRoot(dir: string | null): void {
  if (dir === null) {
    testStateRoot = undefined;
    return;
  }
  const trimmed = dir.trim();
  if (trimmed.length === 0) {
    throw new Error('setTestStateRoot: empty directory');
  }
  testStateRoot = trimmed;
}

/** Read the current test state root override. undefined when not in
 *  test mode. Exposed for diagnostics + bg-launch argv plumbing. */
export function getTestStateRoot(): string | undefined {
  return testStateRoot;
}

export function nexusRootDir(): string {
  if (testStateRoot !== undefined) return joinPath(testStateRoot, 'nexus');
  // An EXPLICIT `--config-dir` / setElanousConfigDir wins over the legacy
  // env (config-dir-unify semantics preserved for its adopters).
  const cfgOverride = getElanousConfigDirOverride();
  if (cfgOverride !== undefined) return joinPath(cfgOverride, 'nexus');
  // Legacy fallback — see header note (restored 2026-07-12). Read live
  // (no caching) so a test's beforeEach set/unset takes effect.
  const legacy = process.env.ELANOUS_NEXUS_DIR;
  if (legacy && legacy.trim()) return legacy.trim();
  return joinPath(getElanousConfigDir(), 'nexus');
}

export function nexusLockPath(): string {
  return joinPath(nexusRootDir(), '.lock');
}

export function nexusRuntimePath(): string {
  return joinPath(nexusRootDir(), 'runtime.json');
}

/** N-5 PR χ — restart-pending state file (one-shot, cleared after read). */
export function nexusRestartStatePath(): string {
  return joinPath(nexusRootDir(), 'restart-state.json');
}

/** P-2D.1 — lock file for the detached `elanous nexus pwa dev --bg`
 *  child. Written by `runPwaDevBgLaunch`, read by `--status` / `--stop`,
 *  cleared on graceful exit. JSON: { pid, host, startedAt, port, logPath }. */
export function nexusPwaDevLockPath(): string {
  return joinPath(nexusRootDir(), '.pwa-dev.lock');
}

export function nexusTabsDir(): string {
  return joinPath(nexusRootDir(), 'tabs');
}

export function nexusTemplatesDir(): string {
  return joinPath(nexusRootDir(), 'templates');
}

export function nexusLogsDir(tabId?: string): string {
  const base = joinPath(nexusRootDir(), 'logs');
  return tabId ? joinPath(base, tabId) : base;
}

export function nexusErrorsDir(tabId?: string): string {
  const base = joinPath(nexusRootDir(), 'errors');
  return tabId ? joinPath(base, tabId) : base;
}

/** Per-channel subsystem binding store. One JSON file per channel ·
 *  0o600 · isolated writes across channels. */
export function nexusBindingsDir(channel?: string): string {
  const base = joinPath(nexusRootDir(), 'bindings');
  return channel ? joinPath(base, `${channel}.json`) : base;
}

/** Ensure the NEXUS root dir exists. Idempotent. Subdirs created
 *  lazily by their writers. */
export function ensureNexusRootDir(): void {
  mkdirSync(nexusRootDir(), { recursive: true });
}
