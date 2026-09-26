// ── C1 (Phase 3 Bundle 3) — shell as Discord channel entity ──
//
// HANDOFF Phase 3 / ROADMAP §6 C1: "shell 이 Discord 채널 entity".
// Discord 채널 (또는 thread) 의 slash command 를 elanous shell spawn 으로
// route + 결과를 같은 채널에 post.
//
// 흐름:
//   [#dev-ops] /build
//     ↓ Discord channel command webhook
//     ↓ ShellChannelOrchestrator.handleCommand
//     ↓ ShellRegistry.spawn (mode=vw, attached to channel id)
//     ↓ shell.result → channelPost (요약 + exit code)
//
// Pure orchestrator — Discord adapter (channel post / command receive)
// 는 host 주입. C 시리즈 wire-light: Discord arc shipped 시 wire 완성.

import type { ShellHandle, ShellRegistry, ShellRequest, ShellResult } from '../shell-runner/types.js';

export interface DiscordChannel {
  readonly id: string;
  readonly name: string;
  /** 'thread' | 'voice' | 'text' 등. text 가 기본. */
  readonly kind?: string;
}

export interface ChannelCommand {
  readonly channel: DiscordChannel;
  readonly userId: string;
  readonly username?: string;
  readonly verb: string;        // "build" | "test" | "deploy" 등
  readonly args?: readonly string[];
  /** Raw transcript for error / log. */
  readonly raw?: string;
}

export interface ChannelPost {
  readonly channelId: string;
  readonly message: string;
  /** 응답 형식 hint — 'embed' / 'plain' 등. host 가 결정. */
  readonly format?: 'embed' | 'plain';
}

export type CommandResolution =
  | { readonly kind: 'allow'; readonly request: ShellRequest }
  | { readonly kind: 'deny'; readonly reason: string }
  | { readonly kind: 'unknown' };

export interface ShellChannelOrchestratorDeps {
  registry: ShellRegistry;
  spawnShell: (req: ShellRequest) => Promise<ShellHandle | null> | ShellHandle | null;
  /** verb (예: "build") + args → ShellRequest 또는 deny / unknown. */
  resolveCommand: (cmd: ChannelCommand) => CommandResolution;
  /** Channel 으로 메시지 post. */
  channelPost: (post: ChannelPost) => Promise<void>;
  /** Result summary 작성 — defaults to terse "exit N · D ms" form. */
  composeResult?: (result: ShellResult, cmd: ChannelCommand) => string;
  /** Per-command await budget — over-budget 시 채널에 "still running"
   *  중간 보고 + handle 은 그대로 살림. Default 60_000 (1 min). */
  resultBudgetMs?: number;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface ShellChannelOrchestrator {
  handleCommand(cmd: ChannelCommand): Promise<{
    outcome: 'spawned' | 'denied' | 'unknown' | 'spawn-failed';
    shellId?: string;
    reason?: string;
  }>;
}

const DEFAULT_BUDGET_MS = 60_000;

function defaultCompose(result: ShellResult, cmd: ChannelCommand): string {
  const exit = result.exitCode !== undefined ? `exit ${result.exitCode}` : result.outcome;
  const tail = result.aggregated?.text?.split('\n').slice(-5).join('\n') ?? '';
  return `**${cmd.verb}** by @${cmd.username ?? cmd.userId} → ${exit} · ${result.durationMs}ms\n\`\`\`\n${tail}\n\`\`\``;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(v);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(null);
    });
  });
}

export function createShellChannelOrchestrator(
  deps: ShellChannelOrchestratorDeps,
): ShellChannelOrchestrator {
  const compose = deps.composeResult ?? defaultCompose;
  const budget = deps.resultBudgetMs ?? DEFAULT_BUDGET_MS;
  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  return {
    async handleCommand(cmd) {
      const resolution = deps.resolveCommand(cmd);
      if (resolution.kind === 'unknown') {
        log('discord.shell.unknown', cmd.verb);
        await deps.channelPost({
          channelId: cmd.channel.id,
          message: `❓ unknown command: \`${cmd.verb}\``,
        });
        return { outcome: 'unknown' };
      }
      if (resolution.kind === 'deny') {
        log('discord.shell.denied', cmd.verb, { reason: resolution.reason });
        await deps.channelPost({
          channelId: cmd.channel.id,
          message: `🚫 denied: ${resolution.reason}`,
        });
        return { outcome: 'denied', reason: resolution.reason };
      }

      const handle = await deps.spawnShell(resolution.request);
      if (!handle) {
        log('discord.shell.spawn-failed', cmd.verb);
        await deps.channelPost({
          channelId: cmd.channel.id,
          message: `⚠️ failed to spawn shell for \`${cmd.verb}\``,
        });
        return { outcome: 'spawn-failed' };
      }
      log('discord.shell.spawned', handle.id, { channel: cmd.channel.id });

      // Background — await result + post, but don't block handler return.
      void (async () => {
        const result = await withTimeout(handle.result, budget);
        if (!result) {
          log('discord.shell.budget-elapsed', handle.id);
          await deps.channelPost({
            channelId: cmd.channel.id,
            message: `⏳ \`${cmd.verb}\` 가 ${Math.round(budget / 1000)}초 안에 안 끝남 — shell 은 살아있음 (\`${handle.id}\`)`,
          });
          return;
        }
        try {
          await deps.channelPost({
            channelId: cmd.channel.id,
            message: compose(result, cmd),
          });
        } catch (err) {
          log('discord.shell.post-throw', handle.id, { error: String(err) });
        }
      })();

      return { outcome: 'spawned', shellId: handle.id };
    },
  };
}
