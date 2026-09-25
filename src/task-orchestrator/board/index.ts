/**
 * Board primitives — `projectTaskToCard` + `computeBoard`.
 *
 * Pure data layer for kanban boards. Widget implementations (VW slot,
 * terminal pane, TUI, web) consume `BoardLayout` + `BoardCard[]` and
 * decide how to paint.
 */
export * from './card.js';
export * from './layout.js';
export * from './observable.js';
export * from './ansi-renderer.js';
