// Transfer picker modal — T5-J2.
//
// Sibling of session / window / ssh / finder pickers. Wraps
// createSearchModal with the list of TransferTargets so the user
// can fuzz-match by name or kind and Enter to pick the destination
// for their browser-pane `t` transfer.
//
// Label format:
//
//   ⮡  mba     ssh → ~/Downloads/
//   📱 iPhone  iphone → pushcut(elanous-file-received)
//   ⮡  backup  ssh → ~/Transfers/
//
// Kind glyph: ⮡ for SSH (arrow-into), 📱 for iPhone. Destination
// hint summarizes where the file will land.

import type { SearchItem, SearchModalHandle } from '../chat/search/modal.js';
import type { ThemeTokens } from '../theme/tokens.js';
import { C } from '../tui.js';
import type { ModalBounds } from '../display/modal-stack.js';
import type { TransferTarget } from './transfer-targets.js';
import { filterPickerItemsByLabel } from '../ui/chrome/picker-query.js';
import { createVwFilterPickerModal } from '../ui/vw-filter-picker-modal.js';
import {
  searchItemsToPickerSpec,
  type PickerSearchItem,
  type PickerSpec,
} from '../expression/index.js';

export interface OpenTransferPickerOpts {
  targets: TransferTarget[];
  bounds: ModalBounds;
  width: number;
  maxVisible?: number;
  /** Label shown in the title row — typically a summary of what's
   *  being sent (e.g. "3 files (842 KB)"). */
  summary?: string;
  onAccept: (target: TransferTarget) => void;
  onCancel?: () => void;
  theme?: ThemeTokens;
}

export function createTransferPickerModal(opts: OpenTransferPickerOpts): SearchModalHandle {
  const items = (): SearchItem[] => {
    return opts.targets.map((t): SearchItem => ({
      label: formatTargetLabel(t),
      payload: t.name,
    }));
  };
  const titleSummary = opts.summary ? ` · ${opts.summary}` : '';
  return createVwFilterPickerModal({
    id: `transfer:${Date.now().toString(36)}`,
    bounds: opts.bounds,
    title: `Transfer destination${titleSummary}`,
    width: opts.width,
    maxVisible: opts.maxVisible ?? 10,
    primaryActionLabel: 'send',
    cancelActionLabel: 'cancel',
    onQuery: (q) => {
      const all = items();
      return filterPickerItemsByLabel(all, q, (it) => String(it.label ?? ''));
    },
    onAccept: (item) => {
      const target = opts.targets.find(t => t.name === item.payload);
      if (target) opts.onAccept(target);
    },
    onCancel: opts.onCancel,
    theme: opts.theme,
  });
}

function formatTargetLabel(t: TransferTarget): string {
  const name = t.name.padEnd(12).slice(0, 12);
  if (t.kind === 'ssh') {
    const glyph = C.accent('⮡');
    const host = t.host.host.padEnd(20).slice(0, 20);
    const dest = C.subtext(`→ ${t.host.name}:${t.remoteDir}`);
    return `${glyph}  ${C.info(name)} ssh  ${C.muted(host)} ${dest}`;
  }
  const glyph = C.highlight('📱');
  const transport =
    t.tailscaleHost ? C.subtext(`tailscale(${t.tailscaleHost})`)
    : t.pushcutName ? C.subtext(`pushcut(${t.pushcutName})`)
    : C.subtext('(no transport)');
  return `${glyph} ${C.info(name)} iphone ${transport}`;
}

/** Build an expression `PickerSpec` describing the available
 *  TransferTargets. Pure helper.
 *
 *  Each item's `description` summarizes the destination kind + path
 *  in plain text — what `formatTargetLabel` conveys with glyph + ANSI.
 *  Adapter strips the ANSI from the label.
 *
 *  2026-04-28 (Pick A PR-S2) — picker family a11y integration. */
export function buildTransferPickerSpec(
  targets: ReadonlyArray<TransferTarget>,
  summary?: string,
): PickerSpec {
  const items: PickerSearchItem[] = targets.map((t) => {
    let description: string;
    if (t.kind === 'ssh') {
      description = `ssh · ${t.host.name} · ${t.remoteDir}`;
    } else {
      const transport = t.tailscaleHost
        ? `tailscale ${t.tailscaleHost}`
        : t.pushcutName
        ? `pushcut ${t.pushcutName}`
        : 'no transport';
      description = `iphone · ${transport}`;
    }
    return {
      label: formatTargetLabel(t),
      payload: t.name,
      description,
    };
  });
  const title = summary ? `Transfer destination · ${summary}` : 'Transfer destination';
  return searchItemsToPickerSpec(items, {
    id: 'transfer-picker',
    title,
  });
}
