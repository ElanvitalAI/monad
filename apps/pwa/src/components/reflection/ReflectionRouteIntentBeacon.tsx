'use client';

// β (BACKLOG-pwa-mobile-readiness §6.1 #6 metric · 2026-05-12) —
// `/reflection` route mount beacon.
//
// DailyReflectionPanel 자체는 server-render OK 한 panel. 사용자 진입
// 신호 (navigation · push tap follow-through vs manual nav) 를 mount-once
// 으로 emit 한다. ReferralSource 는 `document.referrer` + `?from=push`
// 쿼리로 best-effort 추정 (push notification URL 에 `?from=push` 가
// 들어있을 때만 정확).
//
// MANUAL §1 navigation layer · §3 컨벤션 `pwa.navigation.<verb>`.

import { useEffect } from 'react';
import { userIntentLogger } from '@/lib/user-intent-logger';

export function ReflectionRouteIntentBeacon(): null {
  useEffect(() => {
    const source = resolveSource();
    void userIntentLogger.emit({
      surface: 'pwa',
      intent: {
        layer: 'navigation',
        kind: 'pwa.navigation.reflection_opened',
        target: { kind: 'route', id: '/reflection', label: 'Reflection' },
        value: { source },
      },
      surface_state: { route: '/reflection' },
    });
  }, []);
  return null;
}

function resolveSource(): 'push' | 'manual' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('from') === 'push') return 'push';
    const referrer = document.referrer || '';
    if (referrer && referrer.startsWith(window.location.origin)) return 'manual';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
