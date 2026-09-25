// PWA · BACKLOG #2 — platform connection summary hook.
//
// Wraps GET /v1/platforms. Long refetch interval (30s) — connection
// state rarely flips during a single Settings session, and the user
// is the actor who flips it (so they'll Cmd+R or trigger a manual
// refetch via the existing query invalidation paths).

'use client';

import { useQuery } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';
import type { PlatformEntry } from '../client';

export function usePlatforms() {
  const client = useNexusClient();
  return useQuery<{ platforms: PlatformEntry[] }>({
    queryKey: nexusKeys.platforms(),
    queryFn: () => client.getPlatforms(),
    refetchInterval: 30_000,
  });
}
