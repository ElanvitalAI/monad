'use client';

// R4 v1.1 (2026-07-07) — `/dashboard` 파이낸스 대시보드 (organic-signal-engine).
// GET /v1/dashboard/{summary,heatmap,timeline,digs} 60초 폴링.
// v1.1 (대표 피드백): 장중 라이브 오버레이(2h 수집) · 일간/주간 토글 ·
// KR 섹터 카드 · 워치리스트(지수+대표종목·finviz 스타일) · 매력도 Δ방향
// 인디케이터 · 한글 레이블. 모바일 우선(iPad/아이폰 홈화면).

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';

const POLL_MS = 60_000;

interface SectorMove { symbol: string; name: string; dayPct: number; weekPct: number | null; streak: number }
interface Notable { symbol: string; dayPct: number; weekPct: number | null; streak: number; high20: boolean; flags: string[] }
interface AttrCell { key: string; label: string; symbol: string; score: number; signal: string | null; delta: number | null; dir: 'up' | 'down' | 'flat' | null }
interface SignalRow { id: string; ts: string; author: string; text: string; url: string; urgency: number | null; market: number | null; sector: string | null; impact: number | null; reason: string | null; alerted: number }
interface DigRow { id: number; ts: string; topic: string; sector: string; verdict: string; confidence: string }
interface ScheduleJob { id: string; name: string; cron: string | null; intervalMs: number | null; category: string; source: string; enabled: boolean; runVia: string; lastRun: string | null; command: string }
interface Schedules { total: number; adopted: number; byCategory: Record<string, number>; bySource: Record<string, number>; jobs: ScheduleJob[] }
interface OntologyProp { from: string; to: string; weight: number; leadLag: number; dir: '동조' | '역행' }
interface Ontology { stats: { nodes: number; edges: number; chains: number; companies: number }; chains: string[]; propagation: OntologyProp[]; p7m7: { weight: number; relation: string } | null; causalEdges: number; generatedAt: string }
interface BtRecent { id: string; runDate: string; concept: string; strategy: string; hypothesis: string; verdict: string; sharpe: number | null; pbo: number | null }
interface BtPromo { ts: string; expId: string; stage: string; fund: string }
interface Backtest { stats: { total: number; today: number; confirmed: number; paperFills: number }; byVerdict: Record<string, number>; recent: BtRecent[]; promotions: BtPromo[]; generatedAt: string }
interface LoopStatus { name: string; label: string; armed: boolean | null; today: number; byStatus: Record<string, number>; last: { at: string; status: string; detail?: string } | null }
interface Loops { loops: LoopStatus[]; generatedAt: string }
interface LiveRow { symbol: string; name: string; last: number; dayPct: number }
interface LiveSnapshot { ts: string; session: { us: string; kr: string }; usAnchors: LiveRow[]; usSectors: LiveRow[]; krSectors: LiveRow[]; indices: LiveRow[]; stocks: LiveRow[]; notables?: LiveRow[] }

interface CapstoneSignal { name: string; bear: boolean; detail: string }
interface Summary {
  capstone: {
    target: string | null; updatedAt: string | null;
    regime?: string | null; label?: string | null; targetExposure?: number | null;
    samsung?: number | null; r3Level?: number | null; reliable?: boolean | null;
    signals?: Record<'A' | 'B' | 'C' | 'D' | 'E', CapstoneSignal> | null;
  } | null;
  signals: { day: { total: number; alerted: number }; week: { total: number; alerted: number } } | null;
  digs: { week: number; lastAt: string | null } | null;
}
interface Heatmap {
  attractiveness: { asOf: string | null; prevAsOf: string | null; asset: AttrCell[]; country: AttrCell[]; sector: AttrCell[] } | null;
  usSectors: { date: string; anchors: SectorMove[]; sectors: SectorMove[]; notables: Notable[] } | null;
  krSectors: { date: string; sectors: SectorMove[] } | null;
  live: LiveSnapshot | null;
  newsSectors: Array<{ sector: string; label: string; n: number }> | null;
}

/** 등락% → 배경색 (녹→적 · 텔레그램 5단계 게이지 철학). */
function pctBg(pct: number, unit = 1): string {
  const t = Math.max(-1, Math.min(1, pct / (2.5 * unit)));
  if (Math.abs(t) < 0.1) return 'hsl(0 0% 50% / 0.15)';
  return t > 0 ? `hsl(142 60% 40% / ${0.15 + 0.5 * t})` : `hsl(0 70% 48% / ${0.15 + 0.5 * -t})`;
}
function scoreBg(score: number): string { return pctBg(score - 50, 10); }
const pctTxt = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(1)}%`;
const kst = (iso: string) => { try { return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
const hhmm = (iso: string) => { try { return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

function Cell({ label, value, bg, corner, cornerBottom }: { label: string; value: string; bg: string; corner?: string; cornerBottom?: string }) {
  return (
    <div className="relative flex flex-col items-center justify-center rounded-md px-1.5 py-1.5 text-center" style={{ background: bg }}>
      {/* 우측 2단 (대표 지시 2026-07-07): 상단=변화 방향 ▲▼ · 하단=매매 시그널 ✅⛔
          (📈📉는 소형에서 구분 불가 피드백 → 실루엣·색이 다른 ✅/⛔ + 12px) */}
      {corner ? <span className="absolute right-1 top-0.5 text-[10px]">{corner}</span> : null}
      {cornerBottom ? <span className="absolute bottom-0.5 right-0.5 text-xs leading-none">{cornerBottom}</span> : null}
      <span className="text-[11px] leading-tight text-foreground/80">{label}</span>
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Card({ title, sub, children, right }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {sub ? <span className="text-[10px] text-muted-foreground">{sub}</span> : null}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** 백테스팅 루프 서브탭(S1) — 실험·verdict·승격·페이퍼. READ-ONLY·페이퍼. */
function BacktestSubPanel({ backtest }: { backtest: Backtest | null }) {
  if (!backtest) return <p className="p-4 text-xs text-muted-foreground">백테스팅 루프 미실행 — 평일 20:00 크론(`bun scripts/backtest-cycle.ts`) 후 표시됩니다.</p>;
  const b = backtest;
  const vColor = (v: string): string => v === 'CONFIRMED' ? 'text-emerald-500' : v === 'REJECTED' ? 'text-red-500' : 'text-muted-foreground';
  return (
    <div className="flex flex-col gap-3">
      <Card title="🧪 백테스팅 루프" sub={`총 ${b.stats.total} 실험 · 오늘 ${b.stats.today} · CONFIRMED ${b.stats.confirmed} · 페이퍼 체결 ${b.stats.paperFills}`}>
        {Object.keys(b.byVerdict).length ? (
          <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
            {Object.entries(b.byVerdict).map(([v, n]) => (
              <span key={v} className={`rounded bg-secondary px-1.5 py-0.5 ${vColor(v)}`}>{v} {n}</span>
            ))}
          </div>
        ) : <p className="mb-2 text-[10px] text-muted-foreground">오늘 실험 없음</p>}
        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">최근 실험 (모멘텀·스윙 가설)</p>
        {b.recent.length ? (
          <ul className="flex flex-col gap-1">
            {b.recent.slice(0, 12).map(r => (
              <li key={r.id} className="flex items-center justify-between gap-2 border-b border-border/40 py-1 text-xs last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.concept} · {r.strategy}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{r.hypothesis}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums">
                  <span className={vColor(r.verdict)}>{r.verdict}</span>
                  {r.sharpe != null ? <span className="text-muted-foreground">Sh {r.sharpe}</span> : null}
                  {r.pbo != null ? <span className="text-muted-foreground">PBO {r.pbo}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-[10px] text-muted-foreground">실험 없음</p>}
      </Card>
      {b.promotions.length ? (
        <Card title="🚀 승격 이력" sub={`${b.promotions.length}건`}>
          <ul className="flex flex-col gap-1">
            {b.promotions.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-2 border-b border-border/40 py-1 text-xs last:border-0">
                <span className="min-w-0 truncate">{p.expId}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{p.stage} · {p.fund}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <p className="text-[10px] text-muted-foreground">페이퍼·disarmed · 실집행은 대표 arm 게이트(aggressive fund) · 승격 게이트 PBO&lt;10%·DSR&gt;0·CPCV≥85%·OOS Sharpe&gt;1.5·WRC·Pre-Bull</p>
    </div>
  );
}

/** 일간/주간 세그먼트 토글. */
function RangeToggle({ value, onChange }: { value: 'day' | 'week'; onChange: (v: 'day' | 'week') => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border text-[11px]">
      {(['day', 'week'] as const).map(v => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`px-2 py-0.5 ${value === v ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'}`}>
          {v === 'day' ? '일간' : '주간'}
        </button>
      ))}
    </div>
  );
}

/** 섹터 그리드 — range 토글·라이브 오버레이(일간일 때만) 적용. */
function SectorGrid({ moves, live, range }: { moves: SectorMove[]; live: LiveRow[] | null; range: 'day' | 'week' }) {
  const liveMap = new Map((live ?? []).map(l => [l.symbol, l.dayPct]));
  const rows = moves.map(m => {
    const liveDay = range === 'day' ? liveMap.get(m.symbol) : undefined;
    const v = range === 'week' ? (m.weekPct ?? 0) : (liveDay ?? m.dayPct);
    return { ...m, v, isLive: liveDay != null };
  }).sort((a, b) => b.v - a.v);
  const unit = range === 'week' ? 3 : 1;
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
      {rows.map(s => (
        <Cell key={s.symbol} label={s.name} bg={pctBg(s.v, unit)}
          value={`${pctTxt(s.v)}${range === 'day' && Math.abs(s.streak) >= 3 ? (s.streak > 0 ? ` ↑${s.streak}` : ` ↓${-s.streak}`) : ''}`}
          {...(s.isLive ? { corner: '·' } : {})} />
      ))}
    </div>
  );
}

/** 워치리스트 행 (finviz/HTS 벤치마크 — 이름·심볼·가격·등락 컬러바). */
function WatchRow({ r }: { r: LiveRow }) {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-border/40 py-1 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{r.name}</p>
        <p className="text-[10px] text-muted-foreground">{r.symbol}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums">{r.last.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <span className="w-14 rounded px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums" style={{ background: pctBg(r.dayPct) }}>
          {pctTxt(r.dayPct)}
        </span>
      </div>
    </li>
  );
}

export function FinanceDashboardPanel() {
  const { config } = useDaemon();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [digs, setDigs] = useState<DigRow[]>([]);
  const [schedules, setSchedules] = useState<Schedules | null>(null);
  const [ontology, setOntology] = useState<Ontology | null>(null);
  const [backtest, setBacktest] = useState<Backtest | null>(null);
  const [loops, setLoops] = useState<Loops | null>(null);
  const [tab, setTab] = useState<'overview' | 'backtest'>('overview');
  const [range, setRange] = useState<'day' | 'week'>('day');
  const [loading, setLoading] = useState(false);
  const [recollecting, setRecollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!config.baseUrl) return;
    setLoading(true);
    const get = async (path: string): Promise<any> => {
      const res = await fetch(`${config.baseUrl}${path}`, {
        ...(config.token ? { headers: { authorization: `Bearer ${config.token}` } } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} (${path})`);
      return res.json();
    };
    try {
      const [s, h, t, d, sc, on, bt, lp] = await Promise.all([
        get('/v1/dashboard/summary'), get('/v1/dashboard/heatmap'),
        get('/v1/dashboard/timeline?hours=48&floor=6'), get('/v1/dashboard/digs?limit=8'),
        get('/v1/dashboard/schedules'), get('/v1/dashboard/ontology'), get('/v1/dashboard/backtest'),
        get('/v1/dashboard/loops'),
      ]);
      setSummary(s.summary); setHeatmap(h.heatmap); setSignals(t.signals ?? []); setDigs(d.digs ?? []);
      setSchedules(sc.schedules ?? null); setBacktest(bt.backtest ?? null);
      setOntology(on.ontology ?? null); setLoops(lp.loops ?? null);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally { setLoading(false); }
  }, [config.baseUrl, config.token]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  /** refresh 버튼 범위(설계·2026-07-07): ①API 재호출(신호·디깅은 즉시 최신)
   *  ②장중이면 라이브 시세 온디맨드 재수집 트리거(서버 3분 rate guard) —
   *  수집은 ~40초 백그라운드라 25s/55s 지연 재로드로 새 스냅샷 픽업. */
  const refresh = useCallback(async (): Promise<void> => {
    void load();
    if (!config.baseUrl) return;
    try {
      const res = await fetch(`${config.baseUrl}/v1/dashboard/refresh-live`, {
        method: 'POST',
        ...(config.token ? { headers: { authorization: `Bearer ${config.token}` } } : {}),
      });
      const j = (await res.json()) as { started?: boolean };
      if (j.started) {
        setRecollecting(true);
        setTimeout(() => { void load(); }, 25_000);
        setTimeout(() => { void load(); setRecollecting(false); }, 55_000);
      }
    } catch { /* fail-soft — API 재호출은 이미 수행됨 */ }
  }, [config.baseUrl, config.token, load]);

  const us = heatmap?.usSectors ?? null;
  const kr = heatmap?.krSectors ?? null;
  const attr = heatmap?.attractiveness ?? null;
  const live = heatmap?.live ?? null;
  const liveTag = live ? `🔴 라이브 ${hhmm(live.ts)} (${live.session.us.startsWith('OPEN') || live.session.us === 'PRE' || live.session.us === 'AFTER' ? `US ${live.session.us}` : `KR ${live.session.kr}`})` : null;

  return (
    <section data-testid="finance-dashboard-panel" className="mx-auto flex max-w-5xl flex-col gap-3 p-3 pb-16">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-lg font-medium">시그널 대시보드</h1>
          <p className="text-xs text-muted-foreground">
            {summary?.capstone?.target ? (
              <>캡스톤 <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">{summary.capstone.target}</span>{' '}</>
            ) : null}
            신호 24h {summary?.signals?.day.total ?? '–'}건 · 7d {summary?.signals?.week.total ?? '–'}건(🚨{summary?.signals?.week.alerted ?? 0}) · 디깅 7d {summary?.digs?.week ?? 0}건
            {liveTag ? <> · <span className="font-medium text-foreground">{liveTag}</span></> : ' · EOD'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeToggle value={range} onChange={setRange} />
          <Button type="button" variant="ghost" size="sm" aria-label="refresh dashboard" onClick={() => { void refresh(); }}>
            <RefreshCw className={`size-4 ${loading || recollecting ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>
      {error ? <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</p> : null}

      {/* 투자 대시보드 서브탭(개요 · 백테스팅) — 대표 지시 2026-07-08 */}
      <div className="flex gap-1 border-b border-border/40">
        {(['overview', 'backtest'] as const).map(k => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${tab === k ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {k === 'overview' ? '개요' : '🧪 백테스팅'}
          </button>
        ))}
      </div>

      <div className={`grid gap-3 lg:grid-cols-[1fr_300px] ${tab === 'overview' ? '' : 'hidden'}`}>
        <div className="flex min-w-0 flex-col gap-3">
          {us ? (
            <Card title="🇺🇸 US 섹터 순환" sub={range === 'day' ? (live?.usSectors?.length ? `라이브 ${hhmm(live.ts)}` : `${us.date} EOD`) : `주간 (5거래일) · ~${us.date}`}>
              <div className="mb-2 grid grid-cols-3 gap-1.5">
                {(range === 'day' && live?.usAnchors?.length
                  ? live.usAnchors.map(a => ({ symbol: a.symbol, name: a.name, v: a.dayPct }))
                  : us.anchors.map(a => ({ symbol: a.symbol, name: a.name, v: range === 'week' ? (a.weekPct ?? 0) : a.dayPct }))
                ).map(a => <Cell key={a.symbol} label={a.name} value={pctTxt(a.v)} bg={pctBg(a.v, range === 'week' ? 3 : 1)} />)}
              </div>
              <SectorGrid moves={us.sectors} live={live?.usSectors ?? null} range={range} />
              {us.notables.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {us.notables.map(n => {
                    // 일간은 라이브 우선 (EOD 칩이 장중과 정반대로 보이는 문제 —
                    // 대표 지적: KORU EOD -9.8% vs 라이브 +17%)
                    const liveN = range === 'day'
                      ? (live?.notables ?? []).concat(live?.stocks ?? []).find(l => l.symbol === n.symbol)
                      : undefined;
                    const v = range === 'week' ? (n.weekPct ?? n.dayPct) : (liveN?.dayPct ?? n.dayPct);
                    return (
                      <span key={n.symbol} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: pctBg(v, range === 'week' ? 5 : 2) }}>
                        {n.symbol} {pctTxt(v)}{liveN ? '·L' : ''}{Math.abs(n.streak) >= 4 ? (n.streak > 0 ? ` ↑${n.streak}d` : ` ↓${-n.streak}d`) : ''}{n.high20 && n.dayPct > 0 ? ' 🏔' : ''}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </Card>
          ) : null}

          {kr ? (
            <Card title="🇰🇷 KR 섹터 (KODEX)" sub={range === 'day' ? (live?.krSectors?.length ? `라이브 ${hhmm(live.ts)}` : `${kr.date} EOD`) : `주간 (5거래일)`}>
              <SectorGrid moves={kr.sectors} live={live?.krSectors ?? null} range={range} />
            </Card>
          ) : null}

          {attr ? (
            <Card title="🌐 매력도 (자산×국가×섹터)" sub={`${attr.asOf ?? '?'} · Δ는 ${attr.prevAsOf ?? '직전'} 대비 방향`}>
              {(['asset', 'country', 'sector'] as const).map(g => (
                attr[g].length ? (
                  <div key={g} className="mb-1.5">
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{g === 'asset' ? '자산군' : g === 'country' ? '국가' : '섹터'}</p>
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                      {attr[g].map(c => (
                        <Cell key={c.key} label={c.label} bg={scoreBg(c.score)}
                          value={String(c.score)}
                          {...(c.dir ? { corner: c.dir === 'up' ? '▲' : c.dir === 'down' ? '▼' : '─' } : {})}
                          {...(c.signal === 'BUY' ? { cornerBottom: '✅' } : c.signal === 'SELL' ? { cornerBottom: '⛔' } : {})} />
                      ))}
                    </div>
                  </div>
                ) : null
              ))}
              <p className="mt-1 text-[10px] text-muted-foreground">셀 색=점수(50 중립) · 우상단 ▲▼=변화 방향 · 우하단 ✅매수/⛔매도 시그널(±1σ·HOLD 생략)</p>
            </Card>
          ) : null}

          {heatmap?.newsSectors?.length ? (
            <Card title="📡 뉴스 신호 섹터 분포" sub="7일 · 유의(6+)">
              <div className="flex flex-wrap gap-1">
                {heatmap.newsSectors.map(s => (
                  <span key={s.sector} className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">{s.label ?? s.sector} <b>{s.n}</b></span>
                ))}
              </div>
            </Card>
          ) : null}

          <Card title="🕒 신호 타임라인" sub="48h · floor 6+">
            {signals.length === 0 ? <p className="text-xs text-muted-foreground">신호 없음</p> : (
              <ul className="flex flex-col gap-2">
                {signals.slice(0, 12).map(s => (
                  <li key={s.id} className="border-l-2 pl-2 text-xs" style={{ borderColor: pctBg((s.market ?? 0) - 5, 2) }}>
                    <span className="text-[10px] text-muted-foreground">{kst(s.ts)} · {s.author}{s.alerted ? ' · 🚨' : ''} · [{s.sector ?? '?'}{s.impact ?? 0}·시장{s.market ?? 0}]</span>
                    {/* 한국어 판정사유를 타이틀로 · 원문은 실제 출처 링크(X/t.me/기사 — 대표 지시 2026-07-07) */}
                    <p className="leading-snug">{s.reason ?? s.text.slice(0, 150)}</p>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="mt-0.5 inline-block text-[10px] text-primary underline-offset-2 hover:underline">
                        {s.url.includes('//x.com') ? '𝕏' : s.url.includes('t.me') ? 'Telegram' : '기사'} 원문 ↗
                      </a>
                    ) : s.reason ? (
                      <details className="mt-0.5">
                        <summary className="cursor-pointer text-[10px] text-muted-foreground">원문</summary>
                        <p className="text-[11px] leading-snug text-foreground/70">{s.text.slice(0, 200)}</p>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="🔎 디깅 피드" sub="적응 해상도 · 최근 8">
            {digs.length === 0 ? <p className="text-xs text-muted-foreground">디깅 없음</p> : (
              <ul className="flex flex-col gap-2">
                {digs.map(d => (
                  <li key={d.id} className="rounded-md bg-secondary/50 p-2 text-xs">
                    <p className="mb-1 text-[10px] text-muted-foreground">{kst(d.ts)} · {d.sector} · 확신도 {d.confidence}</p>
                    <p className="font-medium leading-snug">{d.topic.slice(0, 110)}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-primary">분석 보기</summary>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground/90">{d.verdict}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* 스케줄러 (prospective memory · B1) — 예약 작업 인지·상태 */}
          {schedules ? (
            <Card title="🗓 스케줄러" sub={`${schedules.total}잡 · monad실행 ${schedules.adopted} · ${Object.entries(schedules.byCategory).map(([k, v]) => `${k} ${v}`).join(' · ')}`}>
              <ul className="flex flex-col gap-1">
                {schedules.jobs.slice(0, 40).map(j => (
                  <li key={j.id} className="flex items-center justify-between gap-2 border-b border-border/40 py-1 text-xs last:border-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{j.enabled ? '' : '⏸ '}{j.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{j.cron ?? (j.intervalMs ? `${Math.round(j.intervalMs / 60000)}분` : '?')} · {j.category}{j.source !== 'crontab' ? ` · ${j.source}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {j.runVia === 'monad' ? <span className="rounded bg-primary/20 px-1 text-[10px] text-primary">monad</span> : j.runVia === 'daemon' ? <span className="rounded bg-secondary px-1 text-[10px] text-muted-foreground">daemon</span> : null}
                      {j.lastRun ? <span className="text-[10px] tabular-nums text-muted-foreground">{hhmm(j.lastRun)}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* 온톨로지 (국면 인과추론 엔진 · M5) — 인과그래프 통계·미국→한국 전파·P7↔M7 */}
          {ontology ? (
            <Card title="🧠 온톨로지" sub={`${ontology.stats.nodes} 노드 · ${ontology.stats.edges} 엣지 · ${ontology.stats.chains} 체인 · ${ontology.stats.companies} 종목${ontology.causalEdges ? ` · 인과 ${ontology.causalEdges}` : ''}`}>
              {ontology.propagation.length > 0 ? (
                <>
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">미국 → 한국 전파 (lead-lag)</p>
                  <ul className="mb-2 flex flex-col gap-1">
                    {ontology.propagation.slice(0, 10).map((p, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 border-b border-border/40 py-1 text-xs last:border-0">
                        <span className="min-w-0 truncate">{p.from} <span className="text-muted-foreground">→</span> {p.to}</span>
                        <span className="shrink-0 tabular-nums text-[10px]">
                          <span className={p.dir === '동조' ? 'text-emerald-500' : 'text-red-500'}>{p.dir === '동조' ? '▲' : '▼'} {Math.abs(p.weight).toFixed(2)}</span>
                          <span className="text-muted-foreground"> · {p.leadLag}일</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="mb-2 text-[10px] text-muted-foreground">측정된 전파 없음</p>}
              {ontology.p7m7 ? (
                <p className="text-[10px] text-muted-foreground">P7↔M7 로테이션: <span className={ontology.p7m7.relation === '역관계' ? 'text-red-500' : 'text-emerald-500'}>{ontology.p7m7.relation} ({ontology.p7m7.weight.toFixed(2)})</span></p>
              ) : null}
              <p className="mt-1 truncate text-[10px] text-muted-foreground">체인: {ontology.chains.join(' · ')}</p>
            </Card>
          ) : null}

          {/* 자율 루프 관측 — dig goal · 새벽 리플레이 · 백테스팅이 실제로 도는가(armed·오늘·상태) */}
          {loops && loops.loops.length > 0 ? (
            <Card title="🔁 자율 루프" sub={`${loops.loops.length}개 · run 상태 관측`}>
              <ul className="flex flex-col gap-1">
                {loops.loops.map((l) => (
                  <li key={l.name} className="flex items-center justify-between gap-2 border-b border-border/40 py-1 text-xs last:border-0">
                    <span className="min-w-0 truncate">
                      {l.armed === null ? <span className="text-muted-foreground">◦</span> : <span className={l.armed ? 'text-emerald-500' : 'text-muted-foreground'}>{l.armed ? '● armed' : '○ off'}</span>}
                      <span className="ml-1">{l.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                      오늘 {l.today}{l.last ? <span className="ml-1">· {l.last.status}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        {/* 워치리스트 사이드 (finviz/HTS 벤치마크 — 데스크탑 우측·모바일 하단) */}
        <aside className="flex flex-col gap-3">
          {/* 캡스톤 A~E — 사이드바 최상단 (대표 지시 2026-07-07) */}
          {summary?.capstone ? (
            <Card title="🧭 캡스톤 (삼성 슬리브)" sub={summary.capstone.updatedAt ? `${kst(summary.capstone.updatedAt)} EOD` : undefined}>
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-primary/10 px-2 py-0.5 text-sm font-bold text-primary">{summary.capstone.target ?? '?'}</span>
                {summary.capstone.targetExposure != null ? (
                  <span className="text-xs text-muted-foreground">목표 {summary.capstone.targetExposure}×</span>
                ) : null}
              </div>
              {summary.capstone.label ? <p className="mb-2 text-[11px] text-muted-foreground">{summary.capstone.label}</p> : null}
              {summary.capstone.signals ? (
                <ul className="flex flex-col gap-1">
                  {(['A', 'B', 'C', 'D', 'E'] as const).map(k => {
                    const s = summary.capstone!.signals![k];
                    if (!s) return null;
                    return (
                      <li key={k} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className={`inline-block size-2 rounded-full ${s.bear ? 'bg-red-500' : 'bg-emerald-500'}`} />
                          <b>{k}</b> {s.name}
                        </span>
                        <span className="text-right text-[11px] text-muted-foreground">{s.detail}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground">A~E 상세는 다음 08:30 신호 갱신부터</p>
              )}
              {summary.capstone.samsung ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  삼성전자 ₩{summary.capstone.samsung.toLocaleString()}
                  {summary.capstone.r3Level ? (
                    <> · <b className="text-foreground/90">R3 ₩{summary.capstone.r3Level.toLocaleString()}</b> 회복 시 LONG
                      {' '}(<span className="tabular-nums">{pctTxt((summary.capstone.r3Level / summary.capstone.samsung - 1) * 100)}</span> 남음)</>
                  ) : ' · R3 회복 시 LONG 전환'}
                </p>
              ) : null}
              {summary.capstone.reliable === false ? (
                <p className="mt-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">⚠️ EOD 조회 실패 — 신호 신뢰 불가(fail-closed)</p>
              ) : null}
              <p className="mt-1.5 text-[10px] text-muted-foreground">🔴 방어 요인 발동 · 🟢 정상 · E는 발동=매수기회(과도폭락 반등)</p>
            </Card>
          ) : null}
          <Card title="📈 지수·FX" sub={live ? `라이브 ${hhmm(live.ts)}` : '수집 대기'}>
            {live?.indices?.length ? <ul>{live.indices.map(r => <WatchRow key={r.symbol} r={r} />)}</ul>
              : <p className="text-xs text-muted-foreground">장중 수집 전 (2시간 주기)</p>}
          </Card>
          <Card title="⭐ 대표 종목" sub={live ? `라이브 ${hhmm(live.ts)}` : '수집 대기'}>
            {live?.stocks?.length ? <ul>{live.stocks.map(r => <WatchRow key={r.symbol} r={r} />)}</ul>
              : <p className="text-xs text-muted-foreground">장중 수집 전 (2시간 주기)</p>}
          </Card>
        </aside>
      </div>

      {tab === 'backtest' ? <BacktestSubPanel backtest={backtest} /> : null}

      <p className="text-center text-[10px] text-muted-foreground">
        READ-ONLY 관찰 · 매매는 verify+HITL · 갱신: 신호·디깅=준실시간 / 라이브 시세=장중 30분(↻=즉시 재수집·3분 가드) / EOD·매력도=일 1회
        {recollecting ? ' · 🔄 라이브 재수집 중(~40초)' : ''}
      </p>
    </section>
  );
}
