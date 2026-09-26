// NEXUS · UserConfig read/write (Phase N-3 PR μ)
//
// Single JSON file at `~/.elanous/config.json`. Loaded at boot; mutations
// go through writeUserConfigPatch (which round-trips: load → patch → write).
// File is created lazily on first write — boot tolerates missing file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  USER_CONFIG_VERSION,
  type UserConfig,
} from './types.js';
import { userConfigPath } from './paths.js';
import { withFileLockSync } from '../../storage/file-lock.js';

function defaultUserConfig(): UserConfig {
  return { version: USER_CONFIG_VERSION, global: {}, tabs: {} };
}

export function readUserConfig(): UserConfig {
  const path = userConfigPath();
  if (!existsSync(path)) return defaultUserConfig();
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UserConfig>;
    if (parsed.version !== USER_CONFIG_VERSION) return defaultUserConfig();
    // PLAN-config-unification §3-A — Path A's 16 keys (acp / chat /
    // llm / obsidian / skills / …) share the same JSON file. Spread
    // `parsed` first so unknown keys flow through; then overwrite the
    // 3 NEXUS-typed slots. Without this passthrough, every
    // patchUserConfig() round-trip wipes the user's entire LLM /
    // Obsidian / Discord / … config (critical fix 2026-05-13).
    return {
      ...parsed,
      version: USER_CONFIG_VERSION,
      global: (parsed.global ?? {}) as UserConfig['global'],
      tabs: (parsed.tabs ?? {}) as UserConfig['tabs'],
    };
  } catch {
    return defaultUserConfig();
  }
}

export function writeUserConfig(cfg: UserConfig): void {
  const path = userConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** Convenience: load → mutate → save in a single operation. Returns
 *  the post-mutation value of the field for callers that want to
 *  echo back.
 *
 *  FU3 (PLAN-config-unification-elanous-root-2026-05-10 closing): the
 *  full read-modify-write is wrapped in a cross-process file lock so
 *  simultaneous patchers (NEXUS daemon + CLI · or two daemons) cannot
 *  lose each other's updates. Lock path is shared with Path A's
 *  saveUserConfig so the two writers serialize against each other. */
export function patchUserConfig(mutate: (cfg: UserConfig) => void): UserConfig {
  const path = userConfigPath();
  return withFileLockSync(path + '.lock', () => {
    const cfg = readUserConfig();
    mutate(cfg);
    writeUserConfig(cfg);
    return cfg;
  });
}

// ---------------------------------------------------------------------------
// Switch-id <-> UserConfig path resolution
// ---------------------------------------------------------------------------

/** Resolve a switch id like 'tabs.daemon:1.httpPort' into the value
 *  stored in UserConfig (or undefined if unset). The first segment must
 *  be 'global' or 'tabs'. For tabs, the second segment is the tab id
 *  (literal · NOT a wildcard) and the rest is the field path. */
export function readSwitchValue(cfg: UserConfig, switchId: string): unknown {
  const parts = switchId.split('.');
  if (parts.length < 2) return undefined;
  if (parts[0] === 'global') {
    return readNested(cfg.global as Record<string, unknown>, parts.slice(1));
  }
  if (parts[0] === 'tabs') {
    const tabId = parts[1];
    if (!tabId) return undefined;
    const tabCfg = cfg.tabs[tabId];
    if (!tabCfg) return undefined;
    if (parts.length === 2) return tabCfg;
    return readNested(tabCfg as Record<string, unknown>, parts.slice(2));
  }
  return undefined;
}

export function writeSwitchValue(cfg: UserConfig, switchId: string, value: unknown): void {
  const parts = switchId.split('.');
  if (parts.length < 2) throw new Error(`invalid switch id: ${switchId}`);
  if (parts[0] === 'global') {
    writeNested(cfg.global as Record<string, unknown>, parts.slice(1), value);
    return;
  }
  if (parts[0] === 'tabs') {
    const tabId = parts[1];
    if (!tabId) throw new Error(`invalid switch id: ${switchId}`);
    if (!cfg.tabs[tabId]) cfg.tabs[tabId] = {};
    if (parts.length === 2) {
      // Replacing the whole TabUserConfig is unusual but allowed.
      cfg.tabs[tabId] = value as Record<string, unknown>;
      return;
    }
    writeNested(cfg.tabs[tabId] as Record<string, unknown>, parts.slice(2), value);
    return;
  }
  throw new Error(`unsupported switch scope: ${parts[0]}`);
}

function readNested(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function writeNested(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = path[i];
    if (typeof cur[seg] !== 'object' || cur[seg] == null) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/** Remove the value at `switchId`. No-op when the path does not exist.
 *  Mirrors `writeSwitchValue` semantics for path scoping ('global.X' or
 *  'tabs.<id>.X'). Used by `elanous nexus config unset`. */
export function unsetSwitchValue(cfg: UserConfig, switchId: string): void {
  const parts = switchId.split('.');
  if (parts.length < 2) throw new Error(`invalid switch id: ${switchId}`);
  if (parts[0] === 'global') {
    deleteNested(cfg.global as Record<string, unknown>, parts.slice(1));
    return;
  }
  if (parts[0] === 'tabs') {
    const tabId = parts[1];
    if (!tabId) throw new Error(`invalid switch id: ${switchId}`);
    const tabCfg = cfg.tabs[tabId];
    if (!tabCfg) return;
    if (parts.length === 2) {
      delete cfg.tabs[tabId];
      return;
    }
    deleteNested(tabCfg as Record<string, unknown>, parts.slice(2));
    return;
  }
  throw new Error(`unsupported switch scope: ${parts[0]}`);
}

function deleteNested(obj: Record<string, unknown>, path: string[]): void {
  let cur: Record<string, unknown> | null = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = path[i];
    const next = cur[seg];
    if (typeof next !== 'object' || next === null) return;
    cur = next as Record<string, unknown>;
  }
  delete cur[path[path.length - 1]];
}
