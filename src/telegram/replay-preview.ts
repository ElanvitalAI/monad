// Tier 1 telegram fan-out arc — PR 3 · last-N replay preview helper.
//
// HTML-formatted sibling of `src/dashboard/replay-preview.ts`'s
// `renderReplayPreviewLines` (PR #833). The TUI version produces ANSI
// lines; Telegram needs HTML (parse_mode='HTML'), so we translate the
// same shape — role gutter prefix, per-message line cap, more-lines
// footer — to telegram-format.ts's HTML subset.
//
// The output is a list of HTML strings, each safe to pass into
// TelegramBot.sendMessage with parse_mode='HTML'. Each entry is split
// to stay under the 4096-byte/message cap (RESEARCH §2.1 hermes
// truncate_message pattern); callers iterate and sendMessage one at
// a time so a long catch-up never trips Telegram's parse-entity error
// or the per-message size limit.

import { markdownToTelegramHtml, splitMarkdownForTelegram } from '../telegram-format.js';
import type { LLMMessage } from '../llm.js';

/** A single message ready for sendMessage(parse_mode='HTML'). When
 *  the source message is long enough that the rendered HTML exceeds
 *  the per-Telegram-message cap, the renderer pre-splits it into
 *  multiple sub-messages here so each entry fits within the limit. */
export interface TelegramReplayPreviewMessage {
  /** Original source role — used by callers (PR 4 sinker) to decide
   *  rate-limiting / mute behavior. Telegram doesn't render this
   *  separately; it's already baked into the html via the role
   *  gutter prefix. */
  role: 'user' | 'assistant' | 'tool';
  html: string;
}

export interface RenderTelegramReplayPreviewOpts {
  /** How many of the most recent messages to include. Default 5. */
  limit?: number;
  /** Per-message line cap (after rendering). Default 8. Mirrors
   *  PR #833's renderReplayPreviewLines `linesPerMessage`. */
  linesPerMessage?: number;
  /** Per-Telegram-message HTML char cap. Default 4000 (Telegram caps
   *  at 4096; we leave 96 chars of headroom for parse-mode tag
   *  inflation, mirroring src/telegram.ts's chunk size).
   *  RESEARCH §2.1 hermes uses utf16_len + 4000 byte conservative cap. */
  perMessageHtmlMax?: number;
  /** Optional header line shown once before the first message
   *  (e.g. "↩ resumed elanous-session-3 — last 5 turns:"). When
   *  provided it's prepended to the first preview entry's html. */
  header?: string;
  /** Optional more-messages footer when the input has more messages
   *  than `limit` allows. Mirrors PR #833's "...and N more". When
   *  unset (default) no footer is appended. */
  moreFooterPrefix?: string;
}

const ROLE_PREFIX: Record<'user' | 'assistant' | 'tool', string> = {
  user: '👤',
  assistant: '🤖',
  tool: '🔧',
};

const DEFAULT_LIMIT = 5;
const DEFAULT_LINES_PER_MESSAGE = 8;
const DEFAULT_PER_MESSAGE_HTML_MAX = 4000;

function asPreviewableRole(role: string | undefined): 'user' | 'assistant' | 'tool' | null {
  if (role === 'user' || role === 'assistant' || role === 'tool') return role;
  return null;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (typeof c === 'string') { parts.push(c); continue; }
      const obj = c as { type?: string; text?: string };
      if (obj && obj.type === 'text' && typeof obj.text === 'string') parts.push(obj.text);
    }
    return parts.join('\n');
  }
  return '';
}

/** Cap a multi-line markdown body to the first `lines` lines, with a
 *  "... +N more lines" footer when truncated. The footer is plain
 *  text so the markdown→HTML pass renders it as italic-friendly
 *  ellipsis. Mirrors renderReplayPreviewLines (PR #833) line-cap
 *  behavior. */
function capLines(body: string, lines: number): string {
  const split = body.split('\n');
  if (split.length <= lines) return body;
  const head = split.slice(0, lines).join('\n');
  const remaining = split.length - lines;
  return `${head}\n_…+${remaining} more line${remaining === 1 ? '' : 's'}_`;
}

/** Render the last-N messages of a session history as Telegram HTML
 *  preview entries. Caller iterates over the result and calls
 *  sendMessage(parse_mode='HTML') for each entry. Empty preview
 *  (no eligible messages) returns an empty array.
 *
 *  Used by `/resume <daemon-id>` in PR 3 to surface the prior
 *  conversation context immediately when a chat picks up a daemon
 *  session for the first time. PR 4's boot catch-up reuses the same
 *  helper for missed turns since lastSeenMsgIdx. */
export function renderTelegramReplayPreviewHtml(
  messages: readonly LLMMessage[],
  opts: RenderTelegramReplayPreviewOpts = {},
): TelegramReplayPreviewMessage[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const linesPerMessage = opts.linesPerMessage ?? DEFAULT_LINES_PER_MESSAGE;
  const perMessageHtmlMax = opts.perMessageHtmlMax ?? DEFAULT_PER_MESSAGE_HTML_MAX;

  // Filter to previewable roles + most-recent slice.
  const preview: { role: 'user' | 'assistant' | 'tool'; text: string }[] = [];
  for (let i = messages.length - 1; i >= 0 && preview.length < limit; i--) {
    const m = messages[i]!;
    const role = asPreviewableRole(m.role);
    if (!role) continue;
    const text = extractText(m.content).trim();
    if (!text) continue;
    preview.unshift({ role, text });
  }

  if (preview.length === 0) return [];

  const out: TelegramReplayPreviewMessage[] = [];
  const totalEligible = (() => {
    let n = 0;
    for (const m of messages) {
      if (asPreviewableRole(m.role) && extractText(m.content).trim()) n++;
    }
    return n;
  })();
  const omitted = Math.max(0, totalEligible - preview.length);

  // Build a single combined markdown body so the HTML conversion is
  // one pass — keeps fenced-code-block tracking consistent across
  // role boundaries.
  const sections: string[] = [];
  if (opts.header) sections.push(opts.header);
  for (let i = 0; i < preview.length; i++) {
    const m = preview[i]!;
    const prefix = ROLE_PREFIX[m.role];
    const capped = capLines(m.text, linesPerMessage);
    sections.push(`${prefix} ${capped}`);
  }
  if (omitted > 0 && opts.moreFooterPrefix !== undefined) {
    sections.push(`${opts.moreFooterPrefix} ${omitted}`);
  }

  const fullHtml = markdownToTelegramHtml(sections.join('\n\n'));
  // Pre-split for the per-message cap. splitMarkdownForTelegram
  // already enforces the same 4096-bound logic the live streamer
  // uses; we just feed the rendered html (which itself was derived
  // from markdown) through the same splitter to be conservative.
  // A future refactor (PR 4 polish, RESEARCH §B.4) could lift this
  // splitter into the gateway abstraction.
  const chunks = splitMarkdownForTelegram(fullHtml, perMessageHtmlMax);

  // Synthesize role for chunked output: the first chunk inherits the
  // first preview message's role; subsequent chunks default to
  // 'assistant' (most catch-up content). Role is only used by callers
  // for rate-limit / mute decisions, not for re-rendering.
  for (let i = 0; i < chunks.length; i++) {
    out.push({
      role: i === 0 ? (preview[0]?.role ?? 'assistant') : 'assistant',
      html: chunks[i]!,
    });
  }
  return out;
}
