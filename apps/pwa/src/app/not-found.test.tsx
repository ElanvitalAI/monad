import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ROUTE_GUIDANCE_ITEMS } from '@/components/welcome/WelcomeHome';
import NotFound from './not-found';

function routeGuidanceTestId(href: string): string {
  return `route-guidance-${href === '/' ? 'root' : href.slice(1).replaceAll('/', '-')}`;
}

function decodedHtml(html: string): string {
  return html.replaceAll('&quot;', '"');
}

describe('NotFound — route guidance contract', () => {
  test('identifies the missing location without calling itself the default entry', () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain('data-testid="not-found"');
    expect(html).toContain('여기엔 없습니다');
    expect(html).toContain('알 수 없는 주소');
    expect(html).not.toContain('기본 진입 화면');
  });

  test('renders every shared address once, linking only menu destinations and showing non-menu reasons', () => {
    const html = decodedHtml(renderToStaticMarkup(<NotFound />));
    expect(ROUTE_GUIDANCE_ITEMS.length).toBeGreaterThan(0);
    for (const route of ROUTE_GUIDANCE_ITEMS) {
      expect(html.match(new RegExp(`data-testid="${routeGuidanceTestId(route.href)}"`, 'g'))?.length).toBe(1);
    }
    for (const item of ROUTE_GUIDANCE_ITEMS.filter((route) => route.navigable)) {
      expect(html).toContain(`href="${item.href}"`);
      expect(html).toContain('data-route-kind="destination"');
    }
    for (const route of ROUTE_GUIDANCE_ITEMS.filter((item) => !item.navigable)) {
      expect(html).toContain(route.reason!);
      expect(html).not.toContain(`href="${route.href}"`);
    }
  });
});
