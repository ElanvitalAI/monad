'use client';

import type { ControlSignal } from '@/lib/control-signals-api';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface Props {
  items: ControlSignal[];
}

export function SignalGrid({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No control signals matched the current filter.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => {
        const scope = [
          item.scope?.surface && `surface=${item.scope.surface}`,
          item.scope?.channel && `channel=${item.scope.channel}`,
          item.scope?.sessionId && `session=${item.scope.sessionId}`,
        ]
          .filter(Boolean)
          .join(' · ') || 'unscoped';
        return (
          <li key={i} className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="text-sm font-medium">
              {item.kind} · {item.urgency}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {relTime(item.createdAt)} · {item.source ?? 'unknown'} · {scope}
            </div>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-[11px]">
              {JSON.stringify(item.payload ?? {}, null, 2)}
            </pre>
          </li>
        );
      })}
    </ul>
  );
}
