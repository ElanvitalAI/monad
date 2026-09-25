// PWA · SSE event subscriber → cache invalidation (Phase N-4 PR ξ)

'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { invalidationsForEvent } from './query-keys';
import type { NexusEvent } from '../types';

export interface UseNexusEventsOpts {
  /** Topic prefixes (default ['tab.', 'nexus.', 'config.']). */
  topics?: string[];
  /** User-supplied callback fired for every event after invalidation. */
  onEvent?: (ev: NexusEvent) => void;
  /** Skip wiring (e.g., when nexus URL not yet known). */
  enabled?: boolean;
}

const DEFAULT_TOPICS = ['tab.', 'nexus.', 'config.'];

export function useNexusEvents(opts: UseNexusEventsOpts = {}) {
  const client = useNexusClient();
  const qc = useQueryClient();
  const enabled = opts.enabled ?? true;
  const topics = opts.topics ?? DEFAULT_TOPICS;

  useEffect(() => {
    if (!enabled) return;
    const off = client.subscribeEvents({
      topics,
      onEvent: (ev) => {
        for (const key of invalidationsForEvent(ev.kind)) {
          qc.invalidateQueries({ queryKey: key });
        }
        opts.onEvent?.(ev);
      },
      onError: () => { /* TODO: surface in UI · PR ο shows toast */ },
    });
    return off;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, qc, enabled, topics.join(',')]);
}
