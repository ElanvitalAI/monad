// H6 P5 · /reply slash command.
//
// Surface:
//   /reply <target-session-id> <message...>                 # user → target
//   /reply --from <source-id> <target-id> <message...>      # source → target
//   /reply --channels r,m <target-id> <message...>          # channel filter
//   /reply --idle-ms 5000 <target-id> <message...>          # longer idle
//   /reply --timeout-ms 60000 <target-id> <message...>      # longer hard cap
//   /reply help
//
// Flags can appear in any order BEFORE the positional <target> <msg>.
// Session ids never contain whitespace (they're minted by the adapter
// registry) so the first non-flag token is treated as <target> and
// everything remaining is the message.

import { debug } from '../../debug/log.js';
import {
  dispatchAgentReply,
  type AgentReplyArgs,
} from './agent-reply.js';
import type {
  SlashExecuteRequest,
  SlashExecuteResult,
} from './dashboard-slash.js';

export interface AgentReplySlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

export async function executeAgentReplySlash(
  req: SlashExecuteRequest,
): Promise<AgentReplySlashResult | null> {
  if (req.name !== 'reply') return null;
  const args = [...req.args];
  const first = args[0]?.toLowerCase();
  if (args.length === 0 || first === 'help' || first === '?') {
    return helpOutput();
  }
  try {
    const parsed = parseArgs(args);
    if ('error' in parsed) return errorOutput(parsed.error);
    const { opts, targetId, message } = parsed;
    const result = await dispatchAgentReply({
      toSessionId: targetId,
      message,
      ...(opts.fromSessionId ? { fromSessionId: opts.fromSessionId } : {}),
      ...(opts.includeChannels ? { includeChannels: opts.includeChannels } : {}),
      ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return {
      ok: !result.isError,
      name: 'reply',
      args: req.args,
      logLines: splitLines(result.output),
      ...(result.isError ? { message: result.output } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (debug.enabled) {
      debug.log('agent-reply.slash.error', 'dispatch', { error: msg, args }, { level: 'error' });
    }
    return {
      ok: false,
      name: 'reply',
      args: req.args,
      logLines: [`/reply: ${msg}`],
      message: msg,
    };
  }
}

// ─── Arg parser ──────────────────────────────────────────────────────

interface ParsedOpts {
  fromSessionId?: string;
  includeChannels?: string[];
  idleMs?: number;
  timeoutMs?: number;
}

interface ParsedArgs {
  opts: ParsedOpts;
  targetId: string;
  message: string;
}

function parseArgs(tokens: string[]): ParsedArgs | { error: string } {
  const opts: ParsedOpts = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === '--from') {
      const next = tokens[i + 1];
      if (!next) return { error: `/reply: --from requires a session id` };
      opts.fromSessionId = next;
      i += 2;
      continue;
    }
    if (t === '--channels') {
      const next = tokens[i + 1];
      if (!next) return { error: `/reply: --channels requires a comma-separated list` };
      opts.includeChannels = next.split(',').map((s) => s.trim()).filter(Boolean);
      i += 2;
      continue;
    }
    if (t === '--idle-ms') {
      const next = tokens[i + 1];
      const n = next ? Number(next) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `/reply: --idle-ms expects a positive number · got '${next ?? ''}'` };
      }
      opts.idleMs = n;
      i += 2;
      continue;
    }
    if (t === '--timeout-ms') {
      const next = tokens[i + 1];
      const n = next ? Number(next) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `/reply: --timeout-ms expects a positive number · got '${next ?? ''}'` };
      }
      opts.timeoutMs = n;
      i += 2;
      continue;
    }
    break; // first non-flag token · positional args start
  }
  const targetId = tokens[i];
  if (!targetId) {
    return { error: `/reply: target session id required · try /reply help` };
  }
  const messageParts = tokens.slice(i + 1);
  if (messageParts.length === 0) {
    return { error: `/reply: message required · /reply <target> <message...>` };
  }
  return {
    opts,
    targetId,
    message: messageParts.join(' '),
  };
}

// ─── Help + error ────────────────────────────────────────────────────

function helpOutput(): AgentReplySlashResult {
  return {
    ok: true,
    name: 'reply',
    args: [],
    logLines: [
      '/reply — send a message to a live embodied session and capture the reply (H6 P5 · Bundle 1)',
      '  /reply <target-session-id> <message...>',
      '  /reply --from <source-id> <target-id> <message...>',
      '  /reply --channels r,m <target-id> <message...>',
      '  /reply --idle-ms 5000 <target-id> <message...>',
      '  /reply --timeout-ms 60000 <target-id> <message...>',
      '  /reply help',
      '',
      '  Flags before positional args. Default channel filter = message only.',
      '  Cycle depth cap = 8 (across inbound reply edges) · exceeded → abort.',
      '  Timeouts return partial content + "timeout-truncated" warning (NOT an error).',
      '',
      '  Example: /reply emb-codex-pty-1 "what did you just do?"',
      '  Example: /reply --from emb-claude-pty-1 emb-codex-pty-2 "can you verify this diff?"',
    ],
  };
}

function errorOutput(message: string): AgentReplySlashResult {
  return {
    ok: false,
    name: 'reply',
    args: [],
    logLines: [message],
    message,
  };
}

function splitLines(s: string): string[] {
  return s.split('\n');
}
