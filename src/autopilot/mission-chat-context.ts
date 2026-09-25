// ── 채팅방 미션 맥락 추적(맥락-인지 revise · 대표 2026-07-14) ──────────────────
//
// P3 NL 라우터가 "최근 활성 미션(recency)"으로만 대상을 골라, 대표가 미션 A 를 논의하다가
// "위 답변을 바탕으로 개정해줘"라고 하면 엉뚱한 미션 B(더 최근)를 집는 오선택이 났다. 근본:
// 라우터가 대화 맥락을 안 읽는다. 이 모듈이 그 맥락을 얇게 보관한다:
//   (1) 이 방에서 마지막으로 언급된 미션 id(멘션 추적) — recency 보다 우선 채택.
//   (2) 모호(선택 카드) 흐름의 원 요청 텍스트 임시 보관 — 미션 픽 후 그 맥락으로 추천.
// 전부 per-chat 파일·fail-soft·시간창 방어.

import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { monadStateRoot } from './state-paths.js';

/** 최근 언급 유효창(기본 30분) — 너무 오래된 언급은 "지금 논의 중"이 아니므로 무시. */
const MENTION_WINDOW_MS = 30 * 60 * 1000;
/** 선택 카드 대기 컨텍스트 유효창(기본 10분) — 픽 안 하고 방치된 것 만료. */
const PENDING_CTX_WINDOW_MS = 10 * 60 * 1000;

function chatCtxPath(chatId: number | string, kind: 'mention' | 'pending-revise-ctx'): string {
  const safe = String(chatId).replace(/[^\w-]/g, '_').slice(0, 40);
  return join(monadStateRoot(), 'autopilot', 'chat-context', `${safe}.${kind}.json`);
}

/** 텍스트에서 apm_ 미션 id 추출(순수·중복제거·등장순). */
export function extractMissionIds(text: string): string[] {
  const ids: string[] = [];
  const re = /\bapm_[a-zA-Z0-9_-]{2,}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || '')) !== null) ids.push(m[0]);
  return [...new Set(ids)];
}

// ── (1) 최근 언급 미션 추적 ──────────────────────────────────────────────

/** 이 방의 "최근 논의 미션"으로 기록(마지막 언급 1건·최신 우선). fail-soft. */
export function recordChatMissionMention(chatId: number, missionId: string, at?: number): void {
  try {
    const p = chatCtxPath(chatId, 'mention');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ missionId, at: at ?? Date.now() }));
  } catch { /* fail-soft */ }
}

/** 텍스트에 apm_id 가 있으면 마지막 것을 최근 논의 미션으로 기록(없으면 no-op). handleIncoming 이
 *  매 사용자 메시지에 호출 — 이후 id 없는 "개정해줘"가 이 미션을 recency 보다 우선 채택하도록. */
export function recordChatMissionMentionsFromText(chatId: number, text: string, at?: number): void {
  const ids = extractMissionIds(text);
  if (ids.length) recordChatMissionMention(chatId, ids[ids.length - 1]!, at);
}

/** 최근(window 내) 논의 미션 id. 없거나 만료면 null. now/windowMs 는 테스트 주입. */
export function getRecentChatMission(
  chatId: number,
  opts: { now?: number; windowMs?: number } = {},
): string | null {
  try {
    const p = chatCtxPath(chatId, 'mention');
    if (!existsSync(p)) return null;
    const o = JSON.parse(readFileSync(p, 'utf-8'));
    if (!o || typeof o.missionId !== 'string' || !o.missionId) return null;
    const now = opts.now ?? Date.now();
    const window = opts.windowMs ?? MENTION_WINDOW_MS;
    if (typeof o.at === 'number' && now - o.at > window) return null;
    return o.missionId;
  } catch { return null; }
}

/** 최근 언급 초기화(테스트/명시 해제). fail-soft. */
export function clearChatMissionMention(chatId: number): void {
  try { const p = chatCtxPath(chatId, 'mention'); if (existsSync(p)) rmSync(p); } catch { /* fail-soft */ }
}

// ── (2) 선택 카드 대기 컨텍스트(모호 해소 흐름) ────────────────────────────

/** 선택 카드를 띄우며 원 요청 텍스트를 보관 — 미션 픽 후 이 맥락으로 추천 생성. fail-soft. */
export function savePendingReviseContext(chatId: number, text: string, at?: number): void {
  try {
    const p = chatCtxPath(chatId, 'pending-revise-ctx');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ text, at: at ?? Date.now() }));
  } catch { /* fail-soft */ }
}

/** 보관된 원 요청 텍스트(window 내). 없거나 만료면 null. */
export function readPendingReviseContext(chatId: number, opts: { now?: number; windowMs?: number } = {}): string | null {
  try {
    const p = chatCtxPath(chatId, 'pending-revise-ctx');
    if (!existsSync(p)) return null;
    const o = JSON.parse(readFileSync(p, 'utf-8'));
    if (!o || typeof o.text !== 'string') return null;
    const now = opts.now ?? Date.now();
    const window = opts.windowMs ?? PENDING_CTX_WINDOW_MS;
    if (typeof o.at === 'number' && now - o.at > window) return null;
    return o.text;
  } catch { return null; }
}

export function clearPendingReviseContext(chatId: number): void {
  try { const p = chatCtxPath(chatId, 'pending-revise-ctx'); if (existsSync(p)) rmSync(p); } catch { /* fail-soft */ }
}
