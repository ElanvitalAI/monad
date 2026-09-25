// ── Presentation P2 · BoxShadow ──
//
// TUI-subset of Flutter's BoxShadow. `offset` is in character cells;
// `blurRadius` is accepted for API parity with Flutter but the half-
// block renderer typically ignores it (kept for serialization
// round-trip and potential future compositor). `opacity` in [0, 1].
//
// Immutable · public constructor (opts object). copyWith is the only
// derivation path.

import type { ColorToken } from '../../widgets/types.js';

export interface ShadowOffset {
  readonly dx: number;
  readonly dy: number;
}

export interface BoxShadowJSON {
  readonly offset: ShadowOffset;
  readonly color: ColorToken | string | null;
  readonly opacity: number;
  readonly blurRadius: number;
}

export interface BoxShadowOptions {
  readonly offset?: ShadowOffset;
  readonly color?: ColorToken | string | null;
  readonly opacity?: number;
  readonly blurRadius?: number;
}

function clampOpacity(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 1;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeOffset(o: ShadowOffset | undefined): ShadowOffset {
  if (!o) return { dx: 0, dy: 0 };
  return { dx: Math.round(Number(o.dx ?? 0)), dy: Math.round(Number(o.dy ?? 0)) };
}

export class BoxShadow {
  readonly offset: ShadowOffset;
  readonly color: ColorToken | string | null;
  readonly opacity: number;
  readonly blurRadius: number;

  constructor(opts: BoxShadowOptions = {}) {
    this.offset = Object.freeze(normalizeOffset(opts.offset));
    this.color = opts.color ?? null;
    this.opacity = clampOpacity(opts.opacity);
    this.blurRadius = Number.isFinite(opts.blurRadius)
      ? Math.max(0, Math.round(opts.blurRadius as number))
      : 0;
  }

  copyWith(patch: BoxShadowOptions): BoxShadow {
    return new BoxShadow({
      offset: patch.offset ?? this.offset,
      // `null` is a valid override (explicit "no color"), so do presence check
      color: 'color' in patch ? (patch.color ?? null) : this.color,
      opacity: patch.opacity ?? this.opacity,
      blurRadius: patch.blurRadius ?? this.blurRadius,
    });
  }

  toJSON(): BoxShadowJSON {
    return {
      offset: { dx: this.offset.dx, dy: this.offset.dy },
      color: this.color,
      opacity: this.opacity,
      blurRadius: this.blurRadius,
    };
  }

  static fromJSON(json: Partial<BoxShadowJSON> | null | undefined): BoxShadow {
    if (!json) return new BoxShadow();
    return new BoxShadow({
      offset: json.offset ? { dx: Number(json.offset.dx ?? 0), dy: Number(json.offset.dy ?? 0) } : { dx: 0, dy: 0 },
      color: json.color ?? null,
      opacity: json.opacity ?? 1,
      blurRadius: json.blurRadius ?? 0,
    });
  }

  static schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        offset: {
          type: 'object',
          properties: {
            dx: { type: 'integer' },
            dy: { type: 'integer' },
          },
          required: ['dx', 'dy'],
          additionalProperties: false,
        },
        color: { type: ['string', 'null'] },
        opacity: { type: 'number', minimum: 0, maximum: 1, default: 1 },
        blurRadius: { type: 'integer', minimum: 0, default: 0 },
      },
      additionalProperties: false,
    };
  }
}
