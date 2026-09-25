// Discord Components builder — Button / Select for interactive UX.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.1 (M1.5)
// ROADMAP: 내부 문서 `ROADMAP-discord-rich-light-persona-2026-05-01` §2.2
//
// Discord webhook execute supports `components: [actionRow, ...]`
// where each action row holds up to 5 Buttons, OR exactly 1 Select.
// We expose:
//   - approveRejectButtons() — HITL "Approve / Reject" pair (M1.4 가
//     reaction 으로 처리하지만 Button 이 더 명시적, Slash 응답에서 사용)
//   - personaPickerSelect()  — "어느 persona 에게?" 선택 UX
//   - actionRow() · button() · select() — pure helpers
//
// Outbound only (build the body) — INTERACTION_CREATE 인입 처리는
// 별 module (interaction-handler) 로, 본 PR scope 외. Slash command
// (M3) 와 wiring 시 callback custom_id 로 라우팅.

import type { ReactionEmoji } from './reaction-handler.js';

/** Discord ButtonStyle enum (per docs). */
export enum ButtonStyle {
  PRIMARY = 1,    // blurple
  SECONDARY = 2,  // grey
  SUCCESS = 3,    // green
  DANGER = 4,     // red
  LINK = 5,       // url-only, no custom_id
}

export const COMPONENT_TYPE = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
} as const;

/** Button spec — caller-friendly, builder converts to Discord shape. */
export interface ButtonSpec {
  readonly label: string;
  readonly customId?: string;       // required unless style=LINK
  readonly style?: ButtonStyle;     // default PRIMARY
  readonly emoji?: ReactionEmoji;
  readonly url?: string;            // required iff style=LINK
  readonly disabled?: boolean;
}

/** String select spec. */
export interface SelectSpec {
  readonly customId: string;
  readonly placeholder?: string;
  readonly minValues?: number;      // 0..options.length
  readonly maxValues?: number;
  readonly options: readonly SelectOption[];
  readonly disabled?: boolean;
}

export interface SelectOption {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly emoji?: ReactionEmoji;
  readonly default?: boolean;
}

/** Discord-shaped component (subset). */
export interface DiscordComponent {
  type: number;
  components?: DiscordComponent[];
  // Button:
  style?: number;
  label?: string;
  custom_id?: string;
  emoji?: { name: string; id?: string; animated?: boolean };
  url?: string;
  disabled?: boolean;
  // Select:
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options?: {
    label: string;
    value: string;
    description?: string;
    emoji?: { name: string; id?: string; animated?: boolean };
    default?: boolean;
  }[];
}

/** Build a single Button component. Validates style requirements
 *  (LINK requires url, others require customId). */
export function button(spec: ButtonSpec): DiscordComponent {
  const style = spec.style ?? ButtonStyle.PRIMARY;
  if (style === ButtonStyle.LINK) {
    if (!spec.url) throw new Error('button: LINK style requires url');
    const out: DiscordComponent = {
      type: COMPONENT_TYPE.BUTTON, style, label: spec.label, url: spec.url,
    };
    if (spec.emoji) out.emoji = toDiscordEmoji(spec.emoji);
    if (spec.disabled !== undefined) out.disabled = spec.disabled;
    return out;
  }
  if (!spec.customId) throw new Error('button: non-LINK style requires customId');
  const out: DiscordComponent = {
    type: COMPONENT_TYPE.BUTTON, style, label: spec.label, custom_id: spec.customId,
  };
  if (spec.emoji) out.emoji = toDiscordEmoji(spec.emoji);
  if (spec.disabled !== undefined) out.disabled = spec.disabled;
  return out;
}

/** Build a String Select component. Validates option count (1..25)
 *  and min/max values. */
export function select(spec: SelectSpec): DiscordComponent {
  if (spec.options.length === 0) throw new Error('select: at least 1 option required');
  if (spec.options.length > 25) throw new Error('select: at most 25 options');
  const minV = spec.minValues ?? 1;
  const maxV = spec.maxValues ?? 1;
  if (minV < 0 || maxV < minV || maxV > spec.options.length) {
    throw new Error('select: invalid min/max values');
  }
  const out: DiscordComponent = {
    type: COMPONENT_TYPE.STRING_SELECT,
    custom_id: spec.customId,
    options: spec.options.map((o) => {
      const opt: NonNullable<DiscordComponent['options']>[number] = {
        label: o.label, value: o.value,
      };
      if (o.description) opt.description = o.description;
      if (o.emoji) opt.emoji = toDiscordEmoji(o.emoji);
      if (o.default !== undefined) opt.default = o.default;
      return opt;
    }),
  };
  if (spec.placeholder) out.placeholder = spec.placeholder;
  if (spec.minValues !== undefined) out.min_values = spec.minValues;
  if (spec.maxValues !== undefined) out.max_values = spec.maxValues;
  if (spec.disabled !== undefined) out.disabled = spec.disabled;
  return out;
}

/** Build an Action Row holding either up to 5 Buttons OR 1 Select.
 *  Discord rejects mixed rows — we enforce. */
export function actionRow(children: readonly DiscordComponent[]): DiscordComponent {
  if (children.length === 0) throw new Error('actionRow: at least 1 child required');
  const hasSelect = children.some((c) => c.type === COMPONENT_TYPE.STRING_SELECT);
  if (hasSelect) {
    if (children.length !== 1) {
      throw new Error('actionRow: a Select must be alone in its row');
    }
  } else {
    if (children.length > 5) {
      throw new Error('actionRow: at most 5 Buttons per row');
    }
  }
  return {
    type: COMPONENT_TYPE.ACTION_ROW,
    components: [...children],
  };
}

// ── high-level convenience ──────────────────────────────────────

export interface ApproveRejectButtonsOpts {
  /** Custom_id prefix. Default = `'hitl'`. Generated:
   *  `<prefix>:approve:<gateId?>` and `<prefix>:reject:<gateId?>`. */
  readonly prefix?: string;
  /** Optional gate / dispatch id appended to custom_id for routing. */
  readonly gateId?: string;
  readonly approveLabel?: string;   // default 'Approve'
  readonly rejectLabel?: string;    // default 'Reject'
  readonly disabled?: boolean;
}

/** Build an action-row holding Approve (green) + Reject (red)
 *  Buttons — the canonical HITL gate UX. Custom_ids encode the
 *  gateId so the interaction handler can route. */
export function approveRejectButtons(opts: ApproveRejectButtonsOpts = {}): DiscordComponent {
  const prefix = opts.prefix ?? 'hitl';
  const tail = opts.gateId ? `:${opts.gateId}` : '';
  return actionRow([
    button({
      label: opts.approveLabel ?? 'Approve',
      customId: `${prefix}:approve${tail}`,
      style: ButtonStyle.SUCCESS,
      emoji: { name: '👍' },
      disabled: opts.disabled,
    }),
    button({
      label: opts.rejectLabel ?? 'Reject',
      customId: `${prefix}:reject${tail}`,
      style: ButtonStyle.DANGER,
      emoji: { name: '👎' },
      disabled: opts.disabled,
    }),
  ]);
}

export interface PersonaPickerOpts {
  readonly customId: string;
  readonly placeholder?: string;
  readonly defaultPersonaId?: string;
}

/** Build a Select for picking among `personas`. Each option's value
 *  = persona.personaId, label = persona.displayName. Truncates to
 *  Discord's 25-option cap. */
export function personaPickerSelect(
  personas: readonly { personaId: string; displayName: string; description?: string }[],
  opts: PersonaPickerOpts,
): DiscordComponent {
  if (personas.length === 0) {
    throw new Error('personaPickerSelect: at least 1 persona required');
  }
  const limited = personas.slice(0, 25);
  return select({
    customId: opts.customId,
    placeholder: opts.placeholder,
    options: limited.map((p) => {
      const opt: SelectOption = {
        label: p.displayName,
        value: p.personaId,
      };
      if (p.description) (opt as { description?: string }).description = p.description;
      if (opts.defaultPersonaId === p.personaId) {
        (opt as { default?: boolean }).default = true;
      }
      return opt;
    }),
  });
}

// ── private ─────────────────────────────────────────────────────

function toDiscordEmoji(e: ReactionEmoji): { name: string; id?: string; animated?: boolean } {
  const out: { name: string; id?: string; animated?: boolean } = { name: e.name };
  if (e.id) out.id = e.id;
  if (e.animated !== undefined) out.animated = e.animated;
  return out;
}
