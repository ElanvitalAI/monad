// 2026-05-07 dogfood feedback — TopBar 안 inline workspace strip 의
// 핵심 분기 (provider 없음 · 빈 워크스페이스 · sm/모바일 분기) 를 lock.
// React Testing Library 가 PWA bun 환경에 없어 renderToStaticMarkup 으로
// HTML 만 검사 — strip 의 mount 여부 + 라벨 노출만 확인.

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { TopBarWorkspaceStrip } from './TopBarWorkspaceStrip';
import { WorkspaceProvider } from '@/components/workspace/WorkspaceProvider';

describe('TopBarWorkspaceStrip — provider gating', () => {
  it('renders nothing when WorkspaceProvider is not mounted (graceful no-op)', () => {
    // useWorkspaceOptional() returns null when no provider above —
    // 컴포넌트가 즉시 null 반환해야 함. RTM 환경에서 Provider context
    // 미존재가 throw 되지 않는지 검증.
    const html = renderToStaticMarkup(<TopBarWorkspaceStrip />);
    expect(html).toBe('');
  });

  it('renders nothing when WorkspaceProvider is mounted but workspace is empty', () => {
    // 첫 진입 사용자가 메뉴 + 아이콘만 보고 시작하도록 — strip 자체
    // hidden. AddTabPopover 도 같이 hidden (sidebar nav 에서 새 탭 entry).
    const html = renderToStaticMarkup(
      <WorkspaceProvider>
        <TopBarWorkspaceStrip />
      </WorkspaceProvider>,
    );
    // tablist data attribute 가 없어야 함 (strip 자체 미렌더).
    expect(html).not.toContain('data-elanous-component="topbar-workspace-strip"');
    expect(html).not.toContain('data-elanous-component="topbar-workspace-strip-mobile"');
  });
});
