'use client';

import type { IntakeSession } from '@/lib/intake-api';
import { cn } from '@/lib/utils';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface Props {
  sessions: IntakeSession[];
  selectedId?: string;
  onOpen: (id: string) => void;
}

export function IntakeList({ sessions, selectedId, onOpen }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No intake sessions found.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {sessions.map((s) => {
        const active = s.intakeId === selectedId;
        return (
          <li key={s.intakeId}>
            <button
              type="button"
              onClick={() => onOpen(s.intakeId)}
              className={cn(
                'w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-colors',
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40 hover:bg-card/80',
              )}
            >
              <div className="text-sm font-medium">
                {s.draft?.title ?? s.intakeId}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {s.intakeId} · {s.state} · {relTime(s.updatedAt)}
              </div>
              {s.draft?.summary && (
                <div className="mt-1 text-xs text-foreground/80">{s.draft.summary}</div>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                <Pill>{s.source}</Pill>
                <Pill>{s.state}</Pill>
                {s.decisionMode && <Pill>{s.decisionMode}</Pill>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}
