// PWA `/settings` Phase 3 — PersonaCard mount surface test.
//
// React Testing 없음 (PWA convention). Export contract + anchor id 검증.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PersonaCard } from './PersonaCard';

describe('PersonaCard — mount surface', () => {
  test('exports a component', () => {
    expect(typeof PersonaCard).toBe('function');
  });

  test('SSR pre-mount returns null (NexusProvider 미mount 시 hide)', () => {
    // 본 컴포넌트는 mounted + client 가 둘 다 있어야 렌더. SSR 에선 둘
    // 다 null → static markup 도 빈 문자열.
    const html = renderToStaticMarkup(<PersonaCard />);
    expect(html).toBe('');
  });
});
