// ── Presentation P2 · Border primitives ──
//
// BorderRadius: per-corner radii (integer cells).
// BorderSpec: per-side border definition (style/color/width).
// Both follow Flutter naming conventions. Private constructors force
// factory use; `copyWith` returns new instances (all fields readonly).

import type { ColorToken } from '../../widgets/types.js';

// ── BorderRadius ────────────────────────────────────────────────

export interface BorderRadiusJSON {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomLeft: number;
  readonly bottomRight: number;
}

function normalizeRadius(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  return r < 0 ? 0 : r;
}

export class BorderRadius {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomLeft: number;
  readonly bottomRight: number;

  private constructor(tl: number, tr: number, bl: number, br: number) {
    this.topLeft = normalizeRadius(tl);
    this.topRight = normalizeRadius(tr);
    this.bottomLeft = normalizeRadius(bl);
    this.bottomRight = normalizeRadius(br);
  }

  /** Same radius on all 4 corners. */
  static circular(radius: number): BorderRadius {
    return new BorderRadius(radius, radius, radius, radius);
  }

  /** Per-corner · omitted → 0. */
  static only(opts: {
    topLeft?: number;
    topRight?: number;
    bottomLeft?: number;
    bottomRight?: number;
  }): BorderRadius {
    return new BorderRadius(
      opts.topLeft ?? 0,
      opts.topRight ?? 0,
      opts.bottomLeft ?? 0,
      opts.bottomRight ?? 0,
    );
  }

  static readonly zero: BorderRadius = new BorderRadius(0, 0, 0, 0);

  copyWith(patch: {
    topLeft?: number;
    topRight?: number;
    bottomLeft?: number;
    bottomRight?: number;
  }): BorderRadius {
    return new BorderRadius(
      patch.topLeft ?? this.topLeft,
      patch.topRight ?? this.topRight,
      patch.bottomLeft ?? this.bottomLeft,
      patch.bottomRight ?? this.bottomRight,
    );
  }

  toJSON(): BorderRadiusJSON {
    return {
      topLeft: this.topLeft,
      topRight: this.topRight,
      bottomLeft: this.bottomLeft,
      bottomRight: this.bottomRight,
    };
  }

  static fromJSON(json: Partial<BorderRadiusJSON> | null | undefined): BorderRadius {
    if (!json) return BorderRadius.zero;
    return BorderRadius.only({
      topLeft: Number(json.topLeft ?? 0),
      topRight: Number(json.topRight ?? 0),
      bottomLeft: Number(json.bottomLeft ?? 0),
      bottomRight: Number(json.bottomRight ?? 0),
    });
  }

  static schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        topLeft: { type: 'integer', minimum: 0, default: 0 },
        topRight: { type: 'integer', minimum: 0, default: 0 },
        bottomLeft: { type: 'integer', minimum: 0, default: 0 },
        bottomRight: { type: 'integer', minimum: 0, default: 0 },
      },
      additionalProperties: false,
    };
  }
}

// ── BorderSpec ──────────────────────────────────────────────────

export type BorderStyle = 'solid' | 'dashed' | 'double' | 'none';

/** Per-side border · `style = 'none'` is distinct from `null` (explicit
 *  absence vs "same as default"). All fields readonly. */
export interface BorderSide {
  readonly color: ColorToken | string | null;
  readonly width: number;
  readonly style: BorderStyle;
}

const NULL_SIDE: BorderSide = Object.freeze({ color: null, width: 0, style: 'none' });

function makeSide(opts?: Partial<BorderSide> | null): BorderSide {
  if (!opts) return NULL_SIDE;
  const width = Number.isFinite(opts.width) ? Math.max(0, Math.round(opts.width as number)) : 1;
  return {
    color: opts.color ?? null,
    width,
    style: opts.style ?? 'solid',
  };
}

export interface BorderSpecJSON {
  readonly top: BorderSide | null;
  readonly right: BorderSide | null;
  readonly bottom: BorderSide | null;
  readonly left: BorderSide | null;
}

export class BorderSpec {
  readonly top: BorderSide | null;
  readonly right: BorderSide | null;
  readonly bottom: BorderSide | null;
  readonly left: BorderSide | null;

  private constructor(
    top: BorderSide | null,
    right: BorderSide | null,
    bottom: BorderSide | null,
    left: BorderSide | null,
  ) {
    this.top = top;
    this.right = right;
    this.bottom = bottom;
    this.left = left;
  }

  /** 4면 모두 동일 side. */
  static all(side: Partial<BorderSide>): BorderSpec {
    const s = makeSide(side);
    return new BorderSpec(s, s, s, s);
  }

  /** 수평/수직 대칭. */
  static symmetric(opts: {
    horizontal?: Partial<BorderSide>;
    vertical?: Partial<BorderSide>;
  }): BorderSpec {
    const h = opts.horizontal ? makeSide(opts.horizontal) : null;
    const v = opts.vertical ? makeSide(opts.vertical) : null;
    return new BorderSpec(v, h, v, h);
  }

  /** 개별 면 · omitted → null (no border). */
  static only(opts: {
    top?: Partial<BorderSide>;
    right?: Partial<BorderSide>;
    bottom?: Partial<BorderSide>;
    left?: Partial<BorderSide>;
  }): BorderSpec {
    return new BorderSpec(
      opts.top ? makeSide(opts.top) : null,
      opts.right ? makeSide(opts.right) : null,
      opts.bottom ? makeSide(opts.bottom) : null,
      opts.left ? makeSide(opts.left) : null,
    );
  }

  copyWith(patch: {
    top?: Partial<BorderSide> | null;
    right?: Partial<BorderSide> | null;
    bottom?: Partial<BorderSide> | null;
    left?: Partial<BorderSide> | null;
  }): BorderSpec {
    const resolve = (
      key: 'top' | 'right' | 'bottom' | 'left',
    ): BorderSide | null => {
      if (!(key in patch)) return this[key];
      const v = patch[key];
      if (v === null) return null;
      return makeSide({ ...(this[key] ?? {}), ...v });
    };
    return new BorderSpec(resolve('top'), resolve('right'), resolve('bottom'), resolve('left'));
  }

  toJSON(): BorderSpecJSON {
    return { top: this.top, right: this.right, bottom: this.bottom, left: this.left };
  }

  static fromJSON(json: Partial<BorderSpecJSON> | null | undefined): BorderSpec {
    if (!json) return BorderSpec.only({});
    return BorderSpec.only({
      ...(json.top ? { top: json.top } : {}),
      ...(json.right ? { right: json.right } : {}),
      ...(json.bottom ? { bottom: json.bottom } : {}),
      ...(json.left ? { left: json.left } : {}),
    });
  }

  static schema(): Record<string, unknown> {
    const sideSchema = {
      type: ['object', 'null'],
      properties: {
        color: { type: ['string', 'null'] },
        width: { type: 'integer', minimum: 0 },
        style: { type: 'string', enum: ['solid', 'dashed', 'double', 'none'] },
      },
      additionalProperties: false,
    };
    return {
      type: 'object',
      properties: {
        top: sideSchema,
        right: sideSchema,
        bottom: sideSchema,
        left: sideSchema,
      },
      additionalProperties: false,
    };
  }
}
