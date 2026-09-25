'use client';

// Autopilot 자율행동 로그 서브탭 (Phase B2) — "회상 없는 자율은 표류".
// 자율루프(dig·backtest·trade·retro·replay·delegate·autopilot)가 무엇을 왜 했나.
// surface_events(domain=monad·kind=autonomy)에서 최근순. loop 필터.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AutopilotApi, AutonomyAction } from '@/lib/autopilot-api';

const LOOPS = ['dig', 'backtest', 'trade', 'retro', 'replay', 'delegate', 'autopilot'] as const;
const LOOP_TONE: Record<string, string> = {
  trade: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  dig: 'bg-sky-500/15 text-sky-200 ring-sky-500/30',
  backtest: 'bg-violet-500/15 text-violet-200 ring-violet-500/30',
  retro: 'bg-amber-500/15 text-amber-200 ring-amber-500/30',
  replay: 'bg-indigo-500/15 text-indigo-200 ring-indigo-500/30',
  delegate: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30',
  autopilot: 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-500/30',
};

function hhmm(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch { return iso.slice(5, 16); }
}

export function AutopilotAutonomyLog({ api }: { api: AutopilotApi }) {
  const [actions, setActions] = useState<AutonomyAction[]>([]);
  const [loop, setLoop] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.autonomy(80, loop ?? undefined);
      setActions(r.actions ?? []);
    } catch { /* fail-soft */ } finally { setLoading(false); }
  }, [api, loop]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLoop(null)}
          className={['rounded px-2 py-0.5 text-xs ring-1', loop === null ? 'bg-primary/20 text-foreground ring-primary/40' : 'bg-muted text-muted-foreground ring-border'].join(' ')}
        >전체</button>
        {LOOPS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLoop(l)}
            className={['rounded px-2 py-0.5 text-xs ring-1', loop === l ? (LOOP_TONE[l] ?? 'bg-primary/20 ring-primary/40') : 'bg-muted text-muted-foreground ring-border'].join(' ')}
          >{l}</button>
        ))}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => void refresh()}>새로고침</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 기록된 자율행동이 없습니다. 자율루프가 돌면 여기에 &ldquo;무엇을 왜 했나&rdquo;가 쌓입니다.</p>
      ) : (
        <ul className="space-y-2">
          {actions.map((a, i) => (
            <li key={`${a.ts}-${i}`} className="rounded-lg border border-border bg-card/50 p-3">
              <div className="flex items-center gap-2">
                <span className={['rounded px-2 py-0.5 text-xs ring-1', LOOP_TONE[a.loop] ?? 'bg-muted text-muted-foreground ring-border'].join(' ')}>{a.loop}</span>
                <span className="text-xs text-muted-foreground">{hhmm(a.ts)}</span>
                {a.importance >= 8 && <span className="rounded bg-rose-500/15 px-1.5 text-[10px] text-rose-300 ring-1 ring-rose-500/30">중요</span>}
              </div>
              <pre className="mt-1.5 whitespace-pre-wrap font-sans text-sm text-foreground/90">{a.text}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
