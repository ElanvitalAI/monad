// Picker adapters — bridge between expression's PickerSpec and monad's
// search-modal SearchItem-like records.
//
// Why: monad's picker family (session-picker / window-picker / ssh-
// picker / transfer-picker / log-search / window-finder) all share
// `createSearchModal` from `src/chat/search/modal.ts`. That modal
// renders via SelectView (an upward-aware widget). The expression
// PickerSpec is a downward-list spec consumed by renderPicker.
//
// These adapters let callers convert in either direction — useful for:
//   - feeding existing monad pickers' state into describeForScreenReader
//     (pure a11y) without changing their UX
//   - building new flat-list pickers from existing SearchItem arrays
//     (future provider/model selection modals)
//   - test-mocking a picker's list state with a known shape
//
// Pure functions — no side effects. Both directions preserve label
// + payload (id) + optional description.

import type { PickerSpec, PickerItemSpec } from '../spec/types.js';

/** Minimal SearchItem-compatible shape — same fields as
 *  `src/chat/search/modal.ts:SearchItem` but typed locally so the
 *  expression layer doesn't depend on chat/search internals. */
export interface PickerSearchItem {
  /** Display label — may carry ANSI when sourced from a host. The
   *  adapter strips ANSI before storing in the PickerSpec so SR
   *  utterances stay clean. */
  label: string;
  /** Stable id used as the spec's `item.id`. Adapters require string;
   *  pass `String(payload)` if your host uses a different shape. */
  payload: string;
  /** Optional second-line annotation (rendered faint by renderPicker). */
  description?: string;
  /** Optional inline hint (rendered faint after the label). */
  hint?: string;
}

export interface SearchItemsToPickerOpts {
  /** Picker spec id — defaults to `'adapted'`. */
  id?: string;
  /** Optional title shown above the list. */
  title?: string;
  /** Active filter / query — preserved on the spec for future re-runs. */
  query?: string;
  /** 0-indexed cursor in the filtered list (caller responsible for
   *  pre-filtering items if `query` is set). Defaults to 0. */
  cursor?: number;
  /** Multi-select toggle. */
  multi?: boolean;
}

const RE_ANSI = /\x1b\[[\d;]*m/g;

/** Convert an array of SearchItem-like records into a PickerSpec.
 *  Strips ANSI from labels so the spec is pure data — re-rendering
 *  through renderPicker / describeForScreenReader gets fresh styling. */
export function searchItemsToPickerSpec(
  items: ReadonlyArray<PickerSearchItem>,
  opts: SearchItemsToPickerOpts = {},
): PickerSpec {
  const pickerItems: PickerItemSpec[] = items.map((it) => {
    const item: PickerItemSpec = {
      id: it.payload,
      label: it.label.replace(RE_ANSI, ''),
    };
    if (it.description !== undefined) item.description = it.description;
    if (it.hint !== undefined) item.hint = it.hint;
    return item;
  });
  const spec: PickerSpec = {
    kind: 'picker',
    id: opts.id ?? 'adapted',
    items: pickerItems,
  };
  if (opts.title !== undefined) spec.title = opts.title;
  if (opts.query !== undefined) spec.query = opts.query;
  if (opts.cursor !== undefined) spec.cursor = opts.cursor;
  if (opts.multi !== undefined) spec.multi = opts.multi;
  return spec;
}

/** Convert a PickerSpec back into SearchItem-like records. Useful
 *  when a host that owns a PickerSpec wants to feed a SearchItem-
 *  consuming surface (e.g., monad's createSearchModal) without
 *  converting field-by-field manually. */
export function pickerSpecToSearchItems(
  spec: PickerSpec,
): PickerSearchItem[] {
  return spec.items.map((it) => {
    const out: PickerSearchItem = {
      label: it.label,
      payload: it.id,
    };
    if (it.description !== undefined) out.description = it.description;
    if (it.hint !== undefined) out.hint = it.hint;
    return out;
  });
}
