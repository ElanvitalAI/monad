// PWA · Tab mutation hooks (Phase N-4 PR ξ)

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';
import type { CreateTabBody } from '../client';

function invalidateTabCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: nexusKeys.snapshot() });
  qc.invalidateQueries({ queryKey: nexusKeys.tabs() });
}

export function useCreateTab() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTabBody) => client.createTab(body),
    onSuccess: () => invalidateTabCaches(qc),
  });
}

export function useDeleteTab() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteTab(id),
    onSuccess: (_, id) => {
      invalidateTabCaches(qc);
      qc.removeQueries({ queryKey: nexusKeys.tab(id) });
    },
  });
}

export function usePatchTab() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { label?: string } }) => client.patchTab(id, body),
    onSuccess: (_, { id }) => {
      invalidateTabCaches(qc);
      qc.invalidateQueries({ queryKey: nexusKeys.tab(id) });
    },
  });
}

export function useStartTab() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.startTab(id),
    onSuccess: (_, id) => {
      invalidateTabCaches(qc);
      qc.invalidateQueries({ queryKey: nexusKeys.tab(id) });
    },
  });
}

export function useStopTab() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, graceMs }: { id: string; graceMs?: number }) => client.stopTab(id, graceMs !== undefined ? { graceMs } : undefined),
    onSuccess: (_, { id }) => {
      invalidateTabCaches(qc);
      qc.invalidateQueries({ queryKey: nexusKeys.tab(id) });
    },
  });
}

export function useRestartTab() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, graceMs }: { id: string; graceMs?: number }) => client.restartTab(id, graceMs !== undefined ? { graceMs } : undefined),
    onSuccess: (_, { id }) => {
      invalidateTabCaches(qc);
      qc.invalidateQueries({ queryKey: nexusKeys.tab(id) });
    },
  });
}
