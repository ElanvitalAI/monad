/** ⛔⭐⭐⭐ MCP Apps 위젯 본문의 «형식» 계약 — 선언하는 쪽과 «읽는 쪽»이 같은 집을 본다.
 *
 *  📏 2026-08-21 라이브 실측(`[F]` 15차 · 브라우저에서 실제 응답 헤더를 읽음):
 *    `content-type: text/html;profile=mcp-app`
 *  그런데 읽는 쪽(`chat-runtime.parseMcpAppPayload`)이 ***`=== 'text/html'` 로 «정확히 일치»***를
 *  요구하고 있었다. ⇒ 파라미터가 붙은 실제 값과 «영영» 안 맞아, 툴 결과에 본문이 실려 와도
 *  그것을 «한 번도 못 쓰고» 매번 느린 폴백 조회로 갔다.
 *
 *  ⇒ 📌 또 「바꿨는데/선언했는데 읽는 쪽이 다른 값을 본다」였다. 그래서 «한 집»에 둔다.
 *  ⛔ 형식 비교는 «본질»(`type/subtype`)로 한다 — RFC 9110 이 파라미터를 형식의 일부로 보지 않는다. */

/** 우리가 능력 선언에 싣는 값. ⛔ 이 문자열을 다른 곳에 «베끼지» 않는다. */
export const MCP_APP_HTML_MIME = 'text/html;profile=mcp-app';

/** 이 형식 표기가 «우리가 그릴 수 있는» 위젯 본문인가.
 *
 *  ⭐ `text/html` 도 참이다 — 파라미터 없이 보내는 서버가 있고, 본질이 같으면 같은 것을 그린다.
 *  ⛔ `text/plain`·`application/json` 등은 거짓. 「모르는 형식」을 그리지 않는다. */
export function isMcpAppHtmlMime(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const essence = value.split(';')[0]!.trim().toLowerCase();
  return essence === 'text/html';
}
