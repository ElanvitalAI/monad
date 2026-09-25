// ── 라이브 세션 이벤트 브릿지 (S3a · 2026-07-09) ──────────────────────────
//
// on-disk 세션 생성/갱신(onSessionCreated·onMessageAppended)을 /v1/events SSE 로
// 발행 → PWA /sessions 가 `topics=session.` 구독으로 즉시 리스트 갱신(polling 대체).
// session.updated 는 세션별 스로틀(턴 중 메시지 다발 → 이벤트 폭주 방지).
// 설계: 내부 문서 `DESIGN-live-session-management-2026-07-09` §S3.

import { onSessionCreated, onMessageAppended, type SessionMeta } from '../../session/index.js';
import type { NexusEventBus } from './event-bus.js';

const UPDATE_THROTTLE_MS = 2000;

/** 데몬 부팅에서 1회 호출 — 세션 리스너를 eventBus 로 브릿지. 해제 함수 반환. */
export function wireSessionStoreEvents(
  bus: Pick<NexusEventBus, 'publish'>,
  now: () => number = Date.now,
): () => void {
  const lastUpdate = new Map<string, number>();

  const offCreated = onSessionCreated((meta: SessionMeta) => {
    bus.publish({
      ts: now(),
      kind: 'session.created',
      detail: { sessionId: meta.id, source: meta.source, title: meta.title },
    });
  });

  const offAppended = onMessageAppended((id: string) => {
    const t = now();
    const last = lastUpdate.get(id);
    if (last !== undefined && t - last < UPDATE_THROTTLE_MS) return; // 세션별 스로틀(첫 갱신은 항상 발행)
    lastUpdate.set(id, t);
    bus.publish({ ts: t, kind: 'session.updated', detail: { sessionId: id } });
  });

  return () => { offCreated(); offAppended(); };
}
