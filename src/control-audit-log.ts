// ── Control audit log (Phase F) ──
//
// Append-only NDJSON trail for every control.* mutation. Lives next
// to the shell-primitive audit log so daily-rotated operator review
// can ingest a single directory tree, but kept in a separate file so
// filters ("what did the LLM reshape?") don't need to parse shell
// events out.
//
// Path: ~/.monad-agent/audit/control-YYYY-MM-DD.ndjson
//       (overridable via setControlAuditRootForTesting)
//
// Fire-and-forget: failures are swallowed so no control call blocks
// on disk IO.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { elanousStateRoot } from './autopilot/state-paths.js';
import { join } from 'node:path';
import { migrateLegacyHomeDir } from './storage/legacy-elanous-dir-migrate.js';

export interface ControlAuditEvent {
  ts: string;                   // ISO-8601 UTC
  action: string;               // 'window_resize' | 'pane_resize' | ...
  subject?: string;             // addr the action targeted
  ok: boolean;
  /** Arbitrary extra fields — width/height/delta/layout/hint length. */
  detail?: Record<string, unknown>;
}

type Sink = (ev: ControlAuditEvent) => void;

let overrideRoot: string | null = null;
let testSink: Sink | null = null;

export function setControlAuditRootForTesting(root: string | null): void {
  overrideRoot = root;
}
export function setControlAuditSinkForTesting(sink: Sink | null): void {
  testSink = sink;
}

// FU2 Tier 3 (PLAN-config-unification-elanous-root-2026-05-10 closing):
//   moved from ~/.monad-agent/audit/ → ~/.elanous/audit/. Daily NDJSON
//   files migrated together via dir-migrate helper · old → .bak.
function defaultRoot(): string {
  if (overrideRoot) return overrideRoot;
  migrateLegacyHomeDir({ legacyHomeRel: join('.monad-agent', 'audit'), elanousRel: 'audit' });
  return join(elanousStateRoot(), 'audit');
}

function todayFile(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return join(defaultRoot(), `control-${y}-${m}-${d}.ndjson`);
}

export function recordControlAudit(ev: ControlAuditEvent): void {
  if (testSink) {
    try { testSink(ev); } catch { /* swallow */ }
    return;
  }
  try {
    const root = defaultRoot();
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    appendFileSync(todayFile(), JSON.stringify(ev) + '\n');
  } catch {
    // Audit failure never escapes.
  }
}
