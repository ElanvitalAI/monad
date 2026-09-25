// PWA · webterm tab detail (Phase N-4 PR π — placeholder)

'use client';

import type { NexusTabState } from '../../types';

export function WebtermDetail({ tab }: { tab: NexusTabState }) {
  const cwd = tab.spec.meta?.cwd as string | undefined;
  return (
    <div className="text-sm text-muted-foreground space-y-2">
      <p>Web terminal pane — xterm.js + WebSocket wiring lands in N-4 cleanup PR.+.</p>
      <p className="font-mono text-xs">tab id: {tab.spec.id}</p>
      {cwd && <p className="font-mono text-xs">cwd: {cwd}</p>}
    </div>
  );
}
