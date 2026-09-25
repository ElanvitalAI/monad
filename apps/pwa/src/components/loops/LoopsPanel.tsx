'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * 투자 루프 오케스트라 (2026-07-08) — 5개 자율 루프를 순환 링(원 노드) + 관계
 * 엣지로 표현. 원 클릭 -> 우측 활동 기록. active(최근 발화) 펄스 · armed 채움 ·
 * 가벼운 메모(마지막 활동·오늘 횟수). 백엔드 /v1/dashboard/loops(5루프+recent).
 * 순수 SVG(의존 없음·static export 안전).
 */

interface LoopActivity {
  at: string;
  status: string;
  detail?: string;
}
interface Loop {
  name: string;
  label: string;
  armed: boolean | null;
  today: number;
  byStatus: Record<string, number>;
  last: LoopActivity | null;
  category?: 'exec' | 'reflect';
  recent?: LoopActivity[];
}

// 시계방향 배치(dig 상단부터) — 백엔드 LOOP_EDGES 와 정합.
const ORDER = ['dig', 'backtest', 'trade', 'retro', 'replay'] as const;
const EDGES: Array<[string, string]> = [
  ['replay', 'dig'],
  ['dig', 'backtest'],
  ['backtest', 'trade'],
  ['trade', 'retro'],
  ['retro', 'replay'],
];

const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // 최근 1시간내 활동 = active(펄스)

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function isActive(loop: Loop): boolean {
  const ts = loop.last?.at ? Date.parse(loop.last.at) : NaN;
  return !Number.isNaN(ts) && Date.now() - ts < ACTIVE_WINDOW_MS;
}

// SVG 좌표 — 400x380 viewBox, 오각형 링.
const CX = 200;
const CY = 190;
const R = 128;
const NODE_R = 40;
function nodePos(idx: number): { x: number; y: number } {
  const angle = (-90 + idx * 72) * (Math.PI / 180);
  return { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
}

export function LoopsPanel() {
  const { client } = useDaemon();
  const [loops, setLoops] = useState<Loop[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await client.fetchJson<{ ok: boolean; loops: { loops: Loop[] } }>('/v1/dashboard/loops');
      setLoops(res.loops?.loops ?? []);
    } catch (err) {
      toast.error(`loops load failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const h = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(h);
  }, [refresh]);

  const byName = useMemo(() => {
    const m = new Map<string, Loop>();
    for (const l of loops) m.set(l.name, l);
    return m;
  }, [loops]);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    ORDER.forEach((n, i) => m.set(n, nodePos(i)));
    return m;
  }, []);

  const sel = selected ? byName.get(selected) ?? null : null;

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 p-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">투자 루프 오케스트라</h1>
          <p className="text-sm text-muted-foreground">
            5개 자율 루프의 순환(분석→백테→매매→회고→재생). 원 클릭 = 활동 기록 · 펄스 = 최근 활동 · 채움 = armed.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </Button>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* 5원 순환 그래프 */}
        <section className="min-w-0 flex-1">
          <svg viewBox="0 0 400 380" className="w-full" role="img" aria-label="loop orchestra graph">
            <defs>
              <marker id="loop-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/50" />
              </marker>
            </defs>
            {/* 엣지 — 노드 경계에서 시작/끝(반지름만큼 당김) */}
            {EDGES.map(([from, to]) => {
              const a = pos.get(from);
              const b = pos.get(to);
              if (!a || !b) return null;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              const x1 = a.x + ux * (NODE_R + 2);
              const y1 = a.y + uy * (NODE_R + 2);
              const x2 = b.x - ux * (NODE_R + 8);
              const y2 = b.y - uy * (NODE_R + 8);
              return (
                <line
                  key={`${from}-${to}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  className="stroke-muted-foreground/30"
                  strokeWidth={1.5}
                  markerEnd="url(#loop-arrow)"
                />
              );
            })}
            {/* 노드 */}
            {ORDER.map((name) => {
              const loop = byName.get(name);
              const p = pos.get(name)!;
              const active = loop ? isActive(loop) : false;
              const armed = loop?.armed === true;
              const isExec = loop?.category !== 'reflect';
              const isSel = selected === name;
              const ring = isExec ? 'stroke-sky-400' : 'stroke-violet-400';
              const fill = armed ? (isExec ? 'fill-sky-500/25' : 'fill-violet-500/25') : 'fill-card';
              return (
                <g
                  key={name}
                  className="cursor-pointer"
                  onClick={() => setSelected((cur) => (cur === name ? null : name))}
                >
                  {active && (
                    // active 펄스 — animate-ping(CSS transform:scale)은 SVG 에서
                    // transform-origin=(0,0) 이라 원이 좌상단 기준 확대돼 우하단으로
                    // 밀려나 보인다. SVG native <animate> 로 반지름만 키워 제자리 펄스.
                    <circle cx={p.x} cy={p.y} r={NODE_R} className={isExec ? 'fill-sky-400/20' : 'fill-violet-400/20'}>
                      <animate attributeName="r" values={`${NODE_R};${NODE_R + 12}`} dur="1.6s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.5;0" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={NODE_R}
                    className={`${fill} ${ring}`}
                    strokeWidth={isSel ? 3.5 : 1.8}
                  />
                  <text x={p.x} y={p.y - 4} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                    {loop?.label?.split('(')[0]?.trim() ?? name}
                  </text>
                  <text x={p.x} y={p.y + 10} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                    {loop ? `${fmtRelative(loop.last?.at)}` : '—'}
                  </text>
                  <text x={p.x} y={p.y + 21} textAnchor="middle" className="fill-muted-foreground/70 text-[8px]">
                    {loop ? `today ${loop.today}${active ? ' · active' : ''}` : ''}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="flex flex-wrap justify-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-sky-400" /> 실행축</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-violet-400" /> 사색축</span>
            <span>채움=armed · 펄스=최근 활동</span>
          </div>
        </section>

        {/* 활동 기록 패널 */}
        {sel && (
          <aside className="w-full shrink-0 space-y-3 rounded-2xl border border-border bg-card p-4 lg:w-[360px]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{sel.label}</h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                aria-label="close"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className={`rounded-full px-2 py-0.5 ring-1 ${sel.category === 'reflect' ? 'text-violet-300 ring-violet-500/30' : 'text-sky-300 ring-sky-500/30'}`}>
                {sel.category === 'reflect' ? '사색축' : '실행축'}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                armed {sel.armed === null ? '—' : sel.armed ? 'ON' : 'off'}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">today {sel.today}</span>
              {isActive(sel) && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300 ring-1 ring-emerald-500/30">active</span>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-sm font-semibold">활동 기록</div>
              {sel.recent && sel.recent.length > 0 ? (
                <div className="space-y-1.5">
                  {sel.recent.map((a, i) => (
                    <div key={`${a.at}-${i}`} className="rounded-lg bg-muted/40 px-3 py-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{a.status}</span>
                        <span className="text-muted-foreground" title={a.at}>{fmtRelative(a.at)}</span>
                      </div>
                      {a.detail && <div className="mt-0.5 truncate text-muted-foreground" title={a.detail}>{a.detail}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">활동 기록 없음.</div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
