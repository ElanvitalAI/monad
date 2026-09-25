import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ROUTE_GUIDANCE_ITEMS, isSidebarRouteHref, WelcomeHome } from './WelcomeHome';

function decodedHtml(html: string): string {
  return html.replaceAll('&quot;', '"');
}

function routeGuidanceTestId(href: string): string {
  return `route-guidance-${href === '/' ? 'root' : href.slice(1).replaceAll('/', '-')}`;
}


describe('WelcomeHome — complete route guidance contract', () => {
  test('renders a welcome-home root with the headline', () => {
    const html = renderToStaticMarkup(<WelcomeHome />);
    expect(html).toContain('data-testid="welcome-home"');
    expect(html).toContain('웰컴 — 어디부터 시작할까요?');
  });

  test('renders every shared route-accounting entry exactly once', () => {
    const html = renderToStaticMarkup(<WelcomeHome />);
    expect(ROUTE_GUIDANCE_ITEMS.length).toBeGreaterThan(0);
    for (const route of ROUTE_GUIDANCE_ITEMS) {
      expect(html.match(new RegExp(`data-testid="${routeGuidanceTestId(route.href)}"`, 'g'))?.length).toBe(1);
    }
  });

  test('links only menu destinations and preserves each non-menu reason as reference text', () => {
    const html = decodedHtml(renderToStaticMarkup(<WelcomeHome />));
    for (const item of ROUTE_GUIDANCE_ITEMS.filter((route) => route.navigable)) {
      expect(html).toContain(`href="${item.href}"`);
      expect(html).toContain('data-route-kind="destination"');
    }
    for (const route of ROUTE_GUIDANCE_ITEMS.filter((item) => !item.navigable)) {
      expect(html).toContain(route.reason!);
      expect(html).toContain('data-route-kind="reference"');
      expect(html).not.toContain(`href="${route.href}"`);
    }
  });

  test('accepts only addresses present in the shared route-accounting table', () => {
    for (const route of ROUTE_GUIDANCE_ITEMS) expect(isSidebarRouteHref(route.href)).toBe(true);
    expect(isSidebarRouteHref('/garbage')).toBe(false);
  });

  // This source-name guard only covers direct redirect/router APIs in RootPage;
  // aliases, dynamic property access, and runtime effects need integration coverage.
  test('RootPage executable source names forbid direct automatic navigation APIs', async () => {
    const source = await Bun.file(new URL('../../app/page.tsx', import.meta.url)).text();
    // This examines executable import/call syntax, not comments; aliases, dynamic property access,
    // and runtime effects still require integration coverage.
    const executableSource = source.replace(/^\s*\/\/.*$/gm, '');
    expect(executableSource).not.toMatch(/(?:import\s+\{[^}]*\b(?:redirect|permanentRedirect|useRouter)\b[^}]*\}|\b(?:redirect|permanentRedirect)\s*\(|\buseRouter\s*\()/);
  });
});
