import { describe, expect, it } from 'bun:test';
import { MCP_APP_HTML_MIME, isMcpAppHtmlMime } from '../src/tool-runtime/mcp-app-mime.js';
import { parseMcpAppPayload } from '../apps/pwa/src/lib/chat-runtime.js';

/** ⛔⭐⭐⭐ 2026-08-21 라이브 실측: 실제 응답 헤더가 `text/html;profile=mcp-app` 인데
 *  읽는 쪽이 `=== 'text/html'` 로 «정확히 일치»를 요구했다. ⇒ 툴 결과에 위젯 본문이 실려 와도
 *  ***한 번도 못 쓰고*** 매번 35~57초짜리 폴백 조회로 갔다. 형식은 «본질»로 비교한다. */

describe('widget mime — 선언하는 쪽과 읽는 쪽이 같은 집을 본다', () => {
  it('우리가 선언하는 값이 우리가 읽는 값이다', () => {
    // ⛔ 이것이 이 파일의 핵심 — 두 쪽이 «같은 상수»를 통과해야 한다.
    expect(isMcpAppHtmlMime(MCP_APP_HTML_MIME)).toBe(true);
  });

  it('파라미터가 붙어도 같은 형식이다', () => {
    expect(isMcpAppHtmlMime('text/html;profile=mcp-app')).toBe(true);
    expect(isMcpAppHtmlMime('text/html; charset=utf-8')).toBe(true);
    expect(isMcpAppHtmlMime('TEXT/HTML')).toBe(true);
    expect(isMcpAppHtmlMime('text/html')).toBe(true);
  });

  it('모르는 형식은 그리지 않는다', () => {
    expect(isMcpAppHtmlMime('text/plain')).toBe(false);
    expect(isMcpAppHtmlMime('application/json')).toBe(false);
    expect(isMcpAppHtmlMime('')).toBe(false);
    expect(isMcpAppHtmlMime(undefined)).toBe(false);
    expect(isMcpAppHtmlMime(42)).toBe(false);
  });
});

describe('임베드된 위젯 본문 — 실물 형식 표기로 문다', () => {
  const payload = (mimeType: string) => ({
    _meta: { ui: { resourceUri: 'ui://x' } },
    content: [{
      type: 'resource',
      resource: {
        uri: 'ui://x',
        mimeType,
        text: '<main>widget</main>',
        _meta: { ui: { csp: { connectDomains: ['https://api.x'], resourceDomains: ['https://cdn.x'] } } },
      },
    }],
  });

  it('🚨 실물 형식 표기(`;profile=mcp-app`)를 «쓴다» — 이것이 안 되면 폴백 조회로 새고 CSP 를 잃는다', () => {
    const parsed = parseMcpAppPayload(payload(MCP_APP_HTML_MIME), 'ui://x');
    expect(parsed?.html).toBe('<main>widget</main>');
    expect(parsed?.connectDomains).toEqual(['https://api.x']);
    expect(parsed?.resourceDomains).toEqual(['https://cdn.x']);
  });

  it('파라미터 없는 표기도 그대로 쓴다', () => {
    expect(parseMcpAppPayload(payload('text/html'), 'ui://x')?.html).toBe('<main>widget</main>');
  });

  it('다른 형식은 위젯 본문으로 읽지 않는다', () => {
    expect(parseMcpAppPayload(payload('application/json'), 'ui://x')).toBeUndefined();
  });
});
