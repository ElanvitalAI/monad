'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { toast } from 'sonner';

/**
 * 운영 상황판 (Ops Observability P4 · 2026-07-10) — 투자 대시보드 서브탭.
 * monad 자율 시스템(미션 → 3계약 루프 → blackboard → 오케스트레이터 → 집행)이 지금
 * 무엇을 어떤 상태로 돌리고 있나 + 이상 + 상태 전이 이력을 한눈에. 백엔드 /v1/dashboard/ops.
 */

interface OpsAnomaly { kind: string; entity: string; detail: string; since?: string }
interface OpsLoop { id: string; lastEvent: string; lastState: string | null; at: string; detail?: Record<string, unknown> }
interface OpsTimelineEntry {
  ts: string; entityType: string; entityId: string; event: string;
  fromState: string | null; toState: string | null; rationale: string | null; actor: string | null;
}
interface OpsData {
  missions: { total: number; byStatus: Record<string, number>; active: Array<{ id: string; goal: string; status: string; source: string; disposition: string }> };
  tasks: {
    total: number; byStatus: Record<string, number>;
    scheduleBacked: number; recentlyActive: number; dispatchPending: number;
    blocked: Array<{ id: string; title: string; note?: string }>;
    dispatchable: Array<{ id: string; title: string }>;
  };
  loops: { loops: OpsLoop[]; armed: boolean; live: boolean; executionMode: string; paperSources: string[] };
  orchestration: { recent: Array<{ event: string; state: string | null; at: string; detail?: Record<string, unknown> }> };
  schedules: { monadTotal: number; staleCount: number; erroredCount: number } | null;
  health: { healthy: boolean; anomalies: OpsAnomaly[]; anomalyCount?: number };
  timeline: OpsTimelineEntry[];
  generatedAt: string;
}

interface MissionDetail {
  mission: { id: string; goal: string; disposition: string; rationale: string | null } | null;
  derived: Array<{ kind: string; name: string; status: string; detail?: string }>;
  transitions: Array<{ ts: string; event: string; toState: string | null }>;
  planDraft: string | null;
}

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

/** 미션 출처 사람용 라벨 — 'human-intent'(내가 던진 골) vs 'discovery'(monad 자율 발굴). */
function sourceLabel(source: string): string {
  switch (source) {
    case 'human-intent': return '내가 던진 골';
    case 'discovery': return 'monad 발굴';
    case 'repo-watch': return '레포 감시';
    case 'manual': return '수동';
    default: return source;
  }
}

const STATE_TONE: Record<string, string> = {
  done: 'text-emerald-500', submitted: 'text-emerald-500', executed: 'text-emerald-500', running: 'text-sky-500',
  failed: 'text-rose-500', error: 'text-rose-500', braked: 'text-amber-500', blocked: 'text-amber-500',
};

function StatusChips({ byStatus }: { byStatus: Record<string, number> }) {
  const entries = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <span className="text-xs text-muted-foreground">없음</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([s, n]) => (
        <span key={s} className={['rounded px-1.5 py-0.5 text-xs font-medium', 'bg-muted', STATE_TONE[s] ?? 'text-foreground'].join(' ')}>
          {s} {n}
        </span>
      ))}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{title}</span>
        {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function OpsPanel() {
  const { client } = useDaemon();
  const [data, setData] = useState<OpsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openMission, setOpenMission] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actMsg, setActMsg] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await client.fetchJson<{ ok: boolean; ops: OpsData | null }>('/v1/dashboard/ops');
      setData(res.ops ?? null);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const h = window.setInterval(() => void refresh(), 60000);
    return () => window.clearInterval(h);
  }, [refresh]);

  // 미션 승인(실행)/거절(종료) — HITL 쓰기. POST /v1/autopilot/mission-action.
  const act = useCallback(async (id: string, action: 'approve' | 'cancel'): Promise<void> => {
    setBusy(id); setActMsg(null);
    const label = action === 'approve' ? '승인·실행' : '거절·종료';
    const tid = toast.loading(`${label} 중…`);
    try {
      const r = await client.fetchJson<{ ok?: boolean; error?: string; note?: string; scheduledCron?: string }>(
        '/v1/autopilot/mission-action',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }) },
      );
      if (r.error) {
        setActMsg(`실패: ${r.error}`);
        toast.error(`${label} 실패: ${r.error}`, { id: tid });
      } else {
        const msg = action === 'approve' ? `✅ 승인·실행됨${r.scheduledCron ? ` · 예약 ${r.scheduledCron}` : ''}` : '✅ 거절·종료됨';
        setActMsg(msg);
        toast.success(msg, { id: tid });
      }
      await refresh();
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      setActMsg(`실패: ${em}`);
      toast.error(`${label} 실패: ${em}`, { id: tid });
    } finally { setBusy(null); }
  }, [client, refresh]);

  // 미션 클릭 시 관련 태스크/스케줄 fan-in 상세 로드.
  useEffect(() => {
    if (!openMission) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    void client.fetchJson<{ ok: boolean; missionDetail: MissionDetail | null }>(`/v1/dashboard/ops?mission=${encodeURIComponent(openMission)}`)
      .then((r) => { if (!cancelled) setDetail(r.missionDetail ?? null); })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [openMission, client]);

  if (err) return <div className="mx-auto max-w-[1400px] p-4 text-sm text-rose-500">운영 상황판 로드 실패: {err}</div>;
  if (!data) return <div className="mx-auto max-w-[1400px] p-4 text-sm text-muted-foreground">불러오는 중…</div>;

  const healthy = data.health.healthy;

  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-4">
      {/* health 배너 */}
      <div className={['rounded-lg border p-3', healthy ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5'].join(' ')}>
        <div className="flex items-center justify-between">
          <span className={['text-sm font-semibold', healthy ? 'text-emerald-500' : 'text-rose-500'].join(' ')}>
            {healthy ? '자율 시스템 정상 ✓' : `이상 ${data.health.anomalies.length}건 ⚠ (개입은 대표 결정·HITL)`}
          </span>
          <span className="text-xs text-muted-foreground">갱신 {fmtRelative(data.generatedAt)} 전</span>
        </div>
        {!healthy ? (
          <div className="mt-2 space-y-1">
            {data.health.anomalies.slice(0, 8).map((a, i) => (
              <div key={i} className="text-xs">
                <span className="rounded bg-rose-500/15 px-1 py-0.5 font-medium text-rose-500">{a.kind}</span>{' '}
                <span className="font-medium">{a.entity}</span> — <span className="text-muted-foreground">{a.detail}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* 상태 그리드 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card title="미션" sub={`${data.missions.total}건`}>
          <StatusChips byStatus={data.missions.byStatus} />
          <div className="mt-1 text-xs text-muted-foreground">proposed = 승인대기(HITL·멈춤 아님)</div>
        </Card>
        <Card title="태스크" sub={`${data.tasks.total}건`}>
          <div className="space-y-0.5 text-xs">
            <div><span className="font-medium text-emerald-500">스케줄 실행 {data.tasks.scheduleBacked}</span> <span className="text-muted-foreground">(최근 발화 {data.tasks.recentlyActive})</span></div>
            <div><span className="font-medium text-sky-500">디스패치 대기 {data.tasks.dispatchPending}</span> · blocked {data.tasks.blocked.length}</div>
            <div className="text-[10px] text-muted-foreground">backlog 대부분은 스케줄로 실행됨(멈춤 아님)</div>
          </div>
        </Card>
        <Card title="계약 루프" sub={`armed=${data.loops.armed} · ${data.loops.executionMode}`}>
          {data.loops.loops.length ? (
            <div className="space-y-1">
              {data.loops.loops.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">{l.id}</span>
                  <span className={STATE_TONE[l.lastState ?? ''] ?? 'text-muted-foreground'}>{l.lastState} · {fmtRelative(l.at)}</span>
                </div>
              ))}
            </div>
          ) : <span className="text-xs text-muted-foreground">최근 사이클 없음</span>}
          {data.loops.paperSources.length ? <div className="mt-1 text-xs text-amber-500">페이퍼: {data.loops.paperSources.join(', ')}</div> : null}
        </Card>
        <Card title="스케줄" sub={data.schedules ? `${data.schedules.monadTotal} monad` : '—'}>
          {data.schedules ? (
            <div className="text-xs">
              <span className={data.schedules.staleCount ? 'text-amber-500' : 'text-muted-foreground'}>stale {data.schedules.staleCount}</span>{' · '}
              <span className={data.schedules.erroredCount ? 'text-rose-500' : 'text-muted-foreground'}>error {data.schedules.erroredCount}</span>
            </div>
          ) : <span className="text-xs text-muted-foreground">없음</span>}
        </Card>
      </div>

      {/* 활성 미션(disposition) — 클릭 시 관련 태스크/스케줄 fan-in 상세 */}
      {data.missions.active.length ? (
        <Card title="미션" sub={`활성 ${data.missions.active.length}건 · 클릭=상세(관련 태스크/스케줄)`}>
          <div className="space-y-1">
            {data.missions.active.map((m) => (
              <div key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenMission(openMission === m.id ? null : m.id)}
                  className="flex w-full items-start gap-2 text-left text-xs hover:opacity-80"
                >
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-amber-500">{m.disposition}</span>
                  <span className="truncate">{m.goal}</span>
                  <span className="shrink-0 text-muted-foreground">{openMission === m.id ? '▲' : '▼'} {sourceLabel(m.source)}</span>
                </button>
                {openMission === m.id ? (
                  <div className="ml-2 mt-1 space-y-1 border-l border-border pl-2">
                    {/* 승인/거절 — proposed 미션. detail 로드와 무관하게 펼치면 즉시 노출(주로 discovery). */}
                    {m.status === 'proposed' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button" disabled={busy === m.id}
                          onClick={() => void act(m.id, 'approve')}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                        >{busy === m.id ? '처리 중…' : '승인하고 실행'}</button>
                        <button
                          type="button" disabled={busy === m.id}
                          onClick={() => void act(m.id, 'cancel')}
                          className="rounded border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-rose-500 disabled:opacity-50"
                        >거절(종료)</button>
                        {actMsg && busy !== m.id ? <span className="text-[11px] text-emerald-500">{actMsg}</span> : null}
                      </div>
                    ) : null}
                    {!detail ? (
                      <div className="text-[11px] text-muted-foreground">상세 불러오는 중…</div>
                    ) : detail.mission?.id !== m.id ? (
                      <div className="text-[11px] text-muted-foreground">…</div>
                    ) : (
                      <div className="space-y-0.5 text-[11px]">
                        {detail.planDraft ? (
                          <details className="rounded border border-border bg-muted/30 p-1.5" open>
                            <summary className="cursor-pointer font-medium text-foreground">📋 멀티페이즈 플랜 (승인 전 검토)</summary>
                            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-snug text-muted-foreground">{detail.planDraft}</pre>
                          </details>
                        ) : null}
                        {detail.mission?.rationale ? <div className="text-muted-foreground">근거: {detail.mission.rationale}</div> : null}
                        <div className="font-medium">관련 파생물 {detail.derived.length}건 (태스크/스케줄/자율행동)</div>
                        {detail.derived.map((d, i) => (
                          <div key={i} className="text-muted-foreground">· [{d.kind}] {d.name} — {d.status}{d.detail ? ` (${d.detail})` : ''}</div>
                        ))}
                        {detail.transitions.length ? <div className="font-medium">전이 {detail.transitions.length}건</div> : null}
                        {detail.transitions.map((t, i) => (
                          <div key={i} className="text-muted-foreground">· {fmtRelative(t.ts)} {t.event} {t.toState ?? ''}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 디스패치 대기(진짜 대기 태스크) */}
      {data.tasks.dispatchable.length ? (
        <Card title="디스패치 대기 태스크" sub={`${data.tasks.dispatchPending}건 · 스케줄 아님·실행 대기`}>
          <div className="space-y-1">
            {data.tasks.dispatchable.map((t) => (
              <div key={t.id} className="text-xs">{t.title}</div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* blocked 태스크 상세 */}
      {data.tasks.blocked.length ? (
        <Card title="막힌 태스크" sub={`${data.tasks.blocked.length}건`}>
          <div className="space-y-1">
            {data.tasks.blocked.map((t) => (
              <div key={t.id} className="text-xs">
                <span className="font-medium">{t.title}</span>{t.note ? <span className="text-muted-foreground"> — {t.note}</span> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 오케스트레이션 최근 */}
      {data.orchestration.recent.length ? (
        <Card title="오케스트레이터 조율" sub="최근">
          <div className="space-y-1">
            {data.orchestration.recent.slice(0, 6).map((o, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span><span className="font-medium">{o.event}</span> {o.state ? `· ${o.state}` : ''}</span>
                <span className="text-muted-foreground">{fmtRelative(o.at)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 상태 전이 타임라인 */}
      <Card title="상태 전이 타임라인" sub={`최근 ${data.timeline.length}건`}>
        {data.timeline.length ? (
          <div className="space-y-1">
            {data.timeline.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="w-10 shrink-0 text-muted-foreground">{fmtRelative(e.ts)}</span>
                <span className="w-24 shrink-0 text-muted-foreground">{e.entityType}·{e.actor}</span>
                <span className="font-medium">{e.event}</span>
                <span className={STATE_TONE[e.toState ?? ''] ?? 'text-muted-foreground'}>
                  {e.fromState ? `${e.fromState}→` : ''}{e.toState ?? ''}
                </span>
                <span className="truncate text-muted-foreground">{e.rationale ?? e.entityId}</span>
              </div>
            ))}
          </div>
        ) : <span className="text-xs text-muted-foreground">기록된 전이 없음(데몬이 새 관측 코드로 재시작되면 채워짐).</span>}
      </Card>
    </div>
  );
}
