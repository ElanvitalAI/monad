// MVP M2.1 — Telegram bot ↔ Monad ACP bridge.
//
// Renamed from `telegram-daemon-bridge.ts` in C-1a (cleanup ROADMAP
// 2026-05-08): with NEXUS N-1.5 v6 hard landing, the "daemon" the bot
// attaches to is no longer a separate `monad serve` process — it's the
// daemon-runtime hosted in-process inside `monad nexus` over the same
// unix socket. (`monad serve` was deleted in C-4a; only NEXUS hosts the daemon-runtime now.)
// Hence the rename: this file is an **ACP bridge** that happens to use
// the daemon socket protocol; "daemon" in the name was misleading.
//
// Returns a `runTurnImpl` compatible with `botFromConfig`'s
// `runTurnImpl` slot but routes the LLM dispatch through the ACP server
// (NEXUS in-process · grace `monad serve` · or auto-spawned) over a
// Unix socket instead of calling `streamLLM` in-process.
//
// Why: with this wired in, a single ACP server owns the LLM / tool /
// session-history work; the Telegram bot becomes a thin ACP client.
// The TUI (when it lands `--attach` mode in M1.5) will be another thin
// client of the same server → a single conversation can be observed
// and continued from any client.
//
// For MVP scope:
//   - Per-telegram-session ACP attach is kept hot (Map<sessionId, …>).
//   - Streaming `onDelta` works → bot edits the placeholder live.
//   - Multimodal images are dropped (daemon-runtime doesn't accept
//     them yet — M2 follow-up).
//   - Memory injection / skill priming / token accounting are SKIPPED.
//     The daemon owns conversation context now; the legacy CLI `runTurn`
//     stays for non-daemon mode.
//
// Auto-spawn: when `MONAD_TELEGRAM_AUTO_SPAWN_DAEMON=1` is set, a
// missing socket triggers a `monad serve --background` fork. Default
// is OFF — the operator usually keeps a long-running `monad serve` up
// and the bot just attaches.
//
// Failure modes:
//   - Daemon not reachable + no auto-spawn → throws clearly so the
//     user sees a helpful error in their telegram chat.
//   - Daemon dies mid-stream → cached session is invalidated, next
//     turn reattaches fresh.

import { spawn as childSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  connectUnixSocket,
  isUnixSocketAlive,
} from './tui-client/acp-transport-unix-client.js';
import { DashboardSession } from './tui-client/dashboard-session.js';
import { defaultControlSignalBus } from './input/control-signal.js';
import { buildTelegramTextInputSourceRef } from './input/input-source-kind.js';
import { emitTurnSubmitBeginSignal } from './input/turn-submit-control.js';
import { abortTurnSubmitOnRecentQuickPass } from './input/turn-submit-revision.js';
import { acquireTurn, releaseTurn } from './session/session-input-arbiter.js';
import {
  createDaemonSessionTurnSubmit,
  runDaemonSessionTurnSubmit,
} from './tui-client/daemon-session-submit-runtime.js';
import {
  monadDaemonSocketPath,
  monadDaemonLogPath,
  ensureMonadDaemonDir,
} from './monad-daemon.js';
import type { RunTurnOpts, RunTurnResult } from './session/chat.js';
import type { SessionMeta } from './session/index.js';
import {
  createAmbientBufferRegistry,
  extractAgentMessageChunkText,
  extractUserMessageChunkText,
} from './channel/ambient-buffer.js';
import {
  openTelegramBindingsStore,
  type TelegramBindingsStore,
} from './telegram/bindings-store.js';
import { readDaemonSessionHistory } from './telegram/daemon-history-reader.js';
import { debug } from './debug/log.js';

export interface TelegramAcpBridgeOpts {
  /** Override the daemon socket path. Defaults to
   *  `monadDaemonSocketPath()` (= `~/.monad/monad.sock`). */
  socketPath?: string;
  /** Auto-spawn `monad serve --background` when the socket is not
   *  alive. Default false. */
  autoSpawn?: boolean;
  /** How long to wait for the socket to come up after auto-spawn. */
  spawnTimeoutMs?: number;
  /** Logger — defaults to console.log. */
  log?: (msg: string) => void;
  /** Tier 1 telegram fan-out arc — fires when fan-out from another
   *  surface arrives for a sessionId this bridge is attached to. The
   *  callback receives the consolidated text of the just-finished
   *  turn (chunks accumulated until idle). Caller resolves
   *  sessionId → chatId via `bindings.telegram` and pushes via the
   *  bot's sendMessage / streamer (telegram side wires this up; the
   *  bridge stays channel-agnostic for future Discord reuse —
   *  RESEARCH §B.4 notes a future ChannelStreamer base could absorb
   *  the per-channel push side without changing the bridge contract). */
  onAmbientTurn?: (sessionId: string, text: string) => void | Promise<void>;
  /** How long the bridge waits for additional chunks before
   *  finalizing an ambient turn (calling onAmbientTurn). Default
   *  2000ms. PR 4's onAppend hook will provide a more precise
   *  finalize signal; this idle-based fallback is the PR 2
   *  baseline and stays as a safety net. */
  ambientIdleMs?: number;
  /** Tier 1 telegram fan-out arc — test seam. Override the
   *  bindings store path (defaults to
   *  `<MONAD_DAEMON_DIR>/telegram-daemon-bindings.json`). Tests
   *  point at a tmp file so mutations don't pollute the real
   *  daemon dir. */
  bindingsStorePath?: string;
}

interface CachedAttach {
  session: DashboardSession;
  /** When the connection drops, we mark this entry stale so the next
   *  turn rebuilds. */
  alive: boolean;
}

export interface TelegramAcpBridge {
  /** Drop-in replacement for the default `runTurnImpl` slot in
   *  `botFromConfig`. Routes LLM dispatch through the daemon. */
  runTurnImpl: (opts: RunTurnOpts) => Promise<RunTurnResult>;
  /** Tear down all cached attaches. Call from the bot's stop handler. */
  close(): Promise<void>;
  /** For tests — current cached session count. */
  cacheSize(): number;
  /** Tier 1 telegram fan-out arc — bind a telegram chat to a daemon
   *  sessionId. PR 3's `/resume` calls this so the chat's next user
   *  message routes to the resumed session (resolveDaemonSessionId
   *  in BotFromConfigOpts looks this up). lastSeenMsgIdx records the
   *  jsonl length at bind-time so subsequent catch-ups don't replay
   *  history that's already been shown. */
  setDaemonSessionForChat(args: {
    chatId: number;
    threadId: number | undefined;
    sessionId: string;
    lastSeenMsgIdx: number;
  }): void;
  /** Tier 1 telegram fan-out arc — chat ↔ daemon session lookup
   *  used by the bot handler before falling back to the default TUI
   *  session flow. Returns null when no binding exists. */
  resolveDaemonSessionForChat(chatId: number, threadId: number | undefined): string | null;
  /** Tier 1 telegram fan-out arc — reverse lookup. Used internally
   *  when wiring `onAmbientTurn` so a fan-out turn flushed via the
   *  ambient buffer can reach the right chat. Exposed for tests so
   *  asserts can verify the binding round-trips. */
  findChatForDaemonSession(sessionId: string): { chatId: number; threadId: number; lastSeenMsgIdx: number } | null;
  /** Tier 1 telegram fan-out arc — advance the cursor for a chat
   *  after the bot has displayed (or sent) a message tied to that
   *  session. The bot calls this after each turn so a future restart
   *  + boot catch-up doesn't re-emit the turn. No-op when the chat
   *  has no binding. */
  advanceCursor(chatId: number, threadId: number | undefined, newIdx: number): void;
  /** Tier 1 telegram fan-out arc — convenience overload for the bot
   *  handler. Reads the daemon's jsonl, then calls `advanceCursor`
   *  with the current message count so the cursor catches up to the
   *  authoritative state. Logs + swallows daemon-history read
   *  failures so a missing jsonl can't break the live turn. */
  advanceCursorAfterTurn(chatId: number, threadId: number | undefined): Promise<void>;
  /** Tier 1 telegram fan-out arc — list every persisted binding.
   *  Used by the bot's boot catch-up to walk all bound chats and
   *  diff their cursor against the daemon's jsonl tail. */
  listDaemonBindings(): Array<{
    chatId: number;
    threadId: number;
    sessionId: string;
    lastSeenMsgIdx: number;
  }>;
}

async function spawnDaemonInBackground(): Promise<void> {
  ensureMonadDaemonDir();
  const fs = await import('node:fs');
  const out = fs.openSync(monadDaemonLogPath(), 'a');
  const err = fs.openSync(monadDaemonLogPath(), 'a');
  const args = [process.argv[1]!, 'serve'];
  const child = childSpawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: process.cwd(),
    env: process.env,
  });
  child.unref();
}

async function waitForSocket(path: string, maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isUnixSocketAlive(path)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Build the bridge. Caller wires `bridge.runTurnImpl` into
 *  `botFromConfig({ runTurnImpl: bridge.runTurnImpl })` and calls
 *  `bridge.close()` from the bot stop path. */
export function createTelegramAcpBridge(
  opts: TelegramAcpBridgeOpts = {},
): TelegramAcpBridge {
  const sockPath = opts.socketPath ?? monadDaemonSocketPath();
  // LF2 — 폴백을 콘솔+debug.log 이중으로: 무prefix stdout 로만 새던 브릿지
  // 라인이 파일 트레일/logs.db 에도 남는다.
  const log = opts.log ?? ((m: string): void => { console.log(m); debug.log('telegram.bridge', m); });
  const cache = new Map<string, CachedAttach>();
  // Tier 1 telegram fan-out arc — chat ↔ daemon session bindings,
  // persisted to disk so a bot restart preserves /resume choices and
  // last-seen cursors. PR 4 wires this through to the bot handler
  // (resolveDaemonSessionId) and the boot catch-up.
  const bindings: TelegramBindingsStore = openTelegramBindingsStore(
    opts.bindingsStorePath ? { storePath: opts.bindingsStorePath } : {},
  );

  async function ensureDaemon(): Promise<void> {
    if (await isUnixSocketAlive(sockPath)) return;
    if (opts.autoSpawn) {
      log(`[daemon-bridge] no daemon at ${sockPath}; auto-spawning…`);
      await spawnDaemonInBackground();
      const ready = await waitForSocket(
        sockPath,
        opts.spawnTimeoutMs ?? 5000,
      );
      if (!ready) {
        throw new Error(
          `daemon-bridge: spawned daemon did not bind ${sockPath} in time`,
        );
      }
    } else {
      throw new Error(
        `daemon-bridge: no monad daemon at ${sockPath}. Start one with \`monad serve --background\`, or set MONAD_TELEGRAM_AUTO_SPAWN_DAEMON=1 to auto-spawn.`,
      );
    }
  }

  // Tier 1 telegram fan-out arc — ambient buffer registry. See
  // src/channel/ambient-buffer.ts for the rationale (per-chat
  // 1msg/sec rate limit + RESEARCH §2.1 hermes batching). Buffer is
  // shared across all sessions this bridge attaches to; entries are
  // keyed by sessionId.
  const ambientRegistry = createAmbientBufferRegistry(
    async (sessionId, text) => {
      if (!opts.onAmbientTurn) return;
      await opts.onAmbientTurn(sessionId, text);
    },
    {
      idleMs: opts.ambientIdleMs ?? 2000,
      log: (m) => log(`[daemon-bridge] ${m}`),
    },
  );

  function buildAmbientHandler(sessionId: string): (update: unknown) => void {
    // Extract text from `agent_message_chunk` and (Tier 1 Phase 3)
    // `user_message_chunk` notifications and forward to the per-
    // session buffer. user_message_chunk is the monad-extension
    // broadcast that fires when ANOTHER surface (PWA / TUI / different
    // chat) sent a user prompt to the same sessionId — we prefix the
    // text so the user can tell their own messages from other
    // surfaces' inputs in the chat timeline. Other sessionUpdate
    // kinds (tool_call, tool_call_update, thought) are ignored at
    // this layer.
    return (update: unknown): void => {
      const userText = extractUserMessageChunkText(update);
      if (userText !== null) {
        ambientRegistry.append(sessionId, `👤 ${userText}\n\n`);
        return;
      }
      const agentText = extractAgentMessageChunkText(update);
      if (agentText !== null) ambientRegistry.append(sessionId, agentText);
    };
  }

  async function attachOrReuse(sessionId: string, cwd: string): Promise<DashboardSession> {
    const cached = cache.get(sessionId);
    if (cached?.alive) return cached.session;
    await ensureDaemon();
    const conn = await connectUnixSocket({ path: sockPath });
    const session = await DashboardSession.attach({ conn, cwd });
    // Tier 1 telegram fan-out arc — install ambient handler so
    // sessionUpdate notifications from other peers (PR #831 broadcast)
    // accumulate into per-turn text and fire onAmbientTurn after the
    // idle window elapses. send()-owned turns are auto-suppressed by
    // DashboardSession.routeSessionUpdate (D3 dedup).
    if (opts.onAmbientTurn) {
      session.setAmbientInterceptor(buildAmbientHandler(sessionId));
    }
    const entry: CachedAttach = { session, alive: true };
    cache.set(sessionId, entry);
    return session;
  }

  function fakeMeta(sessionId: string): SessionMeta {
    return {
      id: sessionId,
      provider: 'monad-daemon',
      model: 'monad-daemon',
      title: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'telegram',
    } as unknown as SessionMeta;
  }

  const runTurnImpl = async (turnOpts: RunTurnOpts): Promise<RunTurnResult> => {
    const key = `telegram:daemon-session#${randomUUID()}`;
    const acquired = acquireTurn(turnOpts.sessionId, key);
    if (!acquired.granted) {
      releaseTurn(turnOpts.sessionId, key);
      return {
        text: `This session is currently receiving input from ${acquired.holder}. Please try again when that turn finishes.`,
        meta: fakeMeta(turnOpts.sessionId),
        usedTokens: 0,
        droppedMessages: 0,
        provider: 'monad-daemon',
        model: 'monad-daemon',
        memoryIds: [],
      };
    }
    try {
      const session = await attachOrReuse(
        turnOpts.sessionId,
        process.cwd(),
      );
      let acc = '';
      try {
      const result = await runDaemonSessionTurnSubmit({
        submit: createDaemonSessionTurnSubmit({
          kind: 'submit-turn',
          source: buildTelegramTextInputSourceRef({ relay: 'daemon-bridge' }),
          text: turnOpts.userText,
          route: 'daemon-session',
        }),
        beforeExecute: (next) => {
          abortTurnSubmitOnRecentQuickPass({
            signalBus: defaultControlSignalBus(),
            scope: {
              channel: 'telegram',
              surface: 'daemon-session',
              sessionId: turnOpts.sessionId,
            },
          });
          emitTurnSubmitBeginSignal({
            submit: next,
            signalBus: defaultControlSignalBus(),
            urgency: 'priority',
            scope: {
              channel: 'telegram',
              surface: 'daemon-session',
              sessionId: turnOpts.sessionId,
            },
          });
        },
        session,
        ...(turnOpts.userAttachments && turnOpts.userAttachments.length > 0
          ? { attachments: turnOpts.userAttachments }
          : {}),
        onText: (delta: string): void => {
          acc += delta;
          turnOpts.onDelta?.(delta);
        },
      });
      // For MVP we ignore non-end_turn stop reasons (cancelled etc.) —
      // the bot still surfaces whatever text accumulated.
      void result;
      } catch (err) {
        // Connection dropped or daemon went down — invalidate cache so
        // the next turn rebuilds. Re-throw with context.
        const entry = cache.get(turnOpts.sessionId);
        if (entry) entry.alive = false;
        throw err;
      }
      return {
        text: acc,
        meta: fakeMeta(turnOpts.sessionId),
        usedTokens: 0,
        droppedMessages: 0,
        provider: 'monad-daemon',
        model: 'monad-daemon',
        memoryIds: [],
      };
    } finally {
      releaseTurn(turnOpts.sessionId, key);
    }
  };

  const close = async (): Promise<void> => {
    // Drain pending ambient buffers (best-effort flush so a finishing
    // turn isn't dropped on shutdown).
    ambientRegistry.flushAll();
    const sessions = [...cache.values()].map((e) => e.session);
    cache.clear();
    await Promise.allSettled(sessions.map((s) => s.close()));
  };

  return {
    runTurnImpl,
    close,
    cacheSize: () => cache.size,
    setDaemonSessionForChat: (args) => bindings.set(args),
    resolveDaemonSessionForChat: (chatId, threadId) => bindings.resolveSessionId(chatId, threadId),
    findChatForDaemonSession: (sessionId) => bindings.findChatBySessionId(sessionId),
    advanceCursor: (chatId, threadId, newIdx) => bindings.advanceCursor(chatId, threadId, newIdx),
    advanceCursorAfterTurn: async (chatId, threadId) => {
      const sid = bindings.resolveSessionId(chatId, threadId);
      if (!sid) return;
      try {
        const r = readDaemonSessionHistory(sid);
        if (r.exists) bindings.advanceCursor(chatId, threadId, r.messages.length);
      } catch (e) {
        log(`[daemon-bridge] advanceCursorAfterTurn read failed: ${String(e)}`);
      }
    },
    listDaemonBindings: () => bindings.list().map((b) => ({
      chatId: b.chatId,
      threadId: b.threadId,
      sessionId: b.sessionId,
      lastSeenMsgIdx: b.lastSeenMsgIdx,
    })),
  };
}
