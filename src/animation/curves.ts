// ── Animation curves — Flutter-inspired easing functions ──
//
// Phase 4b (2026-04-20) — pure math, no frame scheduling. Each curve is
// a `(t: number) => number` where `t ∈ [0, 1]` is linear progress and
// the return is the eased progress (`∈ [0, 1]` for most curves — some
// bounce curves overshoot).
//
// Curves are compositional: a widget asks the AnimationController for
// the raw progress, picks a curve, and uses the result to interpolate
// between start and end values (color, scroll offset, opacity, etc.).

/** A curve transforms linear time → eased progress. Input is clamped
 *  to [0, 1]; output is typically in [0, 1] but bounce/back curves may
 *  overshoot. */
export type Curve = (t: number) => number;

/** Identity — no easing. Progress is linear. */
export const linear: Curve = (t) => clamp01(t);

/** Ease-in (slow start, accelerating). Quadratic. */
export const easeIn: Curve = (t) => {
  const x = clamp01(t);
  return x * x;
};

/** Ease-out (fast start, decelerating). Quadratic. */
export const easeOut: Curve = (t) => {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
};

/** Ease-in-out (slow start, fast middle, slow end). Cubic. */
export const easeInOut: Curve = (t) => {
  const x = clamp01(t);
  return x < 0.5
    ? 4 * x * x * x
    : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Sine-based ease (smoother than quadratic for organic motion). */
export const easeInOutSine: Curve = (t) => {
  const x = clamp01(t);
  return -(Math.cos(Math.PI * x) - 1) / 2;
};

/** Bounce-out — playful decel with 3 bounces at the tail. */
export const bounceOut: Curve = (t) => {
  const x = clamp01(t);
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) {
    const tt = x - 1.5 / d1;
    return n1 * tt * tt + 0.75;
  }
  if (x < 2.5 / d1) {
    const tt = x - 2.25 / d1;
    return n1 * tt * tt + 0.9375;
  }
  const tt = x - 2.625 / d1;
  return n1 * tt * tt + 0.984375;
};

/** Elastic-out — spring overshoot. Can exceed 1.0 briefly. */
export const elasticOut: Curve = (t) => {
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
};

/** Back-out — slight overshoot at 1.0 before settling. */
export const backOut: Curve = (t) => {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Step-start — jumps to 1 at t > 0. Useful for discrete transitions. */
export const stepStart: Curve = (t) => (t > 0 ? 1 : 0);

/** Step-end — stays at 0 until t = 1. */
export const stepEnd: Curve = (t) => (t >= 1 ? 1 : 0);

/** Named registry — look up by name for declarative animation configs. */
export const CURVES: Readonly<Record<string, Curve>> = Object.freeze({
  linear,
  easeIn,
  easeOut,
  easeInOut,
  easeInOutSine,
  bounceOut,
  elasticOut,
  backOut,
  stepStart,
  stepEnd,
});

export type CurveName = keyof typeof CURVES;

/** Look up a named curve; unknown names return `linear`. */
export function resolveCurve(name: string | Curve | undefined): Curve {
  if (typeof name === 'function') return name;
  if (!name) return linear;
  return (CURVES as Record<string, Curve>)[name] ?? linear;
}

function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}
