// Step 1 of platform-evolution arc · PR b — Discord bot ↔ Elanous
// ACP bridge.
//
// Renamed from `discord-daemon-bridge.ts` in C-1b (cleanup ROADMAP
// 2026-05-08): with NEXUS N-1.5 v6 hard landing, the "daemon" the bot
// attaches to is no longer a separate `elanous serve` process — it's the
// daemon-runtime hosted in-process inside `elanous nexus` over the same
// unix socket. (`elanous serve` was deleted in C-4a; only NEXUS hosts the daemon-runtime now.)
// Hence the rename: this file is an **ACP bridge** that happens to use
// the daemon socket protocol.
//
// Mirrors src/telegram-acp-bridge.ts: Discord becomes a thin ACP
// client of the ACP server, attaching a hot per-discord-channel
// DashboardSession over the same Unix socket the telegram bot uses.
// With this wired in, Discord is a 1st-class ACP citizen — same
// sessionPeers fan-out, ambient observation, /resume <id> binding,
// and (PR c) boot catch-up.
//
// Why not extend telegram-acp-bridge.ts directly: identifier shapes
// diverge (telegram chatId = number, discord = snowflake string;
// threadId optional vs absent). Mirroring keeps each bridge readable;
// the shared base lives in src/channel/* (bindings, ambient buffer,
// future ChannelStreamer adapters).
//
// Failure modes:
//   - ACP server not reachable + no auto-spawn → throws so the user
//     sees the error in their discord chat.
//   - ACP server dies mid-stream → cached session invalidated, next
//     turn reattaches fresh.
//
// MVP scope of this PR:
//   - runTurnForDiscord(channelId, userText, onDelta) entry point
//     callable from index.ts's discord.run onMessage handler.
//   - Per-channel ACP attach hot-cached.
//   - Streaming onDelta → bot edits placeholder live.
//   - Multimodal attachments dropped here (Step 2 follow-up — same
//     as telegram-acp-bridge line 17).
//   - /resume binding + boot catch-up wired in PR c.

import { spawn as childSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  connectUnixSocket,
  isUnixSocketAlive,
} from './tui-client/acp-transport-unix-client.js';
import { DashboardSession } from './tui-client/dashboard-session.js';
import { defaultControlSignalBus } from './input/control-signal.js';
import { buildDiscordTextInputSourceRef } from './input/input-source-kind.js';
import { emitTurnSubmitBeginSignal } from './input/turn-submit-control.js';
import { abortTurnSubmitOnRecentQuickPass } from './input/turn-submit-revision.js';
import { acquireTurn, releaseTurn } from './session/session-input-arbiter.js';
import {
  createDaemonSessionTurnSubmit,
  runDaemonSessionTurnSubmit,
} from './tui-client/daemon-session-submit-runtime.js';
import {
  elanousDaemonSocketPath,
  elanousDaemonLogPath,
  ensureElanousDaemonDir,
} from './elanous-daemon.js';
import {
  createAmbientBufferRegistry,
  extractAgentMessageChunkText,
  extractUserMessageChunkText,
} from './channel/ambient-buffer.js';
import {
  openChannelBindingsStore,
  defaultChannelBindingsPath,
  type ChannelBindingsStore,
} from './channel/bindings-store.js';
import { readDaemonSessionHistory } from './telegram/daemon-history-reader.js';
import { debug } from './debug/log.js';

export interface DiscordAcpBridgeOpts {
  /** Override the daemon socket path. */
  socketPath?: string;
  /** Auto-spawn `elanous serve --background` when the socket is not
   *  alive. Default false. */
  autoSpawn?: boolean;
  /** How long to wait for the socket after auto-spawn (ms). */
  spawnTimeoutMs?: number;
  /** Logger. */
  log?: (msg: string) => void;
  /** Fires when fan-out from another surface arrives for a sessionId
   *  this bridge is attached to. Channel-agnostic — caller resolves
   *  sessionId → channelId via bindings. */
  onAmbientTurn?: (sessionId: string, text: string) => void | Promise<void>;
  /** Idle window before an ambient turn finalizes. Default 2000ms. */
  ambientIdleMs?: number;
  /** Test seam — override the channel bindings store path. */
  bindingsStorePath?: string;
}

interface CachedAttach {
  session: DashboardSession;
  alive: boolean;
}

export interface DiscordAcpBridge {
  /** Run a turn through the daemon. Caller (index.ts discord
   *  onMessage) resolves channelId + thread already; this bridge
   *  only needs the userText + sessionId resolution + a streaming
   *  onDelta hook. Returns the accumulated text — the discord bot
   *  layer handles edit/finalize.
   *
   *  Step 2 of platform-evolution arc · PR γ — `attachments` carries
   *  channel-side normalized attachments (Discord's onMessage
   *  download path produces these via NormalizedAttachment[] for the
   *  legacy runAcpTurn route; the bridge forwards them to the daemon
   *  via DashboardSession.send.attachments which calls buildAcpPrompt
   *  to fold them into the ACP ContentBlock[]). Empty / omitted =
   *  text-only turn. */
  runTurn(opts: {
    channelId: string;
    userText: string;
    attachments?: import('./acp/content-blocks.js').NormalizedAttachment[];
    onDelta?: (chunk: string) => void;
  }): Promise<{ text: string }>;
  /** Tear down all cached attaches. */
  close(): Promise<void>;
  cacheSize(): number;
  /** Bind a discord channel to a daemon sessionId (PR c /resume). */
  setDaemonSessionForChannel(args: {
    channelId: string;
    sessionId: string;
    lastSeenMsgIdx: number;
  }): void;
  /** Lookup. */
  resolveDaemonSessionForChannel(channelId: string): string | null;
  findChannelForDaemonSession(sessionId: string): {
    channelId: string;
    lastSeenMsgIdx: number;
  } | null;
  /** Cursor advance. */
  advanceCursor(channelId: string, newIdx: number): void;
  advanceCursorAfterTurn(channelId: string): Promise<void>;
  listDaemonBindings(): Array<{
    channelId: string;
    sessionId: string;
    lastSeenMsgIdx: number;
  }>;
}

async function spawnDaemonInBackground(): Promise<void> {
  ensureElanousDaemonDir();
  const fs = await import('node:fs');
  const out = fs.openSync(elanousDaemonLogPath(), 'a');
  const err = fs.openSync(elanousDaemonLogPath(), 'a');
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

export function createDiscordAcpBridge(
  opts: DiscordAcpBridgeOpts = {},
): DiscordAcpBridge {
  const sockPath = opts.socketPath ?? elanousDaemonSocketPath();
  // LF2 — 폴백을 콘솔+debug.log 이중으로(telegram-acp-bridge 동형).
  const log = opts.log ?? ((m: string): void => { console.log(m); debug.log('discord.bridge', m); });
  const cache = new Map<string, CachedAttach>();
  const bindings: ChannelBindingsStore = openChannelBindingsStore(
    opts.bindingsStorePath
      ? { storePath: opts.bindingsStorePath }
      : { storePath: defaultChannelBindingsPath() },
  );

  async function ensureDaemon(): Promise<void> {
    if (await isUnixSocketAlive(sockPath)) return;
    if (opts.autoSpawn) {
      log(`[discord-acp-bridge] no daemon at ${sockPath}; auto-spawning…`);
      await spawnDaemonInBackground();
      const ready = await waitForSocket(sockPath, opts.spawnTimeoutMs ?? 5000);
      if (!ready) {
        throw new Error(
          `discord-acp-bridge: spawned daemon did not bind ${sockPath} in time`,
        );
      }
    } else {
      throw new Error(
        `discord-acp-bridge: no elanous daemon at ${sockPath}. Start one with \`elanous serve --background\`, or set ELANOUS_DISCORD_AUTO_SPAWN_DAEMON=1 to auto-spawn.`,
      );
    }
  }

  const ambientRegistry = createAmbientBufferRegistry(
    async (sessionId, text) => {
      if (!opts.onAmbientTurn) return;
      await opts.onAmbientTurn(sessionId, text);
    },
    {
      idleMs: opts.ambientIdleMs ?? 2000,
      log: (m) => log(`[discord-acp-bridge] ${m}`),
    },
  );

  function buildAmbientHandler(sessionId: string): (update: unknown) => void {
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
    if (opts.onAmbientTurn) {
      session.setAmbientInterceptor(buildAmbientHandler(sessionId));
    }
    cache.set(sessionId, { session, alive: true });
    return session;
  }

  async function runTurn(
    runOpts: {
      channelId: string;
      userText: string;
      attachments?: import('./acp/content-blocks.js').NormalizedAttachment[];
      onDelta?: (chunk: string) => void;
    },
  ): Promise<{ text: string }> {
    const sessionId = bindings.resolveSessionId({
      channel: 'discord',
      chatId: runOpts.channelId,
    });
    if (!sessionId) {
      throw new Error(
        `discord-acp-bridge: no daemon session bound for channel ${runOpts.channelId}. ` +
        `Use \`!resume <sessionId>\` to bind one.`,
      );
    }
    const key = `discord:daemon-session#${randomUUID()}`;
    const acquired = acquireTurn(sessionId, key);
    if (!acquired.granted) {
      releaseTurn(sessionId, key);
      return { text: `This session is currently receiving input from ${acquired.holder}. Please try again when that turn finishes.` };
    }
    try {
      const session = await attachOrReuse(sessionId, process.cwd());
      let acc = '';
      try {
      await runDaemonSessionTurnSubmit({
        submit: createDaemonSessionTurnSubmit({
          kind: 'submit-turn',
          source: buildDiscordTextInputSourceRef({
            channelId: runOpts.channelId,
            relay: 'daemon-bridge',
          }),
          text: runOpts.userText,
          route: 'daemon-session',
        }),
        beforeExecute: (next) => {
          abortTurnSubmitOnRecentQuickPass({
            signalBus: defaultControlSignalBus(),
            scope: {
              channel: 'discord',
              surface: 'daemon-session',
              sessionId,
            },
          });
          emitTurnSubmitBeginSignal({
            submit: next,
            signalBus: defaultControlSignalBus(),
            urgency: 'priority',
            scope: {
              channel: 'discord',
              surface: 'daemon-session',
              sessionId,
            },
          });
        },
        session,
        ...(runOpts.attachments && runOpts.attachments.length > 0
          ? { attachments: runOpts.attachments }
          : {}),
        onText: (delta: string): void => {
          acc += delta;
          runOpts.onDelta?.(delta);
        },
      });
      } catch (err) {
        const entry = cache.get(sessionId);
        if (entry) entry.alive = false;
        throw err;
      }
      return { text: acc };
    } finally {
      releaseTurn(sessionId, key);
    }
  }

  async function close(): Promise<void> {
    ambientRegistry.flushAll();
    const sessions = [...cache.values()].map((e) => e.session);
    cache.clear();
    await Promise.allSettled(sessions.map((s) => s.close()));
  }

  return {
    runTurn,
    close,
    cacheSize: () => cache.size,
    setDaemonSessionForChannel: ({ channelId, sessionId, lastSeenMsgIdx }) => {
      bindings.set({
        channel: 'discord',
        chatId: channelId,
        sessionId,
        lastSeenMsgIdx,
      });
    },
    resolveDaemonSessionForChannel: (channelId) =>
      bindings.resolveSessionId({ channel: 'discord', chatId: channelId }),
    findChannelForDaemonSession: (sessionId) => {
      const b = bindings.findChatBySessionId(sessionId, { channel: 'discord' });
      if (!b) return null;
      return { channelId: b.chatId, lastSeenMsgIdx: b.lastSeenMsgIdx };
    },
    advanceCursor: (channelId, newIdx) => {
      bindings.advanceCursor({
        channel: 'discord',
        chatId: channelId,
        newIdx,
      });
    },
    advanceCursorAfterTurn: async (channelId) => {
      const sid = bindings.resolveSessionId({ channel: 'discord', chatId: channelId });
      if (!sid) return;
      try {
        const r = readDaemonSessionHistory(sid);
        if (r.exists) {
          bindings.advanceCursor({
            channel: 'discord',
            chatId: channelId,
            newIdx: r.messages.length,
          });
        }
      } catch (e) {
        log(`[discord-acp-bridge] advanceCursorAfterTurn read failed: ${String(e)}`);
      }
    },
    listDaemonBindings: () => bindings.listByChannel('discord').map((b) => ({
      channelId: b.chatId,
      sessionId: b.sessionId,
      lastSeenMsgIdx: b.lastSeenMsgIdx,
    })),
  };
}
