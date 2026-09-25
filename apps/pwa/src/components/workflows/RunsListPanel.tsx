// Archon-port follow-up §5.2 (2026-05-08) — Active Runs panel.
//
// Closes §5.2 of 내부 문서.
// Reads from `GET /v1/workflows/runs` (backed by disk · #1964 + #1977).
// Polls every 5s via React Query.
//
// UX: replaces the right-side run panel with a runs list when the
// "All runs" button is toggled in the workflows panel header. Click
// a row → caller's `onSelect(runId, workflowName)` callback drives
// the existing run-detail flow back into the right panel.

'use client';

import { useMemo, useState } from 'react';
import { History, Loader2, AlertCircle, CheckCircle2, GhostIcon, GitBranch } from 'lucide-react';
import { useWorkflowRuns } from '@/nexus/hooks/use-workflows';
import type { WorkflowRunSummary } from '@/nexus/client';

type StatusFilter = 'all' | 'running' | 'orphaned' | 'done' | 'failed';

const STATUS_LABEL: Record<WorkflowRunSummary['status'], string> = {
  running: 'Running',
  orphaned: 'Orphaned',
  done: 'Done',
  failed: 'Failed',
  unknown: 'Unknown',
};

const STATUS_TONE: Record<WorkflowRunSummary['status'], string> = {
  running: 'bg-info/10 text-info ring-info/30',
  orphaned: 'bg-text-tertiary/10 text-text-tertiary ring-border',
  done: 'bg-success/10 text-success ring-success/30',
  failed: 'bg-error/10 text-error ring-error/30',
  unknown: 'bg-surface-elevated text-text-tertiary ring-border',
};

export function RunsListPanel({
  onSelect,
  selectedRunId,
  enabled,
}: {
  onSelect: (runId: string, workflowName: string) => void;
  selectedRunId: string | null;
  enabled?: boolean;
}) {
  const runs = useWorkflowRuns({ enabled: enabled ?? true });
  const [filter, setFilter] = useState<StatusFilter>('all');

  const filtered = useMemo(() => {
    const all = runs.data?.runs ?? [];
    return filter === 'all' ? all : all.filter((r) => r.status === filter);
  }, [runs.data, filter]);

  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = {
      all: 0,
      running: 0,
      orphaned: 0,
      done: 0,
      failed: 0,
    };
    for (const r of runs.data?.runs ?? []) {
      out.all += 1;
      if (r.status in out) (out as Record<string, number>)[r.status] += 1;
    }
    return out;
  }, [runs.data]);

  if (runs.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-text-tertiary">
        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        loading runs…
      </div>
    );
  }
  if (runs.error) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-error">
        <AlertCircle className="mr-1.5 h-3 w-3" />
        failed to load runs: {(runs.error as Error).message}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <History className="h-3.5 w-3.5 text-text-tertiary" />
        <span className="text-xs font-medium">Recent runs</span>
        <span className="text-[10px] text-text-tertiary">({counts.all})</span>
        <div className="ml-auto flex items-center gap-1">
          {(['all', 'running', 'done', 'failed', 'orphaned'] as StatusFilter[]).map((f) => (
            <FilterChip
              key={f}
              label={f === 'all' ? 'all' : STATUS_LABEL[f as WorkflowRunSummary['status']]}
              count={counts[f]}
              active={filter === f}
              onClick={() => setFilter(f)}
            />
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[11px] text-text-tertiary">
          {filter === 'all'
            ? 'No runs yet — pick a workflow + click Run to start one.'
            : `No ${STATUS_LABEL[filter as WorkflowRunSummary['status']].toLowerCase()} runs.`}
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {filtered.map((r) => (
            <RunRow
              key={r.runId}
              run={r}
              selected={r.runId === selectedRunId}
              onSelect={() => onSelect(r.runId, r.workflowName)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-1.5 py-0.5 text-[10px] transition-colors ${
        active ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'text-text-tertiary hover:bg-surface-elevated'
      }`}
    >
      {label}
      {count > 0 && <span className="ml-1 opacity-70">{count}</span>}
    </button>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: WorkflowRunSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-[11px] transition-colors hover:bg-surface-elevated ${
          selected ? 'bg-primary/10' : ''
        }`}
      >
        <StatusIcon status={run.status} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3 w-3 shrink-0 text-text-tertiary" />
            <span className="truncate font-medium">{run.workflowName}</span>
          </div>
          <div className="flex items-center gap-2 text-[9px] text-text-tertiary">
            <span className="font-mono">{run.runId.slice(0, 22)}</span>
            <span>·</span>
            <span>{formatAge(run.startedAt)}</span>
            {run.arguments && run.arguments.length > 0 && (
              <>
                <span>·</span>
                <span className="truncate italic">{run.arguments.slice(0, 30)}</span>
              </>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase ring-1 ${STATUS_TONE[run.status]}`}
        >
          {STATUS_LABEL[run.status]}
        </span>
      </button>
    </li>
  );
}

function StatusIcon({ status }: { status: WorkflowRunSummary['status'] }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-info" />;
  if (status === 'done') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-error" />;
  if (status === 'orphaned') return <GhostIcon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />;
  return <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-text-tertiary/30" />;
}

function formatAge(startedAt: number): string {
  const diff = Date.now() - startedAt;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
