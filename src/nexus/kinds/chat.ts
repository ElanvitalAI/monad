// NEXUS · chat kind (Phase N-1 PR β placeholder · cleanup PR a backend resolver)
//
// `chat` is a view-only kind: no spawn, no health check, no restart
// policy. The TUI session view is mounted inside the SidebarTabSurface
// detail panel.
//
// PR β shipped the placeholder TextView. N-1 cleanup PR a adds the
// backend resolver path: `meta.backend` records the resolved ACP
// backend kind so future PR b/c can fork the surface mount on it
// without re-resolving. The placeholder view also surfaces the
// resolved backend so the user can verify their switch took effect.
//
// N-1 cleanup PR b will wire the real chat surface (sibling pattern ·
// imports the existing chat view component without wrapping
// `Dashboard`) and replace the placeholder.

import { TextView } from '../../ui/view.js';
import type { View } from '../../ui/view.js';
import {
  CHAT_BACKEND_HARD_DEFAULT,
  resolveChatBackend,
  type ChatBackendKind,
} from '../chat/backend-resolver.js';
import type { NexusChatSession, ChatMessage } from '../chat/session.js';
import { readUserConfig } from '../config/user-config.js';
import type { UserConfig } from '../config/types.js';
import type { TabKind, TabSpec } from './types.js';
import {
  buildWelcomeCardLines,
  shouldShowWelcomeNow,
} from '../chat/welcome.js';

export interface ChatTabOpts {
  id?: string;          // default: 'chat:1' / 'chat:2' / ...
  label?: string;       // user-facing
  resumeSessionId?: string;
  /** N-1 cleanup PR a — explicit backend pin. When omitted the spec
   *  resolves the backend via `resolveChatBackend({cfg, tabId})` so
   *  the per-tab + global UserConfig switches take effect. Pass
   *  explicitly when the caller already knows (e.g., tests, future
   *  per-tab spawn flow). */
  backend?: ChatBackendKind;
  /** N-1 cleanup PR a — UserConfig override for the resolver. Tests
   *  pass a synthetic config without touching disk; production omits
   *  + the spec reads the live UserConfig. */
  userConfig?: UserConfig;
}

export const CHAT_KIND: TabKind = 'chat';

/** Create a TabSpec for a new chat tab. The backend kind is recorded
 *  on `meta.backend` so future surface-mount PRs can fork the wiring
 *  without re-resolving the switch. The resolver fall-through is
 *  documented in `backend-resolver.ts`. */
export function createChatTabSpec(opts: ChatTabOpts = {}): TabSpec {
  const id = opts.id ?? 'chat:1';
  // Resolve the backend at spec-creation time. Production callers
  // omit `userConfig` + we read live; tests pin a synthetic config.
  // Any read failure falls through to the hard default so a corrupt
  // UserConfig can't keep nexus from booting.
  let cfg: UserConfig | undefined = opts.userConfig;
  if (!cfg) {
    try { cfg = readUserConfig(); }
    catch { cfg = undefined; }
  }
  const backend: ChatBackendKind = opts.backend
    ?? (cfg
      ? resolveChatBackend({ cfg, tabId: id })
      : CHAT_BACKEND_HARD_DEFAULT);
  const meta: Record<string, unknown> = { backend };
  if (opts.resumeSessionId) meta['resumeSessionId'] = opts.resumeSessionId;
  return {
    id,
    kind: CHAT_KIND,
    label: opts.label ?? id,
    meta,
  };
}

/** Read the resolved backend back out of a chat TabSpec. Returns the
 *  hard default when meta is missing the field (legacy specs minted
 *  before PR a). */
export function readChatTabBackend(spec: TabSpec): ChatBackendKind {
  const m = spec.meta as { backend?: unknown } | undefined;
  const v = m?.backend;
  return (v === 'claude-code' || v === 'codex' || v === 'none')
    ? v
    : CHAT_BACKEND_HARD_DEFAULT;
}

/** Build the View placed inside the detail panel for this tab.
 *
 *  Two render paths:
 *
 *    - **No session** (caller didn't pass one) — shows a placeholder
 *      that surfaces the resolved backend + how to bind a session.
 *      Used until the host (PR c TUI key dispatch) wires a session
 *      to the chat tab.
 *
 *    - **Session present** — renders the message log: header (tab
 *      id + backend + status) → reversed-scroll-friendly message
 *      list (most recent at the bottom) → status footer.
 *
 *  PR β shipped only the placeholder. PR a recorded the backend on
 *  meta. PR b adds the message-log path. PR c will mount the
 *  session at boot + dispatch keys into it. */
export function createChatTabView(spec: TabSpec, session?: NexusChatSession): View {
  if (!session) return new TextView(buildPlaceholderLines(spec));
  return new TextView(buildSessionLines(spec, session));
}

function buildPlaceholderLines(spec: TabSpec): string[] {
  const backend = readChatTabBackend(spec);
  return [
    '',
    `  chat tab · ${spec.id}`,
    `  backend   · ${backend}`,
    '  ──────────────────────────────────────────────────',
    '',
    '  (caller did not bind a session — TUI render loop should',
    '   pass the chatSessions registry to createChatTabView).',
    '',
  ];
}

/** PR g.1 — guidance lines shown inside the session view's header
 *  area when backend === 'none' (boot auto-detection failed + user
 *  hasn't picked a provider in Settings yet). Surfaces the 3 chat-
 *  compatible providers + the fastest path to set each one up so the
 *  user never sees a silent ACP-spawn fail. Exported so tests + the
 *  Settings tab Quick Setup card (PR g.2) can reuse the same copy. */
export function buildNoBackendGuidanceLines(): string[] {
  return [
    '  No chat backend configured — set up one of the 3:',
    '',
    '    • OpenAI Codex   — `monad login codex` (OAuth · 추천)',
    '                       또는 set OPENAI_API_KEY env',
    '    • Anthropic Claude — set ANTHROPIC_API_KEY env',
    '                         (claude-code CLI 가 자체 인증)',
    '    • Google Gemini  — set GEMINI_API_KEY env',
    '                       (또는 GOOGLE_API_KEY)',
    '',
    '  Tab → Settings 탭의 Quick Setup 카드에서도 안내.',
    '  설정 후 새 chat 탭 (또는 nexus 재시작) 으로 자동 wire.',
  ];
}

function buildSessionLines(spec: TabSpec, session: NexusChatSession): string[] {
  const backend = session.getBackend();
  const status = session.getStatus();
  const acpSessId = session.getAcpSessionId();
  const messages = session.getMessages();
  const compose = session.getCompose();
  const out: string[] = [
    '',
    `  chat tab · ${spec.id}  · backend ${backend}  · ${formatStatus(status)}`,
    acpSessId
      ? `  acp session · ${acpSessId}`
      : '  acp session · (not yet attached — first send attaches lazily)',
    '  ──────────────────────────────────────────────────',
    '',
  ];
  // PR g.1 — when backend is 'none' (clean machine + no user pin),
  // surface the Quick Setup guidance inline so the user has a path
  // forward instead of silently typing into an inert session. Once a
  // backend is wired (env-var added + nexus restart, or Settings →
  // backend picker), this block disappears.
  // PR g.3 — additionally prepend the first-boot welcome card when
  // the dismiss flag is unset. The card explains the post-PR-g flow
  // + Settings entry point + escape hatch.
  if (backend === 'none') {
    if (shouldShowWelcomeNow()) {
      out.push(...buildWelcomeCardLines());
      out.push('');
    }
    out.push(...buildNoBackendGuidanceLines());
    out.push('');
    return out;
  }
  if (messages.length === 0) {
    out.push('  (no messages yet — type to compose, Enter to send)', '');
  } else {
    for (const msg of messages) out.push(...formatMessage(msg));
  }
  // Last error footer — surfaced separately from messages so the user
  // sees the most recent failure even after subsequent system notes.
  const err = session.getLastError();
  if (err) {
    out.push('', `  last error · ${err.message}`);
  }
  // Compose footer — always visible when the session is attachable
  // (i.e., not 'none'). Empty buffer renders just the prompt + caret
  // so users see where their input lands.
  if (status !== 'inert') {
    out.push('', '  ──────────────────────────────────────────────────');
    const inflight = status === 'streaming' || status === 'attaching';
    const caret = inflight ? '▎ (esc to cancel turn)' : '▎';
    out.push(`  > ${compose}${compose.length === 0 ? caret : caret}`);
  }
  out.push('');
  return out;
}

function formatStatus(status: ReturnType<NexusChatSession['getStatus']>): string {
  switch (status) {
    case 'inert':     return 'inert (backend = none)';
    case 'idle':      return 'idle';
    case 'attaching': return 'attaching…';
    case 'streaming': return 'streaming…';
    case 'error':     return 'error';
  }
}

function formatMessage(msg: ChatMessage): string[] {
  const prefix = msg.role === 'user'
    ? '  you  ›'
    : msg.role === 'assistant'
      ? '  ai   ›'
      : '  sys  ·';
  const trailer = msg.streaming ? ' …' : '';
  // Body wrap: split on \n + emit prefix on first line, indent on
  // continuations. Keep the renderer dumb — caller (PR c TUI render
  // loop) is the one that knows the actual terminal width and can
  // re-wrap with the proper width helper. PR b just emits raw lines.
  const body = msg.text.length === 0 && msg.streaming ? '…' : msg.text;
  const bodyLines = body.split('\n');
  const out: string[] = [];
  for (let i = 0; i < bodyLines.length; i += 1) {
    if (i === 0) out.push(`${prefix} ${bodyLines[i]}${i === bodyLines.length - 1 ? trailer : ''}`);
    else out.push(`         ${bodyLines[i]}${i === bodyLines.length - 1 ? trailer : ''}`);
  }
  // M4 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) —
  // FeedbackEnvelope-derived blocks. The daemon-side bridge pre-rendered
  // each envelope's `asciiFallback`, so TUI just indents those lines
  // under the message body. A trailing block whose phase != 'end'
  // gets the `…` trailer so the user sees the stream is live.
  if (msg.feedbackBlocks && msg.feedbackBlocks.length > 0) {
    for (const block of msg.feedbackBlocks) {
      const live = block.phase !== 'end';
      if (block.lines.length === 0) {
        // Diagnostic surface — no lines means the envelope had nothing
        // to display, but the block still exists. Show the kind so a
        // future bug ("why is nothing showing?") is greppable.
        out.push(`         ⌁ ${block.kind}${live ? ' …' : ''}`);
        continue;
      }
      for (let i = 0; i < block.lines.length; i += 1) {
        const isLast = i === block.lines.length - 1;
        const indicator = i === 0 ? '⌁' : ' ';
        const lineTrailer = isLast && live ? ' …' : '';
        out.push(`         ${indicator} ${block.lines[i]}${lineTrailer}`);
      }
    }
  }
  return out;
}
