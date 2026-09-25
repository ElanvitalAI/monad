// H6 P2 Bundle 1 + 2 B · /llm slash command.
//
// Surface:
//   /llm nodes                              # list Tailscale fleet + runtime reachability
//   /llm models [--node <id>] [--refresh]   # list available models (optionally filtered)
//   /llm refresh                            # force-probe every node now (invalidate 5 min cache)
//   /llm install <runtime> <node> <model>   # HITL-gated download (Bundle 2 B · lms get / ollama pull)
//                 [--size-bytes <n>]        #   optional size hint · triggers disk precheck
//   /llm help
//
// Bundle 2 A/A2/C1/D live in `/acp-vw lll <spec>` and outer-LLM routing
// — not through /llm directly.

import { debug } from '../../debug/log.js';
import {
  dispatchLlmListNodes,
  dispatchLlmListAvailableModels,
} from './llm-manager.js';
import { dispatchLlmRequestInstall } from './llm-install.js';
import type { ManagerDeps } from '../../llm/local-manager/manager.js';
import type { InstallerDeps } from '../../llm/local-manager/installer.js';
import type {
  SlashExecuteRequest,
  SlashExecuteResult,
} from './dashboard-slash.js';

export interface LlmSlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

export async function executeLlmSlash(
  req: SlashExecuteRequest,
  deps: ManagerDeps & InstallerDeps = {},
): Promise<LlmSlashResult | null> {
  if (req.name !== 'llm') return null;
  const args = [...req.args];
  const sub = (args[0] ?? '').toLowerCase();

  if (args.length === 0 || sub === 'help' || sub === '?') {
    return helpOutput();
  }

  try {
    if (sub === 'nodes' || sub === 'node') {
      const refresh = args.slice(1).some((a) => a === '--refresh');
      const r = await dispatchLlmListNodes({ refresh }, deps);
      return {
        ok: !r.isError,
        name: 'llm',
        args: req.args,
        logLines: splitLines(r.output),
        ...(r.isError ? { message: r.output } : {}),
      };
    }
    if (sub === 'models' || sub === 'model') {
      const parsed = parseModelsArgs(args.slice(1));
      if ('error' in parsed) return errorOutput(parsed.error);
      const r = await dispatchLlmListAvailableModels(parsed.opts as Record<string, unknown>, deps);
      return {
        ok: !r.isError,
        name: 'llm',
        args: req.args,
        logLines: splitLines(r.output),
        ...(r.isError ? { message: r.output } : {}),
      };
    }
    if (sub === 'refresh' || sub === 'refetch') {
      const r = await dispatchLlmListNodes({ refresh: true }, deps);
      return {
        ok: !r.isError,
        name: 'llm',
        args: req.args,
        logLines: splitLines(r.output.replace(/^LlmListNodes:/, '/llm refresh:')),
        ...(r.isError ? { message: r.output } : {}),
      };
    }
    if (sub === 'install') {
      const parsed = parseInstallArgs(args.slice(1));
      if ('error' in parsed) return errorOutput(parsed.error);
      const r = await dispatchLlmRequestInstall(parsed.opts as unknown as Record<string, unknown>, deps);
      return {
        ok: !r.isError,
        name: 'llm',
        args: req.args,
        logLines: splitLines(r.output),
        ...(r.isError ? { message: r.output } : {}),
      };
    }
    return errorOutput(`/llm: unknown subcommand '${sub}' · try /llm help`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (debug.enabled) {
      debug.log('llm.manager.slash.error', sub, { error: msg, args }, { level: 'error' });
    }
    return {
      ok: false,
      name: 'llm',
      args: req.args,
      logLines: [`/llm ${sub}: ${msg}`],
      message: msg,
    };
  }
}

// ─── Arg parsers ────────────────────────────────────────────────────

interface ModelsOpts {
  node?: string;
  refresh?: boolean;
}

function parseModelsArgs(tokens: string[]): { opts: ModelsOpts } | { error: string } {
  const opts: ModelsOpts = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === '--node' || t === '-n') {
      const next = tokens[i + 1];
      if (!next) return { error: `/llm models: --node requires an id · try /llm nodes first` };
      opts.node = next;
      i += 2;
      continue;
    }
    if (t === '--refresh') {
      opts.refresh = true;
      i += 1;
      continue;
    }
    return { error: `/llm models: unknown argument '${t}'` };
  }
  return { opts };
}

interface InstallOpts {
  runtime: string;
  nodeId: string;
  modelName: string;
  estimatedSizeBytes?: number;
}

function parseInstallArgs(tokens: string[]): { opts: InstallOpts } | { error: string } {
  // Positional: <runtime> <node> <model>  · optional: --size-bytes N
  const positional: string[] = [];
  let size: number | undefined;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === '--size-bytes') {
      const next = tokens[i + 1];
      if (!next) return { error: `/llm install: --size-bytes requires a number` };
      const n = Number.parseInt(next, 10);
      if (!Number.isFinite(n) || n <= 0) return { error: `/llm install: --size-bytes must be positive integer bytes` };
      size = n;
      i += 2;
      continue;
    }
    if (t.startsWith('--')) return { error: `/llm install: unknown flag '${t}'` };
    positional.push(t);
    i += 1;
  }
  if (positional.length < 3) {
    return {
      error:
        `/llm install <runtime> <node> <model> [--size-bytes N] · ` +
        `example: /llm install ollama local llama3.1:8b`,
    };
  }
  const [runtime, nodeId, ...rest] = positional;
  const modelName = rest.join(' ');
  return {
    opts: {
      runtime: runtime!,
      nodeId: nodeId!,
      modelName,
      ...(typeof size === 'number' ? { estimatedSizeBytes: size } : {}),
    },
  };
}

// ─── Help + error ───────────────────────────────────────────────────

function helpOutput(): LlmSlashResult {
  return {
    ok: true,
    name: 'llm',
    args: [],
    logLines: [
      '/llm — local LLM fleet inventory + install (H6 P2 Bundle 1 + 2 B · LM Studio + Ollama)',
      '  /llm nodes                                      # Tailscale hosts + runtime reachability',
      '  /llm models [--node <id>]                       # models per node · optional filter',
      '  /llm models --refresh                           # force-probe before listing',
      '  /llm refresh                                    # force-probe every node now',
      '  /llm install <runtime> <node> <model>           # HITL-gated download · lms get / ollama pull',
      '     [--size-bytes N]                             # optional hint · triggers disk precheck (N × 1.5)',
      '  /llm help',
      '',
      '  Model spec for outer-LLM routing: local-llm:<nodeId>:<modelId>',
      '  Example: local-llm:mbp:qwen2.5-32b-instruct-mlx',
      '  Example: local-llm:local:llama3.1:8b   # Ollama model · port 11434',
      '',
      '  Embodied sessions: /acp-vw lll <spec> · auto-dispatches to lms chat or ollama run',
      '                     · local + remote (Tailscale) · runtime picked from inventory',
      '',
      '  Bundle 2 remaining: C2 MLX · C3 Docker probe · Bundle 3 HTTP SSE wrapper · chat widget',
    ],
  };
}

function errorOutput(message: string): LlmSlashResult {
  return {
    ok: false,
    name: 'llm',
    args: [],
    logLines: [message],
    message,
  };
}

function splitLines(s: string): string[] {
  return s.split('\n');
}
