import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';
import { termPtySelectionHref } from './pty-selection-url';

// ⛔ 소스 계약 시험(저장소 관용구 — `TerminalPanel.test.tsx` 가 같은 형태를 쓴다).
//    이 페이지는 Suspense 로 감싸인 클라이언트 컴포넌트라 훅 하네스로 «안쪽»을 못 부른다.
//    그래서 배선의 «형태»를 문자열로 못 박는다. 행위는 TerminalPanel.interaction.test.tsx 가 잰다.
const PAGE_SRC = readFileSync(join(import.meta.dir, 'page.tsx'), 'utf8');

describe('termPtySelectionHref', () => {
  test('replaces only the PTY query value while preserving other query values and the fragment', () => {
    expect(termPtySelectionHref('https://example.test/app/term/?view=raw&pty=old#screen', 'tui:42'))
      .toBe('/app/term/?view=raw&pty=tui%3A42#screen');
  });

  test('does not create a replacement when the direct selection already matches the URL', () => {
    expect(termPtySelectionHref('https://example.test/app/term/?pty=tui%3A42#screen', 'tui:42')).toBeNull();
  });
});

describe('/term page — URL 배선 계약', () => {
  test('주소창 값을 읽어 초기 선택으로 넘긴다', () => {
    expect(PAGE_SRC).toContain("const PTY_QUERY_KEY = 'pty'");
    expect(PAGE_SRC).toContain('useSearchParams()');
    expect(PAGE_SRC).toContain('searchParams?.get(PTY_QUERY_KEY)');
    expect(PAGE_SRC).toContain('initialPtyId={initialPtyId}');
  });

  test('선택은 주소를 «대치»한다 — 방문 기록을 쌓지 않는다', () => {
    expect(PAGE_SRC).toContain('termPtySelectionHref(window.location.href, terminal.id)');
    expect(PAGE_SRC).toContain('router.replace(href)');
    // ⛔ push 는 뒤로가기 스택을 쌓아 「고를 때마다 기록이 는다」가 된다. 수용 기준 위반이다.
    expect(PAGE_SRC).not.toContain('router.push(');
  });

  test('정적 export 가 깨지지 않게 Suspense 경계 «안»에서 훅을 쓴다', () => {
    // 저장소가 이미 그 실패 문면을 적어 뒀다(SidebarNav.tsx 주석):
    // "useSearchParams() should be wrapped in a suspense boundary".
    expect(PAGE_SRC).toContain('<Suspense');
    const suspenseAt = PAGE_SRC.indexOf('<Suspense');
    const hookAt = PAGE_SRC.indexOf('useSearchParams()');
    // 훅은 Suspense «자식» 컴포넌트에 있어야 한다 — 즉 선언이 경계보다 «앞»에 온다.
    expect(hookAt).toBeGreaterThan(-1);
    expect(suspenseAt).toBeGreaterThan(hookAt);
  });
});
