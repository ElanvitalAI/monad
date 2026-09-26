import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { McpAppFrame } from './McpAppFrame';

describe('McpAppFrame', () => {
  it('uses srcDoc with CSP before untrusted markup and scripts-only sandboxing', () => {
    const markup = renderToStaticMarkup(
      <McpAppFrame
        html={'<main>untrusted</main>'}
        connectDomains={['https://api.example.test']}
        resourceDomains={['https://cdn.example.test', 'https://images.example.test']}
      />,
    );

    expect(markup).toContain('data-elanous-mcp-app-frame="true"');
    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).not.toContain('allow-same-origin');
    expect(markup).toContain('srcDoc="&lt;meta http-equiv=');
    expect(markup.indexOf('Content-Security-Policy')).toBeLessThan(markup.indexOf('untrusted'));
    expect(markup).toContain('connect-src https://api.example.test');
    expect(markup).toContain('img-src https://cdn.example.test https://images.example.test');
    expect(markup).toContain("script-src &#x27;unsafe-inline&#x27; https://cdn.example.test https://images.example.test");
    expect(markup).not.toContain('connect-src https://cdn.example.test');
  });

  it('keeps missing domain metadata deny-by-default while retaining inline app scripts', () => {
    const markup = renderToStaticMarkup(<McpAppFrame html="<main/>" />);

    expect(markup).toContain("connect-src &#x27;none&#x27;");
    expect(markup).toContain("img-src &#x27;none&#x27;");
    expect(markup).toContain("script-src &#x27;unsafe-inline&#x27; &#x27;none&#x27;");
  });
});
