#!/usr/bin/env bun
// ── C5b 텔레그램 스트리밍 sink 실배달 dogfood 하니스 ────────────────────────────────
//
// producer tap(데몬 턴 배선) **없이** 텔레그램 스트리밍 sink 를 실 텔레그램까지 검증한다.
// 스트리밍 델타를 흉내내 sink.onChunk/onFinal 을 직접 구동 → 대표 폰에 in-place 편집이 뜬다.
// 이게 검증하는 것: 공통 코어(throttle·single-flight·dedup)·plain-while-streaming·inline 툴
// (⚙️…✓)·finalize MarkdownV2+split+plain fallback — 즉 스트리밍 flip 시 실제 UX 전부.
// 위험 0: 데몬/운영 무접촉·send-only 봇·대표 자기 챗에만.
//
// 실행:
//   bun scripts/c5-telegram-stream-dogfood.ts                 # 테스트 config 봇·chatId 자동
//   TG_CHAT=<chatId> bun scripts/c5-telegram-stream-dogfood.ts
//   TG_TOKEN=<token> TG_CHAT=<chatId> bun scripts/c5-telegram-stream-dogfood.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TelegramBot } from '../src/telegram.js';
import { createTelegramStreamSink } from '../src/session/streaming/telegram-stream-sink.js';
import { telegramEndpointKey } from '../src/session/session-endpoint-key.js';
import { splitMarkdownForTelegram } from '../src/telegram-format.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadTestTelegram(): { token: string; chatId: number } | null {
  try {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), '.elanous-test', 'config.json'), 'utf8'));
    const tg = cfg.telegram ?? cfg.channels?.telegram;
    const token = tg?.botToken ?? tg?.testChannel?.botToken;
    const chatId = tg?.allowedUsers?.[0] ?? tg?.testChannel?.allowedUsers?.[0];
    if (token && chatId) return { token, chatId };
  } catch { /* fall through */ }
  return null;
}

async function main(): Promise<void> {
  const fromCfg = loadTestTelegram();
  const token = process.env.TG_TOKEN ?? fromCfg?.token;
  const chatId = Number(process.env.TG_CHAT ?? fromCfg?.chatId ?? NaN);
  if (!token || !Number.isFinite(chatId)) {
    console.error('❌ 봇 토큰/chatId 미해결. TG_TOKEN·TG_CHAT env 또는 .elanous-test/config.json telegram 설정 필요.');
    process.exit(1);
  }
  console.log(`▶ C5 스트리밍 dogfood → chatId ${chatId} (테스트 봇). 폰의 텔레그램을 보세요.`);

  const bot = new TelegramBot({ token, allowedUsers: [], onMessage: async () => undefined });

  // sink transport = 실 봇. 스트리밍 중 markdown=false(plain), finalize 만 markdown=true.
  const sink = createTelegramStreamSink(
    {
      send: async (cid, text, o) => {
        const r = await bot.sendMessage(cid, text, {
          ...(o.threadId != null ? { threadId: o.threadId } : {}),
          ...(o.replyTo != null ? { replyTo: o.replyTo } : {}),
          ...(o.markdown ? { markdown: true } : {}),
        });
        return { messageId: r && typeof r === 'object' && 'messageId' in r ? r.messageId : 0 };
      },
      edit: async (cid, mid, text, o) => {
        await bot.editMessageText(cid, mid, text, {
          ...(o.threadId != null ? { threadId: o.threadId } : {}),
          ...(o.markdown ? { markdown: true } : {}),
        });
      },
    },
    { split: (t) => splitMarkdownForTelegram(t, 4096), throttleMs: 1100 },
  );

  const EP = telegramEndpointKey({ chatId });
  const streamId = `dogfood-${chatId}`;
  let seq = 0;
  const chunk = (ev: Parameters<typeof sink.onChunk>[1]) => sink.onChunk(EP, ev, { sessionId: 'dogfood' });

  // 1) 텍스트 델타 스트리밍(공통 코어 throttle 로 in-place 편집·plain).
  const words = ('안녕하세요 대표님. 이건 C5 청크 스트리밍 sink 의 실배달 검증입니다. '
    + '스트리밍 중에는 plain 으로 in-place 편집되어 미완 코드펜스 parse 에러가 없고, '
    + '완료 시에만 MarkdownV2 로 서식이 입혀집니다. ').split(' ');
  for (const w of words) { chunk({ streamId, seq: seq++, delta: w + ' ' }); await sleep(140); }

  // 2) inline 툴 활동(⚙️ … → ✓).
  chunk({ streamId, seq: seq++, tool: { id: 't1', name: 'Bash', phase: 'call' } }); await sleep(900);
  chunk({ streamId, seq: seq++, tool: { id: 't1', name: 'Bash', phase: 'result', ok: true } }); await sleep(900);
  chunk({ streamId, seq: seq++, tool: { id: 't2', name: 'Edit', phase: 'call' } }); await sleep(900);
  chunk({ streamId, seq: seq++, tool: { id: 't2', name: 'Edit', phase: 'result', ok: true } }); await sleep(1200);

  // 3) finalize — MarkdownV2 서식 + (긴 텍스트면) split. 스트림 메시지가 최종 답변으로 collapse.
  const finalText = [
    '*C5 스트리밍 sink 검증 완료* ✅',
    '',
    '적용된 강화:',
    '• `plain-while-streaming` → mid-stream parse 에러 0',
    '• `MarkdownV2-only-at-finalize` + plain fallback',
    '• inline 툴 `⚙️…✓` · saturated dedup · retry\\_after suspend',
    '• finalize 4096 split + reply-threaded',
    '',
    '```',
    'const ok = true; // 코드펜스도 finalize 에서만 렌더',
    '```',
    '',
    '이대로 보이면 producer tap 만 배선하면 실 flip 준비 완료입니다.',
  ].join('\n');
  await sink.onFinal(EP, { streamId, role: 'assistant', text: finalText }, { sessionId: 'dogfood' });

  console.log('✔ 완료. 폰에서: (1) in-place 스트리밍 (2) ⚙️→✓ 툴줄 (3) 최종 MarkdownV2 서식 확인.');
}

void main().catch((e) => { console.error('dogfood 실패:', e); process.exit(1); });
