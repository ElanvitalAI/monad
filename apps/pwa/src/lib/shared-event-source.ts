/** ⛔⭐⭐⭐⭐⭐ **같은 URL 의 SSE 를 «한 연결»로 접는다 — 19차 `[F]`.**
 *
 * ## 왜 이 파일이 있나 — 「관측이 조용히 죽는」 진짜 기전
 *
 * 📏 2026-08-22 라이브 실측(CDP Network). 채팅 탭 «한 장»이 데몬에 연 «안 끝나는» 연결:
 *
 * ```
 * /v1/showroom/layouts/events      ×2   ← 중복
 * /v1/workflows/events             ×2   ← 중복
 * /v1/chat/events?sessionId=…      ×1
 * /v1/events?topics=agent.status   ×1
 * /v1/events?topics=hud.segment    ×1
 * ────────────────────────────────────
 *                            합계   7
 * ```
 *
 * 🔑 ***브라우저의 HTTP/1.1 호스트당 동시 연결 한도는 «6» 이다.***
 * SSE 는 설계상 «끝나지 않으므로» 그 슬롯을 영구히 점유한다.
 * ⇒ 일곱 번째부터는 «큐에 서서 영영 안 나간다» — 그리고 그 줄에
 *   ***`POST /v1/debug-logs/batch`(관측 업로드)와 `/v1/mcp/resources`(위젯 데이터)가 같이 선다.***
 *
 * ⛔⭐⭐ **그리고 그것은 조용하다.** 채팅은 WebSocket 이라 «멀쩡히 돌고»,
 * 화면도 멀쩡하고, 콘솔도 조용하다. ***관측만 통째로 사라진다.***
 * 📏 실측: 그 상태에서 PWA 서피스 로그가 8분간 «0건»이었고,
 *   심지어 ***탭 리로드조차 못 했다***(문서 요청도 같은 큐에 선다).
 *
 * ## ⭐ 중복은 어디서 나오나
 *
 * `AppShell` 이 `SidebarNav` 를 **세 자리**에 마운트한다(모바일 드로어 · 컴팩트 레일 · 데스크톱).
 * CSS 로 숨겨도 ***React 는 마운트하고, 사본마다 자기 `EventSource` 를 연다.***
 * ⛔ 그래서 「화면에 하나만 보인다」가 「연결이 하나」를 뜻하지 않는다.
 *
 * ## 🔧 이 모듈이 하는 일
 *
 * URL 을 키로 **참조계수**한다 — 첫 구독자가 연결을 열고, 나머지는 «같은 연결»에 붙고,
 * 마지막 구독자가 떠날 때 닫는다. ⇒ ***사본이 몇 개든 연결은 하나.***
 * ⭐ 그리고 새 중복 구독자가 생겨도 «자동으로» 접힌다 — 목록을 고칠 필요가 없다.
 *
 * ⚠️ 이 모듈이 «안» 하는 것: 서로 «다른» URL 을 합치지 않는다
 *   (`?topics=a` 와 `?topics=b` 는 다른 연결이다 — 그것은 서버 축의 개선이다).
 */

/** 구독자가 붙일 것 — 이름 있는 이벤트와 `onerror`. 원래 호출부 모양을 그대로 받는다. */
export interface SharedSseHandlers {
  /** `es.addEventListener(name, fn)` 과 같다. */
  events?: Record<string, (ev: MessageEvent) => void>;
  /** 이름 없는 `message` 프레임. */
  onMessage?: (ev: MessageEvent) => void;
  onError?: (ev: Event) => void;
  /** ⭐ 연결 «생성»이 던졌을 때. 무인 리뷰 should-fix(PR #11378):
   *  *"기존 `showroom.sidebar.sse.construct-error` 로그가 사라졌다 — 공유 모듈이 삼키므로
   *  원인 진단성이 후퇴한다."* 🔑 ***관측을 지키려는 PR 이 관측을 하나 지웠다.*** */
  onConstructError?: (err: unknown) => void;
}

/** ⛔⭐⭐ 구독 «한 건»을 나타내는 기록. 무인 리뷰 must-fix(PR #11378):
 *  *"`SharedSseHandlers` 객체 identity 를 `Set` 으로 참조계수화한다 — 같은 handlers 객체로
 *  두 번 구독하면 첫 해제가 «아직 살아 있는» 두 번째까지 제거·close 한다."*
 *  🔑 그 지적이 옳다. ⇒ 세는 단위를 «핸들러»가 아니라 ***「구독 호출」***로 바꾼다. */
interface Subscription {
  handlers: SharedSseHandlers;
}

interface Entry {
  source: EventSource;
  subscribers: Set<Subscription>;
}

/** ⚠️ 모듈 사설 — URL 하나당 항목 하나. */
const entries = new Map<string, Entry>();

/** 시험이 EventSource 를 갈아 끼울 수 있게 열어 둔다(브라우저 밖에서도 돌게). */
type SourceFactory = (url: string) => EventSource;
let factory: SourceFactory | null = null;

/** ⛔ 시험 전용 — 팩토리를 갈고 «남은 연결을 전부 닫는다». */
export function _setEventSourceFactoryForTest(fn: SourceFactory | null): void {
  for (const entry of entries.values()) {
    try { entry.source.close(); } catch { /* ignore */ }
  }
  entries.clear();
  factory = fn;
}

/** 지금 «실제로 열려 있는» 연결 수 — ⭐ 세었으면 내보낼 수 있게 밖으로 낸다. */
export function openSharedEventSourceCount(): number {
  return entries.size;
}

/** 지금 열려 있는 URL 목록 — ⛔ 「몇 개」만으로는 어느 것이 넘쳤는지 못 고친다. */
export function openSharedEventSourceUrls(): string[] {
  return [...entries.keys()];
}

/**
 * 같은 `url` 을 여러 곳에서 구독해도 **연결은 하나**다.
 *
 * @returns 구독 해제 함수. 마지막 구독자가 해제하면 연결을 닫는다.
 *   ⭐ 연결 생성에 실패하면 «아무것도 안 하는» 해제 함수를 돌려준다
 *     (호출부가 `if (!url) return;` 과 같은 모양을 유지할 수 있게).
 */
export function subscribeSharedEventSource(
  url: string,
  handlers: SharedSseHandlers,
): () => void {
  let entry = entries.get(url);
  if (!entry) {
    let source: EventSource;
    try {
      source = factory ? factory(url) : new EventSource(url);
    } catch (err) {
      // ⛔ 생성 실패를 «조용히» 삼키지 않는다 — 호출부가 자기 관측을 남길 수 있게 알린다.
      handlers.onConstructError?.(err);
      return () => { /* no-op */ };
    }
    const created: Entry = { source, subscribers: new Set() };
    // ⛔⭐ 리스너는 «연결당 한 벌»만 단다. 구독자마다 달면 연결은 하나여도
    //   프레임마다 리스너가 N배로 늘어 「한 번 온 것」이 N번 처리된다.
    source.onmessage = (ev) => {
      for (const s of [...created.subscribers]) s.handlers.onMessage?.(ev);
    };
    source.onerror = (ev) => {
      // ⚠️ 네이티브 재시도에 맡긴다 — 여기서 close() 하면 «영구 단절»이 된다.
      for (const s of [...created.subscribers]) s.handlers.onError?.(ev);
    };
    entries.set(url, created);
    entry = created;
  }
  const entryRef = entry;

  // 이름 있는 이벤트는 «구독자마다» 단다 — 구독자별로 이름 집합이 다를 수 있고,
  // 해제할 때 그 구독자 것만 정확히 떼야 한다.
  const named: Array<[string, (ev: MessageEvent) => void]> = [];
  for (const [name, fn] of Object.entries(handlers.events ?? {})) {
    const wrapped = (ev: Event): void => { fn(ev as MessageEvent); };
    entryRef.source.addEventListener(name, wrapped);
    named.push([name, wrapped as (ev: MessageEvent) => void]);
  }
  // ⛔ «호출마다» 새 기록 — 같은 handlers 객체로 두 번 구독해도 둘로 센다(must-fix #11378).
  const subscription: Subscription = { handlers };
  entryRef.subscribers.add(subscription);

  let released = false;
  return () => {
    // ⛔ 두 번 불려도 참조계수를 두 번 깎지 않는다 — React 의 이중 해제에 대비.
    if (released) return;
    released = true;
    for (const [name, wrapped] of named) {
      try { entryRef.source.removeEventListener(name, wrapped as EventListener); } catch { /* ignore */ }
    }
    entryRef.subscribers.delete(subscription);
    if (entryRef.subscribers.size === 0) {
      try { entryRef.source.close(); } catch { /* ignore */ }
      // ⚠️ 그 사이 «같은 URL 로» 새 항목이 들어섰을 수 있다 — 내 것일 때만 지운다.
      if (entries.get(url) === entryRef) entries.delete(url);
    }
  };
}
