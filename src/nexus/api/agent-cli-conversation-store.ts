// agent-cli-conversation-store.ts — W8-A 후속 (2026-05-14)
//
// NEXUS-side cross-backend conversation aggregator (옵션 A · partial).
// agent-cli REST/SSE endpoint 가 매 turn 마다 본 store 에 user/agent text 를
// push. `historyMode: 'rebuild'` 호출 시 본 store 의 last N turn 을 cross-
// backend history 로 reconstruct + backend prompt prefix 로 inject.
//
// 사용 의의:
//   - iOS-side client-side prefix (#2654) 가 cache miss only 였음 — 본 store
//     는 server-side · 사용자 backend swap 빈도와 무관하게 양방향 work.
//   - 다만 본 cut 의 한계: elanous-builtin ACP path 는 본 store push 안 함
//     (NEXUS sessions store 가 별 substrate · 통합은 multi-week 작업).
//     agent-cli 끼리 (codex ↔ claude ↔ gemini) 의 양방향만 cover.
//   - 진짜 모든 backend (elanous-builtin 포함) 양방향 = future plan (RFC
//     doc · process-wide single conversation store + ACP turn-end mirror).
//
// In-memory only (process restart 시 lost). Persistence 는 사용자 dogfood 신호
// 후 SQLite store 로 promotion 가능 (별 트랙).

export type AgentCliTurnRole = 'user' | 'agent';

export interface AgentCliConversationTurn {
  readonly role: AgentCliTurnRole;
  readonly backendId: string;
  /** Plain text. multimodal payload (image base64 등) 는 omit — prefix 의
   *  목적이 다른 backend 가 conversation context 이해이지 raw payload 복원이
   *  아님. 사용자 명시 의도가 textual context 보존.
   *
   *  Multimodal user turns: when the original prompt included image(s),
   *  the stored `text` may carry a " [image attached]" suffix (or be exactly
   *  "[image attached]" for pure-image prompts). This allows the cross-backend
   *  prefix to surface visual context to the next backend without leaking
   *  base64. See handleAgentCliPromptStream for injection site. */
  readonly text: string;
  /** ms epoch · 사용자 turn 의 시간 추적 (debug + future audit). */
  readonly at: number;
}

/** per-chat history (chatId = elanous ACP session id 또는 stable client-side
 *  identifier). 본 store 는 lookup + append 두 operation · O(1). */
export interface AgentCliConversationStore {
  append(chatId: string, turn: AgentCliConversationTurn): void;
  /** last N turn (chronological order · oldest → newest). N 미명시 시
   *  default 16 (8 user + 8 agent 짝). */
  recent(chatId: string, limit?: number): readonly AgentCliConversationTurn[];
  /** Sign-out / session reset 시. */
  clear(chatId: string): void;
  /** 전체 process exit · test isolation. */
  clearAll(): void;
}

export function createInMemoryAgentCliConversationStore(): AgentCliConversationStore {
  const byChat = new Map<string, AgentCliConversationTurn[]>();
  const HARD_CAP = 200; // chat 당 메모리 폭주 방지 · oldest evict.

  return {
    append(chatId, turn) {
      let arr = byChat.get(chatId);
      if (!arr) {
        arr = [];
        byChat.set(chatId, arr);
      }
      arr.push(turn);
      if (arr.length > HARD_CAP) {
        arr.splice(0, arr.length - HARD_CAP);
      }
    },
    recent(chatId, limit = 16) {
      const arr = byChat.get(chatId);
      if (!arr || arr.length === 0) return [];
      return arr.slice(-limit);
    },
    clear(chatId) {
      byChat.delete(chatId);
    },
    clearAll() {
      byChat.clear();
    },
  };
}

let globalStore: AgentCliConversationStore | null = null;

/** Singleton getter. Lazy init — first call decides backing:
 *    1. `ELANOUS_CONVERSATION_STORE_MODE=memory` env → in-memory (test mode)
 *    2. 그 외 (production daemon) → SQLite (`~/.elanous/agent-cli-conversation.db`
 *       또는 `ELANOUS_CONVERSATION_DB_PATH` env override). SQLite open 실패 시
 *       in-memory fallback (graceful · readonly fs / Bun 미설치 등). */
export function globalAgentCliConversationStore(): AgentCliConversationStore {
  if (!globalStore) {
    const modeEnv = process.env.ELANOUS_CONVERSATION_STORE_MODE;
    const home = process.env.HOME ?? '';
    if (modeEnv === 'memory' || !home) {
      globalStore = createInMemoryAgentCliConversationStore();
    } else {
      const dbPath = process.env.ELANOUS_CONVERSATION_DB_PATH
        ?? `${home}/.elanous/agent-cli-conversation.db`;
      try {
        globalStore = createSqliteAgentCliConversationStore(dbPath);
      } catch {
        // Bun 미설치 / readonly fs / 동시 lock 등 — graceful in-memory fallback.
        globalStore = createInMemoryAgentCliConversationStore();
      }
    }
  }
  return globalStore;
}

/** W8-A 후속 #2 (2026-05-14) — production boot path (nexus/index.ts) 에서
 *  SQLite persistence store 로 swap. test / standalone 환경은 그대로
 *  in-memory (factory 호출 안 함). 같은 process 안 multi-call 은 idempotent —
 *  같은 store reference 반환. */
export function setGlobalAgentCliConversationStore(store: AgentCliConversationStore): void {
  globalStore = store;
}

/** Test seam — bypass singleton (`__resetForTest`). */
export function __resetAgentCliConversationStoreForTest(): void {
  globalStore = null;
}

// ─── SQLite persistence (W8-A 후속 #2 · 2026-05-14) ──────────────────────
//
// process restart 시 conversation history 보존. in-memory 는 dev / test 의 lost
// 비용을 감수 (사용자 dogfood path 의 frequency 감안 시 acceptable). production
// daemon (`elanous nexus run`) 은 본 SQLite store 로 swap → 사용자가 elanous 를
// 재시작해도 chat 의 cross-backend conversation context 유지.
//
// Bun built-in sqlite (bun:sqlite) — 외부 dep 0. 본 elanous 의 task-orchestrator/
// store.ts (TaskStore) · u5/patcher 등 같은 substrate 재사용.

/** SQLite-backed store. file path 는 `~/.elanous/agent-cli-conversation.db`
 *  default · nexus boot 시 명시. HARD_CAP 동일 (oldest evict on overflow). */
export function createSqliteAgentCliConversationStore(
  dbPath: string,
  options?: { hardCapPerChat?: number },
): AgentCliConversationStore {
  // dynamic import — bun:sqlite 가 test 환경에 없을 때 in-memory fallback.
  // top-level import 시 non-Bun runtime 에서 fail 가능. 본 factory 만 import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_cli_conversation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      backend_id TEXT NOT NULL,
      text TEXT NOT NULL,
      at INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_chat_at
      ON agent_cli_conversation(chat_id, at)
  `);

  const cap = options?.hardCapPerChat ?? 200;

  const insertStmt = db.prepare(`
    INSERT INTO agent_cli_conversation (chat_id, role, backend_id, text, at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const recentStmt = db.prepare(`
    SELECT role, backend_id AS backendId, text, at
    FROM agent_cli_conversation
    WHERE chat_id = ?
    ORDER BY at ASC, id ASC
    LIMIT ?
  `);
  const countStmt = db.prepare(`
    SELECT COUNT(*) AS c FROM agent_cli_conversation WHERE chat_id = ?
  `);
  const evictStmt = db.prepare(`
    DELETE FROM agent_cli_conversation
    WHERE id IN (
      SELECT id FROM agent_cli_conversation
      WHERE chat_id = ?
      ORDER BY at ASC, id ASC
      LIMIT ?
    )
  `);
  const deleteChatStmt = db.prepare(`DELETE FROM agent_cli_conversation WHERE chat_id = ?`);
  const deleteAllStmt = db.prepare(`DELETE FROM agent_cli_conversation`);

  return {
    append(chatId, turn) {
      insertStmt.run(chatId, turn.role, turn.backendId, turn.text, turn.at);
      // soft evict — count 가 cap 초과 시 oldest 만큼 제거.
      const row = countStmt.get(chatId) as { c: number } | null;
      const count = row?.c ?? 0;
      if (count > cap) {
        evictStmt.run(chatId, count - cap);
      }
    },
    recent(chatId, limit = 16) {
      // ASC + LIMIT 으로 oldest 부터 가져오면 wrong (last N 필요). 모든 row 가져온
      // 후 끝에서 N — 또는 별 query (DESC + reverse). 본 cut: 모든 row 가져오고
      // suffix · HARD_CAP 200 이라 비용 작음.
      const rows = recentStmt.all(chatId, cap) as Array<{
        role: 'user' | 'agent';
        backendId: string;
        text: string;
        at: number;
      }>;
      return rows.slice(-limit);
    },
    clear(chatId) {
      deleteChatStmt.run(chatId);
    },
    clearAll() {
      deleteAllStmt.run();
    },
  };
}

/** Build a cross-backend history prefix block 적용. 호출자 (handleAgentCli-
 *  PromptStream) 가 본 prefix 를 backend message 의 leading text block 으로
 *  inject. 같은 backend 의 last turn 도 포함 — backend 가 자기 own history
 *  와 별 NEXUS prefix 둘 다 받지만 prefix 가 더 정확한 cross-backend
 *  state 보유.
 *
 *  Multimodal: user turns that carried images get " [image attached]" marker
 *  embedded in their stored text so the next backend (after swap) sees the
 *  visual context. Plural "turns" is handled correctly in the header. */
/** 세션 fork-continue seed — 특정 (fork된) 세션의 on-disk 대화 히스토리를 backend seed
 *  prefix 로. buildCrossBackendHistoryPrefix 의 자매지만 소스가 aggregator(chatId)가 아니라
 *  세션 메시지 배열(loadSession 결과). fork 로 히스토리만 복사된 세션을 처음 이어갈 때, 이
 *  prefix 를 첫 turn 에 주입하면 fresh backend 세션이 부모 맥락을 이어받는다. 순수.
 *  user/assistant 만·마지막 maxTurns 짝·현재 user text 제외(중복 방지). */
export function buildSessionHistoryPrefix(
  messages: Array<{ role: string; content: string }>,
  excludeCurrentUserText: string,
  maxTurns: number = 8,
): string {
  const convo = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const recent = convo.slice(-maxTurns * 2);
  const filtered = recent.filter((m) => !(m.role === 'user' && m.content === excludeCurrentUserText));
  if (filtered.length === 0) return '';
  const lines = filtered.map((m) => `${m.role === 'user' ? 'USER' : 'AGENT'}: ${m.content}`);
  return `Previous conversation (forked session history · last ${filtered.length} turn${filtered.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
}

export function buildCrossBackendHistoryPrefix(
  store: AgentCliConversationStore,
  chatId: string,
  excludeCurrentUserText: string,
  maxTurns: number = 8,
): string {
  // Recent 16 = 8 짝. excludeCurrentUserText 는 본 turn 자신의 user text
  // (방금 push 됐을 수도) — prefix 에 들어가면 backend 가 같은 prompt 2번 봄.
  const recent = store.recent(chatId, maxTurns * 2);
  if (recent.length === 0) return '';

  const filtered = recent.filter((t) => !(t.role === 'user' && t.text === excludeCurrentUserText));
  if (filtered.length === 0) return '';

  const lines = filtered.map((t) => {
    const role = t.role === 'user' ? 'USER' : `AGENT[${t.backendId}]`;
    return `${role}: ${t.text}`;
  });
  return `Previous conversation (cross-backend NEXUS history · last ${filtered.length} turn${filtered.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
}
