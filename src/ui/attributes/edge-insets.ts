// ── Presentation P2 · EdgeInsets ──
//
// Flutter-style spacing primitive in character-cell units (integers).
// Factory-constructed only — private constructor guards invariants
// (non-negative, integer). `copyWith` is the only way to derive new
// instances. Serializes to `{top, right, bottom, left}`.

export interface EdgeInsetsJSON {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

const ZERO_SENTINEL: EdgeInsetsJSON = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Normalize a possibly-fractional input into a non-negative integer.
 *  TUI coordinates are character cells; we refuse fractions loudly
 *  (round) rather than silently producing sub-cell offsets. */
function normalizeUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n);
  return r < 0 ? 0 : r;
}

/** TUI edge spacing · 모든 field readonly · factory 전용 생성. */
export class EdgeInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;

  private constructor(top: number, right: number, bottom: number, left: number) {
    this.top = normalizeUnit(top);
    this.right = normalizeUnit(right);
    this.bottom = normalizeUnit(bottom);
    this.left = normalizeUnit(left);
  }

  /** 모든 변이 동일. */
  static all(value: number): EdgeInsets {
    return new EdgeInsets(value, value, value, value);
  }

  /** 수평/수직 대칭. Omitted side → 0. */
  static symmetric(opts: { horizontal?: number; vertical?: number }): EdgeInsets {
    const h = opts.horizontal ?? 0;
    const v = opts.vertical ?? 0;
    return new EdgeInsets(v, h, v, h);
  }

  /** 개별 변 지정 · omitted → 0. */
  static only(opts: { top?: number; right?: number; bottom?: number; left?: number }): EdgeInsets {
    return new EdgeInsets(opts.top ?? 0, opts.right ?? 0, opts.bottom ?? 0, opts.left ?? 0);
  }

  /** All-zero sentinel · same instance reused (OK — immutable). */
  static readonly zero: EdgeInsets = new EdgeInsets(0, 0, 0, 0);

  copyWith(patch: { top?: number; right?: number; bottom?: number; left?: number }): EdgeInsets {
    return new EdgeInsets(
      patch.top ?? this.top,
      patch.right ?? this.right,
      patch.bottom ?? this.bottom,
      patch.left ?? this.left,
    );
  }

  /** Total horizontal padding (left + right). */
  get horizontal(): number { return this.left + this.right; }

  /** Total vertical padding (top + bottom). */
  get vertical(): number { return this.top + this.bottom; }

  toJSON(): EdgeInsetsJSON {
    return { top: this.top, right: this.right, bottom: this.bottom, left: this.left };
  }

  static fromJSON(json: Partial<EdgeInsetsJSON> | null | undefined): EdgeInsets {
    if (!json) return EdgeInsets.zero;
    return EdgeInsets.only({
      top: Number(json.top ?? 0),
      right: Number(json.right ?? 0),
      bottom: Number(json.bottom ?? 0),
      left: Number(json.left ?? 0),
    });
  }

  static schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        top: { type: 'integer', minimum: 0, default: 0 },
        right: { type: 'integer', minimum: 0, default: 0 },
        bottom: { type: 'integer', minimum: 0, default: 0 },
        left: { type: 'integer', minimum: 0, default: 0 },
      },
      additionalProperties: false,
    };
  }
}

export { ZERO_SENTINEL as EDGE_INSETS_ZERO_JSON };
