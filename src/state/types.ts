// ── Presentation track P1 · MonadState tree + Store types ──
//
// Zustand-shape vanilla store · React dep 0. Single source of truth for
// cross-cutting UI state (theme · focus · modal stack · widget instances
// · plugin-owned slices). Phase P1 introduces the types + core impl;
// bridge migrations (ContextKeys · widget-host · plugin-host) land in
// subsequent bundles per ROADMAP §3 P1.5-P1.7.

/** Partial patch applied on top of current state. `setState` 가 받는 두
 *  형식 중 object 형식. undefined 값은 해당 키를 제거하지 않음 (Object.assign
 *  시 skip). */
export type StatePatch<S> = Partial<S>;

/** Functional updater · prior state 를 받아 patch 를 반환. Zustand style. */
export type StateUpdater<S> = (prev: S) => StatePatch<S>;

/** setState overload — 두 형식 다 허용 (object patch 또는 updater function). */
export type Setter<S> = (patch: StatePatch<S> | StateUpdater<S>) => void;

/** getState — 현재 state snapshot 을 반환. 반환값 mutate 금지
 *  (consumer 가 immutable 로 취급). */
export type Getter<S> = () => S;

/** Selector · state 의 일부를 추출하는 pure function. */
export type Selector<S, T> = (state: S) => T;

/** Equality 비교기 · subscribe 가 이전 값과 새 값을 비교할 때 사용.
 *  Default: `Object.is`. */
export type EqualityFn<T> = (a: T, b: T) => boolean;

/** Subscribe 옵션. */
export interface SubscribeOptions<T> {
  /** 이전 값과 같으면 listener 호출 skip. Default: Object.is. */
  equalityFn?: EqualityFn<T>;
  /** true 이면 subscribe 직후 listener 를 initial 값으로 1회 fire.
   *  prev 는 undefined 로 전달됨. Default: false. */
  fireImmediately?: boolean;
  /** 디버깅용 selector 이름. debug.log 에 표시. Optional. */
  name?: string;
}

/** Subscribe listener. prev 는 initial fire 시 undefined 일 수 있음. */
export type Listener<T> = (next: T, prev: T | undefined) => void;

/** subscribe 가 반환하는 dispose. 호출 시 listener 제거. */
export type Unsubscribe = () => void;

/** Store 본체. React 와 무관 · framework-free. */
export interface Store<S> {
  /** 현재 state snapshot. 반환값 mutate 금지. */
  getState: Getter<S>;
  /** Partial patch 적용 or functional updater 호출. 모든 subscriber 에
   *  fan-out · 각 selector 의 equality 로 bailout 결정. */
  setState: Setter<S>;
  /** 지정 selector 의 값이 변할 때 listener 호출. dispose 함수 반환. */
  subscribe: <T>(
    selector: Selector<S, T>,
    listener: Listener<T>,
    options?: SubscribeOptions<T>,
  ) => Unsubscribe;
  /** 모든 subscriber 제거 (테스트용). 프로덕션에서는 각 dispose 를 호출. */
  destroy?: () => void;
}

/** Store initializer — Zustand 패턴. 인자로 `(set, get, store)` 를 받아
 *  초기 state + action 을 반환. Store method 로 action 을 선언할 때 유용. */
export type StoreInitializer<S> = (
  set: Setter<S>,
  get: Getter<S>,
  store: Store<S>,
) => S;

// ── MonadState tree (bridge 전제) ─────────────────────────
//
// 본 P1 번들은 **tree 선언 + 기본 인스턴스** 만 제공. 실제 wiring (대시보드
// 가 읽고 쓰기) 는 후속 번들 P1.5/P1.6/P1.7 에서 ContextKeys / widget-host /
// plugin-host 를 bridge 하면서 채워짐. 지금은 consumer 가 테스트용으로
// import 해서 인스턴스를 만들 수 있는 정도의 shape.

/** UI ambient — 전역 에 걸친 보이는 상태. 추후 ContextKeys (IDX-2a)
 *  가 이리로 점진 migrate. */
export interface UISlice {
  /** Active theme 이름. `/theme switch` 대상. 'default' = built-in. */
  themeName: string;
  /** Focus stack · top 이 active. Coordinator 와 bridge 예정 (P1.5). */
  focusStack: readonly string[];
  /** Modal tier 순서 · top-of-stack 이 focus 대상. */
  modalStack: readonly string[];
  /** U-0 · derived view mode · ROADMAP-input-widget-unification §2.
   *  Dashboard publishes via `deriveViewMode(signals)` at each
   *  flag-change junction; `bridgeContextKeysToStore` projects to
   *  `viewMode.is*` context keys. Optional on UISlice for back-compat
   *  with pre-U-0 `defaultMonadState()` consumers that don't know
   *  about the slice; treat absence as `{kind: 'idle'}`. */
  viewMode?: import('../input-core/view-mode.js').ViewMode;
  /** U-1 · currently-focused widget id · widget-host bridge target.
   *  `null` means no widget owns focus (common · pane-slot focus
   *  lives on `workingDir.focus`, orthogonal axis). Optional on
   *  UISlice for back-compat; treat absence as `null`. */
  focusedWidgetId?: import('./types.js').FocusedWidgetId;
  /** ContextKeys bridge 대상 - 추가 키는 P1.5 에서 채워짐. */
  [key: string]: unknown;
}

/** Widget instance state · widget-host.instances bridge 대상 (P1.6). */
export interface WidgetSlice {
  readonly type: string;
  readonly state: unknown;
}

/** U-1 · currently-focused widget id · widget-host.focusedId bridge
 *  target. `null` (or absent) means no widget owns focus · the pane
 *  slot axis (`workingDir.focus`) is independent. Optional on
 *  `UISlice` for back-compat with pre-U-1 store consumers. */
export type FocusedWidgetId = string | null;

/** MonadState · 전역 트리. 본 P1 번들은 "이 shape 이 있다" 만 선언. */
export interface MonadState {
  readonly ui: UISlice;
  readonly widgets: Record<string, WidgetSlice>;
  /** Plugin-owned slices · flat namespace · isolation 보장. */
  readonly plugins: Record<string, unknown>;
  /** Layout (VWT Phase 3a 와 align 예정). P1 은 null 만. */
  readonly layout: unknown | null;
}

/** Default empty state · 테스트 + 초기 mount 용. */
export function defaultMonadState(): MonadState {
  return {
    ui: {
      themeName: 'default',
      focusStack: [],
      modalStack: [],
    },
    widgets: {},
    plugins: {},
    layout: null,
  };
}
