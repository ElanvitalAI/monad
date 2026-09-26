export const DEFAULT_ANNOTATION_COLOR = '#ff4d4f';
export const DEFAULT_ANNOTATION_STROKE_WIDTH = 2;

export interface Point {
  x: number;
  y: number;
}

export interface ShapeStyle {
  color?: string;
  strokeWidth?: number;
  dashed?: boolean;
}

export interface PolylineShape extends ShapeStyle {
  kind: 'polyline';
  points: Point[];
}

export interface LineShape extends ShapeStyle {
  kind: 'line';
  from: Point;
  to: Point;
}

export interface ArrowShape extends ShapeStyle {
  kind: 'arrow';
  from: Point;
  to: Point;
}

export interface LabelShape extends ShapeStyle {
  kind: 'label';
  at: Point;
  text: string;
}

export interface BoxShape extends ShapeStyle {
  kind: 'box';
  from: Point;
  to: Point;
  fill?: string;
}

export type AnnotationShape = PolylineShape | LineShape | ArrowShape | LabelShape | BoxShape;

export type ShapeResult =
  | { ok: true; svg: string }
  | { ok: false; reason: string };

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function polylineBounds(points: Point[]): Bounds | null {
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function renderShape(shape: AnnotationShape): ShapeResult {
  if (shape.kind === 'polyline' && (shape.points.length < 2 || shape.points.length > 24)) {
    return { ok: false, reason: `polyline requires 2 to 24 points; received ${shape.points.length}` };
  }

  const style = strokeStyle(shape);
  switch (shape.kind) {
    case 'polyline':
      return { ok: true, svg: `<polyline points="${shape.points.map(pointText).join(' ')}" ${style} fill="none"/>` };
    case 'line':
      return { ok: true, svg: `<line x1="${shape.from.x}" y1="${shape.from.y}" x2="${shape.to.x}" y2="${shape.to.y}" ${style}/>` };
    case 'arrow':
      return { ok: true, svg: `<line x1="${shape.from.x}" y1="${shape.from.y}" x2="${shape.to.x}" y2="${shape.to.y}" ${style} marker-end="url(#elanous-annot-arrow)"/>` };
    case 'label':
      return { ok: true, svg: `<text x="${shape.at.x}" y="${shape.at.y}" fill="${escapeAttr(shape.color ?? DEFAULT_ANNOTATION_COLOR)}"${shape.dashed ? ' data-dashed="true"' : ''}>${escapeText(shape.text)}</text>` };
    case 'box': {
      const left = Math.min(shape.from.x, shape.to.x);
      const top = Math.min(shape.from.y, shape.to.y);
      const width = Math.abs(shape.to.x - shape.from.x);
      const height = Math.abs(shape.to.y - shape.from.y);
      return { ok: true, svg: `<rect x="${left}" y="${top}" width="${width}" height="${height}" ${style} fill="${escapeAttr(shape.fill ?? 'none')}"/>` };
    }
  }
}

function strokeStyle(style: ShapeStyle): string {
  const dash = style.dashed ? ' stroke-dasharray="6 4"' : '';
  return `stroke="${escapeAttr(style.color ?? DEFAULT_ANNOTATION_COLOR)}" stroke-width="${style.strokeWidth ?? DEFAULT_ANNOTATION_STROKE_WIDTH}"${dash}`;
}

function pointText(point: Point): string {
  return `${point.x},${point.y}`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** SVG namespace — ⛔ 이것이 없으면 조각이 «HTML 요소»로 파싱돼 크기가 0 이 된다. */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** 화살촉 marker 의 id — `renderShape` 의 `marker-end` 가 이 이름을 참조한다. */
export const ARROW_MARKER_ID = 'elanous-annot-arrow';

/**
 * 🩸⭐⭐ **조각들을 «루트 `<svg>`»로 감싼다** — 2026-09-01 · 42차 · ***라이브 반증에서 나왔다***.
 *
 * ⛔ `renderShape` 는 «조각»(`<polyline …/>`)만 낸다. 그것을 그대로 페이지에 붙이면:
 * ```
 * tag  POLYLINE
 * ns   http://www.w3.org/1999/xhtml   ⇐ SVG 네임스페이스가 «아니다»
 * rect 0 × 0                          ⇐ ***아무것도 안 보인다***
 * ```
 * 📏 실측(예비 봇 9404 · Yahoo Finance): `drew:true` 인데 `rect 0×0` 이었다.
 *    ⇒ 🔑 ***「그렸다」와 「보인다」는 다른 값이다.*** 순수 시험 여섯이 «전부 초록»이었는데도 그랬다 —
 *      그 시험들은 «문자열»만 봤기 때문이다.
 * 🔑 그리고 루트가 있어야 HTML 파서가 그 안을 ***foreign content***(SVG)로 읽는다.
 *    조각만 넣으면 네임스페이스가 안 붙는다.
 *
 * ⛔ 화살촉은 `<marker>` 정의가 «없으면» 안 그려진다 — `marker-end` 가 참조만 하기 때문이다.
 *    ⇒ arrow 가 하나라도 있으면 `<defs>` 를 «같이» 낸다.
 */
export function renderAnnotationSvg(shapes: readonly AnnotationShape[]): ShapeResult {
  if (shapes.length === 0) return { ok: false, reason: 'no shapes to render' };
  const parts: string[] = [];
  for (const shape of shapes) {
    const piece = renderShape(shape);
    // ⛔ 하나라도 거절되면 «전부» 거절한다 — 반쪽 그림은 「보인다」보다 나쁘다(사람이 믿는다).
    if (!piece.ok) return piece;
    parts.push(piece.svg);
  }
  const needsArrow = shapes.some((shape) => shape.kind === 'arrow');
  const defs = needsArrow
    ? `<defs><marker id="${ARROW_MARKER_ID}" viewBox="0 0 10 10" refX="9" refY="5"`
      + ` markerWidth="6" markerHeight="6" orient="auto-start-reverse">`
      + `<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>`
    : '';
  // ⛔ 뷰포트를 «가득» 채운다 — 좌표가 페이지 픽셀이므로 루트가 작으면 잘린다.
  // ⛔ `pointer-events:none` — 사람이 그 페이지를 계속 쓸 수 있어야 한다(우리 봇도 누른다).
  const style = 'position:fixed;left:0;top:0;width:100vw;height:100vh;'
    + 'z-index:2147483647;pointer-events:none';
  return {
    ok: true,
    svg: `<svg xmlns="${SVG_NAMESPACE}" style="${style}">${defs}${parts.join('')}</svg>`,
  };
}
