// LC10 — ProgressBar: transient progress display.
//
// A one-row widget that paints a filled-proportion bar plus an
// optional label and percent text. Hosts typically wrap it in a
// BoxView for a framed look and call update({ current, label })
// from a long-running task loop.
//
// Intentionally does not take focus — progress is a passive signal.
//
// IDX-6 FU I (2026-04-19) — accepts an optional theme. When set, the
// fill color resolves from the semantic palette so theme switches
// repaint the bar consistently with PFC Andon / TO status-badge
// conventions. A status tag (backlog|running|review|done|error) maps
// to the corresponding semantic token, giving tasks a visually
// consistent progress indicator regardless of theme.
//
// 2026-04-28 — Internal bar string now generated via expression
// `renderProgress` (chalk-environment-deterministic raw SGR). The
// theme/status → AdaptiveColor mapping stays in this file so the
// semantic semantics (red-for-error, amber-for-review, ...) hold
// regardless of which renderer produces the cells. fillChar /
// emptyChar overrides are deprecated — renderProgress uses `█` / `·`
// for `solid` and `═` / `─` for `dotted` (existing defaults match).

import type { KeyEvent } from '../../plugins/core/types.js';
import {
  paintPair,
  resolveSemantic,
  type ThemeTokens,
} from '../../theme/tokens.js';
import { C } from '../../tui.js';
import { renderProgress } from '../../expression/index.js';
import type { Printer } from '../printer.js';
import { cellWidth } from '../printer.js';
import { Ignored, type EventResult, type FocusSource, type Size, type View } from '../view.js';

export type ProgressStatus = 'backlog' | 'running' | 'review' | 'done' | 'error';

export interface ProgressBarSpec {
  total: number;
  current?: number;
  label?: string;
  /** Character used for filled portion. Default '█'. */
  fillChar?: string;
  /** Character used for empty portion. Default '·'. */
  emptyChar?: string;
  showPercent?: boolean;
  /** IDX-6 FU I — optional theme tokens. Absent = legacy C.* painters. */
  theme?: ThemeTokens;
  /** IDX-6 FU I — semantic status, maps to a theme-invariant color
   *  via resolveSemantic. Absent = fill uses theme.semantic.success
   *  or legacy C.success. */
  status?: ProgressStatus;
}

export class ProgressBar implements View {
  private current: number;
  private label: string;

  constructor(private spec: ProgressBarSpec) {
    this.current = spec.current ?? 0;
    this.label = spec.label ?? '';
  }

  update(patch: { current?: number; label?: string; total?: number }): void {
    if (patch.total !== undefined)   this.spec.total = patch.total;
    if (patch.current !== undefined) this.current = Math.max(0, Math.min(this.spec.total, patch.current));
    if (patch.label !== undefined)   this.label = patch.label;
  }

  get percent(): number {
    if (this.spec.total <= 0) return 0;
    return Math.round((this.current / this.spec.total) * 100);
  }

  draw(p: Printer): void {
    if (p.width <= 0 || p.height <= 0) return;
    const showPct = this.spec.showPercent ?? true;
    const labelPaint = this.labelPainter();

    // Line 0: label (if any)
    let barRow = 0;
    if (this.label && p.height >= 2) {
      p.text(0, 0, labelPaint(this.label));
      barRow = 1;
    }

    const pctText = showPct ? ` ${String(this.percent).padStart(3, ' ')}%` : '';
    const pctW = cellWidth(pctText);
    const barW = Math.max(0, p.width - pctW);
    const value = this.spec.total > 0 ? this.current / this.spec.total : 0;

    // Internal bar string via expression renderProgress — raw SGR,
    // chalk-environment-deterministic. Fill / empty colors resolve
    // through the semantic palette (theme-aware) or fall back to
    // legacy hex defaults (theme-absent). renderProgress always uses
    // its own fillChar/emptyChar (`█`/`·` for solid, `═`/`─` for
    // dotted) — fillChar/emptyChar overrides on ProgressBarSpec are
    // deprecated post-migration.
    const bar = renderProgress(
      {
        kind: 'progress',
        value,
        width: barW,
        bar: 'solid',
      },
      'truecolor',
      {
        themeAccent: this.fillAccentHex(),
      },
    );

    p.text(0, barRow, bar + (showPct ? labelPaint(pctText) : ''));
  }

  /** Resolve the fill color as a hex string for `renderProgress`'s
   *  `themeAccent` option. Legacy (no theme) maps the status token to
   *  monad's stock pastel palette; theme-aware path goes through
   *  `resolveSemantic` and reads the resolved fg. */
  private fillAccentHex(): string {
    const { theme, status } = this.spec;
    if (!theme) {
      // Legacy hex defaults — chosen to match the previous C.error /
      // C.warning / C.muted / C.success palette intent.
      if (status === 'error') return '#f38ba8';
      if (status === 'review') return '#f9e2af';
      if (status === 'backlog') return '#7f849c';
      if (status === 'running') return '#89b4fa';
      return '#a6e3a1'; // done / default → green
    }
    const kind = mapStatusToSemantic(status ?? 'done');
    const pair = resolveSemantic(theme, kind);
    return pair?.fg && /^#[0-9a-fA-F]{6}$/.test(pair.fg) ? pair.fg : '#a6e3a1';
  }

  private labelPainter(): (s: string) => string {
    const { theme } = this.spec;
    if (!theme) return C.subtext;
    return paintPair(resolveSemantic(theme, 'muted'));
  }

  onEvent(_ev: KeyEvent): EventResult { return Ignored; }
  layout(_s: Size): void { /* no-op */ }
  requiredSize(c: Size): Size {
    return { width: c.width, height: Math.min(c.height, this.label ? 2 : 1) };
  }
  takeFocus(_src?: FocusSource): boolean { return false; }
}

/** Map a ProgressStatus to the semantic slot its fill should use.
 *  Theme-invariant per DD-IDX-15 — callers get red-for-error,
 *  amber-for-review, etc., regardless of the active preset. */
function mapStatusToSemantic(
  status: ProgressStatus,
): 'critical' | 'warning' | 'success' | 'info' | 'muted' {
  switch (status) {
    case 'error':   return 'critical';
    case 'review':  return 'warning';
    case 'backlog': return 'muted';
    case 'running': return 'info';
    case 'done':    return 'success';
    default:        return 'success';
  }
}
