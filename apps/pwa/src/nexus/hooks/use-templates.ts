// PWA · Templates hooks (Phase N-4 PR ξ)

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';
import type { SaveTemplateBody } from '../client';

export function useTemplates() {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.templates(),
    queryFn: () => client.getTemplates(),
  });
}

export function useTemplate(name: string, opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery({
    queryKey: nexusKeys.template(name),
    queryFn: () => client.getTemplate(name),
    enabled: opts.enabled ?? name.length > 0,
  });
}

export function useSaveTemplate() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveTemplateBody) => client.saveTemplate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: nexusKeys.templates() }),
  });
}
