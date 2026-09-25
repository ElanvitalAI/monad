'use client';

// BACKLOG #2 — Platform connections card.
//
// 6-row Badge list showing whether the user has wired credentials /
// config for each integration channel (Discord, Telegram, Pushcut,
// ACP, Tailscale share). Reads GET /v1/platforms (sync · 30s
// refetch). Connected rows show a brief detail; not-configured
// rows show the setup hint.

import { CheckCircle2, Circle, RefreshCw, AlertCircle } from 'lucide-react';
import type { PlatformEntry } from '@/nexus/client';
import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';
import { usePlatforms } from '@/nexus/hooks/use-platforms';

export function PlatformConnectionsCard() {
  // Mirror QuickSetupCard's gating — when no Nexus client is in
  // context (SSR / dev without a daemon), the card is silently absent
  // rather than rendering an error.
  const client = useOptionalNexusClient();
  if (!client) return null;

  return <PlatformConnectionsCardInner />;
}

function PlatformConnectionsCardInner() {
  const { data, isLoading, error, refetch, isFetching } = usePlatforms();

  const platforms = data?.platforms ?? [];
  const connectedCount = platforms.filter((p) => p.status === 'connected').length;

  return (
    <section className="space-y-2" data-testid="platform-connections-card">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Platform connections</h2>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span data-testid="platform-summary">
            {data ? `${connectedCount} of ${platforms.length} connected` : isLoading ? 'loading…' : ''}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh platform connection status"
            className="rounded p-1 hover:bg-surface-elevated disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {error && (
        <p className="flex items-center gap-1 text-[11px] text-error">
          <AlertCircle className="h-3 w-3" />
          {error instanceof Error ? error.message : 'Failed to load platform list'}
        </p>
      )}

      {isLoading && !data && (
        <p className="text-[11px] text-muted-foreground">Querying /v1/platforms…</p>
      )}

      {data && (
        <ul className="space-y-1.5" role="list">
          {platforms.map((p) => (
            <PlatformRow key={p.id} entry={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface PlatformRowProps {
  entry: PlatformEntry;
}

export function PlatformRow({ entry }: PlatformRowProps) {
  const connected = entry.status === 'connected';
  return (
    <li
      data-testid={`platform-row-${entry.id}`}
      data-status={entry.status}
      className="flex items-start gap-3 rounded-md border border-border bg-surface px-3 py-2"
    >
      <div className="mt-0.5 flex-shrink-0">
        {connected ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" aria-label="connected" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" aria-label="not configured" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium">{entry.label}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
              connected
                ? 'bg-green-600/10 text-green-700'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {connected ? 'connected' : 'not configured'}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">{entry.detail}</div>
        {!connected && entry.hint && (
          <div className="text-[10px] italic text-muted-foreground/80">{entry.hint}</div>
        )}
      </div>
    </li>
  );
}
