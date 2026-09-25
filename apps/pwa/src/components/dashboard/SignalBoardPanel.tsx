'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * 통합 시그널 보드 (2026-07-10) — 투자 대시보드 서브탭. 4소스(버즈 급부상·디깅/신호
 * 타임라인·국면전환·회고/기억 루프)를 하나의 최신순 감지 피드 + 국면/캡스톤 hero 로.
 * 대표 지시: 여러 루프에이전트가 감지한 내용을 한눈에. 백엔드 /v1/signals/board.
 */

type SignalSource = 'buzz' | 'dig' | 'signal' | 'regime' | 'reflection';
interface SignalDetection {
  source: SignalSource;
  ts: string;
  title: string;
  detail?: string;
  score?: number;
  ticker?: string;
  link?: string;
}
interface SignalBoard {
  generatedAt: string;
  regime: { label: string | null; composite: number | null; asOf: string; transition: boolean } | null;
  capstone: Record<string, unknown> | null;
  feed: SignalDetection[];
  bySource: Record<string, number>;
}

const SOURCE_META: Record<SignalSource, { label: string; badge: string; ring: string }> = {
  buzz: { label: '버즈', badge: 'bg-orange-500/15 text-orange-500', ring: 'border-orange-500/40' },
  dig: { label: '디깅', badge: 'bg-sky-500/15 text-sky-500', ring: 'border-sky-500/40' },
  signal: { label: '신호', badge: 'bg-rose-500/15 text-rose-500', ring: 'border-rose-500/40' },
  regime: { label: '국면', badge: 'bg-violet-500/15 text-violet-500', ring: 'border-violet-500/40' },
  reflection: { label: '회고', badge: 'bg-emerald-500/15 text-emerald-500', ring: 'border-emerald-500/40' },
};

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function SignalBoardPanel() {
  const { client } = useDaemon();
  const [board, setBoard] = useState<SignalBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<SignalSource | 'all'>('all');

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await client.fetchJson<{ ok: boolean; board: SignalBoard }>('/v1/signals/board?limit=60');
      setBoard(res.board ?? null);
    } catch (err) {
      toast.error(`시그널 보드 로드 실패: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const h = window.setInterval(() => void refresh(), 60000);
    return () => window.clearInterval(h);
  }, [refresh]);

  const feed = useMemo(() => {
    const f = board?.feed ?? [];
    return filter === 'all' ? f : f.filter((d) => d.source === filter);
  }, [board, filter]);

  const cap = board?.capstone as { target?: string; label?: string; samsung?: number; r3Level?: number } | null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4">
      {/* Hero — 국면 + 캡스톤 */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
          <div className="text-xs text-muted-foreground">🧭 국면 (regime)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-semibold">{board?.regime?.label ?? '—'}</span>
            {board?.regime?.composite != null && (
              <span className={board.regime.composite >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                {board.regime.composite >= 0 ? '+' : ''}{board.regime.composite.toFixed(3)}
              </span>
            )}
            {board?.regime?.transition && <span className="rounded bg-violet-500/20 px-1.5 text-xs text-violet-500">전환</span>}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{fmtRelative(board?.regime?.asOf)} 전</div>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-xs text-muted-foreground">🧭 캡스톤 (capstone)</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-semibold">{cap?.target ?? cap?.label ?? '—'}</span>
            {cap?.samsung != null && <span className="text-sm text-muted-foreground">삼성 ₩{Number(cap.samsung).toLocaleString()}</span>}
          </div>
          {cap?.r3Level != null && <div className="mt-0.5 text-xs text-muted-foreground">R3 회복선 ₩{Number(cap.r3Level).toLocaleString()}</div>}
        </div>
      </div>

      {/* 필터 + 새로고침 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">감지 피드</span>
        {(['all', 'buzz', 'signal', 'dig', 'regime', 'reflection'] as const).map((s) => {
          const count = s === 'all' ? board?.feed?.length ?? 0 : board?.bySource?.[s] ?? 0;
          const active = filter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={[
                'rounded-full px-2.5 py-0.5 text-xs transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {s === 'all' ? '전체' : SOURCE_META[s].label} {count > 0 && <span className="opacity-70">{count}</span>}
            </button>
          );
        })}
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? '…' : '↻'}
          </Button>
        </div>
      </div>

      {/* 통합 감지 피드 */}
      <div className="space-y-1.5">
        {feed.length === 0 && (
          <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            {busy ? '로딩…' : '감지된 신호 없음'}
          </div>
        )}
        {feed.map((d, i) => {
          const meta = SOURCE_META[d.source];
          const body = (
            <div className={['rounded-lg border bg-card p-2.5', meta.ring].join(' ')}>
              <div className="flex items-start gap-2">
                <span className={['mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', meta.badge].join(' ')}>
                  {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{d.title}</div>
                  {d.detail && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{d.detail}</div>}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{fmtRelative(d.ts)}</span>
              </div>
            </div>
          );
          return d.link ? (
            <a key={`${d.source}-${i}`} href={d.link} target="_blank" rel="noreferrer" className="block hover:opacity-90">
              {body}
            </a>
          ) : (
            <div key={`${d.source}-${i}`}>{body}</div>
          );
        })}
      </div>

      {board?.generatedAt && (
        <div className="mt-3 text-center text-[10px] text-muted-foreground">
          갱신 {fmtRelative(board.generatedAt)} 전 · 60s 자동
        </div>
      )}
    </div>
  );
}
