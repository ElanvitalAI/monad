// ── 텔레그램 스트리밍 sink (C5b · 2026-07-16) ─────────────────────────────────────
//
// StreamingSurfaceSink 텔레그램 구현 — 공통 코어(draft-stream-loop) 위에 텔레그램 특유 기법을
// 얹는다(hermes-agent·openclaw 조사 채택). 라이브 스트림 핸들(placeholder message_id·throttle)을
// endpoint 별로 소유. 현 makeStreamer 흡수 + 강화:
//
//  1. plain-while-streaming · MarkdownV2-only-at-finalize + plain fallback — ⚠️ 현 monad 는
//     mid-stream markdown 편집이라 미완 코드펜스/엔티티가 parse 에러. 스트리밍 중엔 plain,
//     finalize 에만 서식(실패 시 plain 재시도). **실질 개선.**
//  2. saturated dedup + retry_after suspend + minInitialChars — 공통 코어(draft-stream-loop)가 처리.
//  3. finalize 시 4096 split + reply-threaded 연속 메시지.
//  4. inline progress — 툴 활동(⚙️…✓)·추론(🧠)을 스트림 텍스트에 inline 렌더(대표 §10-1 결정).
//
// transport 주입 → 실봇 없이 유닛테스트. 실배선(telegram-trigger-bot)이 bot.sendMessage/
// editMessageText 로 transport 구현 + splitMarkdownForTelegram 주입. flag-OFF(streaming.telegram).

import { createDraftStreamLoop, type DraftStreamLoop } from './draft-stream-loop.js';
import {
  type StreamingMode, type CompositorState,
  createCompositorState, applyChunk, composeStream, crossedBlockBoundary,
} from './stream-compositor.js';
import {
  createTypingGovernor, createGroupFairQueue, shouldRotate,
  type TypingGovernor, type GroupFairQueue,
} from './telegram-stream-enh.js';
import { debug } from '../../debug/log.js';
import { parseTelegramEndpoint, isOwnInstanceEndpoint, matchesBot } from '../session-endpoint-key.js';
import type { StreamingSurfaceSink, SessionChunkEvent, SessionStreamFinal, DeliverContext } from '../session-fanout.js';

/** 텔레그램 전송 어댑터(주입) — 실배선은 TelegramBot.sendMessage/editMessageText. markdown=finalize 만.
 *  chatAction/delete 는 C5-enh(typing governor·rotation) 선택 — 미주입이면 해당 강화 no-op. */
export interface TelegramStreamTransport {
  send: (chatId: number, text: string, opts: { threadId?: number; markdown?: boolean; replyTo?: number }) => Promise<{ messageId: number }>;
  edit: (chatId: number, messageId: number, text: string, opts: { threadId?: number; markdown?: boolean }) => Promise<void>;
  /** §C5-enh typing governor — sendChatAction("typing"). */
  chatAction?: (chatId: number, threadId?: number) => Promise<void>;
  /** §C5-enh rotation — 옛 placeholder 삭제(post-new-then-delete). */
  delete?: (chatId: number, messageId: number) => Promise<void>;
}

export interface TelegramStreamSinkConfig {
  throttleMs?: number;        // 편집 간격. 기본 1100(디스코드 5edit/5s 미만·텔레그램 ~1s).
  minInitialChars?: number;   // 첫 전송 최소 길이. 기본 0.
  maxToolLines?: number;      // inline 툴 tail 최대 줄. 기본 6.
  /** 스트리밍 모드(C5-enh·§6-8). 기본 partial(현 C5b full stream 행동 유지). */
  mode?: StreamingMode;
  /** §5.2-5 typing governor — 첫 청크 전 sendChatAction("typing") 라이브 신호. 기본 off. */
  typing?: boolean;
  /** §5.2-6 forum fair-queue — supergroup 다중 토픽 라운드로빈. 기본 off. */
  fairQueue?: boolean;
  /** §10-2 scroll-jump rotation — post-new-then-delete. 기본 off. */
  rotate?: boolean;
  /** 스트리밍 프리뷰 단일 메시지 최대 글자(초과분은 tail·다중 메시지 방지). 기본 3800. finalize 는 무관. */
  streamMaxChars?: number;
  /** 최종 텍스트 분할(기본 단순 4096). 실배선은 splitMarkdownForTelegram 주입. */
  split?: (text: string) => string[];
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** ★ 봇 스코프(2026-07-21·"확" 크로스봇 누출 근본수리) — 이 sink 가 서비스하는 봇 id(=token prefix).
   *  endpoint 의 botId 와 다르면 배달 스킵(matchesBot 가드). 여러 봇이 같은 chatId(대표 user id)를 공유할
   *  때, 봇 무가드면 응답 첫 청크가 엉뚱한 봇(코나투스)으로 새 "확"으로 고착됐다. 미지정=봇 무관(하위호환). */
  botId?: string;
}

interface LiveHandle {
  streamId: string;
  chatId: number;
  threadId?: number;
  messageId: number | null;   // placeholder(첫 전송에 확정)
  loop: DraftStreamLoop;
  state: CompositorState;
  lastRendered: string;       // block 모드 cadence 판정용(직전 편집 텍스트)
  edits: number;              // rotation — 편집 횟수
  createdAt: number;          // rotation — placeholder 생성 시각
  lastRotateAt: number;       // rotation — 직전 rotate 시각
}

/** 텔레그램 에러의 retry_after(초) → ms. (telegram.ts 가 err.retryAfter 로 노출) */
function telegramRetryAfterMs(err: unknown): number | null {
  const ra = (err as { retryAfter?: number } | null)?.retryAfter;
  return typeof ra === 'number' && ra > 0 ? ra * 1000 : null;
}

/** endpoint → 배달 chat. 완전스코프 키면 parse+인스턴스+봇 가드, 아니면 bare chatId 폴백.
 *  ★ 봇 가드(2026-07-21·"확" 근본수리) — sinkBotId 주어지면 endpoint 의 botId 와 matchesBot 로 대조해
 *  다른 봇의 endpoint 는 스킵(크로스봇 누출 차단). BOT_ANY/미상은 하위호환 허용. */
function resolveChat(endpoint: string, sinkBotId?: string): { chatId: number; threadId?: number } | null {
  const parsed = parseTelegramEndpoint(endpoint);
  if (parsed) {
    if (!isOwnInstanceEndpoint(parsed.instance)) return null; // 크로스 인스턴스 차단
    if (!matchesBot(parsed.botId, sinkBotId)) return null;     // ★ 크로스봇 차단(확 누출 근본수리)
    const chatId = Number(parsed.chatId);
    if (!Number.isFinite(chatId)) return null;
    const threadId = Number(parsed.threadId);
    return { chatId, ...(Number.isFinite(threadId) && threadId > 0 ? { threadId } : {}) };
  }
  const chatId = Number(endpoint);
  return Number.isFinite(chatId) ? { chatId } : null;
}

function defaultSplit(text: string, max = 4096): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

export function createTelegramStreamSink(
  transport: TelegramStreamTransport,
  config: TelegramStreamSinkConfig = {},
): StreamingSurfaceSink {
  const throttleMs = config.throttleMs ?? 1100;
  const minInitialChars = config.minInitialChars ?? 0;
  const maxToolLines = config.maxToolLines ?? 6;
  const mode: StreamingMode = config.mode ?? 'partial';
  const now = config.now ?? Date.now;
  const split = config.split ?? ((t: string) => defaultSplit(t));
  const handles = new Map<string, LiveHandle>();

  // §C5-enh governors — 전부 config-gated(기본 off) → 라이브 텔레그램 스트리밍 무접촉.
  const typing: TypingGovernor | null = config.typing && transport.chatAction
    ? createTypingGovernor({ sendChatAction: transport.chatAction, ...(config.now ? { now: config.now } : {}) })
    : null;
  const fairQueue: GroupFairQueue | null = config.fairQueue ? createGroupFairQueue() : null;
  const rotateOn = config.rotate === true && transport.delete != null;
  /** fair-queue thread 키 — chatId 안 threadId(없으면 main). */
  const threadKey = (chatId: number, threadId?: number): string => `${chatId}:${threadId ?? 'main'}`;

  // ⚠️ 스트리밍 프리뷰 단일 메시지 cap — partial 로 누적 full 텍스트가 4096 을 넘으면 bot.editMessageText
  // 가 내부 split 으로 **새 메시지를 만들어** 스트리밍 중 여러 plain 메시지가 자라남(2026-07-16 dogfood
  // 실측). 스트리밍 프리뷰는 tail 만 단일 메시지로 보이고(초과분 …), 완전 텍스트는 finalize 의 split+
  // markdown 이 배달한다. 기본 3800(4096 여유·⚙️툴 tail 공간).
  const streamMaxChars = config.streamMaxChars ?? 3800;

  /** 컴포지터 렌더 — 모드별(off 억제·progress compact·partial/block full). 대표 §10-1 inline 결정.
   *  스트리밍 프리뷰는 streamMaxChars 로 cap(tail·다중 메시지 방지). finalize 는 무관(full split). */
  function render(h: LiveHandle): string | null {
    const text = composeStream(h.state, mode, { maxToolLines });
    if (text == null) return null;
    if (text.length <= streamMaxChars) return text;
    return `…${text.slice(text.length - streamMaxChars)}`; // 최신 tail 만(스트리밍 프리뷰)
  }

  /** rotation — 오래 편집된 placeholder 를 post-new-then-delete 로 하단 재배치(scroll-jump 회피). */
  async function maybeRotate(h: LiveHandle, text: string): Promise<void> {
    if (!rotateOn || h.messageId == null || transport.delete == null) return;
    if (!shouldRotate({ edits: h.edits, createdAt: h.createdAt, lastRotateAt: h.lastRotateAt }, now())) return;
    const oldId = h.messageId;
    try {
      const r = await transport.send(h.chatId, text, { ...(h.threadId != null ? { threadId: h.threadId } : {}), markdown: false });
      const newId = r.messageId;
      await transport.delete(h.chatId, oldId); // detached delete(fail-soft)
      h.messageId = newId;
      h.createdAt = now();
      h.lastRotateAt = now();
      h.edits = 0;
      try { debug.log('telegram.stream', 'rotate', { streamId: h.streamId, oldId, newId }); } catch { /* fail-soft */ }
    } catch {
      // ⚠️ rotate 실패(특히 delete 실패)면 옛 메시지 잔존 = "기존 내용 남음" 유발. 관측 필수.
      try { debug.log('telegram.stream', 'rotate-fail', { streamId: h.streamId, oldId }, { level: 'error' }); } catch { /* fail-soft */ }
    }
  }

  function makeHandle(endpoint: string, streamId: string, chat: { chatId: number; threadId?: number }): LiveHandle {
    const h: LiveHandle = {
      streamId, chatId: chat.chatId, ...(chat.threadId != null ? { threadId: chat.threadId } : {}),
      messageId: null, state: createCompositorState(), lastRendered: '',
      edits: 0, createdAt: now(), lastRotateAt: Number.NEGATIVE_INFINITY,
      loop: undefined as unknown as DraftStreamLoop,
    };
    h.loop = createDraftStreamLoop(
      {
        // 스트리밍 중엔 **plain**(parse 에러 회피). 첫 전송=send(placeholder 확정), 이후=edit.
        edit: async (text) => {
          if (h.messageId == null) {
            const r = await transport.send(h.chatId, text, { ...(h.threadId != null ? { threadId: h.threadId } : {}), markdown: false });
            h.messageId = r.messageId;
            h.createdAt = now();
            try { debug.log('telegram.stream', 'placeholder', { streamId: h.streamId, msgId: h.messageId, chars: text.length }); } catch { /* fail-soft */ }
          } else {
            await transport.edit(h.chatId, h.messageId, text, { ...(h.threadId != null ? { threadId: h.threadId } : {}), markdown: false });
            try { debug.log('telegram.stream', 'edit', { streamId: h.streamId, msgId: h.messageId, chars: text.length }); } catch { /* fail-soft */ }
          }
          h.edits++;
          if (fairQueue) fairQueue.served(h.chatId, threadKey(h.chatId, h.threadId));
          await maybeRotate(h, text);
        },
        retryAfterMs: telegramRetryAfterMs,
        ...(config.now ? { now: config.now } : {}),
        ...(config.schedule ? { schedule: config.schedule } : {}),
      },
      { throttleMs, minInitialChars },
    );
    return h;
  }

  return {
    // 한 프로세스에 봇이 여럿이면 합성 sink 가 이것으로 «내 endpoint 인가»를 고른다(session-fanout pickMember).
    accepts(endpoint: string): boolean { return resolveChat(endpoint, config.botId) !== null; },
    onChunk(endpoint: string, ev: SessionChunkEvent): void {
      const chat = resolveChat(endpoint, config.botId);   // ★ 봇 가드 — 다른 봇 endpoint 스킵(확 누출 차단)
      if (!chat) return;
      let h = handles.get(endpoint);
      if (!h || h.streamId !== ev.streamId) {
        // 새 스트림 — 기존 핸들 있으면 정리(턴 경계).
        if (h) { h.loop.stop(); if (fairQueue) fairQueue.served(h.chatId, threadKey(h.chatId, h.threadId)); }
        h = makeHandle(endpoint, ev.streamId, chat);
        handles.set(endpoint, h);
        if (typing) typing.ping(chat.chatId, chat.threadId); // §5.2-5 첫 청크 전 liveness
        if (fairQueue) fairQueue.enqueue(chat.chatId, threadKey(chat.chatId, chat.threadId));
      }
      applyChunk(h.state, ev);
      const text = render(h);
      if (text == null) return; // off 모드·빈 상태 — 편집 억제
      // block 모드 — 새 블록 경계(빈 줄)를 지날 때만 편집(flicker 감소). 그 외 모드는 매 청크.
      if (mode === 'block' && h.lastRendered && !crossedBlockBoundary(h.lastRendered, text)) return;
      // §5.2-6 fair-queue — supergroup 다중 토픽이면 라운드로빈 순번일 때만 편집(다른 토픽 무영향).
      if (fairQueue && !fairQueue.isTurn(h.chatId, threadKey(h.chatId, h.threadId))) return;
      h.lastRendered = text;
      h.loop.update(text);
    },

    async onFinal(endpoint: string, ev: SessionStreamFinal): Promise<void> {
      const h = handles.get(endpoint);
      const chat = resolveChat(endpoint, config.botId);   // ★ 봇 가드(확 누출 차단)
      if (!chat) return;
      // generation guard(§6-9) — 라이브핸들이 이 스트림의 것일 때만 placeholder 재사용·정리.
      // 이미 새 스트림이 올라와 있으면 그 placeholder 를 clobber 하지 않고 fresh 전송.
      const owns = h != null && h.streamId === ev.streamId;
      if (owns) {
        // ⚠️ 레이스 수정 — in-flight placeholder send 를 먼저 완료(flush)해 messageId 확정 후 정리.
        // 안 그러면 빠른/짧은 턴에서 placeholder send resolve 전에 onFinal 이 돌아 messageId=null →
        // collapse 못 하고 최종을 fresh 전송 → 스트리밍 프리뷰("💬 …")가 고아로 남음.
        try { await h!.loop.flush(); } catch { /* fail-soft */ }
        h!.loop.stop();
        handles.delete(endpoint);
      }
      if (fairQueue) fairQueue.remove(chat.chatId, threadKey(chat.chatId, chat.threadId)); // 슬롯 반납
      const chunks = split(ev.text).filter((c) => c.length > 0);
      if (chunks.length === 0) return;
      // finalize 는 MarkdownV2 시도 → parse 에러 시 plain 재시도(§1). collapse: 스트림 텍스트를
      // 최종 답변으로 대체(툴 tail 자연 소멸·§10-2 collapse-in-place).
      const chatId = chat.chatId;
      const threadOpt = chat.threadId != null ? { threadId: chat.threadId } : {};
      // chunk 1 — placeholder(이 스트림 소유 시) 있으면 edit, 없으면 send.
      let lastMsgId = owns ? (h!.messageId ?? null) : null;
      let firstPath = 'none'; // 관측 — markdown 성공/plain fallback(=포매팅 raw) 추적
      const first = chunks[0]!;
      if (lastMsgId != null) {
        try { await transport.edit(chatId, lastMsgId, first, { ...threadOpt, markdown: true }); firstPath = 'edit-md'; }
        catch { try { await transport.edit(chatId, lastMsgId, first, { ...threadOpt, markdown: false }); firstPath = 'edit-plain'; } catch { firstPath = 'edit-fail'; } }
      } else {
        try { const r = await transport.send(chatId, first, { ...threadOpt, markdown: true }); lastMsgId = r.messageId; firstPath = 'send-md'; }
        catch {
          try { const r = await transport.send(chatId, first, { ...threadOpt, markdown: false }); lastMsgId = r.messageId; firstPath = 'send-plain'; }
          catch { firstPath = 'send-fail'; }
        }
      }
      // 관측 — finalize 경로: chunks(다중=split)·owns(placeholder 재사용)·firstPath(*-plain=마크다운 parse
      // 실패→raw). 대표 "될때 안될때·포매팅 안됨" 진단의 결정 신호.
      try { debug.log('telegram.stream', 'finalize', { streamId: ev.streamId, chunks: chunks.length, owns, firstPath }); } catch { /* fail-soft */ }
      // chunk 2..N — reply-threaded 연속 메시지(마지막 가시 메시지에 이어붙임).
      for (let i = 1; i < chunks.length; i++) {
        const c = chunks[i]!;
        const opts = { ...threadOpt, markdown: true, ...(lastMsgId != null ? { replyTo: lastMsgId } : {}) };
        try { const r = await transport.send(chatId, c, opts); lastMsgId = r.messageId; }
        catch {
          try { const r = await transport.send(chatId, c, { ...opts, markdown: false }); lastMsgId = r.messageId; }
          catch { /* fail-soft */ }
        }
      }
    },

    onAbort(endpoint: string, streamId: string): void {
      const h = handles.get(endpoint);
      // generation guard — 이 스트림의 핸들만 정리(새 스트림이면 무시).
      if (h && h.streamId === streamId) {
        h.loop.stop();
        handles.delete(endpoint);
        if (fairQueue) fairQueue.remove(h.chatId, threadKey(h.chatId, h.threadId));
      }
    },
  };
}
