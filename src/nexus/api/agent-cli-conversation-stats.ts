// agent-cli-conversation-stats.ts — W8-A 후속 #5 (2026-05-14)
//
// GET /v1/agent-cli/conversation-stats?chatId=<sid> · per-backend usage
// count for picker hint UI. iOS BackendPickerChip 의 Menu 안에 각 backend
// 별 turn count badge — 사용자가 picker open 시 자기 prior pattern 인지
// ("최근 N turn 동안 어느 backend 사용했나").
//
// 자가 강화 loop 의 첫 surface — 사용자가 "내가 이 chat 에서 codex 를 5번 ·
// claude 를 3번 사용했네" mental model 형성. 향후 KGS 기반 자동 default
// 추천은 별 트랙 (mid-loop · backend assignment 의 patcher 학습).

import { globalAgentCliConversationStore } from './agent-cli-conversation-store.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const CONVERSATION_STATS_PATH = '/v1/agent-cli/conversation-stats';

export function isConversationStatsPath(pathname: string): boolean {
  return pathname === CONVERSATION_STATS_PATH;
}

export interface BackendUsageStats {
  /** backendId → user/agent turn count (user prompt + agent response = 1 짝 카운트). */
  byBackend: Record<string, number>;
  /** Total turn count (모든 backend 합). */
  total: number;
  /** Most-recent N turn 의 backend 다양성 (distinct count). */
  distinctBackends: number;
}

/** GET handler. ?chatId=<sid> 명시 시 본 chat 의 stats · 없으면 400. */
export async function handleConversationStats(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  const url = new URL(req.url);
  const chatId = url.searchParams.get('chatId');
  if (!chatId || chatId.length === 0) {
    return jsonResponse({ error: 'chatId-required' }, 400);
  }
  const store = globalAgentCliConversationStore();
  const turns = store.recent(chatId, 1000);
  const byBackend: Record<string, number> = {};
  // user/agent 짝 카운트 — agent response 만 count (turn = "사용자가 backend
  // 한 번 호출" · response 가 더 stable signal). user-only turn (예: agent
  // 가 error 로 abort) 은 0 count.
  for (const turn of turns) {
    if (turn.role === 'agent') {
      byBackend[turn.backendId] = (byBackend[turn.backendId] ?? 0) + 1;
    }
  }
  const total = Object.values(byBackend).reduce((a, b) => a + b, 0);
  const distinct = Object.keys(byBackend).length;
  return jsonResponse({
    chatId,
    byBackend,
    total,
    distinctBackends: distinct,
  } satisfies BackendUsageStats & { chatId: string }, 200);
}
