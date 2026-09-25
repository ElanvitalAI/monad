// ── 디스코드 스트리밍 sink (C5c · 2026-07-16) ─────────────────────────────────────
//
// StreamingSurfaceSink 디스코드 구현 — 공통 코어(draft-stream-loop) 위에 디스코드 특성을 얹는다.
// 텔레그램 sink 와 인터페이스 공유·구현 분기(대표 §11-2 코어 텍스트 1~5). 디스코드 차이:
//  - channelId·messageId 는 string. 2000자 cap(텔레그램 4096보다 엄격) → splitForDiscord 주입.
//  - **parse_mode 없음** — 디스코드는 content 에 markdown 을 네이티브 렌더 → 스트리밍/finalize 모두
//    plain content(텔레그램의 MarkdownV2 parse 에러/plain fallback 불필요).
//  - edit rate 5/5s → throttle 1100ms(공통 코어). retry_after 존중(공통 코어 suspend).
//  - finalize 시 reply-threaded 연속 메시지(텔레그램 동형).
//  - reactions/모드/컴포지터(6~9)는 C5-enh 후속.
//
// transport 주입 → 실봇 없이 유닛테스트. 실배선(discord-trigger-bot)이 bot.sendMessage/editMessage +
// splitForDiscord 주입. flag-OFF(streaming.discord).

import { createDraftStreamLoop, type DraftStreamLoop } from './draft-stream-loop.js';
import {
  type StreamingMode, type CompositorState,
  createCompositorState, applyChunk, composeStream, crossedBlockBoundary,
} from './stream-compositor.js';
import { debug } from '../../debug/log.js';
import { parseDiscordEndpoint, isOwnInstanceEndpoint } from '../session-endpoint-key.js';
import type { StreamingSurfaceSink, SessionChunkEvent, SessionStreamFinal } from '../session-fanout.js';

/** 디스코드 전송 어댑터(주입) — 실배선은 DiscordBot.sendMessage/editMessage. content 는 항상 plain.
 *  suppressEmbeds = SUPPRESS_EMBEDS 플래그(링크 unfurl 소음 억제·§6-9). create 에만 설정(edit 유지). */
export interface DiscordStreamTransport {
  send: (channelId: string, text: string, opts: { replyTo?: string; suppressEmbeds?: boolean }) => Promise<{ messageId: string }>;
  edit: (channelId: string, messageId: string, text: string) => Promise<void>;
}

export interface DiscordStreamSinkConfig {
  throttleMs?: number;       // 기본 1100(디스코드 5edit/5s 미만).
  minInitialChars?: number;  // 기본 0.
  maxToolLines?: number;     // 기본 6.
  /** SUPPRESS_EMBEDS 로 링크 unfurl 억제(§6-9). 기본 true(스트리밍 소음 억제). */
  suppressEmbeds?: boolean;
  /** 스트리밍 모드(C5-enh·§6-8). 기본 partial. */
  mode?: StreamingMode;
  /** 최종 텍스트 분할(기본 단순 2000). 실배선은 splitForDiscord 주입. */
  split?: (text: string) => string[];
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

interface LiveHandle {
  streamId: string;
  channelId: string;
  messageId: string | null;
  loop: DraftStreamLoop;
  state: CompositorState;
  lastRendered: string;
}

/** 디스코드 에러의 retry_after(초) → ms. */
function discordRetryAfterMs(err: unknown): number | null {
  const e = err as { retryAfter?: number; retry_after?: number } | null;
  const ra = e?.retryAfter ?? e?.retry_after;
  return typeof ra === 'number' && ra > 0 ? ra * 1000 : null;
}

/** endpoint → channelId. 완전스코프 키면 parse+인스턴스 가드, 아니면 bare channelId 폴백. */
function resolveChannel(endpoint: string): string | null {
  const parsed = parseDiscordEndpoint(endpoint);
  if (parsed) {
    if (!isOwnInstanceEndpoint(parsed.instance)) return null; // 크로스 인스턴스 차단
    return parsed.channelId || null;
  }
  return endpoint || null;
}

function defaultSplit(text: string, max = 2000): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

export function createDiscordStreamSink(
  transport: DiscordStreamTransport,
  config: DiscordStreamSinkConfig = {},
): StreamingSurfaceSink {
  const throttleMs = config.throttleMs ?? 1100;
  const minInitialChars = config.minInitialChars ?? 0;
  const maxToolLines = config.maxToolLines ?? 6;
  const mode: StreamingMode = config.mode ?? 'partial';
  const suppressEmbeds = config.suppressEmbeds ?? true;
  const split = config.split ?? ((t: string) => defaultSplit(t));
  const handles = new Map<string, LiveHandle>();

  function render(h: LiveHandle): string | null {
    return composeStream(h.state, mode, { maxToolLines });
  }

  function makeHandle(streamId: string, channelId: string): LiveHandle {
    const h: LiveHandle = {
      streamId, channelId, messageId: null, state: createCompositorState(), lastRendered: '',
      loop: undefined as unknown as DraftStreamLoop,
    };
    h.loop = createDraftStreamLoop(
      {
        edit: async (text) => {
          if (h.messageId == null) {
            const r = await transport.send(h.channelId, text, { ...(suppressEmbeds ? { suppressEmbeds: true } : {}) });
            h.messageId = r.messageId;
            try { debug.log('discord.stream', 'placeholder', { streamId: h.streamId, msgId: h.messageId, chars: text.length }); } catch { /* fail-soft */ }
          } else {
            await transport.edit(h.channelId, h.messageId, text);
            try { debug.log('discord.stream', 'edit', { streamId: h.streamId, msgId: h.messageId, chars: text.length }); } catch { /* fail-soft */ }
          }
        },
        retryAfterMs: discordRetryAfterMs,
        ...(config.now ? { now: config.now } : {}),
        ...(config.schedule ? { schedule: config.schedule } : {}),
      },
      { throttleMs, minInitialChars },
    );
    return h;
  }

  return {
    onChunk(endpoint: string, ev: SessionChunkEvent): void {
      const channelId = resolveChannel(endpoint);
      if (!channelId) return;
      let h = handles.get(endpoint);
      if (!h || h.streamId !== ev.streamId) {
        if (h) h.loop.stop();
        h = makeHandle(ev.streamId, channelId);
        handles.set(endpoint, h);
      }
      applyChunk(h.state, ev);
      const text = render(h);
      if (text == null) return; // off 모드·빈 상태 — 편집 억제
      if (mode === 'block' && h.lastRendered && !crossedBlockBoundary(h.lastRendered, text)) return;
      h.lastRendered = text;
      h.loop.update(text);
    },

    async onFinal(endpoint: string, ev: SessionStreamFinal): Promise<void> {
      const channelId = resolveChannel(endpoint);
      if (!channelId) return;
      // generation guard(§6-9) — 라이브핸들이 **이 스트림**의 것일 때만 placeholder 재사용. 이미
      // 새 스트림이 올라와 있으면(streamId 불일치) 그 placeholder 를 clobber 하지 않고 fresh 전송.
      const h = handles.get(endpoint);
      const owns = h != null && h.streamId === ev.streamId;
      if (owns) {
        // ⚠️ 레이스 수정(§tg 동형) — in-flight placeholder send 완료 후 messageId 확정.
        try { await h!.loop.flush(); } catch { /* fail-soft */ }
        h!.loop.stop();
        handles.delete(endpoint);
      }
      const chunks = split(ev.text).filter((c) => c.length > 0);
      if (chunks.length === 0) return;
      let lastMsgId = owns ? (h!.messageId ?? null) : null;
      const first = chunks[0]!;
      // collapse — 스트림 텍스트(툴 tail 포함)를 최종 답변으로 대체. 디스코드는 parse_mode 없어 plain.
      if (lastMsgId != null) {
        try { await transport.edit(channelId, lastMsgId, first); } catch { /* fail-soft */ }
      } else {
        try { const r = await transport.send(channelId, first, { ...(suppressEmbeds ? { suppressEmbeds: true } : {}) }); lastMsgId = r.messageId; } catch { /* fail-soft */ }
      }
      for (let i = 1; i < chunks.length; i++) {
        try {
          const r = await transport.send(channelId, chunks[i]!, { ...(lastMsgId != null ? { replyTo: lastMsgId } : {}), ...(suppressEmbeds ? { suppressEmbeds: true } : {}) });
          lastMsgId = r.messageId;
        } catch { /* fail-soft */ }
      }
    },

    onAbort(endpoint: string, streamId: string): void {
      const h = handles.get(endpoint);
      // generation guard — 이 스트림의 핸들만 정리(새 스트림이면 무시).
      if (h && h.streamId === streamId) { h.loop.stop(); handles.delete(endpoint); }
    },
  };
}
