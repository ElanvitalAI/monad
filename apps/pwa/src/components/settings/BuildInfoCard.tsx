'use client';

import { useEffect, useState } from 'react';

/**
 * 빌드 정보 카드 (2026-07-08) — 우하단 fixed 배너를 Settings 정식 카드로 이관.
 * PWA 프론트 빌드(시각+SHA)와 데몬 시작(시각+SHA)을 나란히 = 배포 최신 여부 판별.
 * 프론트/데몬 SHA 불일치 시 경고.
 */
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '';
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? '';

function fmtKst(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return iso;
  }
}

export function BuildInfoCard() {
  const [daemon, setDaemon] = useState<{ startedAt: number; sha: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/v1/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.startedAt === 'number') {
          setDaemon({ startedAt: d.startedAt, sha: typeof d.daemonSha === 'string' ? d.daemonSha : '' });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const buildSha = BUILD_SHA && BUILD_SHA !== 'unknown' ? BUILD_SHA : '';
  const daemonSha = daemon?.sha && daemon.sha !== 'unknown' ? daemon.sha : '';
  const mismatch = !!daemonSha && !!buildSha && daemonSha !== buildSha;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold">빌드 정보</h2>
        <p className="text-xs text-muted-foreground">배포 최신 여부 판별 — 새로고침 후 시각/SHA 가 안 바뀌면 옛 캐시.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">PWA 프론트 빌드</div>
          <div className="mt-1 font-mono text-sm">
            {BUILD_TIME ? fmtKst(BUILD_TIME) : '—'}
            {buildSha ? ` · ${buildSha}` : ''}
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">데몬(백엔드) 시작</div>
          <div className={`mt-1 font-mono text-sm ${mismatch ? 'text-amber-500' : ''}`}>
            {daemon ? fmtKst(new Date(daemon.startedAt).toISOString()) : '…'}
            {daemonSha ? ` · ${daemonSha}` : ''}
          </div>
          {mismatch && <div className="mt-1 text-[11px] text-amber-500">프론트/데몬 SHA 불일치 — 재빌드·재시작 필요</div>}
        </div>
      </div>
    </section>
  );
}
