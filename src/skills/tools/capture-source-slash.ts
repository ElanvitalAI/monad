// H6 P6 · /capture slash · user-facing equivalent of the two LLM tools.
//
// Surface:
//   /capture list
//   /capture snapshot <sourceId> [--format text|ansi|png|svg|asciicast]
//                                [--cols N --rows N]
//   /capture help

import { debug } from '../../debug/log.js';
import {
  dispatchListCaptureSources,
  dispatchSnapshotSource,
} from './capture-source.js';
import type {
  SlashExecuteRequest,
  SlashExecuteResult,
} from './dashboard-slash.js';
import type { CaptureFormat } from '../../capture/types.js';

export interface CaptureSourceSlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

const SUPPORTED_FORMATS: readonly CaptureFormat[] = [
  'text', 'ansi', 'png', 'svg', 'asciicast',
];

export async function executeCaptureSourceSlash(
  req: SlashExecuteRequest,
): Promise<CaptureSourceSlashResult | null> {
  if (req.name !== 'capture') return null;
  const [sub, ...rest] = req.args;
  const norm = (sub ?? '').toLowerCase();
  try {
    switch (norm) {
      case '':
      case 'help':
      case '?':
        return helpOutput();
      case 'list':
        return await listAction();
      case 'snapshot':
        return await snapshotAction(rest);
      default:
        return errorOutput(
          `/capture: unknown subcommand '${norm}' · try /capture help`,
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (debug.enabled) {
      debug.log('capture.slash.error', norm, { error: msg, args: req.args }, { level: 'error' });
    }
    return {
      ok: false,
      name: req.name,
      args: req.args,
      logLines: [`/capture ${norm}: ${msg}`],
      message: msg,
    };
  }
}

// ─── Subcommands ─────────────────────────────────────────────────────

async function listAction(): Promise<CaptureSourceSlashResult> {
  const r = await dispatchListCaptureSources({});
  return {
    ok: !r.isError,
    name: 'capture',
    args: ['list'],
    logLines: splitLines(r.output),
  };
}

async function snapshotAction(args: readonly string[]): Promise<CaptureSourceSlashResult> {
  const parsed = parseSnapshotArgs(args);
  if ('error' in parsed) return errorOutput(parsed.error);
  const { sourceId, format, dims } = parsed;
  const r = await dispatchSnapshotSource({
    sourceId,
    ...(format ? { format } : {}),
    ...(dims ? { dims } : {}),
  });
  return {
    ok: !r.isError,
    name: 'capture',
    args: ['snapshot', sourceId],
    logLines: splitLines(r.output),
    ...(r.isError ? { message: r.output } : {}),
  };
}

interface SnapshotArgs {
  sourceId: string;
  format?: CaptureFormat;
  dims?: { cols: number; rows: number };
}

function parseSnapshotArgs(tokens: readonly string[]): SnapshotArgs | { error: string } {
  let sourceId: string | undefined;
  let format: CaptureFormat | undefined;
  let cols: number | undefined;
  let rows: number | undefined;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === '--format') {
      const next = tokens[i + 1];
      if (!next || !(SUPPORTED_FORMATS as string[]).includes(next)) {
        return { error: `/capture snapshot: --format requires one of ${SUPPORTED_FORMATS.join(', ')}` };
      }
      format = next as CaptureFormat;
      i += 2;
      continue;
    }
    if (t === '--cols') {
      const next = tokens[i + 1];
      const n = next ? Number(next) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `/capture snapshot: --cols requires positive number` };
      }
      cols = n;
      i += 2;
      continue;
    }
    if (t === '--rows') {
      const next = tokens[i + 1];
      const n = next ? Number(next) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        return { error: `/capture snapshot: --rows requires positive number` };
      }
      rows = n;
      i += 2;
      continue;
    }
    if (sourceId === undefined) {
      sourceId = t;
      i += 1;
      continue;
    }
    return { error: `/capture snapshot: unexpected token '${t}'` };
  }
  if (!sourceId) {
    return { error: `/capture snapshot: sourceId required · /capture list to discover ids` };
  }
  if ((cols !== undefined) !== (rows !== undefined)) {
    return { error: `/capture snapshot: --cols and --rows must be set together` };
  }
  const result: SnapshotArgs = { sourceId };
  if (format) result.format = format;
  if (cols !== undefined && rows !== undefined) {
    result.dims = { cols, rows };
  }
  return result;
}

// ─── Help + error ────────────────────────────────────────────────────

function helpOutput(): CaptureSourceSlashResult {
  return {
    ok: true,
    name: 'capture',
    args: [],
    logLines: [
      '/capture — capture source registry (H6 P6 · Bundle 1)',
      '  /capture list',
      '      enumerate VW panes · agent sessions · browser CDP pages',
      '  /capture snapshot <sourceId>',
      '      snapshot a source · default format = text for agent-session /',
      '      vw-pane · png for browser-cdp',
      '  /capture snapshot <sourceId> --format text|ansi|png|svg|asciicast',
      '  /capture snapshot <sourceId> --cols 120 --rows 40',
      '  /capture help',
      '',
      '  Source id format: <type>:<native>',
      '    vw-pane:<windowId>/<paneId>',
      '    agent-session:<session-id>',
      '    browser-cdp:page-0',
      '',
      '  Use /capture list FIRST to discover ids; ids are not stable',
      '  across sessions (they mirror live window/session registries).',
    ],
  };
}

function errorOutput(message: string): CaptureSourceSlashResult {
  return {
    ok: false,
    name: 'capture',
    args: [],
    logLines: [message],
    message,
  };
}

function splitLines(s: string): string[] {
  return s.split('\n');
}
