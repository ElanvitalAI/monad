// ── PX-2: plugin-state path helpers ──
//
// Defines the canonical location for per-plugin persisted state and
// key/plugin-id sanitizers. Kept dependency-light so tests can stub in
// temp directories without pulling in the rest of the plugin-state
// surface.
//
// Layout:
//   ~/.monad/state/<plugin-id>/<key>.json      (user scope)
//   <cwd>/.monad/state/<plugin-id>/<key>.json  (project scope; overrides user)
//
// Scope precedence (DD-PX2-1): project wins over user on read when both
// exist. Writes target the caller-specified scope — default is 'user'
// so workspace-local side effects are explicit.

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root for user-global plugin state. */
export function userStateRoot(): string {
  return join(homedir(), '.monad', 'state');
}

/** Root for project-local plugin state. Caller passes its session cwd
 *  (or getSessionCwd()) rather than process.cwd() so the state dir
 *  follows SWD switches (EnterWorktree / SetWorkingDir). */
export function projectStateRoot(cwd: string): string {
  return join(cwd, '.monad', 'state');
}

/** Resolve a `<root>/<pluginId>/<key>.json` path. Caller supplies the
 *  scope root (userStateRoot or projectStateRoot output). Both inputs
 *  must be pre-sanitized by the caller — path joining alone is not a
 *  security boundary. */
export function stateFilePath(root: string, pluginId: string, key: string): string {
  return join(root, pluginId, `${key}.json`);
}

// ── Sanitizers ──────────────────────────────────────────────────────
//
// Plugin IDs and state keys end up as filesystem path segments. We
// enforce a strict allowlist so a caller can't write outside the
// plugin-state tree. Rejects empty / dotfile / traversal / slash.

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function sanitizeKey(key: string): string {
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('state key must be a non-empty string');
  }
  const trimmed = key.trim();
  if (!KEY_PATTERN.test(trimmed)) {
    throw new Error(
      `state key '${key}' is invalid — allowed: lowercase alphanumerics + '.', '_', '-' (not leading).`,
    );
  }
  return trimmed;
}

export function sanitizePluginId(pluginId: string): string {
  if (typeof pluginId !== 'string' || !pluginId.trim()) {
    throw new Error('plugin id must be a non-empty string');
  }
  const trimmed = pluginId.trim();
  if (!PLUGIN_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `plugin id '${pluginId}' is invalid — allowed: lowercase alphanumerics + '.', '_', '-' (not leading).`,
    );
  }
  return trimmed;
}
