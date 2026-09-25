/**
 * api-surface.test.ts — 「이 사이트가 자기 서버를 부르나」의 판정이 «미끄러지지» 않는가.
 * ⛔ 무는 것 셋: ⓐ 모르는 것을 static 으로 접는가 ⓑ 0 을 「없다」로 읽는가 ⓒ 서브도메인을 남으로 보는가
 */
import { describe, expect, test } from 'bun:test';

import {
  classifyEntry,
  formatApiSurface,
  looksLikeIdentifier,
  registrableApprox,
  sameApp,
  summarizeApiSurface,
  type SurfaceEntry,
} from './api-surface.js';

const e = (url: string, resourceType: string | null, method = 'GET', status: number | null = 200): SurfaceEntry =>
  ({ url, method, resourceType, status, mimeType: null });

const PAGE = 'https://www.shop.test/products';

describe('ⓐ 「모르겠다」를 static 으로 «접지 않는다»', () => {
  test('resourceType 을 못 본 것은 unknown 이다', () => {
    expect(classifyEntry(e('https://www.shop.test/x', null), PAGE)).toBe('unknown');
  });

  test('처음 보는 resourceType 도 unknown 이다 (조용히 static 이 되지 않는다)', () => {
    expect(classifyEntry(e('https://www.shop.test/x', 'Prefetch'), PAGE)).toBe('unknown');
  });

  test('unknown 이 «수»로 남는다', () => {
    const s = summarizeApiSurface([e('https://www.shop.test/x', null)], PAGE);
    expect(s.counts.unknown).toBe(1);
    expect(s.counts.static).toBe(0);
  });
});

describe('ⓑ 「0」을 「없다」로 읽지 «않는다»', () => {
  test('요청을 하나도 못 봤으면 unmeasurable 이다 — no-own-api 가 «아니다»', () => {
    const s = summarizeApiSurface([], PAGE);
    expect(s.verdict).toBe('unmeasurable');
    expect(s.verdictReason).toContain('못 쟀다');
  });

  test('요청은 봤는데 자기 API 가 0 이면 «이 한 방문에서 안 보였다»라고 말한다', () => {
    const s = summarizeApiSurface([e('https://cdn.other.test/a.png', 'Image')], PAGE);
    expect(s.verdict).toBe('no-own-api-observed');
    expect(s.verdictReason).toContain('「API 가 없다」가 아니라');
  });

  test('자기 API 가 하나라도 있으면 calls-own-server 다', () => {
    const s = summarizeApiSurface([e('https://api.shop.test/v1/items', 'XHR')], PAGE);
    expect(s.verdict).toBe('calls-own-server');
  });
});

describe('ⓒ 서브도메인은 «같은 앱»이다', () => {
  test('api.x.test 와 www.x.test 는 같은 앱', () => {
    expect(sameApp('https://api.shop.test/v1', PAGE)).toBe(true);
    expect(classifyEntry(e('https://api.shop.test/v1', 'Fetch'), PAGE)).toBe('first-party-api');
  });

  test('아예 다른 도메인은 남의 API', () => {
    expect(classifyEntry(e('https://www.google-analytics.com/g/collect', 'XHR'), PAGE)).toBe('third-party-api');
  });

  test('2단 TLD 를 «한 겹 더» 본다', () => {
    expect(registrableApprox('api.shop.co.kr')).toBe('shop.co.kr');
    expect(registrableApprox('shop.co.kr')).toBe('shop.co.kr');
    expect(registrableApprox('a.b.example.com')).toBe('example.com');
  });

  test('깨진 주소는 «같은 앱이 아니다»로 두되 던지지 않는다', () => {
    expect(sameApp('not a url', PAGE)).toBe(false);
  });
});

describe('엔드포인트 묶기', () => {
  const surface = () =>
    summarizeApiSurface(
      [
        e('https://api.shop.test/v1/items?page=1', 'XHR'),
        e('https://api.shop.test/v1/items?page=2', 'XHR'),
        e('https://api.shop.test/v1/cart', 'Fetch', 'POST', 201),
        e('https://www.google-analytics.com/g/collect', 'XHR', 'POST', 204),
        e('https://cdn.other.test/a.png', 'Image'),
        e('https://www.shop.test/products', 'Document'),
      ],
      PAGE,
    );

  test('질의 문자열이 달라도 «같은 경로»로 묶고 «센다»', () => {
    const items = surface().firstPartyEndpoints.find((x) => x.path === '/v1/items');
    expect(items).toMatchObject({ method: 'GET', count: 2 });
  });

  test('메서드가 다르면 «가른다»', () => {
    expect(surface().firstPartyEndpoints.map((x) => `${x.method} ${x.path}`).sort())
      .toEqual(['GET /v1/items', 'POST /v1/cart']);
  });

  test('본 상태 코드를 «전부» 남긴다', () => {
    expect(surface().firstPartyEndpoints.find((x) => x.path === '/v1/cart')!.statuses).toEqual([201]);
  });

  test('갈래마다 «수»가 맞는다', () => {
    expect(surface().counts).toEqual({ 'first-party-api': 3, 'third-party-api': 1, static: 1, document: 1, navigation: 0, unknown: 0 });
  });

  test('남의 API 출처를 «이름으로» 남긴다 (누가 붙어 있나)', () => {
    expect(surface().thirdPartyOrigins).toEqual(['https://www.google-analytics.com']);
  });

  test('상태를 못 봤으면 「상태 ⚪」로 적는다 (0 으로 지어내지 않는다)', () => {
    const s = summarizeApiSurface([e('https://api.shop.test/v1/x', 'XHR', 'GET', null)], PAGE);
    expect(formatApiSurface(s).join('\n')).toContain('[상태 ⚪]');
  });
});

/**
 * ⛔⭐ 「계약」과 「항해」 — 2026-09-11 실측(bilryo-dongne · 내가 «직접 쓴» 계약으로 반증).
 * 문면은 HAR 에서 그대로 떠 왔다.
 */
describe('프레임워크 항해를 계약으로 세지 않는다', () => {
  const nav = (over: Partial<SurfaceEntry> = {}): SurfaceEntry => ({
    url: 'http://127.0.0.1:8792/items/drill-01?_rsc=1p-R_iEY6bj0jY31',
    method: 'GET', resourceType: 'Fetch', status: 200, mimeType: 'text/x-component', ...over,
  });

  test('`text/x-component` 응답은 항해다', () => {
    expect(classifyEntry(nav({ url: 'http://a.example.com/x' }), 'http://a.example.com/')).toBe('navigation');
  });
  test('`rsc: 1` 요청 헤더면 항해다', () => {
    const e = nav({ mimeType: 'application/json', url: 'http://a.example.com/x', requestHeaders: { rsc: '1' } });
    expect(classifyEntry(e, 'http://a.example.com/')).toBe('navigation');
  });
  test('`?_rsc=` 질의만으로도 항해다 — 헤더를 «못 얻어도» 잡는다', () => {
    const e = nav({ mimeType: 'application/json' });
    expect(classifyEntry(e, 'http://127.0.0.1:8792/')).toBe('navigation');
  });
  test('⛔ 진짜 API 를 항해로 몰지 않는다', () => {
    const e = nav({ url: 'http://127.0.0.1:8791/api/v1/items?page=1', mimeType: 'application/json' });
    expect(classifyEntry(e, 'http://127.0.0.1:8899/')).toBe('first-party-api');
  });
  test('항해 여섯이면 「자기 API 0」이 되고 거짓 자신을 «안» 낸다', () => {
    const six = ['drill-01', 'ladder-02', 'steam-03', 'tent-04', 'sander-05', 'proj-06']
      .map((id) => nav({ url: `http://127.0.0.1:8792/items/${id}?_rsc=1p-R` }));
    const s = summarizeApiSurface(six, 'http://127.0.0.1:8792/');
    expect(s.counts['first-party-api']).toBe(0);
    expect(s.counts.navigation).toBe(6);
    expect(s.verdict).toBe('no-own-api-observed');
  });
});

/** ⛔⭐ 같은 엔드포인트를 id 마다 세지 않는다. */
describe('경로 변수 접기', () => {
  const api = (path: string): SurfaceEntry => ({
    url: `http://a.example.com${path}`, method: 'GET', resourceType: 'XHR', status: 200, mimeType: 'application/json',
  });

  test('형제가 «한 칸만» 다르면 그 칸을 접는다', () => {
    const s = summarizeApiSurface(
      ['/api/v1/items/drill-01', '/api/v1/items/ladder-02', '/api/v1/items/steam-03'].map(api),
      'http://a.example.com/',
    );
    expect(s.firstPartyEndpoints.length).toBe(1);
    expect(s.firstPartyEndpoints[0]!.path).toBe('/api/v1/items/{id}');
    expect(s.firstPartyEndpoints[0]!.count).toBe(3);
    expect(s.firstPartyEndpoints[0]!.foldedFrom).toBe(3);
  });

  test('⛔ 한 번만 본 경로는 «안 접는다» — 표본 하나로 「변수다」라 못 한다', () => {
    const s = summarizeApiSurface([api('/api/v1/items/drill-01')], 'http://a.example.com/');
    expect(s.firstPartyEndpoints[0]!.path).toBe('/api/v1/items/drill-01');
    expect(s.firstPartyEndpoints[0]!.foldedFrom).toBe(0);
  });

  test('⛔ «두 칸» 이상 다르면 안 접는다 — 다른 엔드포인트일 수 있다', () => {
    const s = summarizeApiSurface(['/api/v1/items/drill-01', '/api/v2/users/u-02'].map(api), 'http://a.example.com/');
    expect(s.firstPartyEndpoints.map((e) => e.path).sort()).toEqual(['/api/v1/items/drill-01', '/api/v2/users/u-02']);
  });

  test('목록과 상세가 «섞여도» 목록은 그대로 둔다', () => {
    const s = summarizeApiSurface(
      ['/api/v1/items', '/api/v1/items/drill-01', '/api/v1/items/ladder-02'].map(api),
      'http://a.example.com/',
    );
    expect(s.firstPartyEndpoints.map((e) => e.path).sort()).toEqual(['/api/v1/items', '/api/v1/items/{id}']);
  });

  test('질의 «열쇠»를 모은다 — ⛔ 값은 안 담는다(검색어·토큰이 섞인다)', () => {
    const s = summarizeApiSurface([
      api('/api/v1/items?category=%EC%A0%84%EB%8F%99&page=1'),
      api('/api/v1/items?area=%EC%88%98%EC%9C%A0&per_page=5'),
    ], 'http://a.example.com/');
    expect(s.firstPartyEndpoints[0]!.queryKeys).toEqual(['area', 'category', 'page', 'per_page']);
    expect(JSON.stringify(s.firstPartyEndpoints[0])).not.toContain('전동');
  });
});

/** ⛔ 과잉 접기 — 「한 칸만 다르다」만으로 접으면 «다른 컬렉션»이 지워진다. */
describe('접기 판별 — 식별자처럼 생겼나', () => {
  const api = (path: string): SurfaceEntry => ({
    url: `http://a.example.com${path}`, method: 'GET', resourceType: 'XHR', status: 200, mimeType: 'application/json',
  });
  test('⛔ 서로 다른 «컬렉션»을 접지 않는다', () => {
    const s = summarizeApiSurface(['/v1/items', '/v1/cart'].map(api), 'http://a.example.com/');
    expect(s.firstPartyEndpoints.map((e) => e.path).sort()).toEqual(['/v1/cart', '/v1/items']);
  });
  test('숫자가 든 칸은 식별자다', () => {
    expect(looksLikeIdentifier('drill-01')).toBe(true);
    expect(looksLikeIdentifier('12345')).toBe(true);
  });
  test('긴 해시·uuid 도 식별자다', () => {
    expect(looksLikeIdentifier('a3f9c2e1b7d40516')).toBe(true);
    expect(looksLikeIdentifier('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
  });
  test('⛔ 낱말은 식별자가 «아니다»', () => {
    expect(looksLikeIdentifier('items')).toBe(false);
    expect(looksLikeIdentifier('cart')).toBe(false);
    expect(looksLikeIdentifier('')).toBe(false);
  });
  test('⚪ 숫자 없는 슬러그는 «안 접힌다» — 못 잡는 것을 안다고 적어 둔다', () => {
    const s = summarizeApiSurface(['/posts/hello-world', '/posts/good-bye'].map(api), 'http://a.example.com/');
    expect(s.firstPartyEndpoints.length).toBe(2);
  });
});
