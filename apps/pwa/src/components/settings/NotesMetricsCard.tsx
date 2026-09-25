'use client';

// R-OCR.4.3 — PWA Settings card displaying camera-notes metrics.
//
// Renders the snapshot from `GET /v1/metrics/notes-from-image`:
//   - OCR total / failures / by provider / by polishMode
//   - Save total / failures / by polishMode
//   - Client events: cancel · edit · discard counters
//
// Polls every 10s while mounted (cheap GET, no SSE infrastructure
// needed at this phase). Refresh button forces an immediate re-fetch.
// Renders zero counts when the daemon has the empty-snapshot fallback
// (`wired:false`) so the card stays useful before runNexus rewires.
//
// Cross-ref:
//   src/notes/metrics.ts (collector)
//   src/nexus/api/metrics-notes.ts (snapshot endpoint)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R-OCR.4

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { debugLog } from '@/lib/debug';

interface NotesSnapshot {
  ocr: {
    total: number;
    failures: number;
    byProvider: Record<string, number>;
    byPolishMode: Record<string, number>;
  };
  save: {
    total: number;
    failures: number;
    byPolishMode: Record<string, number>;
  };
  client: {
    cancel: number;
    edit: number;
    discard: number;
  };
  startedAt: string;
  ts: string;
}

interface SnapshotResponse {
  ok: true;
  snapshot: NotesSnapshot;
  wired: boolean;
}

const POLL_MS = 10_000;

function emptySnapshot(): NotesSnapshot {
  return {
    ocr: { total: 0, failures: 0, byProvider: {}, byPolishMode: {} },
    save: { total: 0, failures: 0, byPolishMode: {} },
    client: { cancel: 0, edit: 0, discard: 0 },
    startedAt: '',
    ts: '',
  };
}

function renderBuckets(buckets: Record<string, number>): string {
  const entries = Object.entries(buckets);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}:${v}`).join(' · ');
}

export function NotesMetricsCard() {
  const { config } = useDaemon();
  const [snapshot, setSnapshot] = useState<NotesSnapshot>(emptySnapshot());
  const [wired, setWired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSnapshot = useCallback(async (): Promise<void> => {
    if (!config.baseUrl) return;
    setLoading(true);
    try {
      const res = await fetch(`${config.baseUrl}/v1/metrics/notes-from-image`, {
        ...(config.token ? { headers: { authorization: `Bearer ${config.token}` } } : {}),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as SnapshotResponse;
      setSnapshot(body.snapshot);
      setWired(body.wired);
      setError(null);
      debugLog('notes-metrics.snapshot', {
        wired: body.wired,
        ocrTotal: body.snapshot.ocr.total,
        saveTotal: body.snapshot.save.total,
      });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [config.baseUrl, config.token]);

  useEffect(() => {
    void fetchSnapshot();
    const id = setInterval(() => { void fetchSnapshot(); }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  const ocrSuccess = snapshot.ocr.total - snapshot.ocr.failures;
  const saveSuccess = snapshot.save.total - snapshot.save.failures;

  return (
    <section
      data-testid="notes-metrics-card"
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-medium">카메라 노트 metric</h3>
          <p className="text-xs text-muted-foreground">
            카메라 → markdown 노트 파이프라인 사용량 (daemon 재시작 시 0 으로 리셋).
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void fetchSnapshot()}
          disabled={loading}
          aria-label="refresh notes metrics"
        >
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
        </Button>
      </header>

      {!wired && (
        <p
          data-testid="notes-metrics-not-wired"
          className="mb-3 rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
        >
          collector 미wire — runNexus 재기동 후 측정 시작.
        </p>
      )}
      {error && (
        <p data-testid="notes-metrics-error" className="mb-3 text-xs text-destructive">
          metric fetch 실패: {error}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">OCR 총 / 성공 / 실패</dt>
        <dd data-testid="notes-metrics-ocr">
          {snapshot.ocr.total} / {ocrSuccess} / {snapshot.ocr.failures}
        </dd>

        <dt className="text-muted-foreground">OCR provider</dt>
        <dd data-testid="notes-metrics-ocr-providers">
          {renderBuckets(snapshot.ocr.byProvider)}
        </dd>

        <dt className="text-muted-foreground">OCR polishMode</dt>
        <dd data-testid="notes-metrics-ocr-polish">
          {renderBuckets(snapshot.ocr.byPolishMode)}
        </dd>

        <dt className="text-muted-foreground">Save 총 / 성공 / 실패</dt>
        <dd data-testid="notes-metrics-save">
          {snapshot.save.total} / {saveSuccess} / {snapshot.save.failures}
        </dd>

        <dt className="text-muted-foreground">Save polishMode</dt>
        <dd data-testid="notes-metrics-save-polish">
          {renderBuckets(snapshot.save.byPolishMode)}
        </dd>

        <dt className="text-muted-foreground">Client cancel · edit · discard</dt>
        <dd data-testid="notes-metrics-client">
          {snapshot.client.cancel} · {snapshot.client.edit} · {snapshot.client.discard}
        </dd>
      </dl>

      {snapshot.startedAt && wired && (
        <p className="mt-3 text-[10px] text-muted-foreground">
          since {snapshot.startedAt}
        </p>
      )}
    </section>
  );
}
