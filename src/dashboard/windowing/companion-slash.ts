import { normalizeInputQuery } from '../../input/query-match.js';

export type VwCompanionKey = 'clipboard' | 'memo' | 'detail';
export type VwCompanionAction = 'open' | 'close' | 'toggle';

export interface ParseWindowCompanionSlashSuccess {
  readonly key: VwCompanionKey;
  readonly action: VwCompanionAction;
  readonly windowId: number;
}

export type ParseWindowCompanionSlashResult =
  | { readonly ok: true; readonly value: ParseWindowCompanionSlashSuccess }
  | { readonly ok: false; readonly message: string };

export interface ParseWindowCompanionSlashOpts {
  readonly currentWindowId?: number | null;
}

function parseCompanionKey(raw: string): VwCompanionKey | null {
  const normalized = normalizeInputQuery(raw);
  return normalized === 'clipboard' || normalized === 'clip' || normalized === 'c' ? 'clipboard'
    : normalized === 'memo' || normalized === 'm' ? 'memo'
    : normalized === 'detail' || normalized === 'details' || normalized === 'd' ? 'detail'
    : null;
}

function parseCompanionAction(raw: string): VwCompanionAction | null {
  const normalized = normalizeInputQuery(raw);
  return normalized === 'open' || normalized === 'show' || normalized === 'on' ? 'open'
    : normalized === 'close' || normalized === 'hide' || normalized === 'off' ? 'close'
    : normalized === 'toggle' || normalized === 'tog' || normalized === 't' ? 'toggle'
    : null;
}

export function parseWindowCompanionSlash(
  args: readonly string[],
  opts: ParseWindowCompanionSlashOpts = {},
): ParseWindowCompanionSlashResult {
  const rawKey = (args[0] ?? '').trim();
  const key = parseCompanionKey(rawKey);
  if (!key) {
    return {
      ok: false,
      message: 'Usage: /window companion <clipboard|memo|detail> [open|close|toggle] [windowId]',
    };
  }
  let action: VwCompanionAction = 'toggle';
  let windowId: number | null = opts.currentWindowId ?? null;
  for (const raw of args.slice(1)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const nextAction = parseCompanionAction(trimmed);
    if (nextAction) {
      action = nextAction;
      continue;
    }
    const parsedId = Number.parseInt(trimmed, 10);
    if (Number.isInteger(parsedId)) {
      windowId = parsedId;
      continue;
    }
    return {
      ok: false,
      message: `Unknown /window companion arg: ${trimmed}. Expected open|close|toggle or window id.`,
    };
  }
  if (!Number.isInteger(windowId)) {
    return {
      ok: false,
      message: 'No target virtual window. Focus a VW first or pass an explicit window id.',
    };
  }
  return {
    ok: true,
    value: { key, action, windowId: windowId as number },
  };
}
