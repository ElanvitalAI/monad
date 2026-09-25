// H6 P7 · /inject slash command.
//
// Surface:
//   /inject <sourceId> <targetId>                           # default as=attached-block
//   /inject --as user-message <sid> <tid>                   # raw as user typed
//   /inject --as system-note <sid> <tid>                    # [Context]..[/Context]
//   /inject --as attached-block <sid> <tid>                 # XML-ish block (default)
//   /inject --at <epoch-ms> <sid> <tid>                     # Bundle 2 · v1 emits warning
//   /inject --from <source-session-id> <sid> <tid>          # explicit from edge
//   /inject help
//
// Flags may appear in any order BEFORE the positional <sourceId>
// <targetId>. No free-form message tail — inject content comes from
// the capture source, not the command line.

import { debug } from '../../debug/log.js';
import {
  dispatchInjectCaptureToContext,
} from './capture-inject.js';
import type { InjectMode } from '../../capture/inject-context.js';
import type {
  SlashExecuteRequest,
  SlashExecuteResult,
} from './dashboard-slash.js';

const DEFAULT_AS: InjectMode = 'attached-block';
const VALID_MODES: readonly InjectMode[] = [
  'user-message', 'system-note', 'attached-block',
];

export interface CaptureInjectSlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

export async function executeCaptureInjectSlash(
  req: SlashExecuteRequest,
): Promise<CaptureInjectSlashResult | null> {
  if (req.name !== 'inject') return null;
  const args = [...req.args];
  const first = args[0]?.toLowerCase();
  if (args.length === 0 || first === 'help' || first === '?') {
    return helpOutput();
  }
  try {
    const parsed = parseArgs(args);
    if ('error' in parsed) return errorOutput(parsed.error);
    const { opts, sourceId, targetId } = parsed;
    const result = await dispatchInjectCaptureToContext({
      sourceId,
      targetSessionId: targetId,
      as: opts.as ?? DEFAULT_AS,
      ...(opts.at !== undefined ? { at: opts.at } : {}),
      ...(opts.fromSessionId ? { fromSessionId: opts.fromSessionId } : {}),
    });
    return {
      ok: !result.isError,
      name: 'inject',
      args: req.args,
      logLines: splitLines(result.output),
      ...(result.isError ? { message: result.output } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (debug.enabled) {
      debug.log('capture-inject.slash.error', 'dispatch', { error: msg, args }, { level: 'error' });
    }
    return {
      ok: false,
      name: 'inject',
      args: req.args,
      logLines: [`/inject: ${msg}`],
      message: msg,
    };
  }
}

// ─── Arg parser ──────────────────────────────────────────────────────

interface ParsedOpts {
  as?: InjectMode;
  at?: number;
  fromSessionId?: string;
}

interface ParsedArgs {
  opts: ParsedOpts;
  sourceId: string;
  targetId: string;
}

function parseArgs(tokens: string[]): ParsedArgs | { error: string } {
  const opts: ParsedOpts = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === '--as') {
      const next = tokens[i + 1];
      if (!next) return { error: `/inject: --as requires a mode (${VALID_MODES.join(' | ')})` };
      if (!(VALID_MODES as readonly string[]).includes(next)) {
        return { error: `/inject: invalid --as '${next}' · must be one of ${VALID_MODES.join(', ')}` };
      }
      opts.as = next as InjectMode;
      i += 2;
      continue;
    }
    if (t === '--at') {
      const next = tokens[i + 1];
      const n = next ? Number(next) : NaN;
      if (!Number.isFinite(n) || n < 0) {
        return { error: `/inject: --at expects a non-negative epoch ms · got '${next ?? ''}'` };
      }
      opts.at = n;
      i += 2;
      continue;
    }
    if (t === '--from') {
      const next = tokens[i + 1];
      if (!next) return { error: `/inject: --from requires a session id` };
      opts.fromSessionId = next;
      i += 2;
      continue;
    }
    break; // first non-flag token · positional args start
  }
  const sourceId = tokens[i];
  if (!sourceId) {
    return { error: `/inject: sourceId required · try /inject help` };
  }
  const targetId = tokens[i + 1];
  if (!targetId) {
    return { error: `/inject: targetId required · /inject <sourceId> <targetId>` };
  }
  if (tokens.length > i + 2) {
    return { error: `/inject: unexpected extra arguments · ${tokens.slice(i + 2).join(' ')}` };
  }
  return { opts, sourceId, targetId };
}

// ─── Help + error ────────────────────────────────────────────────────

function helpOutput(): CaptureInjectSlashResult {
  return {
    ok: true,
    name: 'inject',
    args: [],
    logLines: [
      '/inject — inject a capture-source snapshot into a live agent session (H6 P7 · Bundle 1)',
      '  /inject <sourceId> <targetId>                       # default --as=attached-block',
      '  /inject --as user-message <sourceId> <targetId>',
      '  /inject --as system-note <sourceId> <targetId>',
      '  /inject --at <epoch-ms> <sourceId> <targetId>       # Bundle 2 · v1 emits warning',
      '  /inject --from <session-id> <sourceId> <targetId>',
      '  /inject help',
      '',
      '  Flags before positional args. Source enumeration: /capture list.',
      '  Every call goes through a HITL binary approver before target.send().',
      '  Non-revocable v1 — once approved + sent, bytes are in the target PTY buffer.',
      '  Approver denial / timeout is NOT an error — LLM sees warnings + can adapt.',
      '',
      '  Example: /inject vw-pane:1/p12 emb-claude-pty-1',
      '  Example: /inject --as system-note agent-session:emb-codex-pty-1 emb-claude-pty-1',
    ],
  };
}

function errorOutput(message: string): CaptureInjectSlashResult {
  return {
    ok: false,
    name: 'inject',
    args: [],
    logLines: [message],
    message,
  };
}

function splitLines(s: string): string[] {
  return s.split('\n');
}
