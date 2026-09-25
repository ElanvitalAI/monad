// LC11 — Layout DSL parser.
//
// AppCUI-rs-style compact syntax for declaring where a widget
// should sit inside its parent region. Two forms are recognized:
//
//   "fill"
//     → dock fill (take the whole parent)
//
//   "k:v,k:v,..."
//     → comma-separated key/value pairs.
//        x,y    = absolute or percent position (anchor point)
//        w,h    = absolute or percent size
//        p      = pivot (tl|tc|tr|cl|cc|cr|bl|bc|br)
//        t,r,b,l= edge anchors (inset from parent edges)
//
// Examples:
//   "x:8,y:5,w:33%,h:6,p:tl"
//   "x:25%,y:30%,w:50%,h:40%,p:cc"
//   "t:2,r:4,w:40,h:10"
//
// `parseLayout` returns a structured LayoutSpec; `resolveLayout`
// materializes it into an actual (x, y, width, height) rectangle
// given the parent dimensions. The two steps are split so widgets
// can cache the parse and resolve on every paint.

export type Pivot =
  | 'tl' | 'tc' | 'tr'
  | 'cl' | 'cc' | 'cr'
  | 'bl' | 'bc' | 'br';

export type LengthSpec =
  | { kind: 'abs'; value: number }
  | { kind: 'pct'; value: number };

export interface LayoutSpec {
  fill?: boolean;
  x?: LengthSpec;
  y?: LengthSpec;
  w?: LengthSpec;
  h?: LengthSpec;
  pivot?: Pivot;
  anchor?: {
    t?: LengthSpec;
    r?: LengthSpec;
    b?: LengthSpec;
    l?: LengthSpec;
  };
}

export interface LayoutError extends Error { input: string; token?: string }

export function parseLayout(input: string): LayoutSpec {
  const trimmed = input.trim();
  if (!trimmed) return {};
  if (trimmed === 'fill') return { fill: true };

  const spec: LayoutSpec = {};
  const anchor: NonNullable<LayoutSpec['anchor']> = {};
  let hasAnchor = false;

  for (const rawPair of trimmed.split(',')) {
    const pair = rawPair.trim();
    if (!pair) continue;
    const colon = pair.indexOf(':');
    if (colon < 0) throw makeErr(input, pair, 'missing ":"');
    const k = pair.slice(0, colon).trim().toLowerCase();
    const v = pair.slice(colon + 1).trim();
    if (!v) throw makeErr(input, pair, 'empty value');

    switch (k) {
      case 'x': spec.x = parseLength(v, input, pair); break;
      case 'y': spec.y = parseLength(v, input, pair); break;
      case 'w': spec.w = parseLength(v, input, pair); break;
      case 'h': spec.h = parseLength(v, input, pair); break;
      case 'p': spec.pivot = parsePivot(v, input, pair); break;
      case 't': anchor.t = parseLength(v, input, pair); hasAnchor = true; break;
      case 'r': anchor.r = parseLength(v, input, pair); hasAnchor = true; break;
      case 'b': anchor.b = parseLength(v, input, pair); hasAnchor = true; break;
      case 'l': anchor.l = parseLength(v, input, pair); hasAnchor = true; break;
      default: throw makeErr(input, pair, `unknown key "${k}"`);
    }
  }

  if (hasAnchor) spec.anchor = anchor;
  return spec;
}

function parseLength(raw: string, input: string, token: string): LengthSpec {
  if (raw.endsWith('%')) {
    const n = Number(raw.slice(0, -1));
    if (!Number.isFinite(n)) throw makeErr(input, token, `invalid percent "${raw}"`);
    return { kind: 'pct', value: n };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw makeErr(input, token, `invalid number "${raw}"`);
  return { kind: 'abs', value: n };
}

function parsePivot(raw: string, input: string, token: string): Pivot {
  const v = raw.toLowerCase() as Pivot;
  const valid: Pivot[] = ['tl','tc','tr','cl','cc','cr','bl','bc','br'];
  if (!valid.includes(v)) throw makeErr(input, token, `invalid pivot "${raw}"`);
  return v;
}

function makeErr(input: string, token: string, msg: string): LayoutError {
  const e = new Error(`layout DSL: ${msg} (in "${input}")`) as LayoutError;
  e.input = input;
  e.token = token;
  return e;
}

// ── resolution ─────────────────────────────────────────────────

export interface Rect { x: number; y: number; width: number; height: number; }

function resolve(val: LengthSpec | undefined, base: number): number | null {
  if (!val) return null;
  if (val.kind === 'abs') return val.value;
  return Math.round((val.value / 100) * base);
}

function pivotOffsets(pivot: Pivot): { dx: number; dy: number } {
  const hx = pivot[1];
  const vy = pivot[0];
  let dx = 0, dy = 0;
  if (hx === 'l') dx = 0;
  else if (hx === 'c') dx = 0.5;
  else if (hx === 'r') dx = 1;
  if (vy === 't') dy = 0;
  else if (vy === 'c') dy = 0.5;
  else if (vy === 'b') dy = 1;
  return { dx, dy };
}

/** Compute the final rectangle inside a `parent` region. */
export function resolveLayout(spec: LayoutSpec, parent: { width: number; height: number }): Rect {
  if (spec.fill) {
    return { x: 0, y: 0, width: parent.width, height: parent.height };
  }

  // Anchor form takes priority when present.
  if (spec.anchor) {
    const { t, r, b, l } = spec.anchor;
    const lv = resolve(l, parent.width);
    const rv = resolve(r, parent.width);
    const tv = resolve(t, parent.height);
    const bv = resolve(b, parent.height);
    const wv = resolve(spec.w, parent.width);
    const hv = resolve(spec.h, parent.height);

    let x = 0, width = parent.width;
    if (lv !== null && rv !== null) {
      x = lv;
      width = Math.max(0, parent.width - lv - rv);
    } else if (lv !== null && wv !== null) {
      x = lv;
      width = wv;
    } else if (rv !== null && wv !== null) {
      width = wv;
      x = Math.max(0, parent.width - rv - wv);
    } else if (lv !== null) {
      x = lv;
      width = Math.max(0, parent.width - lv);
    } else if (rv !== null) {
      width = Math.max(0, parent.width - rv);
    } else if (wv !== null) {
      width = wv;
    }

    let y = 0, height = parent.height;
    if (tv !== null && bv !== null) {
      y = tv;
      height = Math.max(0, parent.height - tv - bv);
    } else if (tv !== null && hv !== null) {
      y = tv;
      height = hv;
    } else if (bv !== null && hv !== null) {
      height = hv;
      y = Math.max(0, parent.height - bv - hv);
    } else if (tv !== null) {
      y = tv;
      height = Math.max(0, parent.height - tv);
    } else if (bv !== null) {
      height = Math.max(0, parent.height - bv);
    } else if (hv !== null) {
      height = hv;
    }

    return clampToParent({ x, y, width, height }, parent);
  }

  // Positioned form: x/y resolve as the pivot point, w/h as the size.
  const width = Math.max(0, resolve(spec.w, parent.width) ?? parent.width);
  const height = Math.max(0, resolve(spec.h, parent.height) ?? parent.height);
  const px = resolve(spec.x, parent.width) ?? 0;
  const py = resolve(spec.y, parent.height) ?? 0;
  const { dx, dy } = pivotOffsets(spec.pivot ?? 'tl');
  const x = Math.round(px - width * dx);
  const y = Math.round(py - height * dy);
  return clampToParent({ x, y, width, height }, parent);
}

function clampToParent(r: Rect, parent: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.min(parent.width,  r.x));
  const y = Math.max(0, Math.min(parent.height, r.y));
  const width = Math.max(0, Math.min(parent.width - x,  r.width));
  const height = Math.max(0, Math.min(parent.height - y, r.height));
  return { x, y, width, height };
}
