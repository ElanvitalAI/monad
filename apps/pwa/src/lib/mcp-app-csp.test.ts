import { describe, expect, it } from 'bun:test';

import { buildMcpAppCsp, normalizeMcpAppOrigins } from './mcp-app-csp';

describe('MCP App CSP', () => {
  it('separates normalized connect and resource origins in their outbound directives', () => {
    const csp = buildMcpAppCsp({
      connectDomains: ['https://api.example.test', 'https://api.example.test/'],
      resourceDomains: ['https://cdn.example.test', 'http://assets.example.test/'],
    });

    expect(normalizeMcpAppOrigins(['https://cdn.example.test/', 'https://cdn.example.test'])).toEqual([
      'https://cdn.example.test',
    ]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('connect-src https://api.example.test');
    expect(csp).toContain('img-src https://cdn.example.test http://assets.example.test');
    expect(csp).toContain('media-src https://cdn.example.test http://assets.example.test');
    expect(csp).toContain('style-src https://cdn.example.test http://assets.example.test');
    expect(csp).toContain('font-src https://cdn.example.test http://assets.example.test');
    expect(csp).toContain("script-src 'unsafe-inline' https://cdn.example.test http://assets.example.test");
    expect(csp).not.toContain('connect-src https://cdn.example.test');
    expect(csp).not.toContain('img-src https://api.example.test');
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("navigate-to 'none'");
  });

  it('denies every outbound request when metadata is absent or invalid', () => {
    const csp = buildMcpAppCsp({
      connectDomains: ['javascript:alert(1)'],
      resourceDomains: ['data:text/html,boom'],
    });

    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("img-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline' 'none'");
  });

  it('drops hostile, malformed, and non-origin values', () => {
    const csp = buildMcpAppCsp({
      resourceDomains: [
        'https://safe.example.test',
        'javascript:alert(1)',
        'data:text/html,boom',
        'https://user:pass@example.test',
        'https://example.test/path',
        'https://example.test/?query=1',
        'https://example.test/#fragment',
        'not a URL',
        42,
        null,
      ],
    });

    expect(csp).toContain('https://safe.example.test');
    expect(csp).not.toContain('javascript:');
    expect(csp).not.toContain('data:');
    expect(csp).not.toContain('user:pass');
    expect(csp).not.toContain('example.test/path');
    expect(csp).not.toContain('query=1');
    expect(csp).not.toContain('fragment');
  });
});
