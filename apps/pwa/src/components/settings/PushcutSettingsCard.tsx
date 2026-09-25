'use client';

// Round 3 PR1 (β-3 · 2026-05-08) — Pushcut Settings card.
//
// Surfaces the audit-derived "last delivery" snapshot for the
// configured Pushcut notification + a "Test notification" button
// that calls POST /v1/hitl/test-pushcut. Reads through the existing
// nexus client baseUrl so SSG + auth + same-origin guards inherit
// from NexusClientProvider.

import { useCallback, useEffect, useState } from 'react';
import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';
import { Button } from '@/components/ui/button';

interface AuditEntry {
  ts: number;
  requestId: string;
  prompt: string;
  channel: string;
  answer: boolean;
  elapsedMs: number;
}

interface AuditState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  count?: number;
  lastEntry?: AuditEntry;
  error?: string;
  fetchedAt?: number;
}

interface TestState {
  status: 'idle' | 'sending' | 'ok' | 'error';
  banner?: string;
}

const AUDIT_TAIL = 1;     // we only need the most recent pushcut entry

export function PushcutSettingsCard() {
  const client = useOptionalNexusClient();
  const [audit, setAudit] = useState<AuditState>({ status: 'idle' });
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    setAudit({ status: 'loading' });
    try {
      const res = await fetch(
        `${client.baseUrl}/v1/hitl/audit/recent?channel=pushcut&limit=${AUDIT_TAIL}`,
        { credentials: 'include' },
      );
      const body = await res.json() as { ok: boolean; count?: number; entries?: AuditEntry[]; error?: string };
      if (!res.ok || !body.ok) {
        setAudit({ status: 'error', error: body.error ?? `HTTP ${res.status}`, fetchedAt: Date.now() });
        return;
      }
      const lastEntry = body.entries?.[body.entries.length - 1];
      setAudit({
        status: 'ok',
        count: body.count ?? 0,
        lastEntry,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      setAudit({
        status: 'error',
        error: (err as Error).message,
        fetchedAt: Date.now(),
      });
    }
  }, [client]);

  const fireTest = useCallback(async () => {
    if (!client) return;
    setTest({ status: 'sending' });
    try {
      const res = await fetch(`${client.baseUrl}/v1/hitl/test-pushcut`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json() as {
        ok: boolean;
        notificationName?: string;
        sentAt?: number;
        reason?: string;
        hint?: string;
      };
      if (res.ok && body.ok) {
        setTest({
          status: 'ok',
          banner: `✓ sent → ${body.notificationName ?? '(unknown)'}`,
        });
        // Refresh the audit panel so the new entry shows up.
        void refresh();
      } else {
        setTest({
          status: 'error',
          banner: `✗ ${body.reason ?? `HTTP ${res.status}`}${body.hint ? ` · ${body.hint}` : ''}`,
        });
      }
    } catch (err) {
      setTest({
        status: 'error',
        banner: `✗ ${(err as Error).message}`,
      });
    }
  }, [client, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!mounted || !client) return null;

  const last = audit.lastEntry;
  const lastDeliveryAgo = last
    ? formatAgo(Date.now() - last.ts)
    : '(no Pushcut deliveries recorded yet)';

  return (
    <section
      data-testid="pushcut-settings-card"
      className="rounded border border-border/60 bg-card/40 p-4 shadow-sm"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">📲 Pushcut HITL channel</h3>
        <Button
          data-testid="pushcut-settings-refresh"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          aria-label="Refresh Pushcut status"
        >
          ↻
        </Button>
      </header>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Last delivery</dt>
        <dd
          data-testid="pushcut-last-delivery"
          className="font-mono"
        >
          {audit.status === 'loading' ? '…' : lastDeliveryAgo}
        </dd>
        {last ? (
          <>
            <dt className="text-muted-foreground">Last answer</dt>
            <dd className="font-mono">{last.answer ? 'yes' : 'no'} · {last.elapsedMs}ms</dd>
            <dt className="text-muted-foreground">Last requestId</dt>
            <dd className="font-mono break-all">{last.requestId}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Total recorded</dt>
        <dd className="font-mono">
          {audit.status === 'ok' ? audit.count ?? 0 : '—'}
        </dd>
      </dl>

      {audit.status === 'error' ? (
        <p className="mt-2 text-xs text-destructive">
          audit fetch failed: {audit.error}
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button
          data-testid="pushcut-test-button"
          variant="outline"
          size="sm"
          disabled={test.status === 'sending'}
          onClick={() => void fireTest()}
        >
          {test.status === 'sending' ? '…' : 'Test notification'}
        </Button>
        {test.banner ? (
          <span
            data-testid="pushcut-test-banner"
            className={
              test.status === 'ok'
                ? 'text-xs text-emerald-600 font-mono'
                : 'text-xs text-destructive font-mono'
            }
          >
            {test.banner}
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Audit log: <span className="font-mono">$MONAD_DIR/hitl-log.jsonl</span>{' '}
        (rotates at 100 MB · cv-3 β-4)
      </p>
    </section>
  );
}

function formatAgo(deltaMs: number): string {
  if (deltaMs < 0) return 'just now';
  if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)}s ago`;
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 86_400_000) return `${Math.floor(deltaMs / 3_600_000)}h ago`;
  return `${Math.floor(deltaMs / 86_400_000)}d ago`;
}
