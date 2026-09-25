// Style — fluent builder for ANSI-styled text spans.
//
// lipgloss-equivalent shape. A `Style` is immutable; every chained
// method returns a fresh instance so call sites can build templates
// once and reuse them. `.render(text, profile)` materializes the ANSI
// string for the given color profile.
//
// Renderers in `src/expression/` always go through Style — never call
// chalk directly — so profile-fallback (mono / 16 / 256 / truecolor)
// stays uniform regardless of the host's auto-detected color support.
//
// We emit raw SGR ourselves rather than going through chalk because
// chalk silently degrades to a passthrough when `supportsColor` is
// false (test runners, CI, piped stdout). The expression layer needs
// profile-deterministic output: pass `profile='truecolor'` and you
// always get truecolor escapes, pass `'mono'` and you always get the
// bare text. Detection lives at the host boundary (`detectProfile()`
// in color.ts) — Style itself just renders.

import {
  type AdaptiveColor,
  type ColorProfile,
  detectProfile,
  paint,
  paintBg,
} from './color.js';

interface StyleState {
  fg?: AdaptiveColor | string;
  bg?: AdaptiveColor | string;
  bold?: boolean;
  faint?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
  paddingX?: number;
  marginX?: number;
}

const SGR_BOLD = '\x1b[1m';
const SGR_FAINT = '\x1b[2m';
const SGR_ITALIC = '\x1b[3m';
const SGR_UNDERLINE = '\x1b[4m';
const SGR_INVERSE = '\x1b[7m';
const SGR_STRIKE = '\x1b[9m';
const SGR_RESET = '\x1b[0m';

export class Style {
  private constructor(private readonly s: StyleState) {}

  static empty(): Style {
    return new Style({});
  }

  static of(init: Partial<StyleState>): Style {
    return new Style({ ...init });
  }

  foreground(c: AdaptiveColor | string): Style {
    return new Style({ ...this.s, fg: c });
  }
  background(c: AdaptiveColor | string): Style {
    return new Style({ ...this.s, bg: c });
  }
  bold(v = true): Style {
    return new Style({ ...this.s, bold: v });
  }
  faint(v = true): Style {
    return new Style({ ...this.s, faint: v });
  }
  italic(v = true): Style {
    return new Style({ ...this.s, italic: v });
  }
  underline(v = true): Style {
    return new Style({ ...this.s, underline: v });
  }
  inverse(v = true): Style {
    return new Style({ ...this.s, inverse: v });
  }
  strikethrough(v = true): Style {
    return new Style({ ...this.s, strikethrough: v });
  }
  paddingX(n: number): Style {
    return new Style({ ...this.s, paddingX: n });
  }
  marginX(n: number): Style {
    return new Style({ ...this.s, marginX: n });
  }

  render(text: string, profile: ColorProfile = detectProfile()): string {
    return this.renderInternal(text, profile, false);
  }

  /** PR-Δ17 (F13 · 2026-04-28) — opt-in mono-emphasis renderer. When
   *  `keepAttrsInMono` is true, attribute SGRs (bold / faint / italic
   *  / underline / inverse / strikethrough) survive even when the
   *  profile is `'mono'` so callers that want visual hierarchy on
   *  bare TTYs / NO_COLOR / CI logs (e.g. setup wizard) can opt in
   *  without affecting the wider mono contract (table / markdown /
   *  status module assert mono = zero SGR). Color SGRs are still
   *  mono-stripped under both modes. */
  renderWithMonoEmphasis(text: string, profile: ColorProfile = detectProfile()): string {
    return this.renderInternal(text, profile, true);
  }

  private renderInternal(
    text: string,
    profile: ColorProfile,
    keepAttrsInMono: boolean,
  ): string {
    const inner = this.s.paddingX ? pad(text, this.s.paddingX) : text;
    let body = inner;
    if (profile !== 'mono') {
      // Apply attribute SGR, then color SGR. Reset at the end so a
      // single render call has self-contained styling.
      const attrs: string[] = [];
      if (this.s.bold) attrs.push(SGR_BOLD);
      if (this.s.faint) attrs.push(SGR_FAINT);
      if (this.s.italic) attrs.push(SGR_ITALIC);
      if (this.s.underline) attrs.push(SGR_UNDERLINE);
      if (this.s.inverse) attrs.push(SGR_INVERSE);
      if (this.s.strikethrough) attrs.push(SGR_STRIKE);
      if (this.s.fg) body = paint(this.s.fg, profile)(body);
      if (this.s.bg) body = paintBg(this.s.bg, profile)(body);
      if (attrs.length > 0) body = attrs.join('') + body + SGR_RESET;
    } else if (keepAttrsInMono) {
      const attrs: string[] = [];
      if (this.s.bold) attrs.push(SGR_BOLD);
      if (this.s.faint) attrs.push(SGR_FAINT);
      if (this.s.italic) attrs.push(SGR_ITALIC);
      if (this.s.underline) attrs.push(SGR_UNDERLINE);
      if (this.s.inverse) attrs.push(SGR_INVERSE);
      if (this.s.strikethrough) attrs.push(SGR_STRIKE);
      if (attrs.length > 0) body = attrs.join('') + body + SGR_RESET;
    }
    return this.s.marginX ? pad(body, this.s.marginX) : body;
  }
}

function pad(text: string, n: number): string {
  if (!Number.isFinite(n) || n <= 0) return text;
  const space = ' '.repeat(n);
  return space + text + space;
}
