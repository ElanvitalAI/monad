'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { toast } from 'sonner';

/**
 * elanous(elanous-builtin) backend 의 LLM provider 스위처 (2026-07-08).
 * 대표 요청: elanous 선택 시 어떤 LLM provider(claude·grok 등)로 답할지. 왼쪽 backend
 * 칩처럼 **클릭할 때마다 "가능한(설정된)" provider 로 순환**. 미설정(apiKey 없는
 * apiKey-flow) provider 는 아예 숨김. Settings 의 provider 설정을 재사용
 * (/v1/setup/llm-providers · routing 설정). apiKey 재입력 불필요(저장 key 재사용).
 */
interface ProviderWire {
  provider: string;
  label: string;
  flow: string;
  hasSavedKey: boolean;
}

export function ElanousProviderChip() {
  const { client } = useDaemon();
  const [providers, setProviders] = useState<ProviderWire[]>([]);
  const [active, setActive] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await client.fetchJson<{ providers: ProviderWire[]; activeProvider: string }>('/v1/setup/llm-providers');
      setProviders(res.providers ?? []);
      setActive(res.activeProvider ?? '');
    } catch {
      /* soft */
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  // "가능한" provider 만 — apiKey flow 는 저장 key 있는 것 + auto. codex/local(PWA
  // 미지원)·미설정 apiKey 는 제외 → 클릭 순환 대상에서 안 보임.
  const selectable = providers.filter((p) => (p.flow === 'apiKey' && p.hasSavedKey) || p.flow === 'auto');

  const cycle = useCallback(async () => {
    if (busy || selectable.length === 0) return;
    const idx = selectable.findIndex((p) => p.provider === active);
    const next = selectable[(idx + 1) % selectable.length]!;
    if (next.provider === active && selectable.length === 1) return; // 하나뿐이면 전환 불필요
    setBusy(true);
    try {
      const res = await client.fetchJson<{ ok?: boolean; error?: string; active?: { provider: string } }>(
        '/v1/setup/llm-provider',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: next.provider }) },
      );
      if (res && res.error) {
        toast.error(`provider 전환 실패: ${res.error}`);
      } else {
        // 전환 성공은 칩 라벨 변화로 즉시 보이므로 별도 팝업(toast) 없음(대표 요청).
        setActive(res?.active?.provider ?? next.provider);
      }
    } catch (err) {
      toast.error(`provider 전환 실패: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, selectable, active, client]);

  // 가능한 provider 가 없으면 칩 자체를 숨김.
  if (selectable.length === 0) return null;

  // active 는 전체 providers 에서 찾는다 — codex 처럼 순환 대상(selectable)이 아닌
  // provider 가 현재 active 여도 라벨을 정확히 표시(이전엔 selectable[0] 오표시).
  const activeLabel = providers.find((p) => p.provider === active)?.label ?? active ?? selectable[0]!.label;

  return (
    <button
      type="button"
      onClick={() => void cycle()}
      disabled={busy || selectable.length < 2}
      className="rounded-full border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
      title={selectable.length < 2 ? `LLM provider: ${activeLabel}` : `클릭하면 다음 provider 로 순환 (현재 ${activeLabel})`}
    >
      {activeLabel}
    </button>
  );
}
