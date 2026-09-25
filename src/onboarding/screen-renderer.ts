// Single-screen wizard renderer — Phase 5 (PR δ).
//
// Composes the full wizard screen as one string: cleared viewport +
// centered rounded box that contains header (Step N/M + title +
// progress dots) + excerpt + body (option list or text input) +
// footer (key hint). Hosts emit the result with `process.stdout.write`
// after every key event so the wizard stays a single-screen UX
// without entering altscreen — RESEARCH-tui-installer §5.A1
// explicitly flags altscreen as anti-pattern (breaks redirect /
// scrollback / IDE integration).
//
// Pure function — caller passes the spec, the renderer returns the
// string. No mutation of process.stdout, no side effects.

import {
  detectProfile,
  type ColorProfile,
  Style,
  pickBorder,
  type BorderShape,
} from '../expression/index.js';
import { progressDots } from './progress.js';

const DEFAULT_ACCENT = '#89b4fa';
const DEFAULT_MUTED = '#7f849c';
const DEFAULT_DIM = '#6c7086';
const DEFAULT_DANGER = '#f38ba8';

const CSI = '\x1b[';
/** Clear screen + move cursor to home — preserves scrollback unlike
 *  altscreen. */
export const ANSI_CLEAR_HOME = `${CSI}2J${CSI}H`;
export const ANSI_HIDE_CURSOR = `${CSI}?25l`;
export const ANSI_SHOW_CURSOR = `${CSI}?25h`;

export interface ScreenOption {
  /** 1-based label number (rendered as `1)` `2)` …). */
  numeric: number;
  /** User-visible label. */
  label: string;
  /** Optional short hint after the label. */
  hint?: string;
}

export interface ScreenInputField {
  /** Field label rendered above the input row. */
  label: string;
  /** Current buffer content (renderer prints as-is). */
  value: string;
  /** Mask each char with `*` — for `askSecret`. */
  mask?: boolean;
  /** Placeholder shown when value is empty. Rendered dim. */
  placeholder?: string;
  /** Optional 1-line help under the input. */
  help?: string;
  /** Optional inline error (red, replaces help when present). */
  error?: string;
}

/** Visual severity glyph + color hint. PR-Δ4 (2026-04-28). */
export type ScreenSeverity = 'required' | 'optional' | 'advanced';

export interface ScreenSpec {
  /** 1-based step index. */
  stepIndex: number;
  /** Total step count. */
  stepTotal: number;
  /** Localized step title. */
  title: string;
  /** Optional severity glyph in the header — `★` required (accent),
   *  `▽` optional (muted), `▲` advanced (warning). */
  severity?: ScreenSeverity;
  /** Optional 1-3 line context shown under the header. */
  excerpt?: string;
  /** Optional skip-behavior text — what happens if the user opts out.
   *  Rendered dim with a `↳` prefix below the excerpt. */
  skipBehavior?: string;
  /** Body: either an option picker OR an input field. */
  body:
    | {
        kind: 'options';
        options: ScreenOption[];
        selected: number;
        help?: string;
        /** PR-Δ23b — fuzzy typing buffer state. When defined (even
         *  empty string), the renderer shows the `filter: ...` line
         *  above the option list and replaces `help` with a matches
         *  counter. Undefined = legacy picker (no filter UI). */
        filter?: string;
        /** Total option count BEFORE filtering — drives the
         *  `<visible> / <fullCount> matches` indicator. Required when
         *  `filter` is defined. */
        fullCount?: number;
      }
    | { kind: 'input'; field: ScreenInputField }
    | { kind: 'message'; lines: string[] };
  /** Footer key-binding hints (rendered dim). */
  footer?: string;
  /** Optional terminal width override (test injects). Defaults to
   *  `process.stdout.columns ?? 80`. */
  cols?: number;
  /** Optional terminal height override. Defaults to
   *  `process.stdout.rows ?? 24`. */
  rows?: number;
  /** Color profile — defaults to runtime detection. */
  profile?: ColorProfile;
  /** Border family — default `'rounded'`. */
  border?: 'rounded' | 'normal' | 'thick' | 'double' | 'ascii';
  /** Optional accent color (hex). */
  accent?: string;
  /** Optional muted color (hex). */
  muted?: string;
}

/** Compute the desired box width — clamps `cols - 4` to `[40, 80]`. */
export function computeBoxWidth(cols: number): number {
  if (!Number.isFinite(cols) || cols <= 0) return 60;
  const desired = cols - 4;
  return Math.max(40, Math.min(desired, 80));
}

/** Compute the left padding to center a `boxWidth` box in `cols`.
 *  Returns 0 when the box is at least as wide as the viewport. */
export function computeBoxLeftPad(cols: number, boxWidth: number): number {
  if (boxWidth >= cols) return 0;
  return Math.floor((cols - boxWidth) / 2);
}

/** Render the full screen as a string. Caller should write `ANSI_CLEAR_HOME`
 *  + this output + (optional) cursor positioning for input fields. */
export function renderScreen(spec: ScreenSpec): string {
  const profile = spec.profile ?? detectProfile();
  const cols = spec.cols ?? process.stdout.columns ?? 80;
  const accent = spec.accent ?? DEFAULT_ACCENT;
  const muted = spec.muted ?? DEFAULT_MUTED;
  const border = pickBorder(spec.border ?? 'rounded');
  const boxWidth = computeBoxWidth(cols);
  const leftPad = ' '.repeat(computeBoxLeftPad(cols, boxWidth));

  // PR-Δ17 (F13) — attribute SGRs (bold / faint / italic) survive the
  // mono profile via the Style render path's split (color stripped,
  // attributes kept). Adding `faint()` to muted / dim paint gives
  // mono terminals a real visual hierarchy: accent stays bold, muted
  // goes dim — readable without colors.
  const accentPaint = Style.empty().foreground(accent).bold();
  const accentPlain = Style.empty().foreground(accent);
  const mutedPaint = Style.empty().foreground(muted).faint();
  const dimPaint = Style.empty().foreground(DEFAULT_DIM).faint();
  const dangerPaint = Style.empty().foreground(DEFAULT_DANGER).bold();

  const lines: string[] = [];

  // ── Header — `╭─ ★ Step N / M — title  ●●●○○ ─...─╮` ─────────
  const dots = progressDots(spec.stepIndex, spec.stepTotal, { profile, accent, muted });
  // dots already SGR-styled — strip for width math. The `●○` glyphs
  // (U+25CF / U+25CB) are East-Asian-Ambiguous: many terminals render
  // them as 2 cells while JS string.length reports 1. PR-Δ8 budgets
  // the visible cells via `visualWidth()` so the right-edge `╮` lands
  // on the same row instead of wrapping to the next line.
  const dotsPlain = stripSgr(dots);
  const sevGlyph = severityGlyph(spec.severity);
  const sevPlain = sevGlyph ? `${sevGlyph} ` : '';
  const sevColored = sevGlyph
    ? severityPaint(spec.severity, accent, muted, DEFAULT_DANGER, profile, sevGlyph) + ' '
    : '';
  const headLabelPlain = ` ${sevPlain}Step ${spec.stepIndex} / ${spec.stepTotal} — ${spec.title}  ${dotsPlain} `;
  // Rendered headLabel: keep colored counter+title and the colored dots
  const headLabelColored =
    ' ' +
    sevColored +
    accentPaint.renderWithMonoEmphasis(`Step ${spec.stepIndex} / ${spec.stepTotal} — ${spec.title}  `, profile) +
    dots +
    ' ';
  // Total cells the header draws: 3 (corner+2 top fills) + label + rule
  // + 1 (corner). Solve for `headRuleLen` so the row's visual width
  // equals exactly `boxWidth` — Sprint 11 fix for box wrap when the
  // header consumed 2 cells beyond the box edge.
  const headRuleLen = Math.max(2, boxWidth - 4 - visualWidth(headLabelPlain));
  const headRule = mutedPaint.renderWithMonoEmphasis(border.top.repeat(headRuleLen), profile);
  lines.push(
    leftPad +
      mutedPaint.renderWithMonoEmphasis(border.tl + border.top + border.top, profile) +
      headLabelColored +
      headRule +
      mutedPaint.renderWithMonoEmphasis(border.tr, profile),
  );

  // ── Excerpt ──────────────────────────────────────────────────────
  // PR-Δ12 (Sprint 12): wrap each line to the inner width minus the
  // `  ` indent so long words like `lifecycle` aren't clipped to
  // `lifecycl` by `pushBoxLine`'s truncate fallback. Wrap respects
  // visual cell width (East-Asian-Wide aware) and tries word boundaries
  // first before hard-breaking oversize tokens.
  const innerWidthForWrap = boxWidth - 2 - 2; // box inner − leading "  "
  const excerptLines: string[] = [];
  if (spec.excerpt) {
    for (const raw of spec.excerpt.split('\n')) {
      for (const wrapped of wrapByVisualWidth(raw, innerWidthForWrap)) {
        excerptLines.push(wrapped);
      }
    }
  }
  if (spec.skipBehavior) {
    if (excerptLines.length > 0) excerptLines.push('');
    for (const wrapped of wrapByVisualWidth('↳ ' + spec.skipBehavior, innerWidthForWrap)) {
      excerptLines.push(wrapped);
    }
  }
  if (excerptLines.length > 0) {
    pushBlankBoxLine(lines, leftPad, border, boxWidth, mutedPaint, profile);
    // PR-Δ17 (F13) — skip-behavior lines (the `↳ ` prefix marker)
    // render dim + italic so the visual hierarchy reads even on mono
    // terminals where the dim color hex is stripped.
    const skipPaint = Style.empty().foreground(DEFAULT_DIM).faint().italic();
    for (const raw of excerptLines) {
      const isSkip = raw.startsWith('↳ ');
      const colored = isSkip
        ? '  ' + skipPaint.renderWithMonoEmphasis(raw, profile)
        : '  ' + raw;
      pushBoxLine(
        lines,
        leftPad,
        border,
        boxWidth,
        colored,
        '  ' + raw,
        mutedPaint,
        profile,
      );
    }
  }

  // ── Body ──────────────────────────────────────────────────────────
  pushBlankBoxLine(lines, leftPad, border, boxWidth, mutedPaint, profile);

  if (spec.body.kind === 'options') {
    const filterDefined = spec.body.filter !== undefined;

    // PR-Δ23b — fuzzy typing buffer line above the option list.
    if (filterDefined) {
      const filterText = spec.body.filter ?? '';
      const filterLabelPlain =
        filterText.length > 0
          ? `  filter: ${filterText}`
          : '  filter: (type to filter)';
      const filterLabelColored =
        filterText.length > 0
          ? '  ' +
            dimPaint.renderWithMonoEmphasis('filter:', profile) +
            ' ' +
            accentPlain.renderWithMonoEmphasis(filterText, profile)
          : '  ' +
            dimPaint.renderWithMonoEmphasis('filter: (type to filter)', profile);
      pushBoxLine(
        lines,
        leftPad,
        border,
        boxWidth,
        filterLabelColored,
        filterLabelPlain,
        mutedPaint,
        profile,
      );
      pushBlankBoxLine(lines, leftPad, border, boxWidth, mutedPaint, profile);
    }

    const sel = spec.body.selected;
    if (filterDefined && spec.body.options.length === 0) {
      const noMatchPlain = '  ! no matches — Backspace edits · ESC clears';
      pushBoxLine(
        lines,
        leftPad,
        border,
        boxWidth,
        '  ' + dimPaint.renderWithMonoEmphasis('! no matches — Backspace edits · ESC clears', profile),
        noMatchPlain,
        mutedPaint,
        profile,
      );
    } else {
      spec.body.options.forEach((opt, i) => {
        const cursor = i === sel ? '▶' : ' ';
        const numLabel = `${opt.numeric})`;
        const hint = opt.hint ? `  ${opt.hint}` : '';
        const plain = `  ${cursor} ${numLabel} ${opt.label}${hint}`;
        const colored =
          '  ' +
          (i === sel ? accentPaint.renderWithMonoEmphasis(cursor, profile) : ' ') +
          ' ' +
          (i === sel ? accentPlain.renderWithMonoEmphasis(numLabel, profile) : mutedPaint.renderWithMonoEmphasis(numLabel, profile)) +
          ' ' +
          (i === sel ? accentPlain.renderWithMonoEmphasis(opt.label, profile) : opt.label) +
          (opt.hint ? '  ' + dimPaint.renderWithMonoEmphasis(opt.hint, profile) : '');
        pushBoxLine(lines, leftPad, border, boxWidth, colored, plain, mutedPaint, profile);
      });
    }
    if (filterDefined && spec.body.fullCount !== undefined) {
      pushBlankBoxLine(lines, leftPad, border, boxWidth, mutedPaint, profile);
      const cnt = spec.body.options.length;
      const matchesText = `${cnt} / ${spec.body.fullCount} matches`;
      pushBoxLine(
        lines,
        leftPad,
        border,
        boxWidth,
        '  ' + dimPaint.renderWithMonoEmphasis(matchesText, profile),
        '  ' + matchesText,
        mutedPaint,
        profile,
      );
    } else if (spec.body.help) {
      pushBlankBoxLine(lines, leftPad, border, boxWidth, mutedPaint, profile);
      pushBoxLine(
        lines,
        leftPad,
        border,
        boxWidth,
        '  ' + dimPaint.renderWithMonoEmphasis(spec.body.help, profile),
        '  ' + spec.body.help,
        mutedPaint,
        profile,
      );
    }
  } else if (spec.body.kind === 'input') {
    const f = spec.body.field;
    // PR-Δ18 (Sprint 15 · 2026-04-28) · multi-line wrap for long
    // prompt labels. Sprint 4 의 Telegram step 의 prompt
    // ("Home channel / chat ID for cron deliveries (optional, blank
    // = same as owner DM):") 는 80-col 박스 inner 폭 초과 → 한 줄로
    // truncate 되어 박스 우측에 짤림. wrapByVisualWidth 로 단어 경계
    // wrap 후 each line 을 accentPlain 으로 paint.
    for (const wrapped of wrapByVisualWidth(f.label, innerWidthForWrap)) {
      pushBoxLine(
        lines,
        leftPad,
        border,
        boxWidth,
        '  ' + accentPlain.renderWithMonoEmphasis(wrapped, profile),
        '  ' + wrapped,
        mutedPaint,
        profile,
      );
    }
    const shown = f.mask
      ? '*'.repeat(f.value.length)
      : f.value.length > 0
        ? f.value
        : f.placeholder
          ? dimPaint.renderWithMonoEmphasis(f.placeholder, profile)
          : '';
    const shownPlain = f.mask
      ? '*'.repeat(f.value.length)
      : f.value.length > 0
        ? f.value
        : f.placeholder ?? '';
    const inputLinePlain = `  > ${shownPlain}`;
    const inputLineColored = '  ' + accentPlain.renderWithMonoEmphasis('>', profile) + ' ' + shown;
    pushBoxLine(lines, leftPad, border, boxWidth, inputLineColored, inputLinePlain, mutedPaint, profile);
    if (f.error) {
      // wrap error text too
      for (const wrapped of wrapByVisualWidth('! ' + f.error, innerWidthForWrap)) {
        pushBoxLine(
          lines,
          leftPad,
          border,
          boxWidth,
          '  ' + dangerPaint.renderWithMonoEmphasis(wrapped, profile),
          '  ' + wrapped,
          mutedPaint,
          profile,
        );
      }
    } else if (f.help) {
      // wrap help text too
      for (const wrapped of wrapByVisualWidth('↳ ' + f.help, innerWidthForWrap)) {
        pushBoxLine(
          lines,
          leftPad,
          border,
          boxWidth,
          '  ' + dimPaint.renderWithMonoEmphasis(wrapped, profile),
          '  ' + wrapped,
          mutedPaint,
          profile,
        );
      }
    }
  } else {
    // message
    for (const raw of spec.body.lines) {
      pushBoxLine(lines, leftPad, border, boxWidth, '  ' + raw, '  ' + raw, mutedPaint, profile);
    }
  }

  // ── Footer ───────────────────────────────────────────────────────
  pushBlankBoxLine(lines, leftPad, border, boxWidth, mutedPaint, profile);
  if (spec.footer) {
    pushBoxLine(
      lines,
      leftPad,
      border,
      boxWidth,
      '  ' + dimPaint.renderWithMonoEmphasis(spec.footer, profile),
      '  ' + spec.footer,
      mutedPaint,
      profile,
    );
  }

  // ── Bottom border ────────────────────────────────────────────────
  lines.push(
    leftPad +
      mutedPaint.renderWithMonoEmphasis(border.bl + border.bottom.repeat(boxWidth - 2) + border.br, profile),
  );

  return lines.join('\n');
}

function pushBoxLine(
  lines: string[],
  leftPad: string,
  border: BorderShape,
  boxWidth: number,
  contentColored: string,
  contentPlain: string,
  mutedPaint: Style,
  profile: ColorProfile,
): void {
  const innerWidth = boxWidth - 2;
  // pad / clip based on visual width (East-Asian-Wide / ambiguous
  // glyphs render at 2 cells in most terminals — JS string.length lies
  // to us). Without `visualWidth`, the right border drifts past the
  // viewport edge, breaking the box.
  const cells = visualWidth(contentPlain);
  const padCount = Math.max(0, innerWidth - cells);
  const padded = contentColored + ' '.repeat(padCount);
  // If somehow longer, truncate the colored rendering naively (rare —
  // long labels). We accept potential SGR corruption here because the
  // dim padding case dominates.
  const clipped = cells > innerWidth ? contentColored.slice(0, innerWidth) : padded;
  lines.push(
    leftPad +
      mutedPaint.renderWithMonoEmphasis(border.left, profile) +
      clipped +
      mutedPaint.renderWithMonoEmphasis(border.right, profile),
  );
}

function pushBlankBoxLine(
  lines: string[],
  leftPad: string,
  border: BorderShape,
  boxWidth: number,
  mutedPaint: Style,
  profile: ColorProfile,
): void {
  lines.push(
    leftPad +
      mutedPaint.renderWithMonoEmphasis(border.left, profile) +
      ' '.repeat(boxWidth - 2) +
      mutedPaint.renderWithMonoEmphasis(border.right, profile),
  );
}

/** Strip ANSI SGR escape sequences so width math sees the visible
 *  glyphs only. Conservative regex — covers `CSI ... m` runs. */
export function stripSgr(s: string): string {
  // Matches ESC [ ... m
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Visible width in terminal cells. Handles East-Asian-Wide and the
 *  East-Asian-Ambiguous glyphs used by the wizard (`●○ ★ ▽ ▲ ▶ ↳`)
 *  which most modern terminals render at 2 cells. PR-Δ8 uses this in
 *  place of `string.length` so the box border doesn't drift past the
 *  viewport when these glyphs are present.
 *
 *  Conservative — we don't pull in `string-width` (deps minimization).
 *  Range coverage:
 *    - U+1100..U+115F  Hangul Jamo
 *    - U+2E80..U+9FFF  CJK
 *    - U+A000..U+A4CF  Yi
 *    - U+AC00..U+D7A3  Hangul syllables
 *    - U+F900..U+FAFF  CJK compat
 *    - U+FE30..U+FE4F  CJK compat forms
 *    - U+FF00..U+FF60  Fullwidth ASCII
 *    - U+FFE0..U+FFE6  Fullwidth signs
 *    - U+1F300..U+1F9FF Emoji
 *    - Specific glyphs we use: ● ○ ★ ☆ ▽ ▲ ▶ ↳ ↵ — */
export function visualWidth(s: string): number {
  let width = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0) continue;
    if (code < 0x20) continue; // C0 controls
    if (code === 0x7f) continue; // DEL
    if (isWideCodePoint(code)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function isWideCodePoint(cp: number): boolean {
  // Specific wide glyphs the wizard uses (East-Asian-Ambiguous in many
  // monospace fonts).
  if (cp === 0x25cf || cp === 0x25cb) return true; // ● ○
  if (cp === 0x2605 || cp === 0x2606) return true; // ★ ☆
  if (cp === 0x25bd || cp === 0x25b2 || cp === 0x25b6) return true; // ▽ ▲ ▶
  if (cp === 0x21b3) return true; // ↳
  if (cp === 0x21b5) return true; // ↵
  if (cp === 0x2014) return true; // — em dash
  if (cp === 0x2192) return true; // → right arrow
  if (cp === 0x00b7) return false; // · middle dot — narrow
  if (cp >= 0x1100 && cp <= 0x115f) return true; // Hangul Jamo
  if (cp >= 0x2e80 && cp <= 0x9fff) return true; // CJK
  if (cp >= 0xa000 && cp <= 0xa4cf) return true; // Yi
  if (cp >= 0xac00 && cp <= 0xd7a3) return true; // Hangul syllables
  if (cp >= 0xf900 && cp <= 0xfaff) return true; // CJK compat
  if (cp >= 0xfe30 && cp <= 0xfe4f) return true; // CJK compat forms
  if (cp >= 0xff00 && cp <= 0xff60) return true; // Fullwidth ASCII
  if (cp >= 0xffe0 && cp <= 0xffe6) return true; // Fullwidth signs
  if (cp >= 0x1f300 && cp <= 0x1f9ff) return true; // Emoji
  return false;
}

/** Glyph for a given severity level. Returns `null` when no badge
 *  should be shown. */
export function severityGlyph(sev?: ScreenSeverity): string | null {
  if (sev === 'required') return '★';
  if (sev === 'optional') return '▽';
  if (sev === 'advanced') return '▲';
  return null;
}

/** Color the severity glyph by intent — required = accent (bold),
 *  optional = muted, advanced = danger (warning amber/red). */
function severityPaint(
  sev: ScreenSeverity | undefined,
  accent: string,
  muted: string,
  danger: string,
  profile: ColorProfile,
  glyph: string,
): string {
  if (sev === 'required') return Style.empty().foreground(accent).bold().renderWithMonoEmphasis(glyph, profile);
  if (sev === 'optional') return Style.empty().foreground(muted).faint().renderWithMonoEmphasis(glyph, profile);
  if (sev === 'advanced') return Style.empty().foreground(danger).bold().renderWithMonoEmphasis(glyph, profile);
  return glyph;
}

/** Compose the full output the host should write — clear + screen.
 *  Hosts that need to position the cursor (input fields) follow this
 *  with `ANSI_HIDE_CURSOR` or a `\x1b[r;cH` move. */
export function composeFullPaint(spec: ScreenSpec): string {
  return ANSI_CLEAR_HOME + renderScreen(spec);
}

/** Sprint 12: visual-cell-aware word wrap. Splits `text` so each
 *  emitted line's `visualWidth` is `<= max`, preferring whitespace
 *  boundaries; oversize tokens get hard-broken. Returns at least one
 *  line (empty string for empty input) so callers can iterate without
 *  guarding. Used by the excerpt renderer to keep words like
 *  `lifecycle` from being clipped to `lifecycl` when the box is
 *  narrow. */
export function wrapByVisualWidth(text: string, max: number): string[] {
  if (max <= 0) return [text];
  if (visualWidth(text) <= max) return [text];
  const tokens = text.split(/(\s+)/); // keep separators interleaved
  const out: string[] = [];
  let cur = '';
  let curW = 0;
  const flush = (): void => {
    if (cur.length > 0) {
      out.push(cur.replace(/\s+$/, ''));
      cur = '';
      curW = 0;
    }
  };
  for (const tok of tokens) {
    if (tok.length === 0) continue;
    const tokW = visualWidth(tok);
    if (curW + tokW <= max) {
      cur += tok;
      curW += tokW;
      continue;
    }
    // Doesn't fit on the current line.
    flush();
    if (tokW <= max) {
      cur = tok.replace(/^\s+/, '');
      curW = visualWidth(cur);
      continue;
    }
    // Hard-break — token wider than the budget.
    let chunk = '';
    let chunkW = 0;
    for (const ch of tok) {
      const cw = visualWidth(ch);
      if (chunkW + cw > max) {
        out.push(chunk);
        chunk = ch;
        chunkW = cw;
      } else {
        chunk += ch;
        chunkW += cw;
      }
    }
    cur = chunk;
    curW = chunkW;
  }
  flush();
  return out.length > 0 ? out : [''];
}
