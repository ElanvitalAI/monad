'use client';

// BACKLOG #3 — Sidebar workflow invoker.
//
// Sticky compact card at the bottom of the left sidebar so the user
// can fire a workflow without leaving the current route. Mirrors the
// `monad wf run <name> [-- args]` CLI dispatch path; the heavy
// compose / graph / runs UI stays in /workflows. After Run fires,
// shows a tiny inline status with a deep link to the runs panel.
//
// Hidden in compact (rail) mode — there's no horizontal room for the
// select + args + button.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';
import { useWorkflows, useStartWorkflow } from '@/nexus/hooks/use-workflows';
import type { WorkflowSummary } from '@/nexus/client';

type RunStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'started'; runId: string; name: string }
  | { kind: 'error'; message: string };

interface InvokerProps {
  /** Hide entirely (compact rail). */
  compact?: boolean;
}

export function SidebarWorkflowInvoker({ compact = false }: InvokerProps) {
  // Same gating pattern as PlatformConnectionsCard — silently absent
  // when no NexusClient is in context (SSR / dev without daemon).
  const client = useOptionalNexusClient();
  if (compact || !client) return null;
  return <SidebarWorkflowInvokerInner />;
}

function SidebarWorkflowInvokerInner() {
  const list = useWorkflows();
  const start = useStartWorkflow();
  const [selectedName, setSelectedName] = useState<string>('');
  const [args, setArgs] = useState<string>('');
  const [status, setStatus] = useState<RunStatus>({ kind: 'idle' });

  // Default-select the first workflow once the list loads. Keeps the
  // Run button enabled on first render so users don't have to open
  // the dropdown for the most-common case.
  const workflows = list.data?.workflows ?? [];
  const effectiveName = selectedName || workflows[0]?.name || '';

  const onRun = async (): Promise<void> => {
    if (!effectiveName) return;
    setStatus({ kind: 'pending' });
    try {
      const result = await start.mutateAsync({ name: effectiveName, args });
      setStatus({ kind: 'started', runId: result.runId, name: effectiveName });
    } catch (e) {
      setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : 'run failed to start',
      });
    }
  };

  const groups = useMemo(() => groupBySource(workflows), [workflows]);

  return (
    <div
      data-testid="sidebar-workflow-invoker"
      className="border-t border-sidebar-border px-3 py-2.5 space-y-1.5"
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
        Run workflow
      </div>

      <select
        value={effectiveName}
        onChange={(e) => setSelectedName(e.target.value)}
        disabled={list.isLoading || workflows.length === 0}
        aria-label="Select workflow to run"
        className="block w-full truncate rounded border border-border bg-surface px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
      >
        {workflows.length === 0 && (
          <option value="">{list.isLoading ? 'loading…' : 'no workflows'}</option>
        )}
        {groups.map((group) => (
          <optgroup key={group.source} label={group.label}>
            {group.items.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <input
        type="text"
        value={args}
        onChange={(e) => setArgs(e.target.value)}
        placeholder="args (optional)"
        aria-label="Workflow arguments"
        className="block w-full rounded border border-border bg-surface px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <button
        type="button"
        onClick={onRun}
        disabled={!effectiveName || status.kind === 'pending'}
        data-testid="sidebar-workflow-invoker-run"
        className="flex w-full items-center justify-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-accent-hover disabled:opacity-50"
      >
        {status.kind === 'pending' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        Run
      </button>

      <RunInlineStatus status={status} />
    </div>
  );
}

function RunInlineStatus({ status }: { status: RunStatus }) {
  if (status.kind === 'idle' || status.kind === 'pending') return null;
  if (status.kind === 'error') {
    return (
      <p
        data-testid="sidebar-workflow-invoker-error"
        className="flex items-start gap-1 text-[10px] leading-tight text-error"
      >
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <span className="break-all">{status.message}</span>
      </p>
    );
  }
  // started
  return (
    <p
      data-testid="sidebar-workflow-invoker-started"
      className="flex items-start gap-1 text-[10px] leading-tight text-muted-foreground"
    >
      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-green-600" />
      <span className="min-w-0 flex-1 truncate">
        started <span className="font-mono">{status.runId.slice(0, 14)}</span> ·{' '}
        <Link href={'/workflows' as never} className="underline">
          view
        </Link>
      </span>
    </p>
  );
}

interface InvokerGroup {
  source: WorkflowSummary['source'];
  label: string;
  items: WorkflowSummary[];
}

const SOURCE_ORDER: ReadonlyArray<WorkflowSummary['source']> = ['project', 'global', 'builtin'];
const SOURCE_LABEL: Record<WorkflowSummary['source'], string> = {
  project: 'Project',
  global: 'Global',
  builtin: 'Built-in',
};

/** Pure helper extracted for unit testing. Bucketize by source so the
 *  dropdown shows project / global / builtin <optgroup>s in a stable
 *  order, regardless of how the server returns them. */
export function groupBySource(workflows: WorkflowSummary[]): InvokerGroup[] {
  const buckets = new Map<WorkflowSummary['source'], WorkflowSummary[]>();
  for (const w of workflows) {
    const arr = buckets.get(w.source) ?? [];
    arr.push(w);
    buckets.set(w.source, arr);
  }
  const out: InvokerGroup[] = [];
  for (const src of SOURCE_ORDER) {
    const items = buckets.get(src);
    if (!items || items.length === 0) continue;
    items.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ source: src, label: SOURCE_LABEL[src], items });
  }
  return out;
}
