// NEXUS · first-boot welcome card (N-1 cleanup PR g.3).
//
// Shown at the top of the chat-tab placeholder when both:
//   - the chat backend resolved to 'none' (clean machine + no
//     env / OAuth detected by PR g.1's auto-detect), AND
//   - UserConfig.global.nexus.firstBootGuideShown is not true
//     (i.e., the user has not dismissed the card yet)
//
// The card points the user at the Settings tab Quick Setup card
// (PR g.2) and the OAuth login path so a clean machine can pick a
// chat backend.
//
// Dismiss path: pressing Escape on a chat tab whose session is in
// inert state (backend='none') flips the flag → next boot skips
// the card. Selecting a backend (env-var added + nexus restart)
// resolves backend !== 'none' on subsequent boots so the card also
// stops showing without needing the dismiss flag.

import {
  patchUserConfig,
  readUserConfig,
} from '../config/user-config.js';
import type { UserConfig } from '../config/types.js';

/** True when the welcome card should render in the chat-tab view.
 *  Pure read — caller passes the live UserConfig so this stays
 *  testable without disk I/O. */
export function shouldShowWelcome(cfg: UserConfig): boolean {
  return cfg.global.nexus?.firstBootGuideShown !== true;
}

/** Persist the dismiss flag → next boot skips the card. Returns the
 *  patched config so callers can update any in-memory snapshot they
 *  hold. Idempotent — calling twice writes the same value. */
export function dismissWelcome(): UserConfig {
  return patchUserConfig((cfg) => {
    cfg.global.nexus = { ...(cfg.global.nexus ?? {}), firstBootGuideShown: true };
  });
}

/** Convenience wrapper — readUserConfig + shouldShowWelcome in one
 *  call. Used by callers that don't already hold the cfg snapshot
 *  (e.g., chat tab view called from sidebar item factory). */
export function shouldShowWelcomeNow(): boolean {
  try {
    return shouldShowWelcome(readUserConfig());
  } catch {
    // Corrupt / missing config → show the card (safer for new users).
    return true;
  }
}

/** The welcome card lines themselves. Pure formatter — pulled into
 *  chat tab view (when backend='none' + shouldShowWelcome) and
 *  exported so tests can pin the copy without re-rendering through
 *  the view layer. */
export function buildWelcomeCardLines(): string[] {
  return [
    '  ✦ Welcome to elanous NEXUS',
    '  ──────────────────────────────────────────────────',
    '',
    '  이 화면은 NEXUS 데몬(PWA·meta-api)입니다.',
    '  인터랙티브 대시보드는 별도 터미널에서 `elanous`.',
    '',
    '  Chat 백엔드 미설정 — 다음 중 하나로 셋업:',
    '    • Tab → Settings 탭 → Quick Setup 카드 (3 provider 안내)',
    '    • 별도 터미널: `elanous login codex` (가장 추천 · OAuth)',
    '    • env 설정: OPENAI_API_KEY · ANTHROPIC_API_KEY · GEMINI_API_KEY',
    '',
    '  [Esc] 본 안내 닫기 (다음 boot 부터 안 보임)',
  ];
}
