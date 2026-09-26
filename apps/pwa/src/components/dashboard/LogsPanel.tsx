'use client';

// ── Logs 대시보드 패널 (통합 로그 패브릭 LF4 · 2026-07-13) ──────────────────
//
// ELG 의 G(Grafana/Kibana 역) — logs.db 위의 관측면:
//   · SSE 라이브 tail(/v1/logs/stream) + pause("⏸ N new" — TUI log-pane UX 문법)
//   · 필터 칩: level / surface / component — /v1/logs/facets 실측에서 동적 생성
//     (하드코딩 목록 금지 — 디버그 페인 백로그의 registry 요구를 데이터로 해소)
//   · grep 검색 · 분당 count/에러 미니 히스토그램(inline SVG — 차트 라이브러리 무추가)
//   · 저장 쿼리(localStorage) · 행 펼침(data JSON) · sessionId → /sessions 교차
//
// canonical: 내부 문서 `FEATURE-unified-log-fabric-2026-07-13` §9-LF4.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { debugLog } from '@/lib/debug';

interface WireLog {
  id: number;
  ts: string;
  level: string;
  instance?: string;
  surface: string;
  category: string;
  event: string;
  sessionId?: string;
  data?: unknown;
}

interface Facets {
  surfaces: Array<{ surface: string; count: number }>;
  components: Array<{ component: string; count: number }>;
  levels: Array<{ level: string; count: number }>;
}

interface HistogramBucket { bucket: number; count: number; errors: number }

interface InstanceInfo {
  name: string;
  alive: boolean;
  dbExists: boolean;
  current: boolean;
}

const LEVEL_TONE: Record<string, string> = {
  critical: 'bg-rose-600/20 text-rose-300 ring-rose-600/40',
  error: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  info: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  debug: 'bg-muted text-muted-foreground ring-border',
  trace: 'bg-muted text-muted-foreground/60 ring-border',
};

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const BUFFER_CAP = 500;
const SAVED_KEY = 'elanous.pwa.logs.savedQueries';

interface QueryState {
  level: string;         // '' = 전체
  surfaces: string[];
  components: string[];
  grep: string;
}

const EMPTY_QUERY: QueryState = { level: '', surfaces: [], components: [], grep: '' };

function queryToParams(q: QueryState): Record<string, string> {
  const p: Record<string, string> = {};
  if (q.level) p.level = q.level;
  if (q.surfaces.length) p.surface = q.surfaces.join(',');
  if (q.components.length) p.category = q.components.join(',');
  if (q.grep.trim()) p.grep = q.grep.trim();
  return p;
}

function loadSaved(): Array<{ name: string; q: QueryState; stores: string[] }> {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map((item): { name: string; q: QueryState; stores: string[] } => {
      const rawStores: unknown[] = Array.isArray(item.stores) ? item.stores : typeof item.store === 'string' && item.store ? [item.store] : [];
      return {
        name: String(item.name ?? ''),
        q: item.q,
        stores: [...new Set(rawStores.filter((store): store is string => typeof store === 'string' && store.length > 0))],
      };
    }) : [];
  } catch { return []; }
}

/** 분당 히스토그램 — inline SVG(총 count 막대 + error 는 위에 붉은 스택). */
function Histogram({ buckets }: { buckets: HistogramBucket[] }) {
  if (buckets.length === 0) return <p className="text-xs text-muted-foreground">최근 1시간 데이터 없음.</p>;
  const W = 600; const H = 48;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const bw = Math.max(2, Math.floor(W / Math.max(buckets.length, 60)) - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full" preserveAspectRatio="none" role="img" aria-label="분당 로그 히스토그램">
      {buckets.map((b, i) => {
        const h = Math.max(1, Math.round((b.count / max) * (H - 2)));
        const eh = b.errors > 0 ? Math.max(1, Math.round((b.errors / max) * (H - 2))) : 0;
        const x = i * (bw + 1);
        return (
          <g key={b.bucket}>
            <rect x={x} y={H - h} width={bw} height={h} className="fill-primary/40" />
            {eh > 0 && <rect x={x} y={H - h} width={bw} height={eh} className="fill-rose-500" />}
            <title>{`${new Date(b.bucket).toLocaleTimeString()} · ${b.count}건 (error ${b.errors})`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full px-2.5 py-0.5 text-[11px] ring-1 transition-colors',
        active ? 'bg-primary/20 text-primary ring-primary/40' : 'bg-muted/40 text-muted-foreground ring-border hover:text-foreground',
      ].join(' ')}
    >
      {label}{count !== undefined && <span className="ml-1 opacity-60">{count}</span>}
    </button>
  );
}

function LogRow({ log, onSession }: { log: WireLog; onSession: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const t = log.ts.length >= 23 ? log.ts.slice(11, 23) : log.ts;
  return (
    <div className="border-b border-border/50 font-mono text-[12px] leading-5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 px-2 py-0.5 text-left hover:bg-muted/30">
        <span className="shrink-0 text-muted-foreground/70">{t}</span>
        <span className={`shrink-0 rounded px-1 text-[10px] ring-1 ${LEVEL_TONE[log.level] ?? LEVEL_TONE.debug}`}>{log.level.slice(0, 1).toUpperCase()}</span>
        {log.instance && <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] text-primary">{log.instance}</span>}
        <span className="shrink-0 rounded bg-muted px-1 text-[10px]">{log.surface}</span>
        <span className="shrink-0 text-muted-foreground">{log.category}</span>
        <span className="min-w-0 flex-1 truncate">{log.event}</span>
      </button>
      {open && (
        <div className="space-y-1 bg-muted/20 px-8 py-1.5 text-[11px]">
          {log.data !== undefined && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
              {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
            </pre>
          )}
          {log.sessionId && (
            <button type="button" onClick={() => onSession(log.sessionId!)} className="text-primary underline-offset-2 hover:underline">
              session {log.sessionId.slice(0, 8)}… → /sessions
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LogsPanel() {
  const { client } = useDaemon();
  const router = useRouter();
  const [query, setQuery] = useState<QueryState>(EMPTY_QUERY);
  // LF7-d — 연합 뷰: 어느 인스턴스의 스토어를 볼 것인가 ('' = 이 데몬 자신).
  // 서버가 레지스트리 기반으로 타 인스턴스 logs.db 를 read-only 조회.
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [storeNames, setStoreNames] = useState<string[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [buckets, setBuckets] = useState<HistogramBucket[]>([]);
  const [logs, setLogs] = useState<WireLog[]>([]);
  const [paused, setPaused] = useState(false);
  const [queued, setQueued] = useState<WireLog[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Array<{ name: string; q: QueryState; stores: string[] }>>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => { setSaved(loadSaved()); }, []);

  // 인스턴스 목록 (LF7-d) — 1회 + 60s 주기(테스트 데몬 기동/소멸 반영)
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const r = await client.fetchJson<{ ok: boolean; instances: InstanceInfo[] }>('/v1/logs/instances');
        if (alive) setInstances(r.instances ?? []);
      } catch { /* 구버전 데몬 — 셀렉터만 숨김 */ }
    };
    void load();
    const t = setInterval(() => { void load(); }, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [client]);

  const storeParams = useMemo<Array<[string, string]>>(() => storeNames.map((store) => ['store', store]), [storeNames]);
  const storeSuffix = useMemo(() => storeParams.map(([key, value]) => `&${key}=${encodeURIComponent(value)}`).join(''), [storeParams]);
  const streamStoreParam = useMemo<Record<string, string>>(() => {
    const p: Record<string, string> = {};
    if (storeNames.length === 1) p.store = storeNames[0];
    return p;
  }, [storeNames]);

  // 초기 적재 + 필터 변경 시 재조회 (과거분은 GET — SSE 는 이후분만)
  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const qs = new URLSearchParams([...Object.entries(queryToParams(query)), ...storeParams, ['limit', '200'], ['since', '2h']]).toString();
      const r = await client.fetchJson<{ ok: boolean; logs: WireLog[] }>(`/v1/logs?${qs}`);
      setLogs((r.logs ?? []).slice().reverse()); // 최근순 응답 → 시간순 표시
      setQueued([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [client, query, storeParams]);

  useEffect(() => { void refresh(); }, [refresh]);

  // facets + histogram — 30s 주기 (가벼운 집계)
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const f = await client.fetchJson<Facets & { ok: boolean }>(`/v1/logs/facets?since=6h${storeSuffix}`);
        if (alive) setFacets(f);
        const sp = query.surfaces.length ? `&surface=${query.surfaces.join(',')}` : '';
        const h = await client.fetchJson<{ ok: boolean; buckets: HistogramBucket[] }>(`/v1/logs/histogram?since=1h${sp}${storeSuffix}`);
        if (alive) setBuckets(h.buckets ?? []);
      } catch { /* 대시보드 집계는 fail-soft */ }
    };
    void load();
    const t = setInterval(() => { void load(); }, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [client, query.surfaces, storeSuffix]);

  // SSE 라이브 tail — 필터 변경 시 재연결(서버측 필터). 연합 조회는 SSE 미지원.
  useEffect(() => {
    if (typeof window === 'undefined' || storeNames.length > 1) return;
    const url = client.logsStreamUrl({ ...queryToParams(query), ...streamStoreParam });
    if (!url) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
      es.addEventListener('log', (ev) => {
        try {
          const rec = JSON.parse((ev as MessageEvent).data) as WireLog;
          if (pausedRef.current) {
            setQueued((prev) => [...prev, rec].slice(-BUFFER_CAP));
          } else {
            setLogs((prev) => [...prev, rec].slice(-BUFFER_CAP));
          }
        } catch { /* skip malformed */ }
      });
    } catch (e) {
      debugLog('pwa.logs.stream.error', { reason: String(e) });
    }
    return () => { es?.close(); };
  }, [client, query, streamStoreParam]);

  const resume = useCallback(() => {
    setPaused(false);
    setQueued((q) => {
      if (q.length) setLogs((prev) => [...prev, ...q].slice(-BUFFER_CAP));
      return [];
    });
  }, []);

  const toggle = (key: 'surfaces' | 'components', value: string): void => {
    setQuery((q) => {
      const set = new Set(q[key]);
      if (set.has(value)) set.delete(value); else set.add(value);
      return { ...q, [key]: [...set] };
    });
  };

  const saveQuery = (): void => {
    const name = window.prompt('저장할 쿼리 이름:');
    if (!name) return;
    const next = [...saved.filter((s) => s.name !== name), { name, q: query, stores: storeNames }];
    setSaved(next);
    try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [logs, paused]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Logs <span className="text-xs font-normal text-muted-foreground">전 서피스 실시간 (logs.db)</span></h2>
          {err && <p className="text-xs text-rose-400">{err} — 데몬이 LF1 이후 버전인지 확인</p>}
        </div>
        <div className="flex items-center gap-2">
          {instances.length > 1 && (
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              multiple
              value={storeNames}
              onChange={(e) => { setStoreNames([...new Set(Array.from(e.target.selectedOptions, (option) => option.value).filter(Boolean))]); setLogs([]); setQueued([]); }}
              title="로그 인스턴스 — 다른 엘라누스의 스토어를 read-only 연합 조회 (LF7-d)"
            >
              {instances.filter((i) => !i.current).map((i) => (
                <option key={i.name} value={i.name} disabled={!i.dbExists}>
                  {i.name}{i.alive ? '' : ' (정지)'}
                </option>
              ))}
            </select>
          )}
          {saved.length > 0 && (
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value=""
              onChange={(e) => {
                const s = saved.find((x) => x.name === e.target.value);
                if (s) setQuery(s.q);
                if (s) setStoreNames(s.stores);
              }}
            >
              <option value="">저장 쿼리…</option>
              {saved.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
          <Button size="sm" variant="outline" onClick={saveQuery}>쿼리 저장</Button>
          <Button size="sm" variant={paused ? 'default' : 'outline'} onClick={() => (paused ? resume() : setPaused(true))}>
            {paused ? `▶ 재개${queued.length ? ` (+${queued.length})` : ''}` : '⏸ 일시정지'}
          </Button>
        </div>
      </div>

      {/* 히스토그램 — 최근 1h 분당 count(회색)·error(빨강) */}
      <div className="rounded-lg border border-border bg-card/50 p-2">
        <Histogram buckets={buckets} />
      </div>

      {/* 필터 칩 — facets 실측에서 동적 */}
      <div className="space-y-1.5 rounded-lg border border-border bg-card/50 p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground w-16">level ≥</span>
          {LEVELS.map((l) => (
            <Chip key={l} active={query.level === l} label={l} onClick={() => setQuery((q) => ({ ...q, level: q.level === l ? '' : l }))} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground w-16">surface</span>
          {(facets?.surfaces ?? []).map((s) => (
            <Chip key={s.surface} active={query.surfaces.includes(s.surface)} label={s.surface} count={s.count} onClick={() => toggle('surfaces', s.surface)} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground w-16">component</span>
          {(facets?.components ?? []).slice(0, 16).map((c) => (
            <Chip key={c.component} active={query.components.includes(c.component)} label={c.component} count={c.count} onClick={() => toggle('components', c.component)} />
          ))}
        </div>
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-muted-foreground w-16">grep</span>
          <input
            value={query.grep}
            onChange={(e) => setQuery((q) => ({ ...q, grep: e.target.value }))}
            placeholder="event/data/category 부분 일치…"
            className="w-72 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/50"
          />
          {(query.level || query.surfaces.length > 0 || query.components.length > 0 || query.grep) && (
            <Button size="sm" variant="ghost" onClick={() => setQuery(EMPTY_QUERY)}>필터 초기화</Button>
          )}
        </div>
      </div>

      {/* 로그 리스트 — 시간순·auto-scroll(pause 시 고정) */}
      <div className="h-[52vh] overflow-y-auto rounded-lg border border-border bg-card/50">
        {logs.length === 0
          ? <p className="p-4 text-sm text-muted-foreground">일치하는 로그 없음.</p>
          : logs.map((l) => <LogRow key={`${l.instance ?? 'unknown'}:${l.id}`} log={l} onSession={() => router.push('/sessions')} />)}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
