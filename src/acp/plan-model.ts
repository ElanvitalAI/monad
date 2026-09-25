// ACP H1 #2 — Plan model + render helper.
//
// Wraps the ACP wire `Plan` / `PlanEntry` types (`@agentclientprotocol/sdk`)
// with version tracking, stats, and text rendering so the dashboard can
// render plan-mode updates as a one-line summary (collapsed by default)
// or an expanded entry list.
//
// Reference · Warp plan-mode UX (docs.warp.dev · warp.dev/agents) —
//   agent proposes plan → user reviews / approves → agent executes with
//   progress markers. This module ports the data shape; the approval
//   loop lands later (H2 #4 capability gate + VW popover).
// Reference · Zed `crates/acp_thread/src/acp_thread.rs` —
//   L915-974 Plan / PlanStats / PlanEntry · L2140-2162 update_plan.
//   Zed replaces entries in-place to prevent markdown flicker; we
//   replace the list wholesale because we store plain strings.
//
// Wire semantics (ACP spec): `plan` SessionUpdate always carries the
// complete list of entries — the client replaces the entire plan on
// each update. Never append.

import type {
  Plan as WirePlan,
  PlanEntry as WirePlanEntry,
  PlanEntryPriority,
  PlanEntryStatus,
} from '@agentclientprotocol/sdk';
import { debug } from '../debug/log.js';

export interface PlanEntry {
  content: string;
  priority: PlanEntryPriority;
  status: PlanEntryStatus;
}

export interface PlanStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  /** First entry with status='in_progress', or null. */
  currentEntry: PlanEntry | null;
}

export interface PlanSnapshot {
  entries: PlanEntry[];
  version: number;
  stats: PlanStats;
}

export interface PlanModel {
  applyWire(update: WirePlan): PlanSnapshot;
  clear(): PlanSnapshot;
  snapshot(): PlanSnapshot;
  renderSummary(): string;
  renderFull(): string[];
}

export function createPlanModel(): PlanModel {
  let entries: PlanEntry[] = [];
  let version = 0;

  const computeStats = (): PlanStats => {
    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    let currentEntry: PlanEntry | null = null;
    for (const e of entries) {
      if (e.status === 'pending') pending++;
      else if (e.status === 'in_progress') {
        inProgress++;
        if (currentEntry === null) currentEntry = e;
      } else if (e.status === 'completed') completed++;
    }
    return {
      total: entries.length,
      pending,
      inProgress,
      completed,
      currentEntry,
    };
  };

  const snapshot = (): PlanSnapshot => ({
    entries: entries.map((e) => ({ ...e })),
    version,
    stats: computeStats(),
  });

  return {
    applyWire(update) {
      entries = update.entries.map((e: WirePlanEntry) => ({
        content: e.content,
        priority: e.priority,
        status: e.status,
      }));
      version++;
      if (debug.enabled) {
        debug.log('acp.plan.apply', `v${version} n=${entries.length}`, {
          version,
          total: entries.length,
        });
      }
      return snapshot();
    },
    clear() {
      entries = [];
      version++;
      if (debug.enabled) debug.log('acp.plan.clear', `v${version}`);
      return snapshot();
    },
    snapshot,
    renderSummary() {
      const s = computeStats();
      if (s.total === 0) return '◦ plan empty';
      if (s.completed === s.total) return `✓ plan complete (${s.total}/${s.total})`;
      const idx = s.currentEntry
        ? entries.findIndex((e) => e === s.currentEntry) + 1
        : s.completed + 1;
      const title = s.currentEntry ? s.currentEntry.content : '(no active step)';
      const parts: string[] = [];
      if (s.pending > 0) parts.push(`${s.pending} pending`);
      if (s.completed > 0) parts.push(`${s.completed} done`);
      const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      return `▸ ${idx}/${s.total} · ${title}${suffix}`;
    },
    renderFull() {
      if (entries.length === 0) return ['◦ plan empty'];
      return entries.map((e, i) => {
        const glyph = e.status === 'completed'
          ? '[✓]'
          : e.status === 'in_progress'
            ? '[▶]'
            : '[ ]';
        return `${glyph} step ${i + 1} — ${e.content}`;
      });
    },
  };
}
