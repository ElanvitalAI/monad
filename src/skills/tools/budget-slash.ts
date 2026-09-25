// Slash command: /budget · /budget set · /budget refresh
//
// Thin wrapper around the four BudgetX LLM-tool dispatchers + direct
// UsageStore.refresh call. Keeps dashboard.ts from growing another
// 200-line branch by collecting all parsing + formatting here.
//
// Usage:
//   /budget                       → print matrix (all brands × all windows)
//   /budget <brand>               → filter to one brand
//   /budget set <brand> <window> <quota> [--model X]
//                                → write user-config limit
//   /budget refresh [<brand>]     → force-fetch (async · ~1-3s)
//   /budget forecast [<brand>]    → pace projection
//   /budget help                  → usage
//
// Output follows the existing slash convention: `logLines` (strings
// already formatted for the log pane · caller pushes them into
// chatLines). No ANSI colors here; dashboard.ts wraps with its
// chalk-based helpers at display time.

import type { SlashExecuteRequest, SlashExecuteResult } from './dashboard-slash.js';
import {
  dispatchBudgetForecast,
  dispatchBudgetSetLimit,
  dispatchBudgetStatus,
} from './budget.js';
import { getUsageStore } from '../../budget/usage-store.js';

export interface BudgetSlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

export async function executeBudgetSlash(
  req: SlashExecuteRequest,
): Promise<BudgetSlashResult | null> {
  if (req.name !== 'budget' && req.name !== 'b') return null;

  const [sub, ...rest] = req.args;
  const norm = (sub ?? '').toLowerCase();

  try {
    switch (norm) {
      case '':
      case 'status':
        return await statusAction(rest);
      case 'set':
        return await setAction(rest);
      case 'refresh':
        return await refreshAction(rest);
      case 'forecast':
        return await forecastAction(rest);
      case 'remaining':
      case 'usage':
        return remainingAction(req);
      case 'help':
      case '?':
        return helpOutput();
      default:
        if (isBrand(norm)) return await statusAction([norm, ...rest]);
        return {
          ok: false,
          name: req.name,
          args: req.args,
          logLines: [
            `unknown /budget subcommand: ${sub}`,
            'try /budget help',
          ],
          message: 'unknown subcommand',
        };
    }
  } catch (err) {
    return {
      ok: false,
      name: req.name,
      args: req.args,
      logLines: [
        `/budget ${norm || 'status'}: ${err instanceof Error ? err.message : String(err)}`,
      ],
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Subcommands ─────────────────────────────────────────────────────

async function statusAction(args: string[]): Promise<BudgetSlashResult> {
  const brand = args[0] && isBrand(args[0].toLowerCase()) ? args[0].toLowerCase() : undefined;
  const result = await dispatchBudgetStatus({
    ...(brand ? { brand } : {}),
  });
  return {
    ok: !result.isError,
    name: 'budget',
    args,
    logLines: splitLines(result.output),
    ...(result.isError ? { message: result.output } : {}),
  };
}

async function setAction(args: string[]): Promise<BudgetSlashResult> {
  const [brandRaw, windowRaw, quotaRaw, ...rest] = args;
  if (!brandRaw || !windowRaw || quotaRaw === undefined) {
    return {
      ok: false,
      name: 'budget',
      args,
      logLines: [
        'usage: /budget set <brand> <window> <quota> [--model X]',
        'brand  = codex | claude | gemini | local-llm',
        'window = session | weekly | monthly',
        'quota  = percent (0-100) or "inf"',
      ],
      message: 'missing arguments',
    };
  }
  const quota = quotaRaw.toLowerCase() === 'inf' || quotaRaw.toLowerCase() === 'infinity'
    ? Number.POSITIVE_INFINITY
    : Number(quotaRaw);
  const model = extractFlag(rest, '--model');
  const result = await dispatchBudgetSetLimit({
    brand: brandRaw.toLowerCase(),
    window: windowRaw.toLowerCase(),
    quota,
    ...(model ? { model } : {}),
  });
  return {
    ok: !result.isError,
    name: 'budget',
    args,
    logLines: splitLines(result.output),
    ...(result.isError ? { message: result.output } : {}),
  };
}

async function refreshAction(args: string[]): Promise<BudgetSlashResult> {
  const brandRaw = args[0]?.toLowerCase();
  const brand = brandRaw && isBrand(brandRaw) ? brandRaw : undefined;
  const store = getUsageStore();
  const started = Date.now();
  await store.refresh(brand as undefined | 'codex' | 'claude' | 'gemini' | 'local-llm');
  const elapsedMs = Date.now() - started;
  const statusResult = await dispatchBudgetStatus({
    ...(brand ? { brand } : {}),
  });
  return {
    ok: true,
    name: 'budget',
    args,
    logLines: [
      `/budget refresh${brand ? ` ${brand}` : ' (all)'} · took ${elapsedMs}ms`,
      ...splitLines(statusResult.output),
    ],
  };
}

async function forecastAction(args: string[]): Promise<BudgetSlashResult> {
  const brandRaw = args[0]?.toLowerCase();
  const brand = brandRaw && isBrand(brandRaw) ? brandRaw : undefined;
  const result = await dispatchBudgetForecast({
    ...(brand ? { brand } : {}),
  });
  return {
    ok: !result.isError,
    name: 'budget',
    args,
    logLines: splitLines(result.output),
    ...(result.isError ? { message: result.output } : {}),
  };
}

async function remainingAction(req: SlashExecuteRequest): Promise<BudgetSlashResult> {
  const { executeUsageSlash } = await import('./usage-slash.js');
  const result = await executeUsageSlash({ name: 'remaining', args: req.args });
  return {
    ok: result?.ok ?? false,
    name: req.name,
    args: req.args,
    logLines: result?.logLines ?? ['/budget remaining: no result'],
    ...(result?.message ? { message: result.message } : {}),
  };
}

function helpOutput(): BudgetSlashResult {
  return {
    ok: true,
    name: 'budget',
    args: [],
    logLines: [
      '/budget — multi-agent budget tracker (H6 P1)',
      '  /budget                   current usage matrix (all brands × windows)',
      '  /budget remaining         계정 행 × 크레딧 축 × 구독 축 (명령과 같은 산출)',
      '  /budget <brand>           filter to one brand',
      '  /budget set <b> <w> <q>   write user limit · q in % (0-100) or "inf"',
      '  /budget refresh [brand]   force-fetch (~1-3s)',
      '  /budget forecast [brand]  pace projection · safe|warn|throttle',
      '  /budget help              this text',
    ],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isBrand(s: string): boolean {
  return s === 'codex' || s === 'claude' || s === 'gemini' || s === 'local-llm';
}

function splitLines(s: string): string[] {
  return s.split('\n').filter((l) => l.length > 0);
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : undefined;
}
