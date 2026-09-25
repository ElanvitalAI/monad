#!/usr/bin/env bun
// One-shot script — Coding Pipeline P1 followup.
// Adds `alwaysLoad: false,` + `shouldDefer: true,` to the listed
// catalog entries by inserting two lines right after the `    id: '<x>',`
// line. Idempotent: if both flags already exist on the entry, skip.
//
// Usage:  bun run scripts/mark-deferred-tools.ts [--dry]
// Run from repo root. Writes the updated catalog in place.
//
// After this script, `tier-flip` consumers (dashboard chat path) will
// withhold the full schema for these tools and only expose their
// name + promptSummary in the system prompt.

import { readFileSync, writeFileSync } from 'node:fs';

const CATALOG_PATH = 'src/native-tool-catalog.ts';

// Tools to defer. Picked from §3 trail A of 내부 문서
// — heavy specialised tool families that show up in the dashboard catalog
// list but are rarely needed in a general coding turn.
const DEFER_IDS = [
  // Coding Pipeline P5 — already have shouldDefer, missing alwaysLoad
  'find_repo',
  'sync_repo',
  'ref_consult',
  // Terminal-matrix family (12) — broadcast / pipe / group ops
  'terminal_matrix_list',
  'terminal_matrix_spawn',
  'terminal_matrix_move',
  'terminal_broadcast_send',
  'terminal_matrix_group_join',
  'terminal_matrix_group_leave',
  'terminal_channel_publish',
  'terminal_readonly_set',
  'terminal_recharacter',
  'terminal_pipe_to_channel',
  'terminal_unpipe_from_channel',
  'terminal_pipe_list',
  // ACP session family (10)
  'acp_session_create',
  'acp_session_send',
  'acp_session_close',
  'acp_session_list',
  'acp_session_resume',
  'acp_session_spawn_sub',
  'acp_session_start_background',
  'acp_session_status',
  'acp_session_cancel',
  'acp_session_join',
  // Budget + Policy (admin)
  'budget_status',
  'budget_history',
  'budget_forecast',
  'budget_set_limit',
  'policy_decide',
  'policy_explain',
  // Agent room + reply (niche multi-agent UX)
  'agent_room_compose',
  'agent_room_list',
  'agent_room_close',
  'agent_reply',
  // Capture source + inject (HITL pipe)
  'list_capture_sources',
  'snapshot_source',
  'inject_capture_to_context',
  // Local LLM manager (probe-gated; only used when picking node/model)
  'llm_list_nodes',
  'llm_list_available_models',
  'llm_request_install',
  // Misc
  'announce_completion',
];

function entryHasFlag(block: string, flag: string): boolean {
  return new RegExp(`\\b${flag}:\\s*(true|false)`).test(block);
}

const dryRun = process.argv.includes('--dry');
const original = readFileSync(CATALOG_PATH, 'utf8');
const lines = original.split('\n');

// Walk entries: each entry starts with `  {` and ends with `  },`. We
// track entry blocks so we can add the flag lines just after `    id:`
// without touching unrelated lines.
const out: string[] = [];
let inEntry = false;
let entryStart = -1;
let entryLines: string[] = [];
let touched = 0;
let alreadyDeferred = 0;
let unknown = new Set(DEFER_IDS);

function flushEntry(): void {
  // Find the `id: 'X'` line, decide whether this entry needs flags,
  // then push.
  let idValue: string | null = null;
  let idLineIndex = -1;
  for (let i = 0; i < entryLines.length; i++) {
    const m = entryLines[i]!.match(/^\s*id:\s*'([^']+)'/);
    if (m) {
      idValue = m[1]!;
      idLineIndex = i;
      break;
    }
  }
  if (idValue && DEFER_IDS.includes(idValue)) {
    unknown.delete(idValue);
    const block = entryLines.join('\n');
    const hasAlwaysLoad = entryHasFlag(block, 'alwaysLoad');
    const hasShouldDefer = entryHasFlag(block, 'shouldDefer');
    if (hasAlwaysLoad && hasShouldDefer) {
      alreadyDeferred++;
    } else {
      const insertions: string[] = [];
      if (!hasAlwaysLoad) insertions.push('    alwaysLoad: false,');
      if (!hasShouldDefer) insertions.push('    shouldDefer: true,');
      entryLines.splice(idLineIndex + 1, 0, ...insertions);
      touched++;
    }
  }
  out.push(...entryLines);
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;
  if (!inEntry && line === '  {') {
    inEntry = true;
    entryStart = i;
    entryLines = [line];
    continue;
  }
  if (inEntry) {
    entryLines.push(line);
    if (line === '  },') {
      flushEntry();
      inEntry = false;
      entryStart = -1;
      entryLines = [];
    }
    continue;
  }
  out.push(line);
}

const next = out.join('\n');
console.log(`[mark-deferred-tools] target=${DEFER_IDS.length} touched=${touched} already=${alreadyDeferred} unknown=${unknown.size}`);
if (unknown.size > 0) {
  console.error('  unresolved ids:', [...unknown].join(', '));
}
if (dryRun) {
  console.log('[dry] no write');
} else if (next !== original) {
  writeFileSync(CATALOG_PATH, next);
  console.log('[mark-deferred-tools] wrote', CATALOG_PATH);
} else {
  console.log('[mark-deferred-tools] nothing to write');
}
