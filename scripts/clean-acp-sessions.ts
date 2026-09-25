#!/usr/bin/env bun
// clean-acp-sessions.ts
//
// Prunes stale entries from `~/.config/monad/acp-sessions.json`.
// Companion to L2/L3 in src/acp/turn-runner.ts — even after the
// runtime stops *writing* records for ephemeral backends, existing
// files carry a long tail of dead entries from prior boots that
// surface as "unknown session" / "Session not found" errors at
// Discord/Telegram startup.
//
// Default behavior (safe · always backed up):
//   1. Backup the existing file with timestamped suffix.
//   2. Drop records whose backendId is not in the current backend
//      registry (e.g. `codex-native` removed sprint 5B; legacy
//      `codex` alias).
//   3. Drop records whose backendId is on the known-ephemeral list
//      (gemini · loadSession=false at runtime).
//   4. Write the pruned list back atomically.
//   5. Print before/after summary.
//
// Optional flags:
//   --dry-run             Show what would be dropped, don't write.
//   --missing-cwd         Also drop dashboard:<path> entries whose
//                         path no longer exists. Off by default —
//                         removable volumes hit false positives.
//   --older-than-days N   Also drop records older than N days.
//   --all                 Shorthand for --missing-cwd --older-than-days 30.
//   --path <file>         Override the target file path. Default =
//                         $XDG_CONFIG_HOME/monad/acp-sessions.json.
//
// Manual run:
//
//   bun run scripts/clean-acp-sessions.ts
//   bun run scripts/clean-acp-sessions.ts --dry-run
//   bun run scripts/clean-acp-sessions.ts --all
//
// Exit codes:
//   0   success (or dry-run completed)
//   1   target file unreadable / write failed
//   2   bad argument

import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';
import { pruneStaleRecords, type DropReason } from '../src/acp/session-store-prune.js';
import type { AcpSessionRecord } from '../src/acp/session-store.js';

interface ParsedArgs {
  dryRun: boolean;
  missingCwd: boolean;
  olderThanDays: number | null;
  path: string;
}

function defaultStorePath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? joinPath(homedir(), '.config');
  return joinPath(base, 'monad', 'acp-sessions.json');
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    dryRun: false,
    missingCwd: false,
    olderThanDays: null,
    path: defaultStorePath(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (a === '--missing-cwd') { out.missingCwd = true; continue; }
    if (a === '--all') {
      out.missingCwd = true;
      if (out.olderThanDays === null) out.olderThanDays = 30;
      continue;
    }
    if (a === '--older-than-days') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        process.stderr.write(`bad --older-than-days value: ${argv[i]}\n`);
        process.exit(2);
      }
      out.olderThanDays = n;
      continue;
    }
    if (a === '--path') {
      const p = argv[++i];
      if (!p) {
        process.stderr.write('--path requires a value\n');
        process.exit(2);
      }
      out.path = p;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
    process.stderr.write(`unknown flag: ${a}\n`);
    process.exit(2);
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(`Usage: bun run scripts/clean-acp-sessions.ts [flags]

Prunes stale entries from ~/.config/monad/acp-sessions.json.

Flags:
  --dry-run             Show what would be dropped, don't write.
  --missing-cwd         Drop dashboard:<path> entries whose path is gone.
  --older-than-days N   Drop records older than N days.
  --all                 Shorthand for --missing-cwd --older-than-days 30.
  --path <file>         Override target file (default: ~/.config/monad/acp-sessions.json).
  -h, --help            Show this help.
`);
}

function loadRecords(path: string): AcpSessionRecord[] {
  if (!existsSync(path)) {
    process.stdout.write(`no file at ${path} — nothing to do.\n`);
    process.exit(0);
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      process.stderr.write(`expected an array in ${path}, got ${typeof parsed}\n`);
      process.exit(1);
    }
    return parsed as AcpSessionRecord[];
  } catch (err) {
    process.stderr.write(`failed to read ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

function backupFile(path: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${path}.backup-${ts}`;
  copyFileSync(path, backup);
  return backup;
}

function writeRecords(path: string, records: AcpSessionRecord[]): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
  renameSync(tmp, path);
}

function describeRecord(r: AcpSessionRecord): string {
  const idShort = r.sessionId.length > 32 ? `${r.sessionId.slice(0, 32)}…` : r.sessionId;
  return `  ${r.backendId.padEnd(20)}  ${idShort.padEnd(36)}  chat=${r.chatId}`;
}

const REASON_LABELS: Record<DropReason, string> = {
  'unknown-backend': 'unknown backend (not in registry)',
  'ephemeral-backend': 'ephemeral backend (loadSession=false)',
  'missing-cwd': 'cwd no longer exists',
  'older-than-threshold': 'older than threshold',
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`target: ${args.path}\n`);

  const records = loadRecords(args.path);
  process.stdout.write(`loaded ${records.length} record(s)\n\n`);

  const result = pruneStaleRecords(records, {
    missingCwd: args.missingCwd,
    ...(args.olderThanDays !== null ? { olderThanDays: args.olderThanDays } : {}),
  });

  if (result.dropped.length === 0) {
    process.stdout.write('✓ no stale records — nothing to do.\n');
    return;
  }

  process.stdout.write('── would drop ──\n');
  // Group by reason for readability.
  const byReason = new Map<DropReason, AcpSessionRecord[]>();
  for (const d of result.dropped) {
    const list = byReason.get(d.reason) ?? [];
    list.push(d.record);
    byReason.set(d.reason, list);
  }
  for (const [reason, list] of byReason) {
    process.stdout.write(`\n${REASON_LABELS[reason]} (${list.length}):\n`);
    for (const r of list) process.stdout.write(`${describeRecord(r)}\n`);
  }

  process.stdout.write('\n── summary ──\n');
  process.stdout.write(`  before: ${records.length} record(s)\n`);
  process.stdout.write(`  drop:   ${result.dropped.length}\n`);
  process.stdout.write(`  keep:   ${result.kept.length}\n`);
  for (const [reason, count] of Object.entries(result.countsByReason)) {
    if (count > 0) {
      process.stdout.write(`    ${REASON_LABELS[reason as DropReason]}: ${count}\n`);
    }
  }

  if (args.dryRun) {
    process.stdout.write('\n(dry-run · no changes written)\n');
    return;
  }

  const backup = backupFile(args.path);
  process.stdout.write(`\nbackup: ${backup}\n`);

  try {
    writeRecords(args.path, result.kept);
    process.stdout.write(`✓ wrote ${result.kept.length} record(s) to ${args.path}\n`);
  } catch (err) {
    process.stderr.write(`write failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write(`(original preserved at ${backup})\n`);
    process.exit(1);
  }
}

main();
