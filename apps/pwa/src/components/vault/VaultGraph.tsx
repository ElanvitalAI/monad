'use client';

// Vault 그래프 뷰 (OP4 · 2026-07-09) — 노트(노드) + wikilink(엣지) SVG 시각화.
// iPad Cytoscape 그래프 이식(경량 SVG force·무 dep). 백엔드 /v1/vault/graph.
// 노드 클릭→노트 열기. focus 모드(1-hop 로컬 그래프).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { VaultApi, type GraphResult } from '@/lib/vault-api';
import { layoutForce } from '@/lib/vault-helpers';

const W = 900, H = 640;

export function VaultGraph({ onOpen }: { onOpen?: (basename: string) => void }) {
  const { client } = useDaemon();
  const api = useMemo(() => new VaultApi(client), [client]);
  const [graph, setGraph] = useState<GraphResult | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f: string | null) => {
    setLoading(true);
    try { setGraph(await api.graph(f ?? undefined, 1, f ? 60 : 400)); } catch { /* */ } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(focus); }, [load, focus]);

  const positioned = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] as Array<{ source: string; target: string }> };
    const ids = graph.nodes.map(n => n.id);
    // 백엔드 edge는 {from,to} → layoutForce/렌더는 {source,target}.
    const edges = graph.edges.map(e => ({ source: e.from, target: e.to }));
    const nodes = layoutForce(ids, edges, { width: W, height: H, iterations: 140 });
    return { nodes, edges };
  }, [graph]);

  const posOf = useMemo(() => new Map(positioned.nodes.map(n => [n.id, n])), [positioned]);
  const maxDeg = Math.max(1, ...positioned.nodes.map(n => n.deg));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span className="font-medium">노트 그래프</span>
        {focus ? (
          <>
            <span className="text-xs text-muted-foreground">focus: {focus} (1-hop)</span>
            <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" onClick={() => setFocus(null)}>전체 그래프</Button>
          </>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">{graph?.nodes.length ?? 0} 노드 · {graph?.edges.length ?? 0} 링크{graph?.truncated ? ' (일부)' : ''}</span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-2">
        {loading ? <p className="p-4 text-sm text-muted-foreground">그래프 계산 중…</p> :
          !graph || graph.nodes.length === 0 ? <p className="p-4 text-sm text-muted-foreground">그래프가 비어있습니다.</p> : (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" style={{ maxHeight: '78vh' }}>
              {positioned.edges.map((e, i) => {
                const a = posOf.get(e.source), b = posOf.get(e.target);
                if (!a || !b) return null;
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" className="text-border" strokeWidth={0.6} opacity={0.5} />;
              })}
              {positioned.nodes.map((n) => {
                const r = 3 + (n.deg / maxDeg) * 9;
                return (
                  <g key={n.id} className="cursor-pointer" onClick={() => onOpen?.(n.id)} onDoubleClick={() => setFocus(n.id)}>
                    <circle cx={n.x} cy={n.y} r={r} className="fill-primary/70 hover:fill-primary" />
                    {(n.deg >= maxDeg * 0.3 || focus) && <text x={n.x + r + 2} y={n.y + 3} className="fill-foreground/70 text-[9px]">{n.id.split('/').pop()}</text>}
                  </g>
                );
              })}
            </svg>
          )}
      </div>
      <p className="border-t border-border px-3 py-1 text-[11px] text-muted-foreground">클릭=노트 열기 · 더블클릭=로컬 그래프(focus)</p>
    </div>
  );
}
