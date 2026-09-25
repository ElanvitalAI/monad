// Surface-unification ROADMAP §E2 (2026-05-11) — Active-triggers panel.
//
// Renders the `/v1/triggers` snapshot grouped by variant so the user
// can see "what's watching right now" at a glance. Click a row →
// navigate to the workflow + auto-select the trigger node so the form
// opens (defers to caller via `onSelect`).
//
// v1 = REST snapshot polled at 30s. v2 will swap polling for SSE once
// the `/v1/triggers/events` stream lands (BACKLOG).

'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNexusClient } from '@/nexus/hooks/use-nexus-context';
import { Loader2, Workflow, Zap } from 'lucide-react';
import {
  previewScheduleTrigger,
  previewWebhookTrigger,
  previewDiscordTrigger,
  previewTelegramTrigger,
  previewManualTrigger,
  previewChatTrigger,
} from './triggers/trigger-card-preview';
import type { TriggerSnapshot, TriggerSnapshotEntry } from '@/nexus/client';

interface ActiveTriggersPanelProps {
  /** Called when the user clicks a row · parent navigates to the
   *  workflow editor and auto-selects the named node. */
  onSelect?: (entry: TriggerSnapshotEntry) => void;
}

const VARIANT_ICONS: Record<TriggerSnapshotEntry['variant'], string> = {
  schedule: '⏰',
  webhook: '🔗',
  discord: '💬',
  telegram: '✈️',
  manual: '▶',
  chat: '💭',
};

function previewFor(entry: TriggerSnapshotEntry): string {
  switch (entry.variant) {
    case 'schedule':
      return previewScheduleTrigger(entry.payload);
    case 'webhook':
      return previewWebhookTrigger(entry.payload);
    case 'discord':
      return previewDiscordTrigger(entry.payload);
    case 'telegram':
      return previewTelegramTrigger(entry.payload);
    case 'manual':
      return previewManualTrigger(entry.payload);
    case 'chat':
      return previewChatTrigger(entry.payload);
    default:
      return '';
  }
}

export function ActiveTriggersPanel({ onSelect }: ActiveTriggersPanelProps) {
  const client = useNexusClient();
  const qc = useQueryClient();
  const query = useQuery<TriggerSnapshot>({
    queryKey: ['nexus', 'triggers-snapshot'],
    queryFn: () => client.getTriggersSnapshot(),
    refetchInterval: 60_000,
  });

  // Surface-unification v2 (2026-05-11) — live trigger lifecycle SSE.
  // `trigger.subscribed` / `trigger.unsubscribed` invalidate the
  // snapshot so the panel reflects daemon-side wiring in real time.
  // `trigger.fired` keeps a 5-entry trace so the user can see recent
  // hits without watching the daemon log.
  const [recentFires, setRecentFires] = useState<
    Array<{ workflowName: string; nodeId: string; ts: number; ok: boolean }>
  >([]);
  useEffect(() => {
    return client.subscribeEvents({
      topics: ['trigger.'],
      onEvent: (ev) => {
        const detail = (ev.detail ?? {}) as {
          workflowName?: string;
          nodeId?: string;
          ok?: boolean;
        };
        if (ev.kind === 'trigger.subscribed' || ev.kind === 'trigger.unsubscribed') {
          qc.invalidateQueries({ queryKey: ['nexus', 'triggers-snapshot'] });
        } else if (ev.kind === 'trigger.fired' && detail.workflowName && detail.nodeId) {
          setRecentFires((prev) => {
            const next = [
              {
                workflowName: detail.workflowName!,
                nodeId: detail.nodeId!,
                ts: ev.ts,
                ok: detail.ok !== false,
              },
              ...prev,
            ];
            return next.slice(0, 5);
          });
        }
      },
    });
  }, [client, qc]);

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-text-tertiary">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading triggers…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="px-3 py-2 text-[11px] text-error">
        Failed to load trigger snapshot.
      </div>
    );
  }

  const data = query.data;
  if (!data || data.triggers.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-text-tertiary">
        <Workflow className="h-3 w-3" />
        No triggers active.
      </div>
    );
  }

  return (
    <div className="flex flex-col border-b border-border bg-surface-elevated">
      <header className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-accent" />
          <span className="text-xs font-medium">Active triggers</span>
        </div>
        <span className="text-[10px] text-text-tertiary">
          {data.triggers.length} triggers · {data.workflowsScanned} workflows
        </span>
      </header>
      {recentFires.length > 0 && (
        <div className="border-b border-border bg-surface px-3 py-1.5 text-[10px] text-text-tertiary">
          <div className="mb-1 flex items-center gap-1 font-medium text-text-secondary">
            <Zap className="h-3 w-3 text-warning" />
            Recent fires
          </div>
          <ul className="space-y-0.5">
            {recentFires.map((r) => (
              <li key={`${r.workflowName}::${r.nodeId}::${r.ts}`} className="font-mono">
                <span className={r.ok ? 'text-success' : 'text-error'}>●</span>
                {' '}
                {new Date(r.ts).toLocaleTimeString()} · {r.workflowName} · {r.nodeId}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="max-h-48 divide-y divide-border overflow-y-auto">
        {data.triggers.map((t) => (
          <li
            key={`${t.workflowName}::${t.nodeId}`}
            className="cursor-pointer px-3 py-1.5 text-[11px] hover:bg-surface"
            onClick={() => onSelect?.(t)}
          >
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">{VARIANT_ICONS[t.variant]}</span>
              <span className="font-mono text-text-primary">{t.workflowName}</span>
              <span className="text-text-tertiary">·</span>
              <span className="font-mono text-text-tertiary">{t.nodeId}</span>
            </div>
            <div className="ml-6 text-[10px] text-text-tertiary">{previewFor(t)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
