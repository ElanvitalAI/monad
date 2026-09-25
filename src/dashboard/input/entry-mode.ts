import type { Key } from '../../tui.js';

export type DashboardInputEntryMode = 'plain' | 'slash';

/** essential(chat-only) 자동 입력 진입용 합성 키 이름 — 실제 터미널이 만들 수
 *  없는 센티널. ★ 과거엔 합성 `Ctrl+L` 로 자동 진입했는데(#3959 전), Ctrl+L 이
 *  force-redraw 로 재정의되자 "합성키→redraw→재루프→합성키…" busy-loop(무한
 *  깜빡임·키 불능·2026-07-12 dogfood)이 됐다. 진입 신호는 키 체계와 분리한다. */
export const CHAT_MAIN_AUTO_ENTRY_KEY_NAME = 'chat-main-auto-entry';

export function resolveDashboardInputEntryMode(
  key: Key,
): DashboardInputEntryMode | null {
  // ★ Ctrl+L 입력 재진입 폐기(2026-07-12 대표 지적) — codex(clear_terminal)/
  // claude-code(app:redraw) 관례와 충돌 + 한글 IME('ㅣ')에서 copy-log-pane 과
  // 겹치던 이원 동작. Ctrl+L 은 이제 force-redraw 글로벌 액션(global-actions.ts).
  // 입력 진입은 `/`(slash) · Esc/i/클릭(pane-common-key-route) · 자동 진입 센티널.
  if (key.name === CHAT_MAIN_AUTO_ENTRY_KEY_NAME) return 'plain';
  if (key.name === '/' && !key.ctrl) return 'slash';
  return null;
}

export function buildDashboardInputInitialText(
  mode: DashboardInputEntryMode,
  pendingPrefix: string,
): string | undefined {
  if (mode === 'slash') return `/${pendingPrefix}`;
  return pendingPrefix || undefined;
}
