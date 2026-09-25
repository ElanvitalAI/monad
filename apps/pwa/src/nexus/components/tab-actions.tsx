// PWA · NEXUS tab lifecycle action bar (Phase N-4 PR π)

'use client';

import {
  useStartTab,
  useStopTab,
  useRestartTab,
  useDeleteTab,
} from '../hooks/use-tab-actions';
import type { NexusTabState } from '../types';

export interface TabActionsProps {
  tab: NexusTabState;
}

const VIEW_ONLY_KINDS = new Set(['chat', 'webterm']);

export function TabActions({ tab }: TabActionsProps) {
  const start = useStartTab();
  const stop = useStopTab();
  const restart = useRestartTab();
  const del = useDeleteTab();
  const viewOnly = VIEW_ONLY_KINDS.has(tab.spec.kind);

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {!viewOnly && (
        <>
          <ActionBtn
            label="Start"
            onClick={() => start.mutate(tab.spec.id)}
            disabled={start.isPending || tab.status === 'active' || tab.status === 'starting'}
            tone="emerald"
          />
          <ActionBtn
            label="Stop"
            onClick={() => stop.mutate({ id: tab.spec.id, graceMs: 0 })}
            disabled={stop.isPending || tab.status === 'stopped' || tab.status === 'idle'}
            tone="amber"
          />
          <ActionBtn
            label="Restart"
            onClick={() => restart.mutate({ id: tab.spec.id, graceMs: 0 })}
            disabled={restart.isPending}
            tone="blue"
          />
        </>
      )}
      <ActionBtn
        label="Delete"
        onClick={() => del.mutate(tab.spec.id)}
        disabled={del.isPending}
        tone="rose"
      />
      {(start.isError || stop.isError || restart.isError || del.isError) && (
        <span className="text-xs text-rose-600 self-center">
          {((start.error || stop.error || restart.error || del.error) as Error | null)?.message ?? ''}
        </span>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick, disabled, tone }: { label: string; onClick: () => void; disabled?: boolean; tone: 'emerald' | 'amber' | 'blue' | 'rose' }) {
  const toneCls = {
    emerald: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50',
    amber: 'border-amber-300 text-amber-700 hover:bg-amber-50',
    blue: 'border-blue-300 text-blue-700 hover:bg-blue-50',
    rose: 'border-rose-300 text-rose-700 hover:bg-rose-50',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2.5 py-1 text-xs rounded border ${toneCls} disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}
