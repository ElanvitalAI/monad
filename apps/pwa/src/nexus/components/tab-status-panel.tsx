// PWA · NEXUS tab status panel (Phase N-4 PR π)
//
// Shared header for TabDetail · shows status badge · pid · restart count ·
// lastError truncation. Pure presentation; consuming components pull
// data via useNexusTab(id).

'use client';

import type { NexusTabState } from '../types';
import { StatusBadge } from './status-badge';

export interface TabStatusPanelProps {
  tab: NexusTabState;
}

export function TabStatusPanel({ tab }: TabStatusPanelProps) {
  return (
    <header className="flex flex-col gap-1 border-b pb-3 mb-3">
      <div className="flex items-center gap-3">
        <StatusBadge status={tab.status} label />
        <h2 className="text-lg font-semibold flex-1 truncate" title={tab.spec.id}>
          {tab.spec.label}
        </h2>
        <span className="text-xs text-muted-foreground" title={tab.spec.id}>
          {tab.spec.kind}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <dt>pid</dt>
          <dd>{tab.pid ?? '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt>restarts (1h)</dt>
          <dd>{tab.restartCount}</dd>
        </div>
        {tab.startedAt && (
          <div className="flex justify-between col-span-2">
            <dt>started</dt>
            <dd>{new Date(tab.startedAt).toLocaleString()}</dd>
          </div>
        )}
      </dl>
      {tab.lastError && (
        <div className="text-xs text-rose-600 mt-2 break-all">
          <span className="font-semibold">lastError:</span> {tab.lastError.slice(0, 200)}
        </div>
      )}
    </header>
  );
}
