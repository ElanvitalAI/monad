/**
 * network-record.ts — L2 ***네트워크 관측*** (관측 사다리 L2 · `RFC-advanced-clone-…-2026-09-10.md` §4)
 *
 * ⛔ 무엇을 답하나 — 「이 페이지가 ***무엇을 부르고 무엇이 돌아오나***」 하나뿐이다.
 *    「그것이 «규칙»이 무엇인가」(필수 필드·경계값)는 L4 의 몫이고 여기선 «모른다».
 *
 * ⭐⭐ ***재발명 0*** — CDP 는 이미 있다(`src/browser-cdp/client.ts`).
 *    이 자는 «이벤트를 모아 HAR 로 떨구는» 순수 로직이고, 브라우저를 «안 연다».
 *    ⇒ 그래서 브라우저 없이 시험할 수 있다(이벤트를 손으로 먹인다).
 *
 * ⛔⭐ HAR 1.2 로 떨군다 — «표준 형식»이라 바깥 도구(har-to-openapi 등)가 그 위에서 돈다.
 *    로드맵 Ⓒ 의 규율: ***기존 도구를 «먼저» 시험하고 우리 것은 그 뒤에.***
 */

/** ⛔ 이 자가 원리상 «못 보는» 것. 결과(HAR `_blindSpots`)에 «값으로» 실린다. */
export const NETWORK_BLIND_SPOTS: readonly string[] = [
  'before-enable: Network.enable «전»에 이미 나간 요청은 안 잡힌다 (탐색 «전»에 켜야 한다)',
  'scroll-triggered: 스크롤·클릭으로 «나중에» 나가는 요청은 그 행동을 해야 보인다 (L3 의 몫)',
  'worker-and-websocket: 서비스워커·웹워커·WebSocket 프레임은 이 도메인 이벤트로 안 잡힌다',
  'response-body-evicted: 본문은 «따로» 받아야 하고, 브라우저가 이미 버렸으면 못 받는다',
  'cross-origin-opaque: opaque 응답의 본문·헤더는 원리상 못 본다',
  'my-session-only: ⛔ 이것은 «내가 직접 연» 한 세션이다 — 남의 서버를 연타하지 않는다(L4 규칙 ③)',
];

export interface RecordedRequest {
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly resourceType: string | null;
  readonly requestHeaders: Record<string, string>;
  readonly postData: string | null;
  readonly startedAt: number;
  status: number | null;
  statusText: string;
  responseHeaders: Record<string, string>;
  mimeType: string | null;
  encodedDataLength: number | null;
  endedAt: number | null;
  /** ⛔ 「실패」와 「아직 안 끝났다」를 «가른다» */
  outcome: 'pending' | 'finished' | 'failed';
  failureReason: string | null;
  body: string | null;
  /** ⭐ L3 — 「어느 «행동» 뒤에 나온 호출인가」. 계약의 절반은 «순서»다.
   *  ⛔ 걸음을 안 나눴으면 `null` 이다 — 0 번 걸음이 «아니다». */
  step: { index: number; label: string } | null;
}

export interface CdpEventSource {
  on(method: string, listener: (params: Record<string, unknown>) => void): () => void;
}

/** 기록기가 «보는» 이벤트 넷. ⛔ 이 목록이 곧 이 자의 «시야»다. */
export const OBSERVED_EVENTS: readonly string[] = [
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFinished',
  'Network.loadingFailed',
];

export interface NetworkRecorder {
  /** 이벤트 구독을 «건다». 반환값을 부르면 «푼다». */
  attach(source: CdpEventSource): () => void;
  handle(method: string, params: Record<string, unknown>): void;
  /** ⭐ L3 — 여기서부터 나오는 요청을 이 «걸음»에 붙인다. 안 부르면 step 은 null 로 남는다. */
  beginStep(label: string): void;
  readonly entries: readonly RecordedRequest[];
  counts(): { total: number; pending: number; finished: number; failed: number; xhr: number };
  /** 걸음별 요약 — 「이 행동 뒤에 «무엇»이 왔나」 */
  byStep(): { index: number; label: string; total: number; xhr: number; urls: string[] }[];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function headers(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val;
  return out;
}

/** ⭐ XHR·fetch «만» 세는 자리 — 계약 추론의 본체가 그것이다(이미지·폰트는 아니다). */
export const API_RESOURCE_TYPES: readonly string[] = ['XHR', 'Fetch', 'EventSource'];

export function createNetworkRecorder(): NetworkRecorder {
  const byId = new Map<string, RecordedRequest>();
  let step: { index: number; label: string } | null = null;

  const handle = (method: string, params: Record<string, unknown>): void => {
    const requestId = str(params.requestId);
    if (!requestId) return;
    if (method === 'Network.requestWillBeSent') {
      const request = (params.request ?? {}) as Record<string, unknown>;
      // ⛔ 리다이렉트는 «같은 requestId» 로 다시 온다 — 덮어쓰면 첫 홉을 잃는다. 첫 것을 지킨다.
      if (byId.has(requestId)) return;
      byId.set(requestId, {
        requestId,
        url: str(request.url) ?? '',
        method: str(request.method) ?? 'GET',
        resourceType: str(params.type),
        requestHeaders: headers(request.headers),
        postData: str(request.postData),
        startedAt: num(params.timestamp) ?? 0,
        status: null,
        statusText: '',
        responseHeaders: {},
        mimeType: null,
        encodedDataLength: null,
        endedAt: null,
        outcome: 'pending',
        failureReason: null,
        body: null,
        step,
      });
      return;
    }
    const entry = byId.get(requestId);
    if (!entry) return; // ⛔ 시작을 못 본 응답 — 조용히 만들어 내지 않는다
    if (method === 'Network.responseReceived') {
      const response = (params.response ?? {}) as Record<string, unknown>;
      entry.status = num(response.status);
      entry.statusText = str(response.statusText) ?? '';
      entry.responseHeaders = headers(response.headers);
      entry.mimeType = str(response.mimeType);
      if (!entry.resourceType) (entry as { resourceType: string | null }).resourceType = str(params.type);
      return;
    }
    if (method === 'Network.loadingFinished') {
      entry.endedAt = num(params.timestamp);
      entry.encodedDataLength = num(params.encodedDataLength);
      entry.outcome = 'finished';
      return;
    }
    if (method === 'Network.loadingFailed') {
      entry.endedAt = num(params.timestamp);
      entry.outcome = 'failed';
      entry.failureReason = str(params.errorText) ?? 'unknown';
    }
  };

  return {
    handle,
    beginStep(label) {
      step = { index: (step?.index ?? -1) + 1, label };
    },
    byStep() {
      const groups = new Map<number, { index: number; label: string; total: number; xhr: number; urls: string[] }>();
      for (const entry of byId.values()) {
        if (!entry.step) continue;
        const g = groups.get(entry.step.index) ?? { index: entry.step.index, label: entry.step.label, total: 0, xhr: 0, urls: [] };
        g.total += 1;
        if (entry.resourceType !== null && API_RESOURCE_TYPES.includes(entry.resourceType)) {
          g.xhr += 1;
          g.urls.push(`${entry.method} ${entry.url}`);
        }
        groups.set(entry.step.index, g);
      }
      return [...groups.values()].sort((a, b) => a.index - b.index);
    },
    attach(source) {
      const offs = OBSERVED_EVENTS.map((event) => source.on(event, (params) => handle(event, params)));
      return () => { for (const off of offs) off(); };
    },
    get entries() {
      return [...byId.values()];
    },
    counts() {
      const list = [...byId.values()];
      return {
        total: list.length,
        pending: list.filter((e) => e.outcome === 'pending').length,
        finished: list.filter((e) => e.outcome === 'finished').length,
        failed: list.filter((e) => e.outcome === 'failed').length,
        xhr: list.filter((e) => e.resourceType !== null && API_RESOURCE_TYPES.includes(e.resourceType)).length,
      };
    },
  };
}

const headerList = (h: Record<string, string>) => Object.entries(h).map(([name, value]) => ({ name, value }));

/**
 * HAR 1.2 로 떨군다.
 * ⛔ 우리가 «못 잰» 값은 HAR 관례대로 `-1` 로 둔다 — 0 으로 쓰면 「없었다」로 읽힌다.
 */
export function toHar(entries: readonly RecordedRequest[], meta: { pageUrl: string; startedIso: string }): unknown {
  return {
    log: {
      version: '1.2',
      creator: { name: 'elanous-webclone-network-record', version: '1' },
      // ⛔ 표준 밖 필드는 `_` 접두로 — 파서가 무시하되 사람은 읽는다
      _blindSpots: NETWORK_BLIND_SPOTS,
      _observedEvents: OBSERVED_EVENTS,
      pages: [{ startedDateTime: meta.startedIso, id: 'page_1', title: meta.pageUrl, pageTimings: { onContentLoad: -1, onLoad: -1 } }],
      entries: entries.map((e) => ({
        pageref: 'page_1',
        startedDateTime: meta.startedIso,
        time: e.endedAt !== null ? Math.max(0, Math.round((e.endedAt - e.startedAt) * 1000)) : -1,
        _outcome: e.outcome,
        ...(e.failureReason ? { _failureReason: e.failureReason } : {}),
        request: {
          method: e.method,
          url: e.url,
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: headerList(e.requestHeaders),
          queryString: queryStringOf(e.url),
          ...(e.postData ? { postData: { mimeType: e.requestHeaders['content-type'] ?? 'application/octet-stream', text: e.postData } } : {}),
          headersSize: -1,
          bodySize: e.postData ? e.postData.length : -1,
        },
        response: {
          status: e.status ?? 0,
          statusText: e.statusText,
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: headerList(e.responseHeaders),
          content: {
            size: e.encodedDataLength ?? -1,
            mimeType: e.mimeType ?? '',
            ...(e.body !== null ? { text: e.body } : {}),
          },
          redirectURL: e.responseHeaders.location ?? '',
          headersSize: -1,
          bodySize: e.encodedDataLength ?? -1,
        },
        cache: {},
        timings: { send: -1, wait: -1, receive: -1 },
        _resourceType: e.resourceType,
        ...(e.step ? { _step: e.step } : {}),
      })),
    },
  };
}

export function queryStringOf(url: string): { name: string; value: string }[] {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}
