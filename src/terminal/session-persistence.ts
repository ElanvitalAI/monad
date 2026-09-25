// Terminal session persistence.
//
// Metadata-only: we write a list of {id, title, cwd, command, kind,
// agentBrand, termName, startedAt, lastFocusedAt} entries to
// ~/.config/monad-agent/terminal-sessions.json on each registry
// change (debounced 250ms).
//
// On startup, dashboard reads the file to populate a /term resume
// picker — "re-spawn" the same command in a fresh session. We do NOT
// persist scrollback: retaining live PTYs across process restarts
// would require a daemon (cmux-style) which is deferred; re-spawning
// from the stored command is good enough for the common "claude-code
// session I lost" case.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { dirname, join as joinPath } from 'node:path';
import { migrateLegacyHomeFile } from '../storage/legacy-monad-dir-migrate.js';
import type {
  CodingAgentBrand,
  SessionKind,
  TerminalSessionRegistry,
} from './session-registry.js';

export interface PersistedSession {
  id: string;
  title: string;
  cwd: string;
  command?: string;
  kind: SessionKind;
  agentBrand?: CodingAgentBrand;
  termName?: string;
  startedAt: number;
  lastFocusedAt: number;
}

const DEFAULT_DEBOUNCE_MS = 250;

// FU2 Tier 2: ~/.config/monad-agent/terminal-sessions.json → ~/.monad/terminal-sessions.json.
export function defaultSessionsPath(): string {
  migrateLegacyHomeFile({
    legacyHomeRel: joinPath('.config', 'monad-agent', 'terminal-sessions.json'),
    monadRel: 'terminal-sessions.json',
  });
  return joinPath(monadStateRoot(), 'terminal-sessions.json');
}

export function loadPersistedSessions(
  path = defaultSessionsPath(),
): PersistedSession[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.sessions)) return [];
    return parsed.sessions.filter((s: unknown) => {
      const o = s as PersistedSession;
      return typeof o?.id === 'string'
        && typeof o?.title === 'string'
        && typeof o?.cwd === 'string'
        && typeof o?.kind === 'string';
    });
  } catch {
    return [];
  }
}

export function savePersistedSessions(
  sessions: PersistedSession[],
  path = defaultSessionsPath(),
): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    const payload = JSON.stringify({ version: 1, sessions }, null, 2);
    writeFileSync(tmp, payload, 'utf-8');
    renameSync(tmp, path);
  } catch {
    // Persistence is best-effort — never crash the main loop.
  }
}

export interface WireOpts {
  path?: string;
  debounceMs?: number;
  /** Test seam — schedule debounced flush. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (h: ReturnType<typeof setTimeout>) => void;
}

/** Subscribe to the registry + mirror a JSON snapshot to disk each
 *  change (debounced). Returns an unsubscribe function. */
export function wirePersistence(
  registry: TerminalSessionRegistry,
  opts: WireOpts = {},
): () => void {
  const path = opts.path ?? defaultSessionsPath();
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clearSchedule = opts.clearSchedule ?? ((h) => clearTimeout(h));

  let pending: ReturnType<typeof setTimeout> | null = null;
  const doFlush = (): void => {
    pending = null;
    const snapshot = registry.list()
      .filter(s => s.state !== 'exited')
      .map((s): PersistedSession => ({
        id: s.id,
        title: s.title,
        cwd: s.cwd,
        command: s.command,
        kind: s.kind,
        agentBrand: s.agentBrand,
        termName: s.termName,
        startedAt: s.startedAt,
        lastFocusedAt: s.lastFocusedAt,
      }));
    savePersistedSessions(snapshot, path);
  };

  const schedule_ = (): void => {
    if (pending !== null) clearSchedule(pending);
    pending = schedule(doFlush, debounceMs);
  };

  const unsub = registry.subscribe((ev) => {
    // Every lifecycle event is worth persisting except transient
    // attention bumps — those refresh too often.
    if (ev.type === 'attention') return;
    schedule_();
  });

  // Flush once up-front so the file reflects current state even if
  // no event fires immediately.
  schedule_();

  return (): void => {
    unsub();
    if (pending !== null) {
      clearSchedule(pending);
      pending = null;
    }
  };
}
