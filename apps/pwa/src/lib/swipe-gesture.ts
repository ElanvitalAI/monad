/**
 * Pointer event 기반 좌우 swipe 인식기.
 *
 * touch event 비호환 디바이스 (iPad pencil · 일부 안드로이드) 대응
 * 위해 pointer event 만 사용. 임계값:
 *  - 가로 ≥ 100px (의도적 swipe)
 *  - velocity ≥ 0.3 px/ms (천천히 끄는 건 무시)
 *  - 세로 변위 < 가로 변위 (수직 스크롤 아님)
 *
 * onSwipe 가 'left' / 'right' 받음. left = 다음 탭 · right = 이전 탭
 * (브라우저 컨벤션과 동일).
 */

export interface SwipeOpts {
  minDistance?: number;
  minVelocity?: number; // px / ms
  onSwipe: (direction: 'left' | 'right') => void;
  /** swipe 무시 조건 — input/textarea 안의 제스처는 텍스트 선택과 충돌. */
  shouldIgnore?: (target: EventTarget | null) => boolean;
}

const DEFAULT_MIN_DIST = 100;
const DEFAULT_MIN_VEL = 0.3;

export function attachSwipe(
  el: HTMLElement,
  opts: SwipeOpts,
): () => void {
  const minDist = opts.minDistance ?? DEFAULT_MIN_DIST;
  const minVel = opts.minVelocity ?? DEFAULT_MIN_VEL;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  let active = false;
  let pointerId: number | null = null;

  const onDown = (e: PointerEvent): void => {
    if (opts.shouldIgnore?.(e.target)) return;
    startX = e.clientX;
    startY = e.clientY;
    startT = e.timeStamp;
    active = true;
    pointerId = e.pointerId;
  };

  const onUp = (e: PointerEvent): void => {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    pointerId = null;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dt = Math.max(1, e.timeStamp - startT);
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const v = absDx / dt;
    if (absDx < minDist) return;
    if (absDy >= absDx) return; // 수직 우선
    if (v < minVel) return;
    opts.onSwipe(dx < 0 ? 'left' : 'right');
  };

  const onCancel = (): void => {
    active = false;
    pointerId = null;
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}

/** Pure helper — 임계값 검사. swipe-gesture 자체는 DOM-bound 라
 *  단위 테스트가 어렵지만 이 helper 는 검증 가능. */
export function classifySwipe(args: {
  dx: number;
  dy: number;
  dt: number;
  minDistance?: number;
  minVelocity?: number;
}): 'left' | 'right' | null {
  const minDist = args.minDistance ?? DEFAULT_MIN_DIST;
  const minVel = args.minVelocity ?? DEFAULT_MIN_VEL;
  const absDx = Math.abs(args.dx);
  const absDy = Math.abs(args.dy);
  const dt = Math.max(1, args.dt);
  const v = absDx / dt;
  if (absDx < minDist) return null;
  if (absDy >= absDx) return null;
  if (v < minVel) return null;
  return args.dx < 0 ? 'left' : 'right';
}

/** R5 Session card swipe — 4-direction classification. The card deck
 *  uses left/right/up/down for distinct decisions (reject / approve /
 *  pause / expand) so the gesture must distinguish the dominant axis
 *  AND its sign. Callers that only want left/right keep using
 *  `classifySwipe` above; this is the additive 4-axis variant. */
export type SwipeDirection4 = 'left' | 'right' | 'up' | 'down';

export function classifySwipe4(args: {
  dx: number;
  dy: number;
  dt: number;
  minDistance?: number;
  minVelocity?: number;
}): SwipeDirection4 | null {
  const minDist = args.minDistance ?? DEFAULT_MIN_DIST;
  const minVel = args.minVelocity ?? DEFAULT_MIN_VEL;
  const absDx = Math.abs(args.dx);
  const absDy = Math.abs(args.dy);
  const dt = Math.max(1, args.dt);
  // Velocity is measured along the dominant axis.
  const dominantDist = Math.max(absDx, absDy);
  const v = dominantDist / dt;
  if (dominantDist < minDist) return null;
  if (v < minVel) return null;
  // Tie-break biased to horizontal — typical thumb arc on phones is
  // wider laterally than vertically; ambiguous swipes default to
  // left/right which the reject/approve actions own.
  if (absDx >= absDy) return args.dx < 0 ? 'left' : 'right';
  return args.dy < 0 ? 'up' : 'down';
}

export interface Swipe4Opts {
  minDistance?: number;
  minVelocity?: number;
  onSwipe: (direction: SwipeDirection4) => void;
  shouldIgnore?: (target: EventTarget | null) => boolean;
}

/** R5 — DOM-bound 4-direction listener. Mirrors `attachSwipe` but
 *  forwards the result of `classifySwipe4`. Single instance per card
 *  deck; the deck swaps the active card without re-attaching. */
export function attachSwipe4(el: HTMLElement, opts: Swipe4Opts): () => void {
  let startX = 0, startY = 0, startT = 0;
  let active = false;
  let pointerId: number | null = null;

  const onDown = (e: PointerEvent): void => {
    if (opts.shouldIgnore?.(e.target)) return;
    startX = e.clientX;
    startY = e.clientY;
    startT = e.timeStamp;
    active = true;
    pointerId = e.pointerId;
  };
  const onUp = (e: PointerEvent): void => {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    pointerId = null;
    const dir = classifySwipe4({
      dx: e.clientX - startX,
      dy: e.clientY - startY,
      dt: e.timeStamp - startT,
      ...(opts.minDistance !== undefined ? { minDistance: opts.minDistance } : {}),
      ...(opts.minVelocity !== undefined ? { minVelocity: opts.minVelocity } : {}),
    });
    if (dir) opts.onSwipe(dir);
  };
  const onCancel = (): void => { active = false; pointerId = null; };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}
