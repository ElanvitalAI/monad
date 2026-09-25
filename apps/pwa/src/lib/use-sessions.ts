'use client';

/**
 * React hooks 가 sessions-service 를 wrap.
 *
 * sessions-service.ts 는 framework-agnostic 클래스 — react 가 없는 bun
 * 테스트 환경에서도 import 가능. 이 파일만 react / DaemonProvider 에
 * 의존.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import {
  getSessionsService,
  type SessionSummary,
} from './sessions-service';

/** Picker UI 가 mount 되었을 때 active poll 로 bump. picker 닫힘 시
 *  cleanup. list 가 변할 때마다 re-render. */
export function useSessions(
  opts: { activePoll?: boolean } = {},
): readonly SessionSummary[] {
  const { client } = useDaemon();
  const svc = getSessionsService(client);
  const subscribe = (cb: () => void): (() => void) => svc.subscribe(cb);
  const getSnapshot = (): readonly SessionSummary[] => svc.list();
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!opts.activePoll) return;
    return svc.enterActive();
  }, [svc, opts.activePoll]);

  return list;
}

/** picker 가 처음 열릴 때 force refresh 후 list 반환. */
export function useSessionsActive(): readonly SessionSummary[] {
  const { client } = useDaemon();
  const svc = getSessionsService(client);
  const list = useSessions({ activePoll: true });
  const [, setTick] = useState(0);
  useEffect(() => {
    void svc.forceRefresh().then(() => setTick((n) => n + 1));
  }, [svc]);
  return list;
}
