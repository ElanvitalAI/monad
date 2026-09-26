// ACP H2 #5 — Local file-backed session persistence.
//
// Snapshot rich ACP session state (history + plan + tool-call records
// + metadata) so elanous can list saved conversations and call
// `loadSession` on a capable peer to resume them. Gated by H2 #4's
// `getCapabilities().loadSession` at the tool layer — this module
// itself just reads/writes JSON files.
//
// Reference (Warp primary per user 2026-04-22): warp.dev blog "how
//   Warp works" describes per-agent conversation resume as a core
//   Oz/Drive UX. Our equivalent is local-disk only for now; cloud
//   sync (Drive-like) is a later arc.
// Reference (Zed): crates/acp_thread/src/acp_thread.rs calls
//   connection.loadSession(req) when a thread resumes. We port the
//   call shape at client.ts, this module just persists.
// Reference (ACP SDK 0.14.1): LoadSessionRequest = { sessionId, cwd,
//   mcpServers }. Only callable when peer advertises
//   AgentCapabilities.loadSession === true.
//
// Storage layout: `$XDG_CONFIG_HOME/elanous/acp-sessions/<sanitized>.json`
// · one file per session · atomic tmp+rename · corrupt files skipped
// (logged to debug trail, not thrown).
//
// Deliberately NOT integrated into DualRoleManager's send path — that
// hook belongs in a follow-up arc with its own test coverage. This
// module is read-surface + on-demand persist; automatic snapshot on
// turn-end lands later.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join as joinPath } from 'node:path';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import type { ContentBlock, ProtocolVersion } from '@agentclientprotocol/sdk';
import type { PlanSnapshot } from './plan-model.js';
import type { ToolCallRecord } from './tool-call-state.js';
import { debug } from '../debug/log.js';
import { migrateLegacyXdgSubdir } from '../storage/legacy-elanous-dir-migrate.js';

/** Serialized ACP session snapshot. Shape is the full persisted
 *  record — callers receive this on load/resume. */
export interface PersistedAcpSession {
  /** Elanous-namespaced session id (e.g. `acp-cli:claude:abc-123`).
   *  Used as the on-disk key and returned to the LLM. */
  sessionId: string;
  /** Raw backend session id (the part the ACP peer minted). Passed
   *  to `connection.loadSession({ sessionId })` when resuming — the
   *  peer knows nothing about our `acp-cli:` prefix. */
  backendSessionId: string;
  backendId: string;
  cwd: string;
  protocolVersion: ProtocolVersion;
  /** Conversation turn history. Empty array when the backend didn't
   *  stream resumable blocks (common for text-only flows). */
  history: ContentBlock[];
  planSnapshot: PlanSnapshot | null;
  toolCalls: ToolCallRecord[];
  createdAt: number;
  lastSeenAt: number;
  /** Free-form tag · messenger chat id, VW pane id, etc. */
  origin?: string;
}

export interface AcpSessionPersistenceFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, enc: 'utf-8'): string;
  writeFileSync(path: string, contents: string, enc: 'utf-8'): void;
  renameSync(from: string, to: string): void;
  readdirSync(path: string): string[];
  unlinkSync(path: string): void;
  mkdirSync(path: string, opts: { recursive: true }): void;
}

export interface AcpSessionPersistenceOpts {
  basePath?: string;
  fs?: AcpSessionPersistenceFs;
  now?: () => number;
}

export type AcpSessionPersistFilter = { backendId?: string };

/** UI-Core arc Phase U1 — narrow change event for SessionStore facade
 *  subscription. Only the identity fields; full payload stays on disk. */
export type AcpSessionPersistenceChangeEvent =
  | { kind: 'persistence-updated'; sessionId: string; backendId: string }
  | { kind: 'persistence-removed'; sessionId: string };

export interface AcpSessionPersistence {
  persist(
    record: Omit<PersistedAcpSession, 'lastSeenAt' | 'createdAt'> & {
      createdAt?: number;
    },
  ): PersistedAcpSession;
  load(sessionId: string): PersistedAcpSession | null;
  list(filter?: AcpSessionPersistFilter): PersistedAcpSession[];
  remove(sessionId: string): boolean;
  /** UI-Core arc Phase U1 — subscribe to persist/remove events. */
  onChange(listener: (ev: AcpSessionPersistenceChangeEvent) => void): () => void;
  readonly basePath: string;
}

// FU2 (PLAN-config-unification-elanous-root-2026-05-10 closing follow-up):
//   moved from ~/.config/elanous/acp-sessions/ → ~/.elanous/acp-sessions/.
//   Dir migration via the shared once-per-process helper.
function defaultBasePath(): string {
  // ELANOUS_STATE_DIR — unified isolated-state knob (see sessionRoot). Wins
  // over XDG so `elanous telegram-test` keeps its /cc delegation sessions
  // separate from the daemon's.
  const stateDir = process.env.ELANOUS_STATE_DIR?.trim();
  if (stateDir) return joinPath(stateDir, 'acp-sessions');
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return joinPath(xdg, 'elanous', 'acp-sessions');
  migrateLegacyXdgSubdir('acp-sessions');
  // ELANOUS_STATE_DIR 부재 확정(위 early-return) → elanousStateRoot()=~/.elanous (prod 동치).
  return joinPath(elanousStateRoot(), 'acp-sessions');
}

/** Map a session id to a filesystem-safe filename. We keep the
 *  original id intact inside the JSON payload · the filename is just
 *  for lookup. Colons / slashes / whitespace get replaced.
 *
 *  ⭐ **export 인 이유**(17차 `[F]`): 파일명에서 되살아난 id 는 `acp-cli:` 대신
 *  `acp-cli_` 를 달고 온다. 그것을 알아보려는 쪽이 «그 규칙을 베끼는» 대신
 *  ***이 함수로 파생***시키게 하려고 연다 — 살균 규칙이 바뀌면 판정도 같이 따라간다.
 *  ⛔ 파일 경로를 만드는 것은 여전히 이 모듈의 일이다. 밖에서 경로를 조립하지 마라. */
export function sanitizeForFilename(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function filePathFor(basePath: string, sessionId: string): string {
  return joinPath(basePath, `${sanitizeForFilename(sessionId)}.json`);
}

function nodeFs(): AcpSessionPersistenceFs {
  return {
    existsSync,
    readFileSync: (p, enc) => readFileSync(p, enc),
    writeFileSync: (p, c, enc) => writeFileSync(p, c, enc),
    renameSync,
    readdirSync,
    unlinkSync,
    mkdirSync,
  };
}

function isRecordShape(v: unknown): v is PersistedAcpSession {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<PersistedAcpSession>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.backendSessionId === 'string' &&
    typeof r.backendId === 'string' &&
    typeof r.cwd === 'string' &&
    typeof r.protocolVersion === 'number' &&
    Array.isArray(r.history) &&
    Array.isArray(r.toolCalls) &&
    typeof r.createdAt === 'number' &&
    typeof r.lastSeenAt === 'number'
  );
}

export function createAcpSessionPersistence(
  opts: AcpSessionPersistenceOpts = {},
): AcpSessionPersistence {
  const basePath = opts.basePath ?? defaultBasePath();
  const fs = opts.fs ?? nodeFs();
  const now = opts.now ?? (() => Date.now());
  const changeListeners = new Set<(ev: AcpSessionPersistenceChangeEvent) => void>();
  const fireChange = (ev: AcpSessionPersistenceChangeEvent): void => {
    for (const l of Array.from(changeListeners)) {
      try { l(ev); } catch { /* listener errors must not wedge others */ }
    }
  };

  const ensureDir = (): void => {
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
  };

  const readRecord = (path: string): PersistedAcpSession | null => {
    if (!fs.existsSync(path)) return null;
    try {
      const raw = fs.readFileSync(path, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!isRecordShape(parsed)) {
        if (debug.enabled) {
          debug.log('acp.persistence.drop-malformed', path);
        }
        return null;
      }
      return parsed;
    } catch (err) {
      if (debug.enabled) {
        debug.log('acp.persistence.read-error', path, {
          message: (err as Error)?.message,
        }, { level: 'error' });
      }
      return null;
    }
  };

  return {
    get basePath() {
      return basePath;
    },

    persist(input) {
      ensureDir();
      const path = filePathFor(basePath, input.sessionId);
      const existing = readRecord(path);
      const ts = now();
      const record: PersistedAcpSession = {
        sessionId: input.sessionId,
        backendSessionId: input.backendSessionId,
        backendId: input.backendId,
        cwd: input.cwd,
        protocolVersion: input.protocolVersion,
        history: input.history,
        planSnapshot: input.planSnapshot,
        toolCalls: input.toolCalls,
        createdAt: input.createdAt ?? existing?.createdAt ?? ts,
        lastSeenAt: ts,
      };
      if (input.origin !== undefined) record.origin = input.origin;
      else if (existing?.origin !== undefined) record.origin = existing.origin;

      const tmp = `${path}.tmp-${process.pid}`;
      const body = JSON.stringify(record, null, 2);
      fs.writeFileSync(tmp, body, 'utf-8');
      fs.renameSync(tmp, path);
      if (debug.enabled) {
        debug.log('acp.persistence.persist', record.sessionId, {
          backendId: record.backendId,
          historyLen: record.history.length,
          toolCalls: record.toolCalls.length,
        });
      }
      fireChange({ kind: 'persistence-updated', sessionId: record.sessionId, backendId: record.backendId });
      return record;
    },

    load(sessionId) {
      const path = filePathFor(basePath, sessionId);
      return readRecord(path);
    },

    list(filter) {
      if (!fs.existsSync(basePath)) return [];
      let names: string[];
      try {
        names = fs.readdirSync(basePath);
      } catch {
        return [];
      }
      const records: PersistedAcpSession[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const path = joinPath(basePath, name);
        const rec = readRecord(path);
        if (!rec) continue;
        if (filter?.backendId && rec.backendId !== filter.backendId) continue;
        records.push(rec);
      }
      records.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      return records;
    },

    remove(sessionId) {
      const path = filePathFor(basePath, sessionId);
      if (!fs.existsSync(path)) return false;
      try {
        fs.unlinkSync(path);
        if (debug.enabled) debug.log('acp.persistence.remove', sessionId);
        fireChange({ kind: 'persistence-removed', sessionId });
        return true;
      } catch (err) {
        if (debug.enabled) {
          debug.log('acp.persistence.remove-error', sessionId, {
            message: (err as Error)?.message,
          }, { level: 'error' });
        }
        return false;
      }
    },

    onChange(listener) {
      changeListeners.add(listener);
      return () => { changeListeners.delete(listener); };
    },
  };
}

/** Module-wide singleton with default path. Override in tests via
 *  `createAcpSessionPersistence({ basePath, fs })` directly. */
let _singleton: AcpSessionPersistence | null = null;
export function globalAcpSessionPersistence(): AcpSessionPersistence {
  if (!_singleton) _singleton = createAcpSessionPersistence();
  return _singleton;
}

/** Reset for tests. */
export function _resetAcpSessionPersistenceForTests(): void {
  _singleton = null;
}
