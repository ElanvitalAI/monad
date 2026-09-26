// PWA · daemon tab detail (Phase N-4 PR π)

'use client';

import type { NexusTabState } from '../../types';

export function DaemonDetail({ tab }: { tab: NexusTabState }) {
  const meta = tab.spec.meta as { socketPath?: string; lockPath?: string } | undefined;
  const isExternal = tab.status === 'external';
  return (
    <div className="text-sm space-y-2">
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">socket</dt>
        <dd className="font-mono break-all">{meta?.socketPath ?? '—'}</dd>
        <dt className="text-muted-foreground">lock</dt>
        <dd className="font-mono break-all">{meta?.lockPath ?? '—'}</dd>
      </dl>
      {isExternal && (
        <div className="border border-purple-300 bg-purple-50 text-purple-800 rounded p-3 text-xs">
          ⚠ An external <code>elanous serve</code> already holds the lock (pid {tab.pid ?? '?'}).
          NEXUS will not double-spawn. Stop the external daemon
          (<code>elanous serve --stop</code>) and restart this tab to take over.
        </div>
      )}
    </div>
  );
}
