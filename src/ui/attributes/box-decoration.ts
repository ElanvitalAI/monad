// ── Presentation P2 · BoxDecoration ──
//
// Flutter's canonical "rendering style for a box" — color fill, border,
// rounded corners, drop shadow(s), padding, and shape. Matches the
// Flutter API closely: optional fields default to null (meaning "not
// specified") and only `shape` has an intrinsic default ('rectangle').
//
// Immutable · public constructor · copyWith / fromJSON derivation.
// Composes EdgeInsets · BorderSpec · BorderRadius · BoxShadow (each
// already defined in this folder).

import type { ColorToken } from '../../widgets/types.js';
import { EdgeInsets, type EdgeInsetsJSON } from './edge-insets.js';
import {
  BorderSpec,
  BorderRadius,
  type BorderSpecJSON,
  type BorderRadiusJSON,
} from './border.js';
import { BoxShadow, type BoxShadowJSON } from './box-shadow.js';

export type BoxShape = 'rectangle' | 'circle';

export interface BoxDecorationOptions {
  readonly color?: ColorToken | string | null;
  readonly border?: BorderSpec | null;
  readonly borderRadius?: BorderRadius | null;
  readonly boxShadow?: readonly BoxShadow[] | null;
  readonly padding?: EdgeInsets | null;
  readonly shape?: BoxShape;
}

export interface BoxDecorationJSON {
  readonly color: ColorToken | string | null;
  readonly border: BorderSpecJSON | null;
  readonly borderRadius: BorderRadiusJSON | null;
  readonly boxShadow: readonly BoxShadowJSON[] | null;
  readonly padding: EdgeInsetsJSON | null;
  readonly shape: BoxShape;
}

export class BoxDecoration {
  readonly color: ColorToken | string | null;
  readonly border: BorderSpec | null;
  readonly borderRadius: BorderRadius | null;
  readonly boxShadow: readonly BoxShadow[] | null;
  readonly padding: EdgeInsets | null;
  readonly shape: BoxShape;

  constructor(opts: BoxDecorationOptions = {}) {
    this.color = opts.color ?? null;
    this.border = opts.border ?? null;
    this.borderRadius = opts.borderRadius ?? null;
    this.boxShadow = opts.boxShadow ?? null;
    this.padding = opts.padding ?? null;
    // The only field with a non-null default — a rectangle is a
    // sensible baseline; `shape = 'circle'` is the opt-in surprise.
    this.shape = opts.shape ?? 'rectangle';
  }

  copyWith(patch: BoxDecorationOptions): BoxDecoration {
    const has = <K extends keyof BoxDecorationOptions>(key: K): boolean => key in patch;
    return new BoxDecoration({
      color: has('color') ? (patch.color ?? null) : this.color,
      border: has('border') ? (patch.border ?? null) : this.border,
      borderRadius: has('borderRadius') ? (patch.borderRadius ?? null) : this.borderRadius,
      boxShadow: has('boxShadow') ? (patch.boxShadow ?? null) : this.boxShadow,
      padding: has('padding') ? (patch.padding ?? null) : this.padding,
      shape: patch.shape ?? this.shape,
    });
  }

  toJSON(): BoxDecorationJSON {
    return {
      color: this.color,
      border: this.border ? this.border.toJSON() : null,
      borderRadius: this.borderRadius ? this.borderRadius.toJSON() : null,
      boxShadow: this.boxShadow ? this.boxShadow.map((s) => s.toJSON()) : null,
      padding: this.padding ? this.padding.toJSON() : null,
      shape: this.shape,
    };
  }

  static fromJSON(json: Partial<BoxDecorationJSON> | null | undefined): BoxDecoration {
    if (!json) return new BoxDecoration();
    return new BoxDecoration({
      color: json.color ?? null,
      border: json.border ? BorderSpec.fromJSON(json.border) : null,
      borderRadius: json.borderRadius ? BorderRadius.fromJSON(json.borderRadius) : null,
      boxShadow: json.boxShadow
        ? json.boxShadow.map((s) => BoxShadow.fromJSON(s))
        : null,
      padding: json.padding ? EdgeInsets.fromJSON(json.padding) : null,
      shape: json.shape ?? 'rectangle',
    });
  }

  static schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        color: { type: ['string', 'null'], default: null },
        border: { oneOf: [BorderSpec.schema(), { type: 'null' }], default: null },
        borderRadius: { oneOf: [BorderRadius.schema(), { type: 'null' }], default: null },
        boxShadow: {
          oneOf: [
            { type: 'array', items: BoxShadow.schema() },
            { type: 'null' },
          ],
          default: null,
        },
        padding: { oneOf: [EdgeInsets.schema(), { type: 'null' }], default: null },
        shape: { type: 'string', enum: ['rectangle', 'circle'], default: 'rectangle' },
      },
      additionalProperties: false,
    };
  }
}
