// ── Extended WizardIO surface (PLAN-setup-tui-overhaul Phase 2 · PR β) ──
//
// Adds five optional methods to `WizardIO` (`choose` · `showStep` ·
// `showError` · `showHelp` · `showSuccess`) so future Phase 3 + Phase 4
// renderers can replace the bespoke inline rendering without breaking
// every existing host. The existing methods (`ask` / `askSecret` /
// `print` / `close`) stay required.
//
// Each new method has a `*Or` helper here that calls the IO method when
// present, otherwise falls back to a `print` / `ask` based default. Step
// functions can therefore opt into the new surface incrementally:
//
//   await chooseFrom(io, 'Pick one:', options);     // Phase 2-aware
//   showStepOr(io, { index: 1, total: 6, title: '…' }); // host-agnostic
//
// PR β (this commit) only ships the contracts + fallbacks + matching
// stubs in `realIO` / `scriptedIO`. The actual call-site swap inside
// step functions lands in PR γ alongside the single-screen renderer.

import type { WizardIO } from '../onboarding.js';
import { debug } from '../debug/log.js';

// ── Picker (`choose<T>`) ─────────────────────────────────────────────

/** One option inside a `choose()` prompt. `key` is the on-screen letter
 *  the user types (e.g., '1', '2', 'a'); `label` is human-readable;
 *  `value` is what the host gets back; `description` is the optional
 *  inline hint shown next to the label. */
export interface ChoiceOption<T> {
  key: string;
  label: string;
  value: T;
  description?: string;
}

export interface ChooseOpts {
  /** Index (0-based) of the option that gets picked when the user just
   *  presses Enter. Defaults to 0. */
  defaultIndex?: number;
  /** Optional one-line help shown above the choice list. */
  help?: string;
  /** PR-Δ23 (Sprint 16 · 2026-04-30 · F10) — auto-fuzzy threshold.
   *  When the option count is ≥ this number, the chooseFrom fallback
   *  enables substring filtering: the user can type a few letters in
   *  place of an index to narrow the list before picking. Default 10
   *  matches the codex model catalog (50+ entries) where scrolling
   *  past every option is the friction. Set to Infinity to disable. */
  fuzzyThreshold?: number;
}

/** PR-Δ23 (Sprint 16 · 2026-04-30 · F10) — case-insensitive substring
 *  match across `label` / `key` / `description`. Returns options whose
 *  any visible field contains the trimmed query. Empty / blank query
 *  returns the input unchanged (caller decides what "no filter"
 *  means). The match is intentionally simple — a literal includes()
 *  rather than a fuzzy edit-distance — so ranking is stable and the
 *  visible list mirrors the user's exact substring. */
export function fuzzyFilter<T>(
  options: ChoiceOption<T>[],
  query: string,
): ChoiceOption<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => {
    const hay = `${o.label} ${o.key} ${o.description ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}

const DEFAULT_FUZZY_THRESHOLD = 10;

/** Run a multi-choice picker through the IO. Falls back to a plain
 *  numbered `print` / `ask` loop when `io.choose` is not implemented —
 *  matching the current wizard's inline picker shape so output stays
 *  visually compatible. Re-prompts on invalid input up to 3 times,
 *  then accepts the default.
 *
 *  PR-Δ23 (Sprint 16 · 2026-04-30 · F10) — when the option count is
 *  ≥ `opts.fuzzyThreshold` (default 10), the prompt advertises a
 *  filter mode: any non-numeric / non-key input is treated as a
 *  substring query, options are filtered, and the prompt re-issues
 *  with the narrowed list. A query that matches exactly one option
 *  auto-selects it; a query that matches zero re-prompts with the
 *  full list. The numbered + key-letter shortcuts continue to work
 *  on the original full list (so `1` always picks the first option,
 *  even after filtering). */
export async function chooseFrom<T>(
  io: WizardIO,
  prompt: string,
  options: ChoiceOption<T>[],
  opts: ChooseOpts = {},
  stepId?: string,
  pickerId?: string,
): Promise<T> {
  if (io.choose) {
    return io.choose(prompt, options, opts, stepId, pickerId);
  }
  if (options.length === 0) {
    throw new Error('chooseFrom: options array must not be empty.');
  }
  const defaultIdx = clampIdx(opts.defaultIndex ?? 0, options.length);
  const fuzzyThreshold = opts.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
  const fuzzyEnabled = options.length >= fuzzyThreshold;

  if (opts.help) io.print(`  ${opts.help}`);
  io.print(prompt);
  printOptionList(io, options);

  let visible = options;
  for (let attempt = 0; attempt < 3; attempt++) {
    const promptLine = fuzzyEnabled
      ? `  Pick [1-${options.length}] (default ${defaultIdx + 1}, or type letters to filter): `
      : `  Pick [1-${options.length}] (default ${defaultIdx + 1}): `;
    const raw = await io.ask(promptLine);
    const trimmed = raw.trim();
    if (trimmed === '') return options[defaultIdx]!.value;
    // Try the user-visible 1-based index AND the explicit key letter
    // — these always operate on the FULL options list (so `1` keeps
    // picking the first original option even after filtering).
    const byNum = parseInt(raw, 10);
    if (Number.isFinite(byNum) && byNum >= 1 && byNum <= options.length) {
      return options[byNum - 1]!.value;
    }
    const byKey = options.find((o) => o.key === trimmed);
    if (byKey) return byKey.value;
    if (fuzzyEnabled) {
      const filtered = fuzzyFilter(options, trimmed);
      if (filtered.length === 1) {
        // Auto-select on unique match — feels right for a deliberate
        // narrowing query like "claude-3-haiku" against 50 model entries.
        io.print(`  → "${filtered[0]!.label}" (auto-selected)`);
        return filtered[0]!.value;
      }
      if (filtered.length === 0) {
        io.print(`  ! no match for "${trimmed}". Showing full list:`);
        visible = options;
        printOptionList(io, visible);
        continue;
      }
      // 2+ matches — show narrowed list and re-prompt against it.
      io.print(`  ${filtered.length} matches for "${trimmed}":`);
      printOptionList(io, filtered);
      visible = filtered;
      continue;
    }
    io.print(`  ! invalid choice "${raw}". Try again or press Enter for default.`);
  }
  // Fall through after 3 invalid attempts — keep the existing contract
  // that the default eventually wins (visible used only in fuzzy path
  // to prevent it being flagged unused on legacy fallback flows).
  void visible;
  return options[defaultIdx]!.value;
}

function printOptionList<T>(io: WizardIO, options: ChoiceOption<T>[]): void {
  for (let i = 0; i < options.length; i++) {
    const o = options[i]!;
    const tail = o.description ? ` — ${o.description}` : '';
    io.print(`  ${i + 1}) ${o.label}${tail}`);
  }
}

function clampIdx(n: number, len: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n >= len) return len - 1;
  return n;
}

// ── Step header (`showStep`) ─────────────────────────────────────────

/** Visual severity / commitment level for a step. Drives the prefix
 *  glyph in the header and informs users which steps must be set up
 *  vs which they can defer. PR-Δ4 (2026-04-28). */
export type StepSeverity = 'required' | 'optional' | 'advanced';

export interface StepSpec {
  /** 1-based step number. */
  index: number;
  /** Total step count for the current wizard run. */
  total: number;
  /** Localized step title (the user-translated portion of the box header). */
  title: string;
  /** Optional 1-2 line context shown under the header — typically the
   *  step's `setup*Excerpt` from the i18n bundle. */
  excerpt?: string;
  /** Visual severity. Renderers prefix the title with `★` (required),
   *  `▽` (optional), `▲` (advanced). When omitted, no glyph is shown. */
  severity?: StepSeverity;
  /** Optional skip-behavior text — what happens when the user opts out
   *  of this step. Renderers append it to the excerpt with a `↳` prefix. */
  skipBehavior?: string;
}

/** Print a step header through the IO. Falls back to a one-line
 *  `┌─ Step N / total — title ──` shape when the IO doesn't implement
 *  `showStep`, matching the legacy box header so the visual stays
 *  identical for hosts that haven't upgraded. */
export function showStepOr(io: WizardIO, spec: StepSpec): void {
  if (debug.enabled) {
    debug.log('onboarding.showStepOr.enter', `step ${spec.index}/${spec.total}`, {
      index: spec.index,
      total: spec.total,
      title: spec.title,
      hasShowStep: typeof io.showStep === 'function',
      ioKeys: Object.keys(io),
    });
  }
  if (io.showStep) {
    io.showStep(spec);
    return;
  }
  io.print('');
  const lead = `┌─ Step ${spec.index} / ${spec.total} — ${spec.title} `;
  const remaining = Math.max(3, 58 - lead.length);
  io.print(lead + '─'.repeat(remaining));
  if (spec.excerpt) {
    for (const line of spec.excerpt.split('\n')) {
      io.print(`│  ${line}`);
    }
    io.print('│');
  }
}

// ── Inline status (`showError` / `showHelp` / `showSuccess`) ─────────

/** Print an inline error tied to a field. Hosts that can colorize
 *  (Phase 3+) flag this in red; the fallback prints `  ! field: msg`. */
export function showErrorOr(io: WizardIO, field: string, message: string): void {
  if (io.showError) {
    io.showError(field, message);
    return;
  }
  io.print(`  ! ${field}: ${message}`);
}

/** Print an inline help / placeholder hint. Fallback prints
 *  `  ↳ field: msg` on a muted (gray-ish) line. */
export function showHelpOr(io: WizardIO, field: string, message: string): void {
  if (io.showHelp) {
    io.showHelp(field, message);
    return;
  }
  io.print(`  ↳ ${field}: ${message}`);
}

/** Print an inline success / confirmation. Fallback prints
 *  `  ✓ msg`. */
export function showSuccessOr(io: WizardIO, message: string): void {
  if (io.showSuccess) {
    io.showSuccess(message);
    return;
  }
  io.print(`  ✓ ${message}`);
}
