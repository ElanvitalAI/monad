// cv-3 β-4 HITL audit log (Round 2 · 2026-05-08).
//
// Append-only line-delimited JSON log of every HITL confirm round-trip.
// Producer: src/hitl/confirm.ts (single emit point — every channel
// automatically audited because requestConfirmation races them all).
// Consumer: Round 3 PWA Settings Pushcut card · Round 5 IntentRanker
// learning corpus · β-8 metrics · Live Activity history view.
//
// Log path: $MONAD_DIR/hitl-log.jsonl (default: ~/.monad/hitl-log.jsonl).
// Rotation: when the active file size exceeds maxBytes (default 100 MB)
// it is renamed to `<path>.1` and a fresh file is opened. One backup is
// kept; older rotations overwrite the previous `.1`.

import { promises as fsp } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { HitlChannelName, HitlAnswer } from './confirm.js';

export interface HitlAuditEntry {
  /** Unix epoch milliseconds when the round-trip resolved. */
  ts: number;
  /** Correlation id passed by the caller (or synthesised by confirm.ts). */
  requestId: string;
  /** The Y/N question shown to the user. */
  prompt: string;
  /** Optional secondary detail line that accompanied the prompt. */
  detail?: string;
  /** Winning channel — or `'timeout'` / `'all-failed'` when nothing answered. */
  channel: HitlChannelName | 'timeout' | 'all-failed';
  /** The user's answer (or the onTimeout fallback). */
  answer: HitlAnswer;
  /** End-to-end race duration in milliseconds. */
  elapsedMs: number;
  /** Optional caller-supplied hint identifying the agent kind that asked. */
  agentKind?: string;
  /** Optional workflow run id when the prompt came from a workflow approval. */
  runId?: string;
}

export interface HitlAuditWriter {
  /** Append a single entry. Best-effort — never throws. Failures are
   *  swallowed so a broken audit log does not break the user-facing
   *  HITL flow. */
  append(entry: HitlAuditEntry): Promise<void>;
  /** Resolve the file path the writer is appending to. Useful for
   *  /v1/hitl/audit endpoints that surface "where the log lives". */
  readonly path: string;
}

export interface FileAuditWriterOpts {
  /** Override path. Default `$MONAD_DIR/hitl-log.jsonl` or
   *  `~/.monad/hitl-log.jsonl`. */
  path?: string;
  /** Rotate when the active file exceeds this many bytes. Default
   *  100 MB. Set to 0 to disable rotation. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export function defaultAuditLogPath(): string {
  const monadDir = process.env['MONAD_DIR'] ?? join(homedir(), '.monad');
  return join(monadDir, 'hitl-log.jsonl');
}

export function createFileAuditWriter(opts: FileAuditWriterOpts = {}): HitlAuditWriter {
  const path = opts.path ?? defaultAuditLogPath();
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // Serialise appends through a chain so concurrent callers don't
  // interleave bytes mid-line. Cheaper than an OS-level advisory lock
  // and sufficient for in-process correctness (the file is only
  // written by the daemon process).
  let chain: Promise<void> = Promise.resolve();

  return {
    path,
    async append(entry: HitlAuditEntry): Promise<void> {
      const next = chain.then(async () => {
        try {
          await fsp.mkdir(dirname(path), { recursive: true });
          const line = JSON.stringify(entry) + '\n';

          if (maxBytes > 0) {
            try {
              const stat = await fsp.stat(path);
              if (stat.size + line.length > maxBytes) {
                // Rotate: keep one backup at <path>.1.
                try { await fsp.rename(path, `${path}.1`); }
                catch { /* swallow — best-effort */ }
              }
            } catch { /* file does not exist yet — fine */ }
          }

          await fsp.appendFile(path, line, 'utf-8');
        } catch {
          // never throw — audit failure must not break HITL flow
        }
      });
      chain = next;
      return next;
    },
  };
}

export interface ReadAuditOpts {
  path?: string;
  /** Tail the most recent N entries. Default: all entries. */
  limit?: number;
  /** Include the rotated `.1` backup as older entries (chronological). */
  includeRotated?: boolean;
}

export async function readAuditLog(opts: ReadAuditOpts = {}): Promise<HitlAuditEntry[]> {
  const path = opts.path ?? defaultAuditLogPath();
  const entries: HitlAuditEntry[] = [];

  const readFile = async (p: string): Promise<void> => {
    let text: string;
    try { text = await fsp.readFile(p, 'utf-8'); }
    catch { return; }
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as HitlAuditEntry;
        if (typeof parsed?.ts === 'number' && typeof parsed?.requestId === 'string') {
          entries.push(parsed);
        }
      } catch {
        // skip corrupted lines silently — append-only log so any
        // bad line is from a partial write or a manual edit.
      }
    }
  };

  if (opts.includeRotated) await readFile(`${path}.1`);
  await readFile(path);

  if (typeof opts.limit === 'number' && opts.limit >= 0) {
    return entries.slice(-opts.limit);
  }
  return entries;
}

// ─── Module-level audit hook ──────────────────────────────────────
//
// confirm.ts emits every successful (or failed) confirm round-trip
// through this hook. `registerHitlAuditHook(null)` clears the hook —
// useful for tests. The hook is fire-and-forget: confirm.ts never
// awaits the returned Promise so a slow audit writer cannot stall a
// race winner.

export type HitlAuditHook = (entry: HitlAuditEntry) => void | Promise<void>;

let auditHook: HitlAuditHook | null = null;

export function registerHitlAuditHook(hook: HitlAuditHook | null): void {
  auditHook = hook;
}

export function getHitlAuditHook(): HitlAuditHook | null {
  return auditHook;
}

/** Convenience: install a file-backed writer as the global hook. */
export function installFileAuditHook(opts: FileAuditWriterOpts = {}): HitlAuditWriter {
  const writer = createFileAuditWriter(opts);
  registerHitlAuditHook((entry) => writer.append(entry));
  return writer;
}
