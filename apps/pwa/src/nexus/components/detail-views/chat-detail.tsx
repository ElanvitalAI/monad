// PWA · chat tab detail (Phase N-4 PR π — placeholder)

'use client';

import type { NexusTabState } from '../../types';

export function ChatDetail({ tab }: { tab: NexusTabState }) {
  const resumeSessionId = tab.spec.meta?.resumeSessionId as string | undefined;
  return (
    <div className="text-sm text-muted-foreground space-y-2">
      <p>Chat session view — PWA wiring lands in N-4 cleanup PR.+ (xterm + ACP attach).</p>
      <p className="font-mono text-xs">tab id: {tab.spec.id}</p>
      {resumeSessionId && (
        <p className="font-mono text-xs">resumeSessionId: {resumeSessionId}</p>
      )}
    </div>
  );
}
