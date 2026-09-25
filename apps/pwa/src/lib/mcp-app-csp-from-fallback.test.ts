import { describe, expect, test } from 'bun:test';
import { buildMcpAppCsp } from './mcp-app-csp';
import { fetchMcpAppHtml, mcpAppFrameDomains } from './mcp-app-resource';
import { handleMcpResourceGet } from '../../../../src/nexus/api/mcp-resource-route.js';

/** ⛔⭐⭐⭐ 이 파일은 «세 조각이 이어지는지»를 문다 — 조각마다 초록인데 사이가 끊긴 것이
 *  2026-08-21 라이브에서 위젯을 «죽은 껍데기»로 만들었다(무인 리뷰 should-fix · PR #10887).
 *
 *  ```
 *  ① 데몬 라우트가 상대의 `_meta.ui.csp` 를 «머리»로 싣는다      mcpAppCspHeaders
 *  ② PWA 가 그 머리를 읽어 목록으로 돌려준다                     fetchMcpAppHtml
 *  ③ 그 목록이 실제 CSP 문자열이 된다                            buildMcpAppCsp
 *  ```
 *  ⛔ ①②③ 을 «따로» 물면 사이가 끊겨도 전부 초록이다. 그래서 한 줄로 이어서 문다. */

/** ⛔⭐⭐ 응답을 «데몬 라우트 핸들러»가 만들게 한다 — 그 안의 함수를 직접 부르지 않는다.
 *
 *  📏 이 파일의 1차판이 `mcpAppCspHeaders()` 를 «직접» 불렀다. 그러면 라우트에서 그 머리를
 *  붙이는 «줄»을 지워도 시험이 «안 깨진다»(실측: 지웠는데 2 pass). ⇒ 이음매를 비켜 겨눈 것이다.
 *  ⭐ 이 축의 결함이 「배선」이므로 반증도 배선을 지나야 한다. */
function servedBy(content: Record<string, unknown>) {
  const client = { opts: { id: 'higgsfield' }, async readResource() { return { contents: [content] }; } };
  return {
    async fetchResponse(path: string): Promise<Response> {
      return handleMcpResourceGet(new Request(`http://d${path}`), {
        authorize: () => true,
        getClients: () => ({
          clients: [client],
          perServer: { higgsfield: { status: 'ready' } },
        }) as never,
      });
    },
  };
}

describe('fallback widget body → CSP (the three joints, in one line)', () => {
  test('🚨 the peer’s declared origins survive all the way into the iframe CSP', async () => {
    const body = await fetchMcpAppHtml(
      servedBy({
        uri: 'ui://x',
        text: '<main/>',
        mimeType: 'text/html;profile=mcp-app',
        _meta: { ui: { csp: { connectDomains: ['https://api.higgsfield.ai'], resourceDomains: ['https://cdn.higgsfield.ai'] } } },
      }),
      { server: 'higgsfield', uri: 'ui://x' },
    );
    const csp = buildMcpAppCsp({ connectDomains: body?.connectDomains, resourceDomains: body?.resourceDomains });

    expect(csp).toContain('connect-src https://api.higgsfield.ai');
    expect(csp).toContain('img-src https://cdn.higgsfield.ai');
    // ⛔ 이것이 라이브에서 깨졌던 자리다 — 전부 `'none'` 이면 그림도 못 받고 연결도 못 한다.
    expect(csp).not.toContain("connect-src 'none'");
    expect(csp).not.toContain("img-src 'none'");
  });

  test('a peer that declared nothing still gets deny-by-default — «모른다» is not «다 열어라»', async () => {
    const body = await fetchMcpAppHtml(servedBy({ uri: 'ui://x', text: '<main/>', mimeType: 'text/html;profile=mcp-app' }), { server: 's', uri: 'ui://x' });
    const csp = buildMcpAppCsp({ connectDomains: body?.connectDomains, resourceDomains: body?.resourceDomains });
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("img-src 'none'");
  });
});

/** ⛔⭐ 마지막 배선 — 조회 결과가 «프레임 props» 로 흘러가는 자리(무인 리뷰 should-fix · 2026-08-21).
 *  ⚠️ 그 결정이 렌더 본문 안에 있으면 정적 렌더 시험이 못 문다 ⇒ 함수로 꺼내 여기서 문다. */
describe('fetched origins → frame props (the last joint)', () => {
  test('폴백 조회로 받은 목록이 프레임으로 간다 — 블록이 아무것도 모를 때', () => {
    expect(mcpAppFrameDomains({}, { html: '<i/>', connectDomains: ['https://a'], resourceDomains: ['https://b'] }))
      .toEqual({ connectDomains: ['https://a'], resourceDomains: ['https://b'] });
  });

  test('블록이 «직접» 아는 값이 우선이다 — 툴 결과가 선언한 것이 한 다리 더 가깝다', () => {
    expect(mcpAppFrameDomains({ connectDomains: ['https://block'] }, { html: '<i/>', connectDomains: ['https://fetched'] }))
      .toEqual({ connectDomains: ['https://block'] });
  });

  test('둘 다 모르면 아무것도 싣지 않는다 — 그러면 CSP 가 거부 기본으로 선다', () => {
    expect(mcpAppFrameDomains({}, null)).toEqual({});
    const csp = buildMcpAppCsp(mcpAppFrameDomains({}, null));
    expect(csp).toContain("connect-src 'none'");
  });
});
