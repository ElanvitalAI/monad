// Widget behaviors — public barrel.
//
// Phase 1: types only.
// Phase 2 commit 1: 5 core mixins (Scrollable / Cursorable /
// PaneNavigable / Filterable / Selectable).
// Phase 2 commit 2: 2 presentation mixins (Themable / StateStyleable)
// land next.

export type { WidgetBehavior } from './types.js';

export {
  scrollable,
  Scrollable,
  type ScrollableState,
  type ScrollableConfig,
} from './scrollable.js';

export {
  cursorable,
  Cursorable,
  type CursorableState,
  type CursorableConfig,
} from './cursorable.js';

export {
  paneNavigable,
  type PaneNavigableConfig,
} from './pane-navigable.js';

export {
  filterable,
  Filterable,
  type FilterableState,
  type FilterableConfig,
} from './filterable.js';

export {
  selectable,
  type SelectableState,
  type SelectableConfig,
} from './selectable.js';

export {
  themable,
  Themable,
  type ThemableConfig,
  type ThemeChangeSubscribe,
} from './themable.js';

export {
  stateStyleable,
  StateStyleable,
  resolveStyle,
  type StateStyleableState,
  type StateStyleableConfig,
} from './state-styleable.js';

export {
  hoverTint,
  applyHoverableListRowEvent,
  type HoverableState,
} from './hoverable.js';
