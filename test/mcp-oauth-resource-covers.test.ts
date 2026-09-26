import { describe, expect, test } from 'bun:test';
import { discoverMcpOAuth } from '../src/mcp/mcp-oauth.js';

// 🔴 이 파일이 무는 실물 (2026-09-10):
//   Topview 의 protected resource metadata 는 `resource: "https://mcp.topview.ai"` 를 내는데
//   MCP 엔드포인트는 `https://mcp.topview.ai/mcp` 다. 정확 일치만 보던 옛 검사는
//   ***그런 서버에 영영 못 붙었다***(`elanous mcp login topview` 가 identity-mismatch 로 죽었다).
//
// ⛔ 그런데 완화가 «보안 성질»을 깨면 안 된다 — 원래 검사가 막던 것은
//    「악성 서버가 남의 자원 문서를 가리켜 그 자원용 Bearer 를 가로채는 것」이다.
//    ⇒ 아래 «막혀야 하는» 셋이 그 성질의 반증이다.

const meta = (resource: string) => ({
  resource,
  authorization_servers: ['https://auth.example.com'],
});

/** URL 별로 다른 문서를 낸다 — 자원 문서와 «인증서버» 문서는 다른 것이다.
 *  ⛔ 하나로 뭉치면 자원 검사를 통과한 판이 «다음 단계»에서 죽어 오판한다(이 창에서 밟았다). */
function fakeFetch(resourceBody: unknown) {
  return async (url: string) => {
    const body = String(url).includes('oauth-authorization-server')
      ? {
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          code_challenge_methods_supported: ['S256'],
        }
      : resourceBody;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

async function tryDiscover(resource: string, endpoint: string): Promise<string | null> {
  try {
    await discoverMcpOAuth('https://mcp.example.com/.well-known/oauth-protected-resource', {
      resourceUrl: endpoint,
      fetch: fakeFetch(meta(resource)) as never,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe('자원 식별자가 MCP 엔드포인트를 «덮는가»', () => {
  test('✅ 오리진이 곧 자원이면 통과한다 (Topview 형태)', async () => {
    expect(await tryDiscover('https://mcp.topview.ai', 'https://mcp.topview.ai/mcp')).toBeNull();
  });

  test('✅ 정확히 같으면 통과한다 (옛 동작 유지)', async () => {
    expect(await tryDiscover('https://api.krea.ai/mcp', 'https://api.krea.ai/mcp')).toBeNull();
  });

  test('✅ 경로가 세그먼트 경계로 덮으면 통과한다', async () => {
    expect(await tryDiscover('https://x.example.com/a', 'https://x.example.com/a/b')).toBeNull();
  });

  // ── ⛔ 여기부터가 보안 성질의 반증 ──

  test('⛔ 다른 «오리진»은 막는다 — 이것이 원래 검사의 목적이다', async () => {
    const err = await tryDiscover('https://evil.example.com', 'https://mcp.topview.ai/mcp');
    expect(err).toContain('does not cover');
  });

  test('⛔ 다른 «포트»는 다른 오리진이라 막는다', async () => {
    const err = await tryDiscover('https://x.example.com:8443', 'https://x.example.com/mcp');
    expect(err).toContain('does not cover');
  });

  test('⛔ 문자열 접두로 새지 않는다 — /mcp 가 /mcp-evil 을 덮으면 안 된다', async () => {
    const err = await tryDiscover('https://x.example.com/mcp', 'https://x.example.com/mcp-evil');
    expect(err).toContain('does not cover');
  });

  test('⛔ 더 «깊은» 자원이 얕은 엔드포인트를 덮지는 않는다', async () => {
    const err = await tryDiscover('https://x.example.com/a/b', 'https://x.example.com/a');
    expect(err).toContain('does not cover');
  });

  test('⛔ `resource` 가 아예 없으면 여전히 막는다', async () => {
    try {
      await discoverMcpOAuth('https://mcp.example.com/.well-known/oauth-protected-resource', {
        resourceUrl: 'https://mcp.topview.ai/mcp',
        fetch: fakeFetch({ authorization_servers: ['https://auth.example.com'] }) as never,
      });
      throw new Error('통과하면 안 된다');
    } catch (e) {
      expect(String(e)).toContain('no `resource`');
    }
  });
});
