'use client';

// R6.4 — `/reflection` route panel. Fetches GET /v1/reflection/today
// and renders DailyReflection. Auto-refresh every 5 minutes since
// the underlying counters are live (notesSaved increments as the
// user uses the camera).

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { DailyReflection, type DailyReflectionData } from './DailyReflection';

const POLL_MS = 5 * 60_000;

interface ApiResponse {
  ok: true;
  snapshot: DailyReflectionData;
}

const EMPTY_SNAPSHOT: DailyReflectionData = {
  date: '',
  notesSaved: 0,
  ocrRuns: 0,
  sessionsToday: 0,
  topSessions: [],
  generatedAt: '',
};

export function DailyReflectionPanel() {
  const { config } = useDaemon();
  const [snapshot, setSnapshot] = useState<DailyReflectionData>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnap = useCallback(async (): Promise<void> => {
    if (!config.baseUrl) return;
    setLoading(true);
    try {
      const res = await fetch(`${config.baseUrl}/v1/reflection/today`, {
        ...(config.token ? { headers: { authorization: `Bearer ${config.token}` } } : {}),
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as ApiResponse;
      setSnapshot(body.snapshot);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [config.baseUrl, config.token]);

  useEffect(() => {
    void fetchSnap();
    const id = setInterval(() => { void fetchSnap(); }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchSnap]);

  return (
    <section
      data-testid="daily-reflection-panel"
      className="mx-auto flex max-w-md flex-col gap-3 p-4"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-lg font-medium">오늘의 회고</h1>
          <p className="text-xs text-muted-foreground">
            오늘 elanous 활동 요약 · 5분마다 자동 갱신
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="refresh reflection"
          onClick={() => void fetchSnap()}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
        </Button>
      </header>
      {error && (
        <p
          data-testid="reflection-panel-error"
          className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          fetch 실패: {error}
        </p>
      )}
      <DailyReflection snapshot={snapshot} />
    </section>
  );
}
