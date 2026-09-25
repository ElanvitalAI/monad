/**
 * SessionsService — on-disk 세션 스토어(`/v1/sessions/store`) 폴링 + SSE + 캐시.
 *
 * cross-device picker (PR #4.5) 의 데이터 source. PWA 파리티 P1(2026-07-12):
 * 구 in-memory `GET /v1/sessions` 소비를 제거하고 `SessionsStoreApi` 에
 * 위임 — 채팅 picker 와 `/sessions` 페이지가 같은 on-disk 진실원을 본다
 * (텔레그램/CLI 세션 누락 해소). 폴링은 두 cadence:
 *  - **active** (10s) — picker 가 mount 되어있을 때
 *  - **idle** (60s) — picker 닫혀있어도 워크스페이스 strip 의 chat 라벨
 *    update 위해 background poll
 * 여기에 라이브 세션 SSE(S3a · `session.created/updated`)를 얹어 생성/갱신
 * 시 <1s 반영 — 폴링은 SSE 불가 환경 폴백.
 *
 * subscribe / forceRefresh 가 모두 in-flight 폴링을 dedupe — 두 picker
 * 가 동시에 force 해도 한 번만 fetch.
 */

import { DaemonClient } from './daemon-client';
import { SessionsStoreApi, type SessionStoreCard } from './sessions-store-api';
import { debugLog } from './debug';

export type SessionOrigin = 'cli' | 'pwa' | 'tg' | 'dc';

export interface SessionSummary {
  id: string;
  msgCount: number;
  lastTurnAt: string;
  lastMsgPreview?: string;
  origin?: SessionOrigin;
}

export interface SessionsServiceOpts {
  /** Active poll cadence (ms). Default 10s. */
  activeIntervalMs?: number;
  /** Idle poll cadence (ms). Default 60s. */
  idleIntervalMs?: number;
}

const DEFAULT_ACTIVE_MS = 10_000;
const DEFAULT_IDLE_MS = 60_000;
/** SSE 다발 이벤트 coalesce — 턴 중 메시지 연속 append 시 refresh 폭주 방지. */
const SSE_DEBOUNCE_MS = 500;

const KNOWN_ORIGINS: ReadonlySet<string> = new Set(['cli', 'pwa', 'tg', 'dc']);

/** SessionStoreCard → picker 용 SessionSummary. origin 이 없으면 coarse
 *  source(cli/telegram)에서 유도 — 구세대 세션도 뱃지가 비지 않게. */
export function cardToSummary(card: SessionStoreCard): SessionSummary {
  let origin: SessionOrigin | undefined;
  if (card.origin && KNOWN_ORIGINS.has(card.origin)) {
    origin = card.origin as SessionOrigin;
  } else if (card.source === 'telegram') {
    origin = 'tg';
  } else if (card.source === 'cli') {
    origin = 'cli';
  }
  const preview = (card.preview ?? '').trim();
  return {
    id: card.id,
    msgCount: card.messageCount,
    lastTurnAt: card.updatedAt,
    ...(preview ? { lastMsgPreview: preview } : {}),
    ...(origin ? { origin } : {}),
  };
}

export class SessionsService {
  private readonly api: SessionsStoreApi;
  private cache: SessionSummary[] = [];
  private listeners = new Set<() => void>();
  /** Reference count of subscribers requesting "active" polling
   *  (e.g. picker mount). 0 = idle. */
  private activeCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Current poll interval — track so we can compare on cadence change. */
  private currentIntervalMs: number | null = null;
  /** In-flight fetch promise so concurrent callers dedupe. */
  private inFlight: Promise<void> | null = null;
  private es: EventSource | null = null;
  private sseDebounce: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly client: DaemonClient,
    private readonly opts: Required<SessionsServiceOpts> = {
      activeIntervalMs: DEFAULT_ACTIVE_MS,
      idleIntervalMs: DEFAULT_IDLE_MS,
    },
  ) {
    this.api = new SessionsStoreApi(client);
  }

  /** Read-only snapshot of the latest fetched list. May be stale —
   *  subscribers should re-render on subscribe callback rather than
   *  polling list() themselves. */
  list(): readonly SessionSummary[] {
    return this.cache;
  }

  /** Begin background polling at the configured idle cadence + SSE
   *  push 채널. Multiple starts are idempotent.
   *
   *  SSG note (Next 15 `output: 'export'`): the build-time prerender
   *  pass runs hooks in Node where `window` is undefined AND the
   *  DaemonClient's `baseUrl` is empty (no origin to inject yet). A
   *  fetch on a relative URL then fails in Node's fetch with
   *  `TypeError: Failed to parse URL`. Skip polling during SSG
   *  entirely; the client-side first render (in `getSessionsService`)
   *  sees `typeof window === 'object'` and goes through the normal
   *  start path. */
  start(): void {
    if (this.disposed) return;
    if (this.timer) return;
    if (typeof window === 'undefined') return;
    this.scheduleTimer();
    this.openEventStream();
    // Kick a refresh immediately so the first subscriber doesn't wait
    // an interval before seeing data.
    void this.forceRefresh();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.currentIntervalMs = null;
    }
    this.closeEventStream();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
  }

  /** Bump active-poll cadence while a picker is mounted. Returns a
   *  release function (idempotent). */
  enterActive(): () => void {
    this.activeCount += 1;
    this.scheduleTimer();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.scheduleTimer();
    };
  }

  /** Subscribe to cache mutations. Returns unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Force an immediate fetch. Concurrent calls dedupe to a single
   *  in-flight request. */
  forceRefresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const p = this.fetchAndStore().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = p;
    return p;
  }

  /** DELETE /v1/sessions/store/:id then refresh. on-disk 영구 삭제 —
   *  서버가 in-flight abort + in-memory forget 을 동반하므로 picker 와
   *  `/sessions` 페이지 삭제 의미론이 일치한다. */
  async forget(sessionId: string): Promise<void> {
    debugLog('webterm.sessions.forget', { sessionId });
    await this.api.delete(sessionId);
    await this.forceRefresh();
  }

  // --- internals ----------------------------------------------------

  private scheduleTimer(): void {
    if (this.disposed) return;
    const desired = this.activeCount > 0
      ? this.opts.activeIntervalMs
      : this.opts.idleIntervalMs;
    if (this.currentIntervalMs === desired && this.timer) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.currentIntervalMs = desired;
    this.timer = setInterval(() => {
      void this.forceRefresh();
    }, desired);
  }

  /** 라이브 세션 SSE(S3a) — session.created/updated 를 coalesce 해 silent
   *  refresh. 실패/미지원이면 조용히 폴링만으로 동작(폴백). */
  private openEventStream(): void {
    if (this.es || this.disposed) return;
    if (typeof EventSource === 'undefined') return;
    const url = this.client.sessionStoreEventsUrl();
    if (!url) return;
    try {
      const es = new EventSource(url);
      const onSession = (): void => {
        if (this.sseDebounce) clearTimeout(this.sseDebounce);
        this.sseDebounce = setTimeout(() => {
          void this.forceRefresh();
        }, SSE_DEBOUNCE_MS);
      };
      es.addEventListener('session.created', onSession);
      es.addEventListener('session.updated', onSession);
      // 서버가 event 명 없이 보내면 onmessage 로도 수신.
      es.onmessage = onSession;
      this.es = es;
    } catch {
      this.es = null;
    }
  }

  private closeEventStream(): void {
    if (this.sseDebounce) {
      clearTimeout(this.sseDebounce);
      this.sseDebounce = null;
    }
    this.es?.close();
    this.es = null;
  }

  private async fetchAndStore(): Promise<void> {
    try {
      const body = await this.api.list();
      const cards = Array.isArray(body?.sessions) ? body.sessions : [];
      const next = cards.map(cardToSummary);
      // Skip notify when shape is identical (cheap stringify check —
      // list 가 작아 cost 무시할 만함). 빈번한 idle poll 시 React
      // re-render 폭발 방지.
      if (sameShape(this.cache, next)) return;
      this.cache = next;
      for (const fn of this.listeners) {
        try { fn(); } catch { /* listener must not break poll loop */ }
      }
    } catch (err) {
      debugLog('webterm.sessions.fetch.error', { err: String(err) });
      // 네트워크 오류 시 cache 유지 — picker 가 stale 데이터로 fallback.
    }
  }
}

function sameShape(a: SessionSummary[], b: SessionSummary[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.msgCount !== y.msgCount ||
      x.lastTurnAt !== y.lastTurnAt ||
      x.lastMsgPreview !== y.lastMsgPreview ||
      x.origin !== y.origin
    ) {
      return false;
    }
  }
  return true;
}

/** SessionsService singleton — 한 PWA 인스턴스에서 다중 picker 가 같은
 *  cache 를 공유하도록 한다. DaemonClient 가 reconfig 되면 재생성.
 *
 *  React hook (`useSessions` · `useSessionsActive`) 는 별도 파일
 *  `apps/pwa/src/lib/use-sessions.ts` 에서 이 함수를 호출. SessionsService
 *  자체는 framework-agnostic (Bun 테스트에서 react 없이 import 가능). */
let singleton: { client: DaemonClient; svc: SessionsService } | null = null;

export function getSessionsService(client: DaemonClient): SessionsService {
  if (singleton && singleton.client === client) return singleton.svc;
  if (singleton) singleton.svc.dispose();
  const svc = new SessionsService(client);
  // Skip caching the singleton during SSG — when the client side
  // hydrates with a real DaemonClient (window.location.origin baseUrl)
  // we want `getSessionsService` to rebuild the service so its
  // `start()` actually kicks off polling. If we cached an SSG-built
  // svc the client would receive a no-op singleton on hydrate.
  if (typeof window !== 'undefined') {
    singleton = { client, svc };
  }
  svc.start();
  return svc;
}

export function _resetSessionsServiceSingletonForTest(): void {
  if (singleton) singleton.svc.dispose();
  singleton = null;
}
