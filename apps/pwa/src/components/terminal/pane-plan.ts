import type { DaemonTerminalSummary } from '@/lib/daemon-client';

export interface PanePlanLayout {
  runId: string;
  split: string;
  tabs: string[];
}

export interface PanePlanUnknown {
  id: string;
  reason: 'relationship-unavailable';
}

/** A render-independent, JSON-serializable terminal placement description. */
export interface PanePlan {
  layouts: PanePlanLayout[];
  unknown: PanePlanUnknown[];
}

function newestAliveChild(
  children: readonly DaemonTerminalSummary[],
): DaemonTerminalSummary | undefined {
  const alive = children.filter((child) => child.alive && Number.isFinite(child.startedAt));
  if (alive.length === 0) return undefined;

  const latestStartedAt = Math.max(...alive.map(({ startedAt }) => startedAt));
  const newest = alive.filter(({ startedAt }) => startedAt === latestStartedAt);
  return newest.length === 1 ? newest[0] : undefined;
}

/**
 * Produces a pure placement description from verified run membership.
 * Rows without a run value, or a run without a unique newest live member,
 * remain explicit unknowns rather than receiving an invented placement.
 */
export function panePlan(terminals: readonly DaemonTerminalSummary[]): PanePlan {
  const rowsByRunId = new Map<string, DaemonTerminalSummary[]>();
  const unknownIds = new Set<string>();
  for (const terminal of terminals) {
    const runId = terminal.runId?.trim();
    if (!runId) {
      unknownIds.add(terminal.id);
      continue;
    }
    const rows = rowsByRunId.get(runId) ?? [];
    rows.push(terminal);
    rowsByRunId.set(runId, rows);
  }

  const layouts: PanePlanLayout[] = [];
  for (const [runId, rows] of rowsByRunId) {
    const newest = newestAliveChild(rows);
    if (!newest) {
      for (const row of rows) unknownIds.add(row.id);
      continue;
    }

    layouts.push({
      runId,
      split: newest.id,
      tabs: rows.filter((row) => row.id !== newest.id).map(({ id }) => id),
    });
  }

  const placedIds = new Set(layouts.flatMap(({ split, tabs }) => [split, ...tabs]));
  const unknown = terminals
    .filter(({ id }) => unknownIds.has(id) && !placedIds.has(id))
    .map(({ id }) => ({ id, reason: 'relationship-unavailable' as const }));

  return { layouts, unknown };
}
