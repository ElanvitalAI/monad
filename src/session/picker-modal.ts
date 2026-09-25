// Session picker modal.
//
// Thin adapter over createSearchModal that formats TerminalSession
// list entries as SearchItems. On accept, calls sessionRegistry.attach
// so the selected session becomes foreground. State markers + relative
// timestamps are rendered with color so the user can spot the
// attention ring at a glance.

import type { SearchItem, SearchModalHandle } from '../chat/search/modal.js';
import type { ThemeTokens } from '../theme/tokens.js';
import { C } from '../tui.js';
import type { ModalBounds } from '../display/modal-stack.js';
import type { TerminalSession, TerminalSessionRegistry } from '../terminal/session-registry.js';
import { filterPickerItemsByLabel } from '../ui/chrome/picker-query.js';
import { createVwFilterPickerModal } from '../ui/vw-filter-picker-modal.js';
import {
  searchItemsToPickerSpec,
  type PickerSearchItem,
  type PickerSpec,
} from '../expression/index.js';

export interface OpenSessionPickerOpts {
  registry: TerminalSessionRegistry;
  bounds: ModalBounds;
  width: number;
  maxVisible?: number;
  /** Called with the selected session + the registry handle so the
   *  caller can decide: attach / detach / kill. Default action is
   *  attach. */
  onAccept: (session: TerminalSession) => void;
  onCancel?: () => void;
  now?: () => number;
  theme?: ThemeTokens;
}

export function createSessionPickerModal(opts: OpenSessionPickerOpts): SearchModalHandle {
  const nowFn = opts.now ?? (() => Date.now());

  const sessionItems = (): SearchItem[] => {
    const list = opts.registry.list().filter(s => s.state !== 'exited');
    return list.map((s): SearchItem => ({
      label: formatSessionLabel(s, nowFn()),
      payload: s.id,
    }));
  };

  return createVwFilterPickerModal({
    id: `session-picker:${nowFn().toString(36)}`,
    bounds: opts.bounds,
    title: 'Terminal sessions',
    width: opts.width,
    maxVisible: opts.maxVisible ?? 8,
    primaryActionLabel: 'attach',
    cancelActionLabel: 'cancel',
    onQuery: (q) => {
      const all = sessionItems();
      return filterPickerItemsByLabel(all, q, (it) => String(it.label ?? ''));
    },
    onAccept: (item) => {
      const session = opts.registry.get(String(item.payload));
      if (session) opts.onAccept(session);
    },
    onCancel: opts.onCancel,
    theme: opts.theme,
  });
}

function formatSessionLabel(s: TerminalSession, now: number): string {
  const stateGlyph = s.state === 'foreground' ? C.success('●') : C.muted('○');
  const attn = s.attentionLevel >= 2 ? C.warning(' ⚠') : s.attentionLevel >= 1 ? C.info(' ·') : '';
  const kindMarker = s.kind === 'coding-agent' ? C.mauve('⧗') : C.sky('$');
  const rel = relativeAge(now - s.lastFocusedAt);
  const idTail = s.id.slice(-6);
  const cwdShort = shortCwd(s.cwd);
  return `${stateGlyph} ${kindMarker} ${s.title.padEnd(24)} ${C.subtext(cwdShort)} ${C.muted(rel)} ${C.muted(idTail)}${attn}`;
}

function relativeAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function shortCwd(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join('/')}`;
}

/** Build an expression `PickerSpec` describing the live (non-exited)
 *  terminal sessions. Pure helper — no modal mounted. Hosts can pass
 *  this through `describeForScreenReader` to produce a SR utterance,
 *  or feed it to `renderPicker` for an alternate visual surface.
 *
 *  ANSI codes from `formatSessionLabel` are stripped via the adapter
 *  so utterances stay clean. Each item carries the session's `cwd`
 *  + state as a `description` so SR-only users learn more than the
 *  visual label conveys at a glance.
 *
 *  2026-04-28 (Pick A PR-S2) — picker family a11y integration. */
export function buildSessionPickerSpec(
  registry: TerminalSessionRegistry,
  now: number = Date.now(),
): PickerSpec {
  const list = registry.list().filter((s) => s.state !== 'exited');
  const items: PickerSearchItem[] = list.map((s) => ({
    label: formatSessionLabel(s, now),
    payload: s.id,
    description: `${s.kind} · ${s.state} · ${s.cwd}`,
  }));
  return searchItemsToPickerSpec(items, {
    id: 'session-picker',
    title: 'Terminal sessions',
  });
}
