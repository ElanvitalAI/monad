// ── 완전 스코프 endpoint 키 (PLAN-cutover §5 · 2026-07-16) ────────────────────────
//
// 텔레그램/디스코드 flip(C2/C3)의 선결. 대표 지적 — endpoint 는 **배달을 유일하게 결정하는
// 전체 키**여야 한다(멀티봇·멀티채널·운영/테스트 분리를 한 방어선으로).
//
//   telegram endpoint = <instance>:<botId>:<chatId>:<threadId>
//   discord  endpoint = <instance>:<botId>:<channelId>
//
// - <instance>(T1 resolveInstanceName) 접두 → **크로스 인스턴스 배달 차단**(#4064 오발송 벡터).
//   fan-out sink 는 자기 인스턴스 endpoint 만 배달.
// - <botId> → 멀티봇 정합(private chat 의 chat.id 는 봇 걸쳐 동일 → botId 없으면 세션 붕괴,
//   findSessionByTelegramChat 이 botId 스코프인 이유와 동형).
// - 구독자 레코드의 endpoint 값에 이 키를 담고, sink 가 parse 해 (instance,botId) 가드 후
//   chatId 로 sendMessage.

import { resolveInstanceName } from '../instance-identity.js';
import type { SessionMeta } from './index.js';

const SEP = '␟'; // ␟ (unit separator) — chatId/botId 에 안 나오는 구분자.
const BOT_ANY = '_';

export interface TelegramEndpoint { instance: string; botId: string; chatId: string; threadId: string }
export interface DiscordEndpoint { instance: string; botId: string; channelId: string }
export interface AcpEndpoint { instance: string; sessionId: string }

/** ACP 완전 스코프 endpoint 키(C5d). ACP peer 그룹은 세션과 1:1 → endpoint = sessionId(인스턴스 스코프).
 *  ACP 는 in-memory 소켓(항상 동일 인스턴스)이나 대칭·크로스가드 위해 instance 접두 유지. */
export function acpEndpointKey(opts: { sessionId: string; instance?: string }): string {
  const inst = opts.instance ?? resolveInstanceName();
  return ['acp', inst, opts.sessionId].join(SEP);
}
export function parseAcpEndpoint(endpoint: string): AcpEndpoint | null {
  const p = endpoint.split(SEP);
  if (p.length !== 3 || p[0] !== 'acp') return null;
  return { instance: p[1]!, sessionId: p[2]! };
}

/** 텔레그램 완전 스코프 endpoint 키. instance 미주입 시 현재 인스턴스(resolveInstanceName). */
export function telegramEndpointKey(opts: {
  chatId: number | string; botId?: string; threadId?: number | string; instance?: string;
}): string {
  const inst = opts.instance ?? resolveInstanceName();
  return ['tg', inst, opts.botId ?? BOT_ANY, String(opts.chatId), String(opts.threadId ?? 0)].join(SEP);
}

/** 디스코드 완전 스코프 endpoint 키. */
export function discordEndpointKey(opts: {
  channelId: string; botId?: string; instance?: string;
}): string {
  const inst = opts.instance ?? resolveInstanceName();
  return ['dc', inst, opts.botId ?? BOT_ANY, opts.channelId].join(SEP);
}

/** endpoint 키 파싱 — sink 가 (instance,botId) 가드 + chatId 추출에 사용. 형식 불일치면 null. */
export function parseTelegramEndpoint(endpoint: string): TelegramEndpoint | null {
  const p = endpoint.split(SEP);
  if (p.length !== 5 || p[0] !== 'tg') return null;
  return { instance: p[1]!, botId: p[2]!, chatId: p[3]!, threadId: p[4]! };
}
export function parseDiscordEndpoint(endpoint: string): DiscordEndpoint | null {
  const p = endpoint.split(SEP);
  if (p.length !== 4 || p[0] !== 'dc') return null;
  return { instance: p[1]!, botId: p[2]!, channelId: p[3]! };
}

/** 인스턴스 가드 — 이 endpoint 가 현재 인스턴스 소속인가(크로스 인스턴스 배달 차단). */
export function isOwnInstanceEndpoint(instance: string, current: string = resolveInstanceName()): boolean {
  return instance === current;
}

/** 봇 가드 — endpoint 의 botId 가 이 sink 의 봇과 맞나(BOT_ANY 는 봇 무관 = 허용). */
export function matchesBot(endpointBotId: string, sinkBotId: string | undefined): boolean {
  return endpointBotId === BOT_ANY || sinkBotId === undefined || endpointBotId === sinkBotId;
}

/** 텔레그램 옛 경로 배달 대상 추출 — 바인딩(attach) 우선, 없으면 auto-created origin(tgChatId).
 *  autoSubscribeOldPath(구독 등록)와 oldPathRecipientKeys(parity/exclude)가 **같은 키**를 내도록
 *  단일 추출원. type-only import(순환 회피). 없으면 null. */
export function telegramOldPathTarget(
  meta: SessionMeta,
): { chatId: number; botId?: string; threadId?: number } | null {
  const b = meta.bindings?.telegram;
  if (b?.chatId != null) {
    return { chatId: b.chatId, ...(b.botId ? { botId: b.botId } : {}), ...(b.threadId != null ? { threadId: b.threadId } : {}) };
  }
  if (meta.source === 'telegram' && meta.tgChatId != null) {
    return { chatId: meta.tgChatId, ...(meta.tgBotId ? { botId: meta.tgBotId } : {}), ...(meta.tgThreadId != null ? { threadId: meta.tgThreadId } : {}) };
  }
  return null;
}
