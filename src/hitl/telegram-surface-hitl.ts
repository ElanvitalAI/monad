// Surface-scoped Telegram HITL — route a delegated ACP agent's
// permission (yes/no) AND multi-option question prompts back to the
// EXACT chat that triggered the mission (e.g. the `/cc` sender), not a
// globally-configured HITL bot/chat.
//
// One `onCallbackQuery` subscription is shared across every chat and
// both prompt kinds, dispatched by callback_data prefix:
//   - `elanous-hitl:<reqId>:yes|no`      → yes/no ConfirmChannel
//   - `mq:<sid>:<qIdx>:<opt|done|other>` → multi-option QuestionChannel
// Dispatching by id (globally unique) means unknown ids from a sibling
// handler are ignored quietly rather than double-answered.
//
// The channels satisfy the `ConfirmChannel` / `QuestionChannel`
// contracts `requestConfirmation()` / `requestQuestion()` race, so the
// ACP HITL adapters work over them unchanged. Discord / iOS get the
// same treatment by providing their own channels — the delegation path
// stays channel-agnostic.

import type { TelegramBot, TgCallbackQuery } from '../telegram.js';
import type { ConfirmChannel, ConfirmRequest, HitlAnswer } from './confirm.js';
import type { QuestionChannel } from './question.js';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
} from '../ask-user-question/types.js';
import { debug } from '../debug/log.js';

const CALLBACK_PREFIX = 'elanous-hitl';
const QUESTION_PREFIX = 'mq';

interface Pending {
  chatId: number;
  messageId?: number;
  /** When the prompt was posted — for the tap→resolve latency log. */
  postedAt: number;
  /** Caller correlation id (e.g. ACP `acp-perm-<sessionId>-<ts>`) — kept
   *  for logs only; NOT used as the callback_data key (see the token). */
  requestId?: string;
  resolve: (answer: HitlAnswer | null) => void;
}

interface QSession {
  chatId: number;
  threadId?: number;
  req: AskUserQuestionRequest;
  qIdx: number;
  answers: Record<string, string | string[]>;
  otherText: Record<string, string>;
  /** qIdx → chosen option indices (multiSelect). */
  selected: Map<number, Set<number>>;
  messageId?: number;
  resolve: (r: AskUserQuestionResult | null) => void;
  settled: boolean;
  cancelCapture?: () => void;
}

export interface TelegramSurfaceHitl {
  /** A yes/no `ConfirmChannel` posting into `chatId` (opt. forum
   *  `threadId`), resolving when that chat's user taps. */
  confirmChannelForChat(chatId: number, threadId?: number): ConfirmChannel;
  /** A multi-option `QuestionChannel` posting into `chatId`, walking
   *  the 1–3 questions and resolving the collected answers. */
  questionChannelForChat(chatId: number, threadId?: number): QuestionChannel;
}

let _counter = 0;
let _qCounter = 0;

export function createTelegramSurfaceHitl(bot: TelegramBot): TelegramSurfaceHitl {
  const pending = new Map<string, Pending>();
  const qSessions = new Map<string, QSession>();

  bot.onCallbackQuery(async (q: TgCallbackQuery) => {
    if (q.data.startsWith(`${CALLBACK_PREFIX}:`)) {
      await handleConfirmCallback(q);
      return;
    }
    if (q.data.startsWith(`${QUESTION_PREFIX}:`)) {
      await handleQuestionCallback(q);
      return;
    }
  });

  // ── Confirm (yes/no) ─────────────────────────────────────────────

  async function handleConfirmCallback(q: TgCallbackQuery): Promise<void> {
    const parts = q.data.split(':');
    const token = parts[1];
    const decision = parts[2];
    const entry = token ? pending.get(token) : undefined;
    // Log EVERY elanous-hitl tap so an unmatched one (a future callback_data
    // truncation / mismatch / expiry) is VISIBLE instead of silently
    // dropped — the exact blind spot that hid the 64-byte truncation bug.
    if (!entry || (decision !== 'yes' && decision !== 'no')) {
      // Log (diagnostic) but DON'T ack — a `elanous-hitl:`-prefixed tap we
      // don't own may belong to the sibling global-HITL handler
      // (telegram-channel.ts, same prefix); acking here would stomp it.
      debug.log('hitl.telegram.confirm.tap-unmatched', token ?? '?', {
        data: q.data, dataLen: q.data.length, reason: !entry ? 'no-pending' : 'bad-decision',
      });
      return;
    }
    const yes = decision === 'yes';
    pending.delete(token!);
    debug.log('hitl.telegram.confirm.resolve', token!, {
      yes, elapsedMs: Date.now() - entry.postedAt, requestId: entry.requestId,
    });
    // Immediate feedback — toast + edit the prompt to a clear status so the
    // user knows the tap registered NOW (the agent's resume may lag).
    // NOTE: this is a POINT-IN-TIME confirmation of the tap, not a live
    // progress tracker — there is no wiring from turn-completion back to
    // this per-permission message, so a "진행 중…" here would linger
    // forever and contradict the separate completion/result message
    // (the placeholder `⏳ Working…` is the authoritative progress +
    // completion indicator). So confirm the approval only.
    await bot.answerCallbackQuery(q.id, { text: yes ? '✓ 승인됨' : '✗ 거부됨' });
    if (entry.messageId !== undefined) {
      try { await bot.editMessageText(entry.chatId, entry.messageId, yes ? '✓ 승인됨' : '✗ 거부됨'); }
      catch { /* best effort */ }
      try { await bot.clearMessageReplyMarkup(entry.chatId, entry.messageId); }
      catch { /* best effort */ }
    }
    entry.resolve(yes);
  }

  function confirmChannelForChat(chatId: number, threadId?: number): ConfirmChannel {
    let currentToken: string | null = null;
    return {
      name: 'telegram',
      async request(req: ConfirmRequest): Promise<HitlAnswer | null> {
        // Short, colon-free internal token for callback_data — NOT the
        // caller's requestId. ACP mints `acp-perm-<sessionId>-<ts>` whose
        // sessionId can be a 36-char UUID (or the namespaced
        // `acp-cli:claude:<uuid>` form with embedded ':'), which BOTH
        // overran Telegram's 64-byte callback_data cap (dropping the
        // trailing `:yes|:no` decision) AND broke `split(':')` parsing —
        // so taps never matched the pending approver and the turn hung
        // until the 120s HITL timeout. A `c<counter>` token stays tiny and
        // delimiter-safe regardless of the requestId.
        const token = `c${(_counter += 1).toString(36)}`;
        currentToken = token;
        const text = [req.prompt, req.detail ? `\n${req.detail}` : '']
          .filter(Boolean)
          .join('');
        let posted: { messageId: number } | undefined;
        try {
          posted = await bot.sendInlineKeyboard(
            chatId,
            text,
            [[
              { text: req.yesLabel ?? 'Approve', data: `${CALLBACK_PREFIX}:${token}:yes` },
              { text: req.noLabel ?? 'Reject', data: `${CALLBACK_PREFIX}:${token}:no` },
            ]],
            threadId !== undefined ? { threadId } : {},
          );
        } catch {
          return null;
        }
        debug.log('hitl.telegram.confirm.post', token, {
          chatId, requestId: req.requestId, messageId: posted?.messageId, hasMessage: posted !== undefined,
        });
        return await new Promise<HitlAnswer | null>((resolve) => {
          pending.set(token, { chatId, messageId: posted?.messageId, postedAt: Date.now(), requestId: req.requestId, resolve });
        });
      },
      async cancel(): Promise<void> {
        if (!currentToken) return;
        const entry = pending.get(currentToken);
        pending.delete(currentToken);
        currentToken = null;
        if (!entry) return;
        if (entry.messageId !== undefined) {
          try { await bot.editMessageText(chatId, entry.messageId, '✗ cancelled'); }
          catch { /* best effort */ }
          try { await bot.clearMessageReplyMarkup(chatId, entry.messageId); }
          catch { /* best effort */ }
        }
        entry.resolve(null);
      },
    };
  }

  // ── Question (multi-option) ──────────────────────────────────────

  /** Render (or re-render) the current question. Re-render (multiSelect
   *  toggle) edits the message text — the selection state lives in the
   *  text ("선택됨: …"), so the static buttons don't need updating. */
  async function renderQuestion(sid: string, s: QSession): Promise<void> {
    const q = s.req.questions[s.qIdx]!;
    const n = s.req.questions.length;
    const lines: string[] = [`[${q.header}] ${s.qIdx + 1}/${n}`, '', q.question, ''];
    q.options.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`);
    });
    if (q.multiSelect) {
      const sel = s.selected.get(s.qIdx);
      if (sel && sel.size > 0) {
        lines.push('', `선택됨: ${[...sel].map((i) => q.options[i]!.label).join(', ')}`);
      }
      lines.push('', '여러 개 고른 뒤 ✅ 완료를 누르세요.');
    }
    const text = lines.join('\n');

    if (s.messageId !== undefined) {
      try { await bot.editMessageText(s.chatId, s.messageId, text); }
      catch { /* best effort — the buttons stay valid */ }
      return;
    }
    const rows: Array<Array<{ text: string; data: string }>> = q.options.map((o, i) => [
      { text: o.label, data: `${QUESTION_PREFIX}:${sid}:${s.qIdx}:${i}` },
    ]);
    const lastRow: Array<{ text: string; data: string }> = [];
    if (q.multiSelect) lastRow.push({ text: '✅ 완료', data: `${QUESTION_PREFIX}:${sid}:${s.qIdx}:done` });
    if (q.includeOther !== false) lastRow.push({ text: '✏️ 기타…', data: `${QUESTION_PREFIX}:${sid}:${s.qIdx}:other` });
    if (lastRow.length > 0) rows.push(lastRow);
    const posted = await bot.sendInlineKeyboard(
      s.chatId, text, rows,
      s.threadId !== undefined ? { threadId: s.threadId } : {},
    );
    s.messageId = posted?.messageId;
  }

  function settleQuestion(sid: string, s: QSession, cancelled: boolean): void {
    if (s.settled) return;
    s.settled = true;
    qSessions.delete(sid);
    s.cancelCapture?.();
    const result: AskUserQuestionResult = { answers: s.answers };
    if (Object.keys(s.otherText).length > 0) result.otherText = s.otherText;
    if (cancelled) result.cancelled = true;
    s.resolve(result);
  }

  async function advanceQuestion(sid: string, s: QSession): Promise<void> {
    s.qIdx += 1;
    s.messageId = undefined; // next question posts a fresh message
    if (s.qIdx < s.req.questions.length) await renderQuestion(sid, s);
    else settleQuestion(sid, s, false);
  }

  async function finalizeMessage(s: QSession, summary: string): Promise<void> {
    if (s.messageId === undefined) return;
    try { await bot.editMessageText(s.chatId, s.messageId, summary); } catch { /* */ }
    try { await bot.clearMessageReplyMarkup(s.chatId, s.messageId); } catch { /* */ }
  }

  async function handleQuestionCallback(q: TgCallbackQuery): Promise<void> {
    const parts = q.data.split(':'); // [mq, sid, qIdx, token]
    if (parts.length < 4) return;
    const sid = parts[1]!;
    const qIdx = Number(parts[2]);
    const token = parts[3]!;
    const s = qSessions.get(sid);
    if (!s || s.settled) { await bot.answerCallbackQuery(q.id, { text: '만료됨' }); return; }
    if (qIdx !== s.qIdx) { await bot.answerCallbackQuery(q.id, {}); return; }
    const cur = s.req.questions[s.qIdx]!;

    if (token === 'other') {
      await bot.answerCallbackQuery(q.id, { text: '기타 입력' });
      await finalizeMessage(s, `${cur.question}\n\n✏️ 답을 다음 메시지로 입력해 주세요.`);
      s.cancelCapture = bot.captureNextText(s.chatId, s.threadId, (text) => {
        if (text === null) { settleQuestion(sid, s, true); return; }
        s.answers[cur.id] = 'Other';
        s.otherText[cur.id] = text;
        void advanceQuestion(sid, s);
      });
      return;
    }

    if (cur.multiSelect && token === 'done') {
      await bot.answerCallbackQuery(q.id, { text: '완료' });
      const sel = s.selected.get(s.qIdx);
      const labels = sel && sel.size > 0 ? [...sel].map((i) => cur.options[i]!.label) : [];
      s.answers[cur.id] = labels;
      await finalizeMessage(s, `${cur.question}\n\n✅ ${labels.join(', ') || '(없음)'}`);
      await advanceQuestion(sid, s);
      return;
    }

    const optIdx = Number(token);
    if (!Number.isInteger(optIdx) || optIdx < 0 || optIdx >= cur.options.length) {
      await bot.answerCallbackQuery(q.id, {});
      return;
    }

    if (cur.multiSelect) {
      await bot.answerCallbackQuery(q.id, {});
      const sel = s.selected.get(s.qIdx) ?? new Set<number>();
      if (sel.has(optIdx)) sel.delete(optIdx); else sel.add(optIdx);
      s.selected.set(s.qIdx, sel);
      await renderQuestion(sid, s);
      return;
    }

    // single-select — pick + advance
    const label = cur.options[optIdx]!.label;
    await bot.answerCallbackQuery(q.id, { text: label });
    s.answers[cur.id] = label;
    await finalizeMessage(s, `${cur.question}\n\n✅ ${label}`);
    await advanceQuestion(sid, s);
  }

  function questionChannelForChat(chatId: number, threadId?: number): QuestionChannel {
    let currentSid: string | null = null;
    return {
      name: 'telegram',
      async ask(req: AskUserQuestionRequest): Promise<AskUserQuestionResult | null> {
        if (!req.questions || req.questions.length === 0) return null;
        const sid = `q${(_qCounter += 1).toString(36)}`;
        currentSid = sid;
        const s: QSession = {
          chatId, threadId, req, qIdx: 0,
          answers: {}, otherText: {}, selected: new Map(),
          settled: false, resolve: () => {},
        };
        const p = new Promise<AskUserQuestionResult | null>((resolve) => { s.resolve = resolve; });
        qSessions.set(sid, s);
        try { await renderQuestion(sid, s); }
        catch { qSessions.delete(sid); return null; }
        return p;
      },
      cancel(): void {
        const sid = currentSid;
        currentSid = null;
        if (!sid) return;
        const s = qSessions.get(sid);
        if (!s || s.settled) return;
        s.settled = true;
        qSessions.delete(sid);
        s.cancelCapture?.();
        void finalizeMessage(s, '✗ cancelled');
        s.resolve(null);
      },
    };
  }

  return { confirmChannelForChat, questionChannelForChat };
}
