// ── Discord AskUserQuestion 채널 (C1 · 2026-07-12) ────────────────────
//
// 세션 패브릭 아크 C트랙 C1: ACP 위임 중 백엔드가 던지는 QUESTION을
// 디스코드 버튼 컴포넌트로 표면화하고, 탭 결과를 턴에 되돌린다.
//
// 철학 (대표 확정 · feedback_autonomous_delegation_no_edit_approval):
// 자율 위임에서 PERMISSION은 auto-approve — 여기서 다루는 것은
// **QUESTION만**(모델이 정말로 사용자 판단을 필요로 하는 갈림길).
//
// 형태: 질문당 메시지 1개 + 옵션 버튼(행당 5개·최대 25개), customId =
// `monad-q:<sid>:<optIdx>`. 탭 → type 6 ACK(무소음 업데이트) → 메시지를
// 선택 결과로 편집 → 다음 질문 렌더 or resolve. 다지선다(multiSelect)는
// v1에서 첫 탭을 단일 선택으로 수용(대부분의 질문 의도에 충분 — 완전한
// 토글 위저드는 후속).
//
// 텔레그램 대응물: hitl/telegram-surface-hitl.ts questionChannelForChat.

import type { QuestionChannel } from './hitl/question.js';
import type { AskUserQuestionRequest, AskUserQuestionResult } from './ask-user-question/types.js';
import { debug } from './debug/log.js';

const CUSTOM_ID_PREFIX = 'monad-q';
const REST_BASE = 'https://discord.com/api/v10';
const MAX_OPTIONS = 25; // 5 rows × 5 buttons

/** Narrow bot surface — real impl is src/discord.ts DiscordBot. */
export interface DiscordQuestionBot {
  sendMessageWithComponents(
    channelId: string,
    text: string,
    components: ReadonlyArray<Record<string, unknown>>,
  ): Promise<{ id: string } | null>;
  editMessage(channelId: string, messageId: string, text: string): Promise<void>;
}

interface QSession {
  channelId: string;
  req: AskUserQuestionRequest;
  qIdx: number;
  answers: Record<string, string | string[]>;
  messageId: string | null;
  settled: boolean;
  resolve: (r: AskUserQuestionResult | null) => void;
}

export interface DiscordQuestionRuntime {
  /** Per-chat QuestionChannel — pass into runAcpTurn hitlQuestionChannels. */
  channelFor(channelId: string): QuestionChannel;
  /** Route a raw INTERACTION_CREATE payload. Returns true when the
   *  interaction was a monad-q button tap this runtime consumed. */
  handleComponentInteraction(raw: Record<string, unknown>): Promise<boolean>;
}

export interface CreateDiscordQuestionRuntimeOpts {
  getBot: () => DiscordQuestionBot | null;
  log?: (msg: string) => void;
  __fetchImpl?: typeof fetch;
}

let _sidCounter = 0;

export function createDiscordQuestionRuntime(
  opts: CreateDiscordQuestionRuntimeOpts,
): DiscordQuestionRuntime {
  const log = opts.log ?? ((): void => {});
  const fetchImpl = opts.__fetchImpl ?? fetch;
  const sessions = new Map<string, QSession>();

  function renderText(s: QSession): string {
    const q = s.req.questions[s.qIdx]!;
    const lines = [
      `🧭 **[${q.header}]** ${q.question}`,
      '',
      ...q.options.map((o, i) => `**${i + 1}. ${o.label}** — ${o.description}`),
    ];
    if (q.multiSelect) lines.push('', '_복수선택 질문 — 가장 중요한 하나를 탭하세요 (v1)._');
    if (s.req.questions.length > 1) lines.push('', `_질문 ${s.qIdx + 1}/${s.req.questions.length}_`);
    return lines.join('\n');
  }

  function renderComponents(sid: string, s: QSession): Array<Record<string, unknown>> {
    const q = s.req.questions[s.qIdx]!;
    const buttons = q.options.slice(0, MAX_OPTIONS).map((o, i) => ({
      type: 2, // BUTTON
      style: 2, // SECONDARY
      label: `${i + 1}. ${o.label}`.slice(0, 80),
      custom_id: `${CUSTOM_ID_PREFIX}:${sid}:${i}`,
    }));
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push({ type: 1, components: buttons.slice(i, i + 5) }); // ACTION_ROW
    }
    return rows;
  }

  async function renderQuestion(sid: string, s: QSession): Promise<void> {
    const bot = opts.getBot();
    if (!bot) throw new Error('discord bot not ready');
    const sent = await bot.sendMessageWithComponents(
      s.channelId, renderText(s), renderComponents(sid, s),
    );
    s.messageId = sent?.id ?? null;
  }

  function channelFor(channelId: string): QuestionChannel {
    let currentSid: string | null = null;
    return {
      name: 'discord',
      async ask(req: AskUserQuestionRequest): Promise<AskUserQuestionResult | null> {
        if (!req.questions || req.questions.length === 0) return null;
        if (!opts.getBot()) return null; // not configured — drop from race
        const sid = `d${(_sidCounter += 1).toString(36)}`;
        currentSid = sid;
        const s: QSession = {
          channelId, req, qIdx: 0, answers: {}, messageId: null,
          settled: false, resolve: () => {},
        };
        const p = new Promise<AskUserQuestionResult | null>((resolve) => { s.resolve = resolve; });
        sessions.set(sid, s);
        try { await renderQuestion(sid, s); }
        catch (err) {
          sessions.delete(sid);
          log(`[discord-q] render failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
        return p;
      },
      async cancel(): Promise<void> {
        const sid = currentSid;
        if (!sid) return;
        const s = sessions.get(sid);
        if (!s || s.settled) return;
        s.settled = true;
        sessions.delete(sid);
        const bot = opts.getBot();
        if (bot && s.messageId) {
          try { await bot.editMessage(s.channelId, s.messageId, '⌛ (질문 종료 — 다른 채널에서 응답됐거나 시간 초과)'); }
          catch { /* best-effort */ }
        }
        s.resolve(null);
      },
    };
  }

  async function ackComponent(raw: Record<string, unknown>): Promise<void> {
    const id = raw.id as string | undefined;
    const token = raw.token as string | undefined;
    if (!id || !token) return;
    try {
      // type 6 = DEFERRED_UPDATE_MESSAGE — silent ack, we edit ourselves.
      await fetchImpl(`${REST_BASE}/interactions/${id}/${token}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 6 }),
      });
    } catch { /* ack 실패해도 편집 경로가 상태를 보여줌 */ }
  }

  async function handleComponentInteraction(raw: Record<string, unknown>): Promise<boolean> {
    if ((raw as { type?: number }).type !== 3) return false; // MESSAGE_COMPONENT
    const data = raw.data as { custom_id?: string } | undefined;
    const customId = data?.custom_id;
    if (!customId || !customId.startsWith(`${CUSTOM_ID_PREFIX}:`)) return false;
    const [, sid, idxRaw] = customId.split(':');
    const s = sid ? sessions.get(sid) : undefined;
    const idx = Number(idxRaw);
    await ackComponent(raw);
    if (!s || s.settled || !Number.isInteger(idx)) {
      debug.log('hitl.discord.question.tap-unmatched', customId, { known: !!s });
      return true; // ours, but stale — consumed
    }
    const q = s.req.questions[s.qIdx]!;
    const opt = q.options[idx];
    if (!opt) return true;
    s.answers[q.id] = q.multiSelect ? [opt.label] : opt.label;
    const bot = opts.getBot();
    if (bot && s.messageId) {
      try { await bot.editMessage(s.channelId, s.messageId, `🧭 **[${q.header}]** ${q.question}\n→ ✅ **${opt.label}**`); }
      catch { /* best-effort */ }
    }
    if (s.qIdx + 1 < s.req.questions.length) {
      s.qIdx += 1;
      try { await renderQuestion(sid!, s); }
      catch {
        // Next-question render failed — settle with what we have.
        s.settled = true;
        sessions.delete(sid!);
        s.resolve({ answers: s.answers, cancelled: true });
      }
      return true;
    }
    s.settled = true;
    sessions.delete(sid!);
    debug.log('hitl.discord.question.resolve', sid!, { answers: Object.keys(s.answers).length });
    s.resolve({ answers: s.answers });
    return true;
  }

  return { channelFor, handleComponentInteraction };
}
