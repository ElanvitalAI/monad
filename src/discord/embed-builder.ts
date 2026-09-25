// Discord embed card builder for persona messages.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.1 (M1.2)
// ROADMAP: 내부 문서 `ROADMAP-discord-rich-light-persona-2026-05-01` §2.2
//
// Discord webhook execute supports both `content` (plain text · mentions
// work) and `embeds[]` (rich card · color accent · footer · fields).
// Persona responses get richer when each persona's brand color becomes
// the embed accent + the footer carries model + cost telemetry. This
// is the visual layer that turns "3 webhook personas" into "3 visibly
// distinct agents with provenance".
//
// Pure helpers — no Discord REST calls. The adapter layer
// (`WebhookPersonaAdapter`) wires `buildPersonaEmbed` into the
// execute body via the `embed` option on `SendAsPersonaOpts`.

import type { PersonaIdentity } from './webhook-persona-adapter.js';

/** Optional embed spec. All fields optional — caller composes only
 *  what's relevant to the persona response. */
export interface PersonaEmbedSpec {
  /** Embed body text. Distinct from the message `content` — embed
   *  description is wrapped in the card with the brand color accent. */
  readonly description?: string;
  /** Short title above the description. */
  readonly title?: string;
  /** Structured fields — typically reasoning steps / sources / metadata. */
  readonly fields?: readonly EmbedField[];
  /** Footer text — convention: `<model> · $<cost>` (e.g.,
   *  `claude-opus-4-7 · $0.0142`). */
  readonly footerText?: string;
  readonly footerIconUrl?: string;
  /** ISO timestamp string or Date — default = now if omitted but
   *  caller wants `includeTimestamp: true`. */
  readonly timestamp?: string | Date;
  /** Set true to auto-fill timestamp with `new Date()` when not given. */
  readonly includeTimestamp?: boolean;
  readonly thumbnailUrl?: string;
}

export interface EmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

/** Discord-shaped embed (subset). Sent as `embeds: [embed]` in the
 *  webhook execute body. */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
  thumbnail?: { url: string };
  author?: { name: string; icon_url?: string };
}

/** Convert a CSS hex color string ('#6d28d9' or '6d28d9') to the
 *  Discord-required integer (0xRRGGBB). Returns undefined on invalid
 *  input — caller's embed will simply omit the color field. */
export function hexColorToInt(hex: string | undefined): number | undefined {
  if (!hex) return undefined;
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;
  return parseInt(cleaned, 16);
}

/** Build a Discord embed object from a persona + embed spec.
 *  Pure — no I/O. */
export function buildPersonaEmbed(
  persona: PersonaIdentity,
  spec: PersonaEmbedSpec,
): DiscordEmbed {
  const embed: DiscordEmbed = {};

  if (spec.title) embed.title = spec.title;
  if (spec.description) embed.description = spec.description;

  const color = hexColorToInt(persona.brandColor);
  if (color !== undefined) embed.color = color;

  if (spec.fields && spec.fields.length > 0) {
    embed.fields = spec.fields.map((f) => {
      const out: { name: string; value: string; inline?: boolean } = {
        name: f.name,
        value: f.value,
      };
      if (f.inline !== undefined) out.inline = f.inline;
      return out;
    });
  }

  if (spec.footerText) {
    embed.footer = { text: spec.footerText };
    if (spec.footerIconUrl) embed.footer.icon_url = spec.footerIconUrl;
  }

  // Timestamp: explicit > auto (if includeTimestamp) > omit
  if (spec.timestamp !== undefined) {
    embed.timestamp = spec.timestamp instanceof Date
      ? spec.timestamp.toISOString()
      : spec.timestamp;
  } else if (spec.includeTimestamp) {
    embed.timestamp = new Date().toISOString();
  }

  if (spec.thumbnailUrl) embed.thumbnail = { url: spec.thumbnailUrl };

  // Author block uses persona display name + avatar — gives the
  // embed its own header even when called without a title.
  embed.author = { name: persona.displayName };
  if (persona.avatarUrl) embed.author.icon_url = persona.avatarUrl;

  return embed;
}

/** Convenience — build a footer string in the canonical format
 *  `<model> · $<cost>`. Omits parts when the underlying value is
 *  missing. Returns undefined if both are absent. */
export function buildModelCostFooter(opts: {
  model?: string;
  costUsd?: number;
  costPrecision?: number;  // default 4
}): string | undefined {
  const parts: string[] = [];
  if (opts.model) parts.push(opts.model);
  if (typeof opts.costUsd === 'number' && Number.isFinite(opts.costUsd)) {
    const precision = opts.costPrecision ?? 4;
    parts.push(`$${opts.costUsd.toFixed(precision)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
