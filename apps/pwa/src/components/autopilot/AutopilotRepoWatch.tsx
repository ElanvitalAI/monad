'use client';

// Autopilot Repo Watch 서브탭 (Phase B2) — 참조 에이전트 repo 흡수 후보 감시 현황.
// hermes/openclaw/codex 의 마지막 감지 SHA·최근 새커밋 수. 흡수 제안은 텔레그램
// report 로 발송(크론 08:40·20:40). 여기는 상태 미러(READ-ONLY).

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AutopilotApi, RepoWatchEntry } from '@/lib/autopilot-api';

function relTime(iso: string | null): string {
  if (!iso) return '미감지';
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return '—';
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

export function AutopilotRepoWatch({ api }: { api: AutopilotApi }) {
  const [repos, setRepos] = useState<RepoWatchEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.repoWatch();
      setRepos(r.repos ?? []);
    } catch { /* fail-soft */ } finally { setLoading(false); }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">참조 에이전트 repo 감시 — 새 커밋을 흡수 후보로 분석(제안은 텔레그램 report·크론 08:40·20:40).</p>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>새로고침</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {repos.map((r) => (
          <div key={r.repo} className="rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.key}</span>
              {r.lastNew > 0 && (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-amber-500/30">
                  새 {r.lastNew}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{r.repo}</p>
            <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-mono text-muted-foreground">{r.lastSha ? r.lastSha.slice(0, 7) : '—'}</span>
              <span className="text-muted-foreground">{relTime(r.lastSeen)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">흡수 채택 → PR 초안 + 빌드/테스트 증거는 P2(disarmed) · merge/재부팅은 대표 HITL.</p>
    </div>
  );
}
