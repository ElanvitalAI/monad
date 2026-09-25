'use client';

import { useEffect, useState } from 'react';
import { ACTIVITY_POLL_MS, type ShellActivitySnapshot } from './activity-snapshot';
import { fetchActivitySnapshot, type ActivityFetchDeps } from './fetch-activity-snapshot';

export function startActivityPolling(
  setSnapshot: (snapshot: ShellActivitySnapshot) => void,
  deps: ActivityFetchDeps = {},
  pollMs: number = ACTIVITY_POLL_MS,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    const next = await fetchActivitySnapshot(deps);
    if (cancelled) return;
    setSnapshot(next);
    timer = setTimeout(() => {
      void tick();
    }, pollMs);
  };

  void tick();
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

export function useShellActivity(
  deps: ActivityFetchDeps = {},
  pollMs: number = ACTIVITY_POLL_MS,
): ShellActivitySnapshot {
  const [snapshot, setSnapshot] = useState<ShellActivitySnapshot>({ kind: 'loading' });

  useEffect(
    () => startActivityPolling(setSnapshot, deps, pollMs),
    [deps.fetchImpl, deps.listProgressFrames, pollMs],
  );

  return snapshot;
}
