// PLAN §4.1 · Phase 1.1 — Turn checkpoint persistence.
//
// One JSONL file per `TurnUri`, append-only, under
// `~/.elanous/checkpoints/`. The directory is created lazily on the first
// write so a fresh install with no checkpoints leaves no on-disk
// footprint.
//
// Tests (and any future in-process fixture) can override the directory
// via `setCheckpointDir(dir)`; pass `null` to revert to the default.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import { debug } from '../debug/log.js';
import type { TurnCheckpoint } from './types.js';

const DEFAULT_DIR = path.join(elanousStateRoot(), 'checkpoints');
let overrideDir: string | null = null;

/** Override the on-disk directory used by `writeCheckpoint` / readers.
 *  Pass `null` to restore the default `~/.elanous/checkpoints/`. */
export function setCheckpointDir(dir: string | null): void {
  overrideDir = dir;
}

export function getCheckpointDir(): string {
  return overrideDir ?? DEFAULT_DIR;
}

/** Convert a TurnUri into a path-safe filename. Bare-ULID URIs map
 *  1:1; Tier-2/3 forms (`turn/<ULID>` etc.) collapse separators so the
 *  file lives flat in the checkpoint dir. */
function fileFor(turnUri: string): string {
  const safe = turnUri.replace(/[/\\:%]/g, '_');
  return path.join(getCheckpointDir(), `${safe}.jsonl`);
}

export function writeCheckpoint(cp: TurnCheckpoint): void {
  try {
    fs.mkdirSync(getCheckpointDir(), { recursive: true });
    fs.appendFileSync(fileFor(cp.turnUri), JSON.stringify(cp) + '\n', 'utf8');
    debug.log('turn-checkpoint', 'write', {
      turnUri: cp.turnUri,
      toolIndex: cp.toolIndex,
      kind: cp.decision.kind,
    });
  } catch (err) {
    debug.log('turn-checkpoint', 'write-fail', {
      turnUri: cp.turnUri,
      error: err instanceof Error ? err.message : String(err),
    }, { level: 'error' });
  }
}

/** Parse a JSONL checkpoint file. Skips malformed lines instead of
 *  throwing — a corrupt entry must not poison `/resume`. */
function parseFile(file: string): TurnCheckpoint[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: TurnCheckpoint[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as TurnCheckpoint;
      if (parsed && typeof parsed === 'object' && parsed.turnUri && parsed.decision) {
        out.push(parsed);
      }
    } catch {
      // Skip malformed entry.
    }
  }
  return out;
}

/** All checkpoints recorded for a turn, in capture order. Resolves a
 *  `turnUri` either as a bare ULID prefix or full identifier — the
 *  filename uses the sanitised full string, so this helper checks both
 *  for ergonomic `/resume <suffix>` UX. */
export function loadCheckpoints(turnUri: string): TurnCheckpoint[] {
  const direct = parseFile(fileFor(turnUri));
  if (direct.length > 0) return direct;
  // Suffix match — `/resume <last 12 chars>` should still resolve.
  let entries: string[];
  try {
    entries = fs.readdirSync(getCheckpointDir());
  } catch {
    return [];
  }
  const safe = turnUri.replace(/[/\\:%]/g, '_');
  const match = entries.find(name => name.endsWith(`${safe}.jsonl`) || name === `${safe}.jsonl`);
  if (!match) return [];
  return parseFile(path.join(getCheckpointDir(), match));
}

export function loadLatest(turnUri: string): TurnCheckpoint | null {
  const all = loadCheckpoints(turnUri);
  return all.length === 0 ? null : (all[all.length - 1] ?? null);
}

/** Most recent checkpoint across every turn — used by `/resume` (no
 *  arg). Picks the row with the lexicographically largest ISO
 *  timestamp; ties fall back to file mtime. */
export function loadMostRecent(): TurnCheckpoint | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(getCheckpointDir());
  } catch {
    return null;
  }
  let best: TurnCheckpoint | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const file = path.join(getCheckpointDir(), entry);
    const rows = parseFile(file);
    const candidate = rows[rows.length - 1];
    if (!candidate) continue;
    if (!best || candidate.timestamp > best.timestamp) {
      best = candidate;
    }
  }
  return best;
}

/** Sorted-newest-first list of TurnUri strings that have at least one
 *  checkpoint on disk. Pure observability helper for `/resume list` /
 *  future tooling. */
export function listCheckpointTurns(): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(getCheckpointDir());
  } catch {
    return [];
  }
  const seen: Array<{ turn: string; mtime: number }> = [];
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const file = path.join(getCheckpointDir(), entry);
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch { continue; }
    seen.push({ turn: entry.replace(/\.jsonl$/, ''), mtime: stat.mtimeMs });
  }
  seen.sort((a, b) => b.mtime - a.mtime);
  return seen.map(s => s.turn);
}
