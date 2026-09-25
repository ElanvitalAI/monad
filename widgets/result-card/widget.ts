// ── Result Card widget ──
//
// Single-persona stance / confidence / summary card. Designed for the
// consensus-trader plugin's result grid: many instances are placed in
// a rows×cells layout, each one holds ONE persona's verdict. A runner
// may spawn cards with `stance='loading'` before the agent produces
// output, then patch state as results land — no full-layout re-render
// needed.
//
// Pure render contract (same (state, ctx, character) → same lines).
// ANSI width/truncation honored via visibleWidth + truncate so Korean /
// CJK personas don't break the card border.

import type { WidgetDef } from '../../src/widgets/types.js';
import { C, visibleWidth, truncate } from '../../src/tui.js';

/** Stance of the persona's verdict. 'loading' = card spawned but
 *  agent hasn't finished; 'error' = agent threw / timed out. Color
 *  and badge glyph both drive off this field. */
export type ResultStance = 'bull' | 'bear' | 'neutral' | 'loading' | 'error';

export interface ResultCardState {
  /** Display name of the persona (e.g. "Park Ji-hoon"). */
  personaName: string;
  /** Role / archetype under the name ("한국 액티브 펀드매니저"). */
  personaRole?: string;
  /** Current stance — drives badge + color. */
  stance: ResultStance;
  /** Confidence 0–100. Ignored when stance is loading/error. */
  confidence?: number;
  /** 1–2 line summary rendered below the confidence bar. Kept short
   *  because cards are narrow (usually 30–40 cols in a multi-col
   *  layout). Wrapping handled by the render function. */
  summary?: string;
  /** Full rationale shown in a modal drill-down (not drawn on the
   *  card itself — the plugin opens a separate markdown widget in a
   *  modal when the user Enters on the card). */
  full?: string;
  /** Populated on stance='error' to surface the failure reason. */
  error?: string;
  /** Focused state — drives border highlight. */
  focused: boolean;
}

export interface ResultCardConfig {
  personaName?: string;
  personaRole?: string;
  stance?: ResultStance;
  confidence?: number;
  summary?: string;
  full?: string;
  error?: string;
}

const GLYPH: Record<ResultStance, string> = {
  bull:    '\u25B2',   // ▲
  bear:    '\u25BC',   // ▼
  neutral: '\u25CF',   // ●
  loading: '\u2731',   // ✱
  error:   '\u2716',   // ✖
};

/** Apply the stance color to a piece of text. Loading is muted so
 *  the card feels "inert" until the agent finishes. */
function stanceColor(stance: ResultStance, text: string): string {
  switch (stance) {
    case 'bull':    return C.success(text);
    case 'bear':    return C.error(text);
    case 'neutral': return C.warning(text);
    case 'loading': return C.muted(text);
    case 'error':   return C.error(text);
  }
}

/** Label shown next to the badge glyph. Short enough to leave room
 *  for the confidence bar on narrow cards. */
function stanceLabel(stance: ResultStance): string {
  switch (stance) {
    case 'bull':    return 'Bull';
    case 'bear':    return 'Bear';
    case 'neutral': return 'Neutral';
    case 'loading': return 'Running';
    case 'error':   return 'Error';
  }
}

/** 8-col filled/hollow block bar for confidence. Fills proportional
 *  to `n/100`; returns colored string. When undefined/loading, an
 *  all-hollow bar keeps the card row height stable so the grid
 *  doesn't reflow when results land. */
function confidenceBar(stance: ResultStance, conf: number | undefined, width = 8): string {
  const clamped = Math.max(0, Math.min(100, conf ?? 0));
  const filled = Math.round((clamped / 100) * width);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(Math.max(0, width - filled));
  const pct = conf == null ? '  —' : `${String(Math.round(clamped)).padStart(2, ' ')}%`;
  return stanceColor(stance, bar) + ' ' + C.muted(pct);
}

/** Split `text` into lines that each fit `width` visible cols. Breaks
 *  on word boundaries when possible, falls back to mid-word split on
 *  very long runs (URLs, Korean with no spaces). */
export function wrapToWidth(text: string, width: number): string[] {
  if (width <= 0) return [];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const tentative = cur + w;
    if (visibleWidth(tentative) <= width) {
      cur = tentative;
    } else {
      if (cur.trim()) lines.push(cur.trimEnd());
      // single word too long — hard split by code point
      if (visibleWidth(w) > width) {
        let chunk = '';
        for (const ch of w) {
          if (visibleWidth(chunk + ch) > width) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        cur = chunk;
      } else {
        cur = w;
      }
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

const resultCardWidget: WidgetDef<ResultCardState, ResultCardConfig> = {
  type: 'result-card',
  description: 'Single-persona stance / confidence / summary card for consensus views',
  defaultCharacter: 'Result',

  initialState(config) {
    return {
      personaName: config?.personaName ?? '',
      personaRole: config?.personaRole,
      stance: config?.stance ?? 'loading',
      confidence: config?.confidence,
      summary: config?.summary,
      full: config?.full,
      error: config?.error,
      focused: false,
    };
  },

  render(state, ctx) {
    const w = ctx.width;
    const h = ctx.height;
    const lines: string[] = [];
    if (h < 1 || w < 4) return lines;

    // ── Border + content layout ──
    // Card occupies its whole allocated cell. Border chars differ by
    // focus so the user sees where they are at a glance. Content rows
    // are indented 1 col inside the border.
    const focused = state.focused || ctx.focused;
    const borderColor = focused ? C.border : C.muted;
    const inner = Math.max(0, w - 2);

    // Top border with persona name inlaid.
    const nameRaw = state.personaName || '—';
    const nameShown = truncate(nameRaw, Math.max(4, inner - 4));
    const nameStr = focused ? C.bold(nameShown) : C.text(nameShown);
    const afterName = Math.max(0, inner - visibleWidth(nameShown) - 3);
    lines.push(
      borderColor('\u256D\u2500 ') + nameStr + ' ' + borderColor('\u2500'.repeat(afterName) + '\u256E'),
    );

    if (h <= 1) return lines;

    // Body rows — build, then wrap into available height.
    const bodyLines: string[] = [];

    if (state.personaRole) {
      bodyLines.push(C.muted(truncate(state.personaRole, inner - 2)));
    }

    // Stance badge + confidence bar row.
    const glyph = GLYPH[state.stance];
    const label = stanceLabel(state.stance);
    const badge = stanceColor(state.stance, `${glyph} ${label}`);
    const bar = state.stance === 'error' ? '' : confidenceBar(state.stance, state.confidence, 8);
    bodyLines.push(badge + (bar ? '  ' + bar : ''));

    // Summary / error paragraph.
    if (state.stance === 'error') {
      const msg = state.error || 'agent failed';
      for (const ln of wrapToWidth(msg, inner - 2)) {
        bodyLines.push(C.error(ln));
      }
    } else if (state.stance === 'loading') {
      bodyLines.push(C.muted('…running'));
    } else if (state.summary) {
      for (const ln of wrapToWidth(state.summary, inner - 2)) {
        bodyLines.push(C.text(ln));
      }
    }

    // Emit body rows within the interior height (h - 2 for top+bottom borders).
    const bodyCap = Math.max(0, h - 2);
    for (let i = 0; i < bodyCap; i++) {
      const row = bodyLines[i] ?? '';
      const pad = Math.max(0, inner - visibleWidth(row));
      lines.push(borderColor('\u2502 ') + row + ' '.repeat(pad) + borderColor(' \u2502'));
    }

    // Bottom border.
    lines.push(borderColor('\u2570' + '\u2500'.repeat(Math.max(0, w - 2)) + '\u256F'));
    return lines;
  },

  onKey(ev, _state, ctx) {
    // Cards are leaves — they don't own a cursor. Enter signals the
    // plugin to open a drill-down modal; j/k/h/l navigate BETWEEN
    // cards and are handled by the plugin layer (arrow through the
    // grid of cards). We surface only 'submit' so the plugin knows
    // the user picked this one.
    if (ev.name === 'enter' && !ev.shift) {
      return { type: 'submit', text: ctx.widgetId };
    }
    return { type: 'none' };
  },

  onMouse(ev, _state, ctx) {
    if (ev.type === 'click' || ev.type === 'double-click') {
      return { type: 'submit', text: ctx.widgetId };
    }
    return { type: 'none' };
  },

  // WR-4 (S3.C · 2026-04-27 · UI Core closure) — opt-in state observation.
  // Stance transitions are the headline event for a result card: an
  // LLM asking "did the persona produce a verdict?" reads stance going
  // loading→bull/bear/neutral or →error. Confidence drift is emitted
  // separately when the stance is non-loading. Pure data state — no
  // animation handles, no subscriptions — so replayState is omitted
  // (Plan B · peer pattern).
  onStateChange(prev, next, ctx) {
    if (prev.stance !== next.stance) {
      ctx.telemetry?.emit({
        kind: 'result-card.stance.change',
        data: { from: prev.stance, to: next.stance, persona: next.personaName },
      });
    }
    if (
      prev.confidence !== next.confidence
      && next.stance !== 'loading'
      && next.stance !== 'error'
    ) {
      ctx.telemetry?.emit({
        kind: 'result-card.confidence.change',
        data: { from: prev.confidence ?? null, to: next.confidence ?? null },
      });
    }
  },

  // Hash discriminates stance + confidence + focus + summary length.
  // Body summary length covers "summary patched in" without paying
  // for a full text hash; rare in-place edits still get caught by
  // the recorder's deep-compare on hash match.
  snapshotHash(state): string {
    const conf = state.confidence == null ? '-' : String(state.confidence);
    const sumLen = state.summary ? state.summary.length : 0;
    return `${state.stance}:${conf}:${state.focused ? 1 : 0}:${sumLen}`;
  },

  // One-line LLM summary — persona name (preferred) + stance + numeric
  // confidence when available. Error branch surfaces the failure
  // reason (truncated) so an agent can tell why a card is empty
  // without opening the drill-down modal.
  describeSurface(state, ctx): string {
    const persona = state.personaName || ctx.character;
    const parts = [persona, state.stance];
    if (state.stance !== 'loading' && state.stance !== 'error' && state.confidence != null) {
      parts.push(`${Math.round(state.confidence)}%`);
    }
    if (state.stance === 'error' && state.error) {
      const trimmed = state.error.length > 32 ? `${state.error.slice(0, 29)}...` : state.error;
      parts.push(`error: ${trimmed}`);
    }
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        personaName: { type: 'string', description: 'Display name for the persona.' },
        personaRole: { type: 'string', description: 'Short subtitle or role line.' },
        stance: {
          type: 'string',
          enum: ['bull', 'bear', 'neutral', 'loading', 'error'],
          description: 'Current stance driving badge, color, and copy.',
        },
        confidence: {
          type: 'number',
          description: 'Confidence percentage from 0 to 100.',
        },
        summary: {
          type: 'string',
          description: 'Short summary paragraph rendered in the card body.',
        },
        full: {
          type: 'string',
          description: 'Full rationale kept for drill-down detail surfaces.',
        },
        error: {
          type: 'string',
          description: 'Failure reason shown when stance is error.',
        },
      },
      additionalProperties: false,
    };
  },
};

export default resultCardWidget;
