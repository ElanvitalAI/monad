/**
 * network-record.test.ts — L2 기록기가 «무엇을 세고 무엇을 안 세나».
 *
 * ⭐ 브라우저를 «안 연다» — CDP 이벤트를 손으로 먹인다. 그래서 결정적이고 빠르다.
 *   ⚠️ 그 대신 「이 코드가 실행 경로에 있나」는 «못 답한다» — 그건 실물 실행의 몫이다.
 */
import { describe, expect, test } from 'bun:test';

import {
  API_RESOURCE_TYPES,
  createNetworkRecorder,
  NETWORK_BLIND_SPOTS,
  OBSERVED_EVENTS,
  queryStringOf,
  toHar,
} from './network-record.js';

const willBeSent = (requestId: string, url: string, extra: Record<string, unknown> = {}) => ({
  requestId,
  timestamp: 100,
  type: 'XHR',
  request: { url, method: 'GET', headers: { accept: 'application/json' } },
  ...extra,
});

function feed(recorder: ReturnType<typeof createNetworkRecorder>, events: [string, Record<string, unknown>][]) {
  for (const [method, params] of events) recorder.handle(method, params);
}

describe('요청 하나의 «일생»', () => {
  test('시작 → 응답 → 완료 를 «한 항목»으로 잇는다', () => {
    const r = createNetworkRecorder();
    feed(r, [
      ['Network.requestWillBeSent', willBeSent('1', 'https://x.test/api/items?page=2')],
      ['Network.responseReceived', { requestId: '1', response: { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, mimeType: 'application/json' } }],
      ['Network.loadingFinished', { requestId: '1', timestamp: 100.25, encodedDataLength: 512 }],
    ]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ url: 'https://x.test/api/items?page=2', status: 200, outcome: 'finished', encodedDataLength: 512 });
  });

  test('⛔ 「실패」와 「아직 안 끝났다」를 «가른다»', () => {
    const r = createNetworkRecorder();
    feed(r, [
      ['Network.requestWillBeSent', willBeSent('1', 'https://x.test/a')],
      ['Network.requestWillBeSent', willBeSent('2', 'https://x.test/b')],
      ['Network.loadingFailed', { requestId: '2', timestamp: 101, errorText: 'net::ERR_BLOCKED_BY_CLIENT' }],
    ]);
    const counts = r.counts();
    expect(counts).toMatchObject({ total: 2, pending: 1, finished: 0, failed: 1 });
    expect(r.entries.find((e) => e.requestId === '2')?.failureReason).toBe('net::ERR_BLOCKED_BY_CLIENT');
  });

  test('리다이렉트는 «같은 requestId» 로 다시 온다 — 첫 홉을 «안 잃는다»', () => {
    const r = createNetworkRecorder();
    feed(r, [
      ['Network.requestWillBeSent', willBeSent('1', 'https://x.test/old')],
      ['Network.requestWillBeSent', willBeSent('1', 'https://x.test/new')],
    ]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].url).toBe('https://x.test/old');
  });

  test('⛔ 시작을 «못 본» 응답으로 항목을 «지어내지 않는다»', () => {
    const r = createNetworkRecorder();
    feed(r, [['Network.responseReceived', { requestId: '99', response: { status: 200 } }]]);
    expect(r.entries).toHaveLength(0);
  });

  test('requestId 가 없는 이벤트는 «무시»한다 (조용히 깨지지 않는다)', () => {
    const r = createNetworkRecorder();
    expect(() => feed(r, [['Network.requestWillBeSent', { request: { url: 'x' } }]])).not.toThrow();
    expect(r.entries).toHaveLength(0);
  });
});

describe('⭐ 계약 추론의 본체는 XHR·fetch 다', () => {
  test('이미지·폰트는 xhr 로 «안 센다»', () => {
    const r = createNetworkRecorder();
    feed(r, [
      ['Network.requestWillBeSent', { ...willBeSent('1', 'https://x.test/api'), type: 'XHR' }],
      ['Network.requestWillBeSent', { ...willBeSent('2', 'https://x.test/logo.png'), type: 'Image' }],
      ['Network.requestWillBeSent', { ...willBeSent('3', 'https://x.test/f.woff2'), type: 'Font' }],
    ]);
    expect(r.counts()).toMatchObject({ total: 3, xhr: 1 });
  });

  test('resourceType 을 «못 봤으면» xhr 로 세지 않는다 (0 으로도, 1 로도 지어내지 않는다)', () => {
    const r = createNetworkRecorder();
    feed(r, [['Network.requestWillBeSent', { requestId: '1', timestamp: 1, request: { url: 'https://x.test/a', method: 'GET' } }]]);
    expect(r.counts()).toMatchObject({ total: 1, xhr: 0 });
    expect(r.entries[0].resourceType).toBeNull();
  });

  test('API_RESOURCE_TYPES 는 EventSource 를 «담는다»(SSE 도 계약이다)', () => {
    expect(API_RESOURCE_TYPES).toContain('EventSource');
  });
});

describe('구독 — 걸고 «푼다»', () => {
  test('attach 가 관측 이벤트 넷을 «전부» 건다', () => {
    const bound: string[] = [];
    const off: string[] = [];
    const r = createNetworkRecorder();
    const detach = r.attach({
      on: (method) => {
        bound.push(method);
        return () => off.push(method);
      },
    });
    expect(bound).toEqual([...OBSERVED_EVENTS]);
    detach();
    expect(off).toEqual([...OBSERVED_EVENTS]);
  });

  test('구독으로 들어온 이벤트도 «같은 자리»로 흐른다', () => {
    const listeners = new Map<string, (p: Record<string, unknown>) => void>();
    const r = createNetworkRecorder();
    r.attach({ on: (m, l) => { listeners.set(m, l); return () => listeners.delete(m); } });
    listeners.get('Network.requestWillBeSent')!(willBeSent('1', 'https://x.test/api'));
    expect(r.entries).toHaveLength(1);
  });
});

describe('HAR — 표준 형식으로 떨군다', () => {
  const har = () => {
    const r = createNetworkRecorder();
    feed(r, [
      ['Network.requestWillBeSent', { ...willBeSent('1', 'https://x.test/api/items?page=2&q=a'), request: { url: 'https://x.test/api/items?page=2&q=a', method: 'POST', headers: { 'content-type': 'application/json' }, postData: '{"a":1}' } }],
      ['Network.responseReceived', { requestId: '1', response: { status: 201, statusText: 'Created', headers: { location: '/api/items/9' }, mimeType: 'application/json' } }],
      ['Network.loadingFinished', { requestId: '1', timestamp: 100.5, encodedDataLength: 33 }],
    ]);
    return toHar(r.entries, { pageUrl: 'https://x.test/', startedIso: '2026-09-10T00:00:00.000Z' }) as any;
  };

  test('HAR 1.2 뼈대를 낸다', () => {
    const h = har();
    expect(h.log.version).toBe('1.2');
    expect(h.log.entries).toHaveLength(1);
    expect(h.log.pages[0].id).toBe('page_1');
  });

  test('요청·응답의 «값»이 살아 있다', () => {
    const e = har().log.entries[0];
    expect(e.request).toMatchObject({ method: 'POST', url: 'https://x.test/api/items?page=2&q=a' });
    expect(e.request.postData.text).toBe('{"a":1}');
    expect(e.request.queryString).toEqual([{ name: 'page', value: '2' }, { name: 'q', value: 'a' }]);
    expect(e.response).toMatchObject({ status: 201, redirectURL: '/api/items/9' });
    expect(e.time).toBe(500);
  });

  test('⛔ 못 «잰» 값은 0 이 아니라 -1 이다 (HAR 관례 — 0 은 「없었다」로 읽힌다)', () => {
    const r = createNetworkRecorder();
    feed(r, [['Network.requestWillBeSent', willBeSent('1', 'https://x.test/a')]]);
    const e = (toHar(r.entries, { pageUrl: 'x', startedIso: 'x' }) as any).log.entries[0];
    expect(e.time).toBe(-1);
    expect(e.response.content.size).toBe(-1);
    expect(e.request.headersSize).toBe(-1);
  });

  test('⭐ 사각(blindSpots)이 HAR 에 «값으로» 실린다 — 읽는 쪽이 0 을 오독하지 않게', () => {
    const h = har();
    expect(h.log._blindSpots).toEqual([...NETWORK_BLIND_SPOTS]);
    expect(h.log._blindSpots.join(' ')).toContain('before-enable');
    expect(h.log._observedEvents).toEqual([...OBSERVED_EVENTS]);
  });

  test('본문을 «못 받았으면» content.text 를 아예 안 쓴다(빈 문자열로 «지어내지 않는다»)', () => {
    const e = har().log.entries[0];
    expect('text' in e.response.content).toBe(false);
  });
});

describe('질의 문자열 읽기', () => {
  test('상대 주소·깨진 주소는 «빈 목록»이고 던지지 않는다', () => {
    expect(queryStringOf('/api/x?a=1')).toEqual([]);
    expect(queryStringOf('not a url')).toEqual([]);
  });
});
