// Picker renderer — pure fn `renderPicker(spec, profile, opts) → string`.
//
// Three responsibilities:
//   1. Filter `spec.items` by `spec.query` using `fuzzyRank` (exact
//      substring fast-path + subsequence walk + word-boundary bonuses).
//   2. Resolve a cursor index against the *filtered* list (host
//      arrows up/down move through filtered, not raw, items).
//   3. Emit one ANSI line per filtered item: marker (▸/  ) + label
//      with optional fuzzy-match highlights + optional description on
//      the next indented line. Disabled items render faint with a
//      reason hint.
//
// The renderer is pure — host owns the cursor, query, and re-render
// cadence. Same `(spec, profile, opts)` always yields the same string.
//
// Layout:
//   ▸ Catppuccin Mocha       ← cursor row, accent + bold label
//       Dark warm pastel     ← description (faint, indented)
//     Latte
//     Frappé                 ← non-cursor rows, plain
//     Macchiato (legacy)     ← disabled, faint + struck
//   No results.              ← empty filter result hint
//
// `RenderPickerOpts.highlightMatches=true` wraps matched indices in a
// theme-accent span when the host wants to advertise *why* a row
// scored. Default off — keeps output stable for callers that just
// want a list.

import type { PickerSpec, PickerItemSpec } from '../spec/types.js';
import {
  type AdaptiveColor,
  type ColorProfile,
  paint,
} from '../color.js';
import { Style } from '../style.js';
import { fuzzyRank, type FuzzyMatch } from '../fuzzy.js';

export interface RenderPickerOpts {
  /** Theme accent — bullets, highlights, cursor. */
  themeAccent?: AdaptiveColor | string;
  /** Theme muted — descriptions, disabled, "no results". */
  themeMuted?: AdaptiveColor | string;
  /** Wrap matched indices in an accent span. Default false. */
  highlightMatches?: boolean;
  /** Width budget — descriptions wrap inside this. Default 60. */
  width?: number;
  /** Cursor override — when host runs an outer cursor that doesn't
   *  live inside the spec. Falls back to `spec.cursor ?? 0`. */
  cursor?: number;
  /** Multi-select state — set of selected item ids. When non-empty,
   *  rows render with a `[x]` / `[ ]` checkbox instead of just a
   *  cursor marker. */
  selected?: ReadonlySet<string>;
  /** PR-Δ25 (Sprint 17 · 2026-04-30) — opt-in mono emphasis. When
   *  true AND profile is `'mono'`, attribute SGRs (bold / faint /
   *  italic / strikethrough) survive on the cursor row, disabled
   *  rows, and "no results" hint even though color SGRs are still
   *  stripped. Default false preserves the legacy mono = zero-CSI
   *  contract. The setup wizard's picker flips this on so cursor
   *  position + disabled state remain visible on NO_COLOR / SSH /
   *  CI logs. */
  keepAttrsInMono?: boolean;
}

const DEFAULT_ACCENT = '#89b4fa';
const DEFAULT_MUTED = '#7f849c';

/** Render a `PickerSpec` to a multi-line ANSI string. */
export function renderPicker(
  spec: PickerSpec,
  profile: ColorProfile = 'truecolor',
  opts: RenderPickerOpts = {},
): string {
  const accent = opts.themeAccent ?? DEFAULT_ACCENT;
  const muted = opts.themeMuted ?? DEFAULT_MUTED;
  const width = Math.max(20, opts.width ?? 60);
  const keepAttrs = opts.keepAttrsInMono ?? false;
  // PR-Δ25 — single helper for the 8 render() callsites in this file.
  // Routes to renderWithMonoEmphasis when keepAttrs is on so mono
  // profile keeps bold/faint/italic/strikethrough; otherwise falls
  // back to plain render() (legacy mono = zero-CSI contract).
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);

  const ranked = filterRanked(spec);
  const lines: string[] = [];

  if (spec.title) {
    lines.push(r(Style.empty().foreground(accent).bold(), spec.title));
  }

  if (ranked.length === 0) {
    const emptyHint = spec.query
      ? `No results for "${spec.query}".`
      : 'No items.';
    lines.push(r(Style.empty().foreground(muted).italic(), emptyHint));
    return lines.join('\n');
  }

  const cursor = clampCursor(opts.cursor ?? spec.cursor ?? 0, ranked.length);
  const showCheckbox = (opts.selected?.size ?? 0) >= 0 && spec.multi === true;

  for (let i = 0; i < ranked.length; i++) {
    const { item, match } = ranked[i]!;
    const isCursor = i === cursor;
    const isSelected = opts.selected?.has(item.id) ?? false;
    lines.push(
      renderItemRow({
        item,
        match,
        isCursor,
        isSelected,
        showCheckbox,
        accent,
        muted,
        profile,
        highlightMatches: opts.highlightMatches ?? false,
        width,
        keepAttrs,
      }),
    );
    if (item.description) {
      const wrapped = wrapText(item.description, width - 4);
      for (const wrap of wrapped) {
        const styled = r(Style.empty().foreground(muted).faint(), wrap);
        lines.push(`    ${styled}`);
      }
    }
  }

  return lines.join('\n');
}

interface RowArgs {
  item: PickerItemSpec;
  match: FuzzyMatch;
  isCursor: boolean;
  isSelected: boolean;
  showCheckbox: boolean;
  accent: AdaptiveColor | string;
  muted: AdaptiveColor | string;
  profile: ColorProfile;
  highlightMatches: boolean;
  width: number;
  keepAttrs: boolean;
}

function renderItemRow(args: RowArgs): string {
  const {
    item,
    match,
    isCursor,
    isSelected,
    showCheckbox,
    accent,
    muted,
    profile,
    highlightMatches,
    keepAttrs,
  } = args;
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);

  const cursorMark = isCursor ? '▸' : ' ';
  const cursorPainted = isCursor
    ? paint(accent, profile)(cursorMark)
    : cursorMark;

  const checkbox = showCheckbox
    ? `${paint(isSelected ? accent : muted, profile)(isSelected ? '[x]' : '[ ]')} `
    : '';

  let label = highlightMatches
    ? renderHighlightedLabel(item.label, match.indices, accent, profile, keepAttrs)
    : item.label;

  if (item.disabled) {
    label = r(Style.empty().foreground(muted).strikethrough(), label);
  } else if (isCursor) {
    label = r(Style.empty().foreground(accent).bold(), label);
  }

  let suffix = '';
  if (item.disabled && item.disabled_reason) {
    suffix += r(Style.empty().foreground(muted).faint().italic(), `  (${item.disabled_reason})`);
  } else if (item.hint) {
    suffix += r(Style.empty().foreground(muted).faint(), `  ${item.hint}`);
  }

  return `${cursorPainted} ${checkbox}${label}${suffix}`;
}

function renderHighlightedLabel(
  label: string,
  indices: ReadonlyArray<number>,
  accent: AdaptiveColor | string,
  profile: ColorProfile,
  keepAttrs: boolean,
): string {
  if (indices.length === 0) return label;
  const set = new Set(indices);
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);
  let out = '';
  for (let i = 0; i < label.length; i++) {
    const ch = label[i]!;
    if (set.has(i)) {
      out += r(Style.empty().foreground(accent).bold(), ch);
    } else {
      out += ch;
    }
  }
  return out;
}

// ── Filter / cursor helpers ────────────────────────────────────────

interface RankedItem {
  item: PickerItemSpec;
  match: FuzzyMatch;
}

/** Filter + rank the picker's items by its query. Disabled items
 *  participate in the match (host can choose to display them) but
 *  rank lowest within the same query score. */
export function filterRanked(spec: PickerSpec): RankedItem[] {
  return fuzzyRank(spec.items, spec.query ?? '', (it) => it.label).map((r) => ({
    item: r.item,
    match: r.match,
  }));
}

function clampCursor(cursor: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(cursor) || cursor < 0) return 0;
  if (cursor >= length) return length - 1;
  return Math.floor(cursor);
}

// ── Word-aware text wrap ────────────────────────────────────────────

/** Greedy word-wrap that breaks on whitespace. Doesn't measure ANSI;
 *  feed it plain text. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0 || !Number.isFinite(width)) return [text];
  if (text.length <= width) return [text];
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
