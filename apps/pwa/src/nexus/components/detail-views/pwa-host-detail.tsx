// PWA · pwa-host tab detail (Phase N-4 PR π)

'use client';

import type { NexusTabState } from '../../types';

export function PwaHostDetail({ tab }: { tab: NexusTabState }) {
  const meta = tab.spec.meta as { healthzUrl?: string; cwd?: string } | undefined;
  const isHaltCrash = tab.status === 'crashed' && tab.lastError?.includes('halt:');
  return (
    <div className="text-sm space-y-2">
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">healthz</dt>
        <dd className="font-mono break-all">{meta?.healthzUrl ?? '—'}</dd>
        <dt className="text-muted-foreground">cwd</dt>
        <dd className="font-mono break-all">{meta?.cwd ?? '—'}</dd>
      </dl>
      {isHaltCrash && (
        <div className="border border-rose-300 bg-rose-50 text-rose-800 rounded p-3 text-xs space-y-1">
          {tab.lastError?.includes('EADDRINUSE') && (
            <p>Port already in use. Stop the conflicting process or change <code>tabs.pwa-host:1.port</code>.</p>
          )}
          {/Module not found|Cannot find module/.test(tab.lastError ?? '') && (
            <p>Missing module — run <code>bun install</code> in <code>apps/pwa</code>, then restart this tab.</p>
          )}
          {tab.lastError && !/(EADDRINUSE|Module not found|Cannot find module)/.test(tab.lastError) && (
            <p>Halt-pattern matched — fix and restart manually.</p>
          )}
        </div>
      )}
    </div>
  );
}
