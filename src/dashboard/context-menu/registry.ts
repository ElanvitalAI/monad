// IDX-5 Phase 2 — dashboard-singleton ContextMenuRegistry.
//
// Mirrors the dashboard-context-keys.ts pattern. One registry per
// runtime. Bootstrap:
//   1. initDashboardContextMenuRegistry({ termSize, pushSurface, ... })
//      — wires the default ContextMenu widget presenter and the
//      ContextKeys bridge. Safe to call more than once (the
//      second call updates deps).
//   2. registerPillMenus(registry) — registers a menu for each
//      status-bar pill and returns a lookup fn handleForPill(name).
//
// Why a singleton: every surface that wants to show a context menu
// lives in a different subsystem (mouse wiring, plugin panes,
// picker rows). Passing the registry through every callsite clutters
// signatures; the singleton keeps the wiring light and test reset
// is one function call.

import type { ModalSurface } from '../../display/modal-stack.js';
import type { PillName } from '../../status/pills.js';
import {
  createContextMenuRegistry,
  wireRegistryToContextKeys,
  buildPillMenu,
  type ContextMenuRegistry,
  type MenuHandle,
  type MenuPresenter,
} from '../../ui/context-menu-registry.js';
import { createDefaultMenuPresenter } from '../../ui/context-menu-presenter.js';
import { getDashboardContextKeyService } from '../context/keys.js';

export interface InitContextMenuRegistryDeps {
  /** Live terminal geometry for presenter placement. */
  termSize: () => { rows: number; cols: number };
  /** Mount a modal surface. Typically `display.pushModal`. */
  pushSurface: (surface: ModalSurface) => { dispose: () => void };
  /** Redraw after open/close. Omit for headless wiring. */
  redraw?: () => void;
  /** Override the presenter (tests). */
  presenter?: MenuPresenter;
  /** IDX-6 Phase 5 adoption — live theme accessor. When provided,
   *  the default presenter paints each opened context menu with a
   *  drop-shadow using `theme.modal.shadow`. Set `ELANOUS_MODAL_SHADOW=off`
   *  env to globally disable even when the getter is present. */
  getTheme?: () => import('../../theme/tokens.js').ThemeTokens | null | undefined;
}

let registry: ContextMenuRegistry | null = null;
let disposeCtxBridge: (() => void) | null = null;
let pillHandles: Readonly<Record<PillName, MenuHandle>> | null = null;

/** Lazy getter. If the registry wasn't explicitly initialised, creates
 *  a detached instance without a presenter (showMenu becomes a no-op
 *  until `initDashboardContextMenuRegistry` is called). Test helpers
 *  and early callers read this before bootstrap; the no-op presenter
 *  keeps them from crashing. */
export function getDashboardContextMenuRegistry(): ContextMenuRegistry {
  if (!registry) registry = createContextMenuRegistry();
  return registry;
}

/** Bootstrap the singleton with a real presenter + register the
 *  5 status-bar pill menus. Idempotent — calling twice re-registers
 *  the presenter (useful if termSize binding changes) but leaves
 *  existing menu handles intact. Returns the registry so callers
 *  can chain. */
export function initDashboardContextMenuRegistry(
  deps: InitContextMenuRegistryDeps,
): ContextMenuRegistry {
  const reg = getDashboardContextMenuRegistry();
  const resolveAmbientTheme = deps.getTheme
    ? () => (process.env.ELANOUS_MODAL_SHADOW === 'off' ? undefined : deps.getTheme!())
    : undefined;
  const presenter = deps.presenter ?? createDefaultMenuPresenter({
    termSize: deps.termSize,
    pushSurface: deps.pushSurface,
    redraw: deps.redraw,
    getTheme: resolveAmbientTheme,
  });
  reg.setPresenter(presenter);

  // Wire to ContextKeys once. If we re-init after a test reset the
  // bridge is already gone; create a fresh one.
  if (!disposeCtxBridge) {
    try {
      disposeCtxBridge = wireRegistryToContextKeys(
        reg,
        getDashboardContextKeyService(),
      );
    } catch {
      /* ignore — ctx bridge failure is non-fatal */
    }
  }

  if (!pillHandles) pillHandles = registerPillMenus(reg);
  return reg;
}

/** Lookup the pre-registered handle for a pill. Returns null before
 *  init completes. */
export function handleForPill(name: PillName): MenuHandle | null {
  if (!pillHandles) return null;
  return pillHandles[name] ?? null;
}

/** Test helper — drop the singleton + all menus + ctx bridge. */
export function __resetDashboardContextMenuRegistryForTests(): void {
  try { disposeCtxBridge?.(); } catch { /* ignore */ }
  disposeCtxBridge = null;
  try { registry?.dispose(); } catch { /* ignore */ }
  registry = null;
  pillHandles = null;
}

/** Register a menu per status-bar pill. Exported so tests can
 *  exercise the set directly without going through init.
 *
 *  2026-05-05 — model pill가 `canRemove: true` 로 등록되어 우클릭 메뉴
 *  에 "Remove Model from rotation" item 노출. 다른 pill 은 무변경. */
export function registerPillMenus(
  reg: ContextMenuRegistry,
): Readonly<Record<PillName, MenuHandle>> {
  const entries: Array<[PillName, string, { canRemove?: boolean; removeLabel?: string }]> = [
    ['workingDir',    'Working dir', {}],
    ['model',         'Model',       { canRemove: true, removeLabel: 'Remove from rotation' }],
    ['mode',          'Mode',        {}],
    ['shellRollup',   'Shells',      {}],
    ['virtualWindow', 'Window',      {}],
  ];
  const out = {} as Record<PillName, MenuHandle>;
  for (const [name, title, extras] of entries) {
    const menu = buildPillMenu({
      pillName: title,
      canSwitch: true,
      canOpenSettings: false,
      ...extras,
    });
    out[name] = reg.registerMenu(menu);
  }
  return out;
}
