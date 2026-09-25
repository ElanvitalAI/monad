// PWA · Config + secrets hooks (Phase N-4 PR ξ)

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';

export function useNexusConfig() {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.config(),
    queryFn: () => client.getConfig(),
  });
}

export function useNexusSwitches() {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.switches(),
    queryFn: () => client.getSwitches(),
  });
}

export function useNexusSwitch(id: string, opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.switch(id),
    queryFn: () => client.getSwitch(id),
    enabled: opts.enabled ?? id.length > 0,
  });
}

export function usePutSwitch() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: unknown }) => client.putSwitch(id, { value }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: nexusKeys.switches() });
      qc.invalidateQueries({ queryKey: nexusKeys.switch(id) });
      qc.invalidateQueries({ queryKey: nexusKeys.config() });
    },
  });
}

export function useNexusSecrets() {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.secrets(),
    queryFn: () => client.getSecrets(),
  });
}

export function usePostSecret() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => client.postSecret({ id, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: nexusKeys.secrets() }),
  });
}

export function useDeleteSecret() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteSecret(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: nexusKeys.secrets() }),
  });
}
