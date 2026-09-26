'use client';

// Voice 일원화 FU PP-V-2 (2026-05-07) — `/v1/voice/cost` polling pill.
// Q7=G1 deferred 후속. BudgetPill 옆에 mount 되며 1분마다 server-side
// `globalVoiceCostTracker().getMonthSummary()` 결과를 fetch 해 monthly
// 누적 STT/TTS USD 를 노출. daemon URL 미설정 시 자동 hidden.
//
// 모바일 viewport 대응: PP-7 (compact UI follow-up) 진입 시 함께
// `hidden md:inline-flex` 로 숨길지 결정. 본 phase 는 항상 노출.

import { useCallback, useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { cn } from '@/lib/utils';
import { debugLog } from '@/lib/debug';

const POLL_INTERVAL_MS = 60_000;

interface VoiceCostSummary {
  monthYYYYMM: string;
  sttUsd: number;
  ttsUsd: number;
  totalUsd: number;
  sttDurationSec: number;
  ttsCharCount: number;
}

/** Format a USD total with 2 decimal places. Sub-cent → "$0.00". */
export function formatVoiceCost(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '$0.00';
  return `$${usd.toFixed(2)}`;
}

export function VoiceCostPill() {
  const { client, config } = useDaemon();
  const [summary, setSummary] = useState<VoiceCostSummary | null>(null);
  const [errored, setErrored] = useState(false);
  const configured = Boolean(config.baseUrl);

  const refresh = useCallback(async (): Promise<void> => {
    if (!configured) return;
    try {
      const data = await client.voiceCost();
      setSummary(data);
      setErrored(false);
    } catch (err) {
      // Daemon may not have voice-rest enabled (503) or be unreachable.
      // Pill goes muted; no toast — this is ambient telemetry, not a
      // hard error.
      setErrored(true);
      debugLog('chat.voice.cost-pill.error', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }, [client, configured]);

  useEffect(() => {
    if (!configured) return;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [configured, refresh]);

  if (!configured) return null;

  // Loading state — show a placeholder so layout doesn't shift when
  // the first poll lands. Errored state collapses to a muted dash so
  // the user knows the pill is wired but the data isn't fresh.
  if (errored && !summary) {
    return (
      <div
        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
        title="voice cost — daemon /v1/voice/cost 응답 없음"
        data-elanous-pill="voice-cost"
      >
        <Mic className="h-3 w-3" aria-hidden />
        <span>—</span>
      </div>
    );
  }

  if (!summary) {
    return (
      <div
        className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
        data-elanous-pill="voice-cost"
      >
        <Mic className="h-3 w-3" aria-hidden />
        <span>…</span>
      </div>
    );
  }

  // Active state — totalUsd === 0 인 경우에도 명시 노출 (사용자가
  // tracker 가 살아있다는 신호로 활용). > $0 면 강조 색상.
  const hasUsage = summary.totalUsd > 0;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]',
        hasUsage
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : 'border-border bg-muted/40 text-muted-foreground',
      )}
      title={`voice cost ${summary.monthYYYYMM} · STT ${formatVoiceCost(summary.sttUsd)} · TTS ${formatVoiceCost(summary.ttsUsd)}`}
      data-elanous-pill="voice-cost"
    >
      <Mic className="h-3 w-3" aria-hidden />
      <span>{formatVoiceCost(summary.totalUsd)}</span>
      <span className="text-muted-foreground">/mo</span>
    </div>
  );
}
