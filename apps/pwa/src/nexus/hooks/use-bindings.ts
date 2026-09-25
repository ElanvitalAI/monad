// PWA · Subsystem binding hooks (PR τ consumer · Phase N-4 PR ξ)

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';

export function useBindingChannels() {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.bindingChannels(),
    queryFn: async () => {
      // Reuse the generic fetch via getNexus client? subscribers want a
      // dedicated method · PR ν 의 client 에는 bindings 가 빠짐. 임시로
      // direct fetch 사용 — PR ξ.+ 에서 client 에 추가.
      const res = await fetch(`${client.baseUrl}/v1/registry/bindings`);
      if (!res.ok) throw new Error(`bindings list ${res.status}`);
      return (await res.json()) as { channels: { channel: string; description?: string; bindingCount: number }[] };
    },
  });
}

export function useBindings(channel: string, opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.bindings(channel),
    queryFn: async () => {
      const res = await fetch(`${client.baseUrl}/v1/registry/bindings?channel=${encodeURIComponent(channel)}`);
      if (!res.ok) throw new Error(`bindings ${res.status}`);
      return (await res.json()) as { channel: string; bindings: { key: string; sessionId?: string; label?: string; meta?: Record<string, unknown>; updatedAt: string }[] };
    },
    enabled: opts.enabled ?? channel.length > 0,
  });
}

interface UpsertBody { sessionId?: string; label?: string; meta?: Record<string, unknown>; mergeMeta?: boolean; channelDescription?: string }

export function useUpsertBinding() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ channel, key, body, method = 'POST' }: { channel: string; key: string; body: UpsertBody; method?: 'POST' | 'PATCH' }) => {
      const res = await fetch(`${client.baseUrl}/v1/registry/bindings/${encodeURIComponent(channel)}/${encodeURIComponent(key)}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`binding upsert ${res.status}`);
      return (await res.json()) as { binding: unknown; outcome: 'created' | 'updated' };
    },
    onSuccess: (_, { channel }) => {
      qc.invalidateQueries({ queryKey: nexusKeys.bindings(channel) });
      qc.invalidateQueries({ queryKey: nexusKeys.bindingChannels() });
    },
  });
}

export function useDeleteBinding() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ channel, key }: { channel: string; key: string }) => {
      const res = await fetch(`${client.baseUrl}/v1/registry/bindings/${encodeURIComponent(channel)}/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`binding delete ${res.status}`);
      return (await res.json()) as { deleted: true; channel: string; key: string };
    },
    onSuccess: (_, { channel }) => {
      qc.invalidateQueries({ queryKey: nexusKeys.bindings(channel) });
      qc.invalidateQueries({ queryKey: nexusKeys.bindingChannels() });
    },
  });
}
