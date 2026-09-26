// H4 Phase 3.B.2b · Codex app-server thread index · disk-backed
// synthId → codex threadId mapping, used by `CodexAppServerAgent.
// loadSession` to call `thread/resume` after a elanous restart.
//
// Pattern is a near-copy of `codex-native-thread-index.ts` minus the
// SDK-specific ThreadOptionsSnapshot — the v2 server owns thread-side
// config (approval policy, sandbox, model, ...) so we don't persist
// those on the client side. cwd is still persisted because `thread/
// resume` accepts a cwd override and we want to default to the
// directory elanous opened the session in.
//
// Storage path: `$XDG_CONFIG_HOME/elanous/codex-app-server-threads.json`
// (same base dir as session-store + codex-native-threads). Atomic
// tmp+rename write. Corrupt file → empty map + debug log.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join as joinPath, dirname } from 'node:path';
import { debug } from '../debug/log.js';
import { migrateLegacyXdgFile } from '../storage/legacy-elanous-dir-migrate.js';

export interface CasThreadIndexEntry {
  /** elanous-synth id (e.g. `codex-app-server-codex-app-server-1`). */
  synthId: string;
  /** Codex thread id returned by `thread/start`. Passed to
   *  `thread/resume` as `threadId`. */
  threadId: string;
  /** Working directory supplied at `thread/start` time. */
  cwd: string;
  createdAt: number;
  lastTurnAt: number;
  /** M4'.1 (2026-04-28) — optional per-session MCP policy. Persisted so
   *  a host restart restores the session's allow/block list before the
   *  first `mcpServer/tool/call` arrives. Backward-compat: legacy
   *  entries without this field decode normally + sessionMcpPolicies
   *  Map starts empty for them (= allow-all default). */
  mcpPolicy?: CasThreadMcpPolicySnapshot | null;
}

/** Wire-shape mirror of \`CodexMcpSessionPolicy\` — kept here (instead of
 *  importing from agent.ts) so the thread-index module stays
 *  dependency-free. The fields are identical. */
export interface CasThreadMcpPolicySnapshot {
  mode: 'allow-all' | 'allow-list' | 'block-list';
  tools?: string[];
}

export interface CasThreadIndexFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, enc: 'utf-8'): string;
  writeFileSync(path: string, contents: string, enc: 'utf-8'): void;
  renameSync(from: string, to: string): void;
  mkdirSync(path: string, opts: { recursive: true }): void;
}

export interface CasThreadIndexOpts {
  basePath?: string;
  fs?: CasThreadIndexFs;
  now?: () => number;
}

export interface CasThreadIndex {
  get(synthId: string): CasThreadIndexEntry | null;
  put(
    synthId: string,
    input: Omit<CasThreadIndexEntry, 'synthId' | 'createdAt' | 'lastTurnAt'> & {
      createdAt?: number;
      lastTurnAt?: number;
    },
  ): CasThreadIndexEntry;
  touch(synthId: string): CasThreadIndexEntry | null;
  /** M4'.1 — update only the mcpPolicy field. Returns the updated entry
   *  or null when the synthId is unknown. Pass `null` to clear. */
  setMcpPolicy(
    synthId: string,
    policy: CasThreadMcpPolicySnapshot | null,
  ): CasThreadIndexEntry | null;
  remove(synthId: string): boolean;
  list(): CasThreadIndexEntry[];
  readonly path: string;
}

/** LRU cap for the on-disk thread index. Without a bound, every session
 *  mint — and every session RECYCLE (elanous's resolveSessionId drops the
 *  elanous-side mapping + mints a fresh thread on a stale epoch / turn-cap /
 *  resume-timeout, but never removes the OLD codex entry) — leaves a
 *  permanent orphan, so the file grows forever. We evict the least-
 *  recently-used entries past this cap; an evicted session that is later
 *  resumed simply misses → the agent's not-found recovery mints a fresh
 *  one (graceful). 200 is generous headroom over the handful of sessions
 *  actually live at once. */
export const CAS_THREAD_INDEX_MAX = 200;

// FU2 (PLAN-config-unification-elanous-root-2026-05-10 closing follow-up):
//   moved from ~/.config/elanous/codex-app-server-threads.json → ~/.elanous/...
function defaultBasePath(): string {
  // ELANOUS_STATE_DIR — unified isolated-state knob (see sessionRoot). Wins
  // over XDG so an isolated process's codex threads don't mix with prod.
  const stateDir = process.env.ELANOUS_STATE_DIR?.trim();
  if (stateDir) return stateDir;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return joinPath(xdg, 'elanous');
  migrateLegacyXdgFile('codex-app-server-threads.json', 0o600);
  return joinPath(homedir(), '.elanous');
}

function defaultFilePath(): string {
  return joinPath(defaultBasePath(), 'codex-app-server-threads.json');
}

function nodeFs(): CasThreadIndexFs {
  return {
    existsSync,
    readFileSync: (p, enc) => readFileSync(p, enc),
    writeFileSync: (p, c, enc) => writeFileSync(p, c, enc),
    renameSync,
    mkdirSync,
  };
}

function isMcpPolicySnapshot(v: unknown): v is CasThreadMcpPolicySnapshot {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<CasThreadMcpPolicySnapshot>;
  if (r.mode !== 'allow-all' && r.mode !== 'allow-list' && r.mode !== 'block-list') {
    return false;
  }
  if (r.tools !== undefined && !Array.isArray(r.tools)) return false;
  if (r.tools && !r.tools.every((t) => typeof t === 'string')) return false;
  return true;
}

function isEntry(v: unknown): v is CasThreadIndexEntry {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<CasThreadIndexEntry>;
  if (
    typeof r.synthId !== 'string' ||
    typeof r.threadId !== 'string' ||
    typeof r.cwd !== 'string' ||
    typeof r.createdAt !== 'number' ||
    typeof r.lastTurnAt !== 'number'
  ) {
    return false;
  }
  // mcpPolicy optional · null/undefined ok · object must conform.
  if (r.mcpPolicy != null && !isMcpPolicySnapshot(r.mcpPolicy)) return false;
  return true;
}

export function createCasThreadIndex(
  opts: CasThreadIndexOpts = {},
): CasThreadIndex {
  const path = opts.basePath ?? defaultFilePath();
  const fs = opts.fs ?? nodeFs();
  const now = opts.now ?? (() => Date.now());

  const readAll = (): Map<string, CasThreadIndexEntry> => {
    if (!fs.existsSync(path)) return new Map();
    let raw: string;
    try {
      raw = fs.readFileSync(path, 'utf-8');
    } catch (err) {
      if (debug.enabled) {
        debug.log('acp.cas.thread-index.read-error', path, {
          message: (err as Error)?.message,
        }, { level: 'error' });
      }
      return new Map();
    }
    if (!raw.trim()) return new Map();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      if (debug.enabled) {
        debug.log('acp.cas.thread-index.parse-error', path, {
          message: (err as Error)?.message,
        }, { level: 'error' });
      }
      return new Map();
    }
    if (!parsed || typeof parsed !== 'object') return new Map();
    const out = new Map<string, CasThreadIndexEntry>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(value) && value.synthId === key) {
        out.set(key, value);
      } else if (debug.enabled) {
        debug.log('acp.cas.thread-index.drop-malformed', key);
      }
    }
    return out;
  };

  const writeAll = (map: Map<string, CasThreadIndexEntry>): void => {
    const dir = dirname(path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj: Record<string, CasThreadIndexEntry> = {};
    for (const [key, entry] of map.entries()) obj[key] = entry;
    const body = JSON.stringify(obj, null, 2);
    const tmp = `${path}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, body, 'utf-8');
    fs.renameSync(tmp, path);
  };

  return {
    get path() {
      return path;
    },

    get(synthId) {
      const map = readAll();
      return map.get(synthId) ?? null;
    },

    put(synthId, input) {
      const map = readAll();
      const existing = map.get(synthId);
      const ts = now();
      const entry: CasThreadIndexEntry = {
        synthId,
        threadId: input.threadId,
        cwd: input.cwd,
        createdAt: input.createdAt ?? existing?.createdAt ?? ts,
        lastTurnAt: input.lastTurnAt ?? ts,
        // M4'.1 — preserve previously-stored mcpPolicy on plain `put`
        // calls (newSession / loadSession refresh) when caller didn't
        // explicitly pass one.
        ...(input.mcpPolicy !== undefined
          ? { mcpPolicy: input.mcpPolicy }
          : existing?.mcpPolicy != null
            ? { mcpPolicy: existing.mcpPolicy }
            : {}),
      };
      map.set(synthId, entry);
      // LRU cap — bound the file. The just-put entry has the newest
      // lastTurnAt so it is never in the evicted (oldest-first) slice.
      if (map.size > CAS_THREAD_INDEX_MAX) {
        const evict = Array.from(map.values())
          .sort((a, b) => a.lastTurnAt - b.lastTurnAt)
          .slice(0, map.size - CAS_THREAD_INDEX_MAX);
        for (const e of evict) map.delete(e.synthId);
        if (debug.enabled) {
          debug.log('acp.cas.thread-index.evict', synthId, { evicted: evict.length, cap: CAS_THREAD_INDEX_MAX });
        }
      }
      writeAll(map);
      if (debug.enabled) {
        debug.log('acp.cas.thread-index.put', synthId, {
          threadId: entry.threadId,
        });
      }
      return entry;
    },

    setMcpPolicy(synthId, policy) {
      const map = readAll();
      const existing = map.get(synthId);
      if (!existing) return null;
      const updated: CasThreadIndexEntry = policy === null
        ? (() => {
            const { mcpPolicy: _drop, ...rest } = existing;
            void _drop;
            return rest;
          })()
        : { ...existing, mcpPolicy: policy };
      map.set(synthId, updated);
      writeAll(map);
      if (debug.enabled) {
        debug.log('acp.cas.thread-index.setMcpPolicy', synthId, {
          mode: policy?.mode ?? 'cleared',
        });
      }
      return updated;
    },

    touch(synthId) {
      const map = readAll();
      const existing = map.get(synthId);
      if (!existing) return null;
      const updated: CasThreadIndexEntry = {
        ...existing,
        lastTurnAt: now(),
      };
      map.set(synthId, updated);
      writeAll(map);
      return updated;
    },

    remove(synthId) {
      const map = readAll();
      if (!map.has(synthId)) return false;
      map.delete(synthId);
      writeAll(map);
      if (debug.enabled) debug.log('acp.cas.thread-index.remove', synthId);
      return true;
    },

    list() {
      const map = readAll();
      return Array.from(map.values()).sort((a, b) => b.lastTurnAt - a.lastTurnAt);
    },
  };
}

let _singleton: CasThreadIndex | null = null;
export function globalCasThreadIndex(): CasThreadIndex {
  if (!_singleton) _singleton = createCasThreadIndex();
  return _singleton;
}

export function _resetCasThreadIndexForTests(): void {
  _singleton = null;
}
