// User-config loader — Phase 7 (B1).
//
// Reads `~/.monad/input-bindings.json` and overlays the user-config
// layer of the resolver binding table. Each entry is validated via
// validateRebind() before application; violations are logged (to the
// supplied reporter) and the entry is skipped. Keeps default + runtime
// layers intact, mirroring claude-code-fork's user-keybindings.json
// hot-reload.
//
// File format (version 1):
//
//   {
//     "version": 1,
//     "bindings": [
//       { "matcher": "alt+s",   "actionId": "mode.enter.sync" },
//       { "matcher": "ctrl+x y","actionId": "mode.enter.sync", "context": "input" }
//     ]
//   }
//
// Errors:
//   • Missing file          → no-op (default + runtime layers own it).
//   • Malformed JSON        → report + no-op (user-config layer
//                             cleared? NO — we preserve whatever was
//                             loaded last so a typo doesn't wipe the
//                             overlay).
//   • Invalid entry         → report + skip that entry, others apply.
//   • Reserved-key/action   → report + skip.

import { readFileSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { setUserConfigBindings, lookupBindings } from './bindings.js';
import { validateRebind, type ReservationViolation } from './reserved.js';
import { applyInputSettings, resetInputSettings, type SettingsApplyResult } from './settings.js';
import type { ContextTag } from './context.js';

/** The one schema version this build understands. Future migrations
 *  land in migrateUserConfig() — for now v1 is passthrough. */
export const SUPPORTED_VERSION = 1;

export interface RawUserBinding {
  matcher: unknown;
  actionId: unknown;
  context?: unknown;
}

export interface RawUserConfig {
  version?: unknown;
  bindings?: unknown;
  settings?: unknown;
}

export interface LoadReport {
  loaded: number;
  skipped: Array<{ entry: RawUserBinding; reason: string }>;
  /** R5 — user-config bindings that shadow a default binding with a
   *  DIFFERENT actionId. Redundant re-binding (same matcher + same
   *  actionId) is NOT flagged. */
  conflicts: Array<{ matcher: string; defaultActionId: string; newActionId: string }>;
  /** R6 — settings block apply result. Empty when no settings were
   *  provided. */
  settings: SettingsApplyResult;
  /** R8 — version declared by the file. `SUPPORTED_VERSION` on match,
   *  `unknown` string when missing/other, used by reporter for
   *  version-mismatch messaging. */
  version: number | 'unknown';
}

export type LoadReporter = (ev:
  | { kind: 'loaded'; report: LoadReport }
  | { kind: 'missing'; path: string }
  | { kind: 'malformed'; path: string; error: string }
  | { kind: 'reloaded'; report: LoadReport }
  | { kind: 'version-mismatch'; path: string; got: unknown; expected: number }
) => void;

const EMPTY_REPORT: LoadReport = {
  loaded: 0, skipped: [], conflicts: [],
  settings: { applied: {}, rejected: [] }, version: 'unknown',
};

const DEFAULT_REPORTER: LoadReporter = () => {};

export function resolveUserBindingsPath(): string {
  return join(homedir(), '.monad', 'input-bindings.json');
}

/** Read + parse + validate. Returns a report; applies the overlay
 *  as a side effect (unless file missing or malformed JSON — those
 *  leave the current overlay untouched). */
export function loadUserBindings(
  path: string = resolveUserBindingsPath(),
  report: LoadReporter = DEFAULT_REPORTER,
): LoadReport {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      report({ kind: 'missing', path });
      // Clear the overlay — file was present before but is gone now.
      // A later setUserConfigBindings([]) would clear; skipping for
      // now keeps last-known-good overlay alive across transient
      // renames (editors often rename-to-replace).
      return { ...EMPTY_REPORT };
    }
    report({ kind: 'malformed', path, error: String(err) });
    return { ...EMPTY_REPORT };
  }

  let parsed: RawUserConfig;
  try {
    parsed = JSON.parse(raw) as RawUserConfig;
  } catch (err) {
    report({ kind: 'malformed', path, error: String(err) });
    return { ...EMPTY_REPORT };
  }

  // R8 — version check. Anything other than the supported version is
  // reported + returned without applying bindings or settings. Keeps
  // a v2 file from being silently reinterpreted under v1 rules.
  const declaredVersion: number | 'unknown' =
    typeof parsed.version === 'number' ? parsed.version : 'unknown';
  if (declaredVersion !== SUPPORTED_VERSION) {
    report({ kind: 'version-mismatch', path, got: parsed.version, expected: SUPPORTED_VERSION });
    return { ...EMPTY_REPORT, version: declaredVersion };
  }

  // R6 — settings block (optional). Defaults restored first so a
  // removed field reverts to baseline.
  resetInputSettings();
  let settingsResult: SettingsApplyResult = { applied: {}, rejected: [] };
  if (parsed.settings && typeof parsed.settings === 'object') {
    settingsResult = applyInputSettings(parsed.settings as Record<string, unknown>);
  }

  const arr = Array.isArray(parsed.bindings) ? (parsed.bindings as RawUserBinding[]) : [];
  const accepted: Array<{ matcher: string; actionId: string; context?: ContextTag }> = [];
  const skipped: LoadReport['skipped'] = [];
  const conflicts: LoadReport['conflicts'] = [];

  for (const entry of arr) {
    const reason = validateEntry(entry);
    if (reason) {
      skipped.push({ entry, reason });
      continue;
    }
    // R11 — context-scoped reserved check. If the entry carries a
    // context tag, only that context's reserved set applies.
    const entryContext = typeof entry.context === 'string'
      ? (entry.context as ContextTag)
      : undefined;
    const v: ReservationViolation | null = validateRebind(
      String(entry.actionId),
      [String(entry.matcher)],
      entryContext,
    );
    if (v) {
      skipped.push({ entry, reason: v.message });
      continue;
    }
    const matcher = String(entry.matcher).toLowerCase();
    const actionId = String(entry.actionId);

    // R5 — conflict detection. Compare against current default layer
    // bindings for the same matcher. Shadowing with a DIFFERENT
    // actionId is flagged; redundant re-binding (same actionId) is
    // silent (some users prefer to version-pin their defaults).
    const defaultHits = lookupBindings(matcher).filter(b => b.source === 'default');
    for (const d of defaultHits) {
      if (d.actionId !== actionId) {
        conflicts.push({ matcher, defaultActionId: d.actionId, newActionId: actionId });
        break;  // one conflict row per matcher is enough
      }
    }

    const out: { matcher: string; actionId: string; context?: ContextTag } = {
      matcher, actionId,
    };
    if (typeof entry.context === 'string') out.context = entry.context as ContextTag;
    accepted.push(out);
  }

  setUserConfigBindings(accepted);
  const result: LoadReport = {
    loaded: accepted.length,
    skipped,
    conflicts,
    settings: settingsResult,
    version: SUPPORTED_VERSION,
  };
  report({ kind: 'loaded', report: result });
  return result;
}

function validateEntry(e: RawUserBinding): string | null {
  if (typeof e !== 'object' || e === null) return 'entry must be an object';
  if (typeof e.matcher !== 'string' || !e.matcher.trim()) return 'matcher must be a non-empty string';
  if (typeof e.actionId !== 'string' || !e.actionId.trim()) return 'actionId must be a non-empty string';
  if (e.context !== undefined && typeof e.context !== 'string') return 'context must be a string when present';
  return null;
}

/** Install an fs.watch on the bindings file. Fires onChange after
 *  every modify/rename event with a 50 ms debounce (editors often
 *  emit multiple events per save). Returns a dispose function that
 *  closes the watcher. */
export function watchUserBindings(
  path: string = resolveUserBindingsPath(),
  onChange: () => void,
): () => void {
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; onChange(); }, 50);
  };
  try {
    // Watch the parent dir so we still get events when the file is
    // deleted + recreated (common editor save pattern). Filter on
    // basename inside the callback so unrelated dir activity is
    // ignored.
    const dir = dirname(path);
    const base = path.slice(dir.length + 1);
    watcher = watch(dir, (_ev, filename) => {
      if (filename && filename === base) debounced();
    });
  } catch {
    // Parent dir missing → skip watcher; the loader still works on
    // subsequent boots when the dir appears. Not fatal.
  }
  return () => {
    if (timer) clearTimeout(timer);
    try { watcher?.close(); } catch { /* ignore */ }
    watcher = null;
  };
}

/** Convenience: initial load + watcher installer. Used by the
 *  dashboard boot path; tests can call the pieces individually. */
export function initUserBindings(
  opts: {
    path?: string;
    report?: LoadReporter;
  } = {},
): { initial: LoadReport; dispose: () => void } {
  const path = opts.path ?? resolveUserBindingsPath();
  const report = opts.report ?? DEFAULT_REPORTER;
  const initial = loadUserBindings(path, report);
  const dispose = watchUserBindings(path, () => {
    const r = loadUserBindings(path, report);
    report({ kind: 'reloaded', report: r });
  });
  return { initial, dispose };
}
