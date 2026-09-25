// PWA · single log line row (Phase N-4 PR ρ)

'use client';

import type { LogLineEntry } from '../hooks/use-tab-logs-stream';

export function LogLine({ entry }: { entry: LogLineEntry }) {
  const tone = entry.stream === 'stderr' ? 'text-rose-400' : 'text-zinc-200';
  return (
    <div className={`font-mono text-xs leading-snug whitespace-pre-wrap break-all ${tone}`}>
      {entry.line}
    </div>
  );
}
