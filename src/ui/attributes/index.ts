// ── Presentation P2 · Attribute objects · public barrel ──
//
// Flutter-style immutable attribute primitives. "Simple API with
// sensible defaults, deep custom via copyWith." Each class exports its
// runtime shape + a JSON companion type for serialization (P3
// declarative schema pipeline).

export { EdgeInsets, type EdgeInsetsJSON } from './edge-insets.js';
export {
  BorderSpec,
  BorderRadius,
  type BorderSide,
  type BorderStyle,
  type BorderSpecJSON,
  type BorderRadiusJSON,
} from './border.js';
export {
  BoxShadow,
  type ShadowOffset,
  type BoxShadowOptions,
  type BoxShadowJSON,
} from './box-shadow.js';
export {
  TextStyle,
  type TextStyleOptions,
  type TextStyleJSON,
} from './text-style.js';
export {
  BoxDecoration,
  type BoxShape,
  type BoxDecorationOptions,
  type BoxDecorationJSON,
} from './box-decoration.js';
