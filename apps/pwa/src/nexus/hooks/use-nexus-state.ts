// PWA · Nexus state queries (Phase N-4 PR ξ)

'use client';

import { useQuery } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';
import type { NexusTabKind } from '../types';

export function useNexusHealth() {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.health(),
    queryFn: () => client.getHealth(),
  });
}

export function useNexusSnapshot() {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.snapshot(),
    queryFn: () => client.getNexus(),
  });
}

export function useNexusTabs(opts: { kind?: NexusTabKind } = {}) {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.tabs(opts.kind),
    queryFn: () => client.getTabs(opts),
  });
}

export function useNexusTab(id: string, opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.tab(id),
    queryFn: () => client.getTab(id),
    enabled: opts.enabled ?? id.length > 0,
  });
}
