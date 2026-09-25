// ── Presentation P2 · TextStyle ──
//
// Zellij 4-tier emphasis + extended line decorations. All fields
// tri-state: `true` (on) · `false` (explicit off) · `null` (inherit).
// This matches Flutter `TextStyle` semantics: "not specified" (null)
// differs from "explicitly off" (false) for purposes of merge().
//
// `merge(child)` returns a new TextStyle where each non-null child
// field overrides the parent. Null fields inherit from the parent.
// Immutable · public constructor · copyWith / merge for derivation.

import type { ColorToken } from '../../widgets/types.js';

export interface TextStyleOptions {
  readonly color?: ColorToken | string | null;
  readonly bold?: boolean | null;
  readonly italic?: boolean | null;
  readonly underline?: boolean | null;
  readonly dim?: boolean | null;
  readonly reverse?: boolean | null;
  readonly strikethrough?: boolean | null;
  readonly doubleUnderline?: boolean | null;
  readonly curlyUnderline?: boolean | null;
  readonly overline?: boolean | null;
}

export interface TextStyleJSON {
  readonly color: string | null;
  readonly bold: boolean | null;
  readonly italic: boolean | null;
  readonly underline: boolean | null;
  readonly dim: boolean | null;
  readonly reverse: boolean | null;
  readonly strikethrough: boolean | null;
  readonly doubleUnderline: boolean | null;
  readonly curlyUnderline: boolean | null;
  readonly overline: boolean | null;
}

const TEXT_STYLE_KEYS: readonly (keyof TextStyleOptions)[] = [
  'color',
  'bold',
  'italic',
  'underline',
  'dim',
  'reverse',
  'strikethrough',
  'doubleUnderline',
  'curlyUnderline',
  'overline',
];

export class TextStyle {
  readonly color: ColorToken | string | null;
  readonly bold: boolean | null;
  readonly italic: boolean | null;
  readonly underline: boolean | null;
  readonly dim: boolean | null;
  readonly reverse: boolean | null;
  readonly strikethrough: boolean | null;
  readonly doubleUnderline: boolean | null;
  readonly curlyUnderline: boolean | null;
  readonly overline: boolean | null;

  constructor(opts: TextStyleOptions = {}) {
    this.color = opts.color ?? null;
    this.bold = opts.bold ?? null;
    this.italic = opts.italic ?? null;
    this.underline = opts.underline ?? null;
    this.dim = opts.dim ?? null;
    this.reverse = opts.reverse ?? null;
    this.strikethrough = opts.strikethrough ?? null;
    this.doubleUnderline = opts.doubleUnderline ?? null;
    this.curlyUnderline = opts.curlyUnderline ?? null;
    this.overline = opts.overline ?? null;
  }

  copyWith(patch: TextStyleOptions): TextStyle {
    const resolve = <K extends keyof TextStyleOptions>(
      key: K,
    ): TextStyleOptions[K] => (key in patch ? (patch[key] ?? null) : this[key]);
    return new TextStyle({
      color: resolve('color'),
      bold: resolve('bold'),
      italic: resolve('italic'),
      underline: resolve('underline'),
      dim: resolve('dim'),
      reverse: resolve('reverse'),
      strikethrough: resolve('strikethrough'),
      doubleUnderline: resolve('doubleUnderline'),
      curlyUnderline: resolve('curlyUnderline'),
      overline: resolve('overline'),
    });
  }

  /** Merge this style as the *parent*, with `child` overriding.
   *  Each child field that is non-null wins; null fields defer to this.
   *  Returns a new instance — no side effects. */
  merge(child: TextStyle | null | undefined): TextStyle {
    if (!child) return this;
    const pick = <K extends keyof TextStyleOptions>(key: K): TextStyleOptions[K] => {
      const childVal = child[key];
      return (childVal === null || childVal === undefined) ? this[key] : childVal;
    };
    return new TextStyle({
      color: pick('color'),
      bold: pick('bold'),
      italic: pick('italic'),
      underline: pick('underline'),
      dim: pick('dim'),
      reverse: pick('reverse'),
      strikethrough: pick('strikethrough'),
      doubleUnderline: pick('doubleUnderline'),
      curlyUnderline: pick('curlyUnderline'),
      overline: pick('overline'),
    });
  }

  toJSON(): TextStyleJSON {
    return {
      color: this.color,
      bold: this.bold,
      italic: this.italic,
      underline: this.underline,
      dim: this.dim,
      reverse: this.reverse,
      strikethrough: this.strikethrough,
      doubleUnderline: this.doubleUnderline,
      curlyUnderline: this.curlyUnderline,
      overline: this.overline,
    };
  }

  static fromJSON(json: Partial<TextStyleJSON> | null | undefined): TextStyle {
    if (!json) return new TextStyle();
    const opts: TextStyleOptions = {};
    for (const k of TEXT_STYLE_KEYS) {
      if (k in json) {
        (opts as Record<string, unknown>)[k] = (json as Record<string, unknown>)[k] ?? null;
      }
    }
    return new TextStyle(opts);
  }

  static schema(): Record<string, unknown> {
    const boolNullable = { type: ['boolean', 'null'], default: null };
    return {
      type: 'object',
      properties: {
        color: { type: ['string', 'null'], default: null },
        bold: boolNullable,
        italic: boolNullable,
        underline: boolNullable,
        dim: boolNullable,
        reverse: boolNullable,
        strikethrough: boolNullable,
        doubleUnderline: boolNullable,
        curlyUnderline: boolNullable,
        overline: boolNullable,
      },
      additionalProperties: false,
    };
  }
}
