// P-1 (BACKLOG-webterm-followups #2 · 2026-05-07) — Derive a
// `DaemonSessionOrigin` from the `InputSourceKind` carried by every
// /v1/prompt[/stream] turn submission.
//
// Why centralize here: every bridge (telegram, discord, PWA, CLI/TUI)
// ultimately submits via /v1/prompt or /v1/prompt/stream with an
// `InputSourceRef` describing where the message came from. Tagging
// origin once at the daemon's prompt entry point catches all bridges
// uniformly without forcing each bridge's call site to remember the
// extra parameter — and avoids drift when a new bridge lands.
//
// Mapping is intentionally narrow: only the four user-facing surfaces
// the picker UI cares about. ACP-internal kinds ('llm-tool',
// 'scheduled', 'glass', 'voice', 'browser', 'terminal', 'mouse',
// 'keyboard') return undefined so the picker shows them untagged
// rather than miscategorising as 'cli'.

import type { InputSourceKind } from '../input/input-source-kind.js';
import type { DaemonSessionOrigin } from './daemon-runtime.js';

export function deriveOriginFromInputSourceKind(
  kind: InputSourceKind | undefined,
): DaemonSessionOrigin | undefined {
  switch (kind) {
    case 'telegram':
      return 'tg';
    case 'discord':
      return 'dc';
    case 'pwa':
      return 'pwa';
    case 'native':
      // 네이티브 iOS/Android 앱(apps/ios·apps/android). 대화 소스 귀속용
      // 서피스 origin — taste substrate 가 "어느 서피스" 를 구분하도록.
      return 'native';
    case 'daemon-api':
      // The /v1/prompt fallback source kind for callers that don't
      // pass `source` explicitly. Treat as CLI/TUI since the bare
      // daemon HTTP API is the path TUI clients use.
      return 'cli';
    default:
      // 'keyboard' / 'mouse' / 'voice' / 'browser' / 'terminal' /
      // 'scheduled' / 'llm-tool' / 'glass' — leave untagged.
      return undefined;
  }
}
