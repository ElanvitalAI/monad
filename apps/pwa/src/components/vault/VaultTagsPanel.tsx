'use client';

// Vault 태그 네비게이션 (OP3c · 2026-07-09) — vault 전체 #tag 집계(count 순) → 클릭 시
// 그 태그로 전문검색. iPad 태그 뷰 이식. 백엔드 /v1/vault/tags.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { VaultApi, type VaultTag } from '@/lib/vault-api';

export function VaultTagsPanel({ onPickTag }: { onPickTag: (tag: string) => void }) {
  const { client } = useDaemon();
  const api = useMemo(() => new VaultApi(client), [client]);
  const [tags, setTags] = useState<VaultTag[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.tags(); setTags((r.tags ?? []).sort((a, b) => b.count - a.count)); }
    catch { /* */ } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const shown = filter ? tags.filter(t => t.tag.toLowerCase().includes(filter.toLowerCase())) : tags;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="태그 필터…" className="w-full rounded border border-border bg-background px-2 py-1 text-xs" />
      </div>
      <div className="flex-1 overflow-auto p-1">
        {loading ? <p className="p-2 text-xs text-muted-foreground">불러오는 중…</p> :
          shown.length === 0 ? <p className="p-2 text-xs text-muted-foreground">태그 없음</p> :
            <ul className="space-y-0.5">
              {shown.map((t) => (
                <li key={t.tag}>
                  <button onClick={() => onPickTag(t.tag)} className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-muted">
                    <span className="truncate">#{t.tag}</span>
                    <span className="ml-2 shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{t.count}</span>
                  </button>
                </li>
              ))}
            </ul>}
      </div>
    </div>
  );
}
