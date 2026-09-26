// H6 P1 Bundle 1 · Log-scan recorder.
//
// Scans local Codex + Claude session log files and produces
// `TurnSummary` rows for the UsageStore → BudgetHistoryStore pipeline.
//
// Why log-scan instead of adapter hook (PLAN §5 D2 adjustment B, see
// HANDOFF 2026-04-22):
//   elanous's PTY adapters expose raw byte streams only — there's no
//   structured `turn-completed` event on the transport, so we can't
//   hook token counts from `session.transports[0].on(...)` like the
//   PLAN §4.4 originally proposed. The CLI itself writes a JSONL file
//   that already has per-turn token counts · scanning that file is
//   the authoritative source until the adapter gains structured
//   events (Bundle 2+ · non-blocking for Bundle 1 exit).
//
// Log paths (mirrors CodexBar `내부 문서 `{codex,claude}``):
//   - Codex:  `$CODEX_HOME/sessions/YYYY/MM/DD/*.jsonl`
//             or `~/.codex/sessions/...`
//   - Claude: `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl` (comma-split)
//             fallback `~/.config/claude/projects/**/*.jsonl`
//             fallback `~/.claude/projects/**/*.jsonl`
//
// Idempotency: `turnId` is deterministic (Codex = `event_msg.id`,
// Claude = `message.id + requestId`). Every scan can safely re-read
// the same file — the history store's INSERT OR IGNORE dedups.

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { debug } from '../debug/log.js';
import type { TurnSummary, UsageProvider } from './types.js';
import type { UsageStore } from './usage-store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 30;

export interface RecorderOpts {
  /** Lookback window for filesystem scan. Files whose mtime is older
   *  than this are skipped. Default 30 days (CodexBar parity). */
  readonly lookbackDays?: number;
  /** Override Codex log root (tests). Default `$CODEX_HOME/sessions`
   *  or `~/.codex/sessions`. */
  readonly codexRoot?: string;
  /** Restrict scans to sessions whose session_meta cwd is the child worktree. */
  readonly codexSessionCwd?: string;
  /** Override Claude project roots (tests). Default `$CLAUDE_CONFIG_DIR
   *  /projects` split by `,` · else `~/.config/claude/projects` +
   *  `~/.claude/projects`. */
  readonly claudeRoots?: readonly string[];
  /** Clock for retention filter (tests). */
  readonly now?: () => number;
}

export interface RecorderResult {
  readonly scannedFiles: number;
  readonly parsedTurns: number;
  readonly newTurns: number;
  readonly errors: number;
}

// ─── Log root resolution ─────────────────────────────────────────────

function resolveCodexRoot(override?: string): string {
  if (override) return override;
  const home = process.env['CODEX_HOME'];
  return home ? join(home, 'sessions') : join(homedir(), '.codex', 'sessions');
}

function resolveClaudeRoots(override?: readonly string[]): readonly string[] {
  // Explicit override — including an empty array — means "use exactly
  // these roots and no fallback". Tests rely on `claudeRoots: []` to
  // scan only the codex side without picking up the user's real logs.
  if (override !== undefined) return override;
  const envRoot = process.env['CLAUDE_CONFIG_DIR'];
  if (envRoot) {
    return envRoot
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((root) => join(root, 'projects'));
  }
  return [
    join(homedir(), '.config', 'claude', 'projects'),
    join(homedir(), '.claude', 'projects'),
  ];
}

// ─── Directory walk · lookback-aware ─────────────────────────────────

function* walkJsonl(root: string, cutoffMs: number): Generator<string> {
  if (!existsSync(root)) return;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (err) {
    if (debug.enabled) {
      debug.log('budget.recorder.walk.read-dir-fail', root, {
        message: err instanceof Error ? err.message : String(err),
      }, { level: 'error' });
    }
    return;
  }
  for (const name of entries) {
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkJsonl(full, cutoffMs);
    } else if (st.isFile() && name.endsWith('.jsonl')) {
      if (st.mtimeMs < cutoffMs) continue;
      yield full;
    }
  }
}

// ─── Codex log parser ────────────────────────────────────────────────

interface CodexEventMsg {
  type?: string;
  id?: string;
  token_count?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
  };
}

interface CodexLine {
  ts?: string | number;
  event_msg?: CodexEventMsg;
  turn_context?: { model?: string };
  session_id?: string;
  type?: string;
  payload?: { cwd?: string; id?: string };
}

function parseCodexFile(path: string, sessionIdFromName: string, sessionCwd?: string): TurnSummary[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const turns: TurnSummary[] = [];
  let currentModel = 'codex-unknown';
  let sessionId = sessionIdFromName;
  let fileCwd: string | undefined;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let obj: CodexLine;
    try {
      obj = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }
    if (obj.session_id && typeof obj.session_id === 'string') {
      sessionId = obj.session_id;
    }
    if (obj.type === 'session_meta' && typeof obj.payload?.cwd === 'string') {
      fileCwd = obj.payload.cwd;
      if (sessionCwd !== undefined && typeof obj.payload.id === 'string') sessionId = obj.payload.id;
    }
    if (obj.turn_context?.model) {
      currentModel = obj.turn_context.model;
    }
    const ev = obj.event_msg;
    if (!ev || ev.type !== 'token_count' || !ev.id || !ev.token_count) continue;
    const tokens = ev.token_count;
    const completedAt = normalizeTs(obj.ts) ?? Date.now();
    turns.push({
      turnId: `codex:${ev.id}`,
      sessionId,
      provider: 'codex' as UsageProvider,
      model: currentModel,
      inputTokens: Number(tokens.input_tokens ?? 0),
      outputTokens: Number(tokens.output_tokens ?? 0),
      ...(tokens.cached_tokens != null
        ? { cacheReadTokens: Number(tokens.cached_tokens) }
        : {}),
      completedAt,
    });
  }
  return sessionCwd !== undefined && fileCwd !== sessionCwd ? [] : turns;
}

// ─── Claude log parser ───────────────────────────────────────────────

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeMessage {
  id?: string;
  model?: string;
  usage?: ClaudeUsage;
}

interface ClaudeLine {
  type?: string;
  timestamp?: string | number;
  requestId?: string;
  sessionId?: string;
  message?: ClaudeMessage;
}

function parseClaudeFile(path: string, sessionIdFromName: string): TurnSummary[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const turns: TurnSummary[] = [];
  let sessionId = sessionIdFromName;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let obj: ClaudeLine;
    try {
      obj = JSON.parse(line) as ClaudeLine;
    } catch {
      continue;
    }
    if (obj.sessionId && typeof obj.sessionId === 'string') {
      sessionId = obj.sessionId;
    }
    if (obj.type !== 'assistant' || !obj.message?.usage) continue;
    const msg = obj.message;
    const usage = msg.usage!;
    const msgId = msg.id ?? '';
    const reqId = obj.requestId ?? '';
    if (msgId.length === 0 && reqId.length === 0) continue;
    const completedAt = normalizeTs(obj.timestamp) ?? Date.now();
    turns.push({
      turnId: `claude:${msgId}:${reqId}`,
      sessionId,
      provider: 'claude' as UsageProvider,
      model: msg.model ?? 'claude-unknown',
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
      ...(usage.cache_read_input_tokens != null
        ? { cacheReadTokens: Number(usage.cache_read_input_tokens) }
        : {}),
      ...(usage.cache_creation_input_tokens != null
        ? { cacheCreateTokens: Number(usage.cache_creation_input_tokens) }
        : {}),
      completedAt,
    });
  }
  return turns;
}

function normalizeTs(raw: string | number | undefined): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function basenameNoExt(path: string): string {
  const last = path.split('/').pop() ?? path;
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

// ─── Scanner entry points ────────────────────────────────────────────

export function scanCodexTurns(opts: RecorderOpts = {}): {
  turns: TurnSummary[];
  files: number;
  errors: number;
} {
  const now = (opts.now ?? Date.now)();
  const cutoff = now - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * DAY_MS;
  const root = resolveCodexRoot(opts.codexRoot);
  const allTurns: TurnSummary[] = [];
  let files = 0;
  let errors = 0;
  for (const file of walkJsonl(root, cutoff)) {
    files++;
    try {
      allTurns.push(...parseCodexFile(file, basenameNoExt(file), opts.codexSessionCwd));
    } catch (err) {
      errors++;
      if (debug.enabled) {
        debug.log('budget.recorder.codex.parse-fail', file, {
          message: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }
  return { turns: allTurns, files, errors };
}

export function scanClaudeTurns(opts: RecorderOpts = {}): {
  turns: TurnSummary[];
  files: number;
  errors: number;
} {
  const now = (opts.now ?? Date.now)();
  const cutoff = now - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * DAY_MS;
  const roots = resolveClaudeRoots(opts.claudeRoots);
  const allTurns: TurnSummary[] = [];
  let files = 0;
  let errors = 0;
  for (const root of roots) {
    for (const file of walkJsonl(root, cutoff)) {
      files++;
      try {
        allTurns.push(...parseClaudeFile(file, basenameNoExt(file)));
      } catch (err) {
        errors++;
        if (debug.enabled) {
          debug.log('budget.recorder.claude.parse-fail', file, {
            message: err instanceof Error ? err.message : String(err),
          }, { level: 'error' });
        }
      }
    }
  }
  return { turns: allTurns, files, errors };
}

/** Scan both Codex + Claude logs and push every discovered turn into
 *  the store. Safe to run repeatedly — dedup is handled by the SQLite
 *  INSERT OR IGNORE path. Returns stats for logging / LLM tool output. */
export function runRecorder(
  store: UsageStore,
  opts: RecorderOpts = {},
): RecorderResult {
  const codex = scanCodexTurns(opts);
  const claude = scanClaudeTurns(opts);
  const all = [...codex.turns, ...claude.turns];
  const newTurns = store.recordTurns(all);
  return {
    scannedFiles: codex.files + claude.files,
    parsedTurns: all.length,
    newTurns,
    errors: codex.errors + claude.errors,
  };
}
