// IDX-5 Phase 2 — context-menu registry.
//
// Right-click context menus are a staple of Mac/Windows GUIs, but
// the existing monad-agent MX6 implementation rebuilds each menu
// inline on every right-click. This module brings the AppCUI-rs
// register_menu + show_menu split into TypeScript: widgets build
// their menu shape once at mount time, receive a stable handle,
// and hand that handle to showMenu on right-click. Items are
// data; the only per-click cost is the showMenu promise + the
// presenter's render.
//
// Key patterns:
//   - AppCUI-rs `register_menu(menu) -> Handle` / `show_menu(h, x,
//     y, max_size?)` (appcui/src/ui/common/control_base.rs:627-633)
//   - ratatui-interact PopupContainer `close_on_escape()` /
//     `close_on_outside_click()` defaults, both true
//     (src/traits/container.rs:194-206)
//   - DD-IDX-12 (registry-based, no rebuild on show)
//   - DD-IDX-18 (Esc + outside-click dismiss as default)
//
// Testability: presenter is injectable. Tests pass a stub
// presenter to control timing and picked values; production wires
// a real presenter that mounts a ContextMenu widget via the
// modal-adapter.

import type { ContextKeyService } from '../input-core/context-keys.js';

/** Structurally-typed eval context used by predicate-based `disabled`
 *  (CMX-3). Intentionally a plain record so callers don't need to
 *  import the provider module to type a MenuItem. Shape is identical
 *  to `MenuBuildContext` in `./context-menu-providers.ts` — the two
 *  names differ only in which module you import them from. */
export type MenuEvalContext = Readonly<Record<string, unknown>>;

/** CMX-3 (2026-04-22) — disabled can be a boolean (static · decided
 *  at menu build time) OR a predicate evaluated at flatten time
 *  against the ctx passed through `ShowMenuOptions.context`. A
 *  predicate returning `true` disables the item; undefined means
 *  enabled. Matches VSCode's `ContextKeyExpression` late-binding
 *  pattern without requiring a DSL — callers just write plain JS. */
export type MenuItemDisabled = boolean | ((ctx: MenuEvalContext) => boolean);

/** One row inside a menu. Commands fire and close the menu;
 *  separators are visual only; checkboxes toggle state and close;
 *  single-choice items emit their value.
 *
 *  CMX-0 (2026-04-22) extensions (additive · backward-compat):
 *  - `payload?: unknown` — opaque data carried with the item, returned
 *    through `MenuResult.payload` on selection. Mirrors AppKit's
 *    `NSMenuItem.representedObject` pattern: the builder attaches a
 *    model reference once, the handler narrows it on pick without a
 *    separate lookup (e.g. `payload: {pane: ref}` on a pane-scoped
 *    action). Presenters ignore it; it's caller-only data.
 *  - `hidden?: boolean` — completely omit the item from rendering.
 *    Distinct from `disabled`: a disabled item is grayed out and
 *    visible (user can see the action exists), a hidden item is
 *    absent (user cannot discover it). Adjacent separators collapse
 *    when all surrounded non-separator items are hidden.
 *
 *  CMX-3 (2026-04-22) extensions (additive · backward-compat):
 *  - `disabled` type widened from `boolean` to
 *    `boolean | ((ctx) => boolean)`. Predicates evaluate at flatten
 *    time so menus registered once upfront can still disable items
 *    based on current app state (clipboard empty · selection empty ·
 *    readonly) without caller-side rebuild. Static boolean callers
 *    are unaffected. */
export type MenuItem =
  | {
      kind: 'command';
      id: string;
      label: string;
      shortcut?: string;
      disabled?: MenuItemDisabled;
      hidden?: boolean;
      payload?: unknown;
      /** Optional submenu opened when the user activates this
       *  item. Presenters that don't support submenus fall back
       *  to ignoring the field and treating it as a plain
       *  command. */
      submenu?: Menu;
    }
  | { kind: 'separator'; hidden?: boolean }
  | {
      kind: 'checkbox';
      id: string;
      label: string;
      checked: boolean;
      disabled?: MenuItemDisabled;
      hidden?: boolean;
      payload?: unknown;
    }
  | {
      kind: 'single-choice';
      /** Group id — single-choice items with the same groupId form
       *  a radio group (one selected at a time). */
      groupId: string;
      id: string;
      label: string;
      selected?: boolean;
      disabled?: MenuItemDisabled;
      hidden?: boolean;
      payload?: unknown;
    };

export interface Menu {
  /** Optional stable id for debug + audit trails. Presenter
   *  doesn't need it. */
  id?: string;
  /** Rendered at the top of the popup when set. */
  title?: string;
  items: MenuItem[];
}

/** Opaque handle returned by registerMenu. Stringly-typed so
 *  consumers can't accidentally pass raw strings back in without
 *  a cast. The internal representation is a random id. */
export type MenuHandle = string & { readonly __menuHandle: unique symbol };

export type MenuCloseReason = 'selected' | 'escape' | 'outside-click' | 'disposed';

export interface MenuResult {
  /** For command + single-choice items, the `id` that fired. For
   *  checkboxes, the id of the toggled row (caller reads the new
   *  `checked` from the menu data after updateMenu). Null when
   *  dismissed without selection. */
  value: string | null;
  reason: MenuCloseReason;
  /** For single-choice items — the groupId whose value changed.
   *  Null otherwise. */
  groupId?: string;
  /** CMX-0 (2026-04-22) · opaque caller-attached data from the
   *  picked item. Copied from `MenuItem.payload` when the user
   *  selects. Null when dismissed without selection, or when the
   *  selected item had no payload. AppKit representedObject
   *  pattern — lets handlers narrow `unknown` to a model reference
   *  without a separate lookup. */
  payload?: unknown;
}

export interface ShowMenuOptions {
  /** Upper bound on the popup size — presenter clamps to terminal
   *  bounds too. Omit to let the presenter pick. */
  maxSize?: { width: number; height: number };
  /** R7 step 2 — when true, this menu open participates in the
   *  single-instance `menu` policy. Presenter backends may use this
   *  to reuse a stable surface id so a new menu replaces the prior
   *  one instead of stacking. Omit/false for popup-style coexistence
   *  such as pill pickers. */
  singleInstance?: boolean;
  /** Workspace affinity for the rendered popup/menu surface. When set,
   *  presenter backends should stamp the mounted menu surface with this
   *  owner so submenu / dismiss / workspace-dispose all stay chained to
   *  the source workspace instead of defaulting to dashboard-main. */
  ownerWorkspaceId?: string;
  /** CMX-3 (2026-04-22) · live eval context for predicate-based
   *  `disabled` fields. Passed through to the presenter's flatten
   *  step so items that declared `disabled: (ctx) => boolean` are
   *  evaluated against the current app state at show time. Static
   *  boolean disables are unaffected. Omit when no predicates are
   *  in play; shape is `Readonly<Record<string, unknown>>`. */
  context?: MenuEvalContext;
}

/** Presenter is the rendering backend — it's told "show this
 *  menu at this spot" and resolves a MenuResult once the user
 *  picks or dismisses. Tests use a stub; the dashboard wires a
 *  real presenter that mounts a ContextMenu widget through the
 *  modal-adapter. */
export type MenuPresenter = (
  menu: Menu,
  pos: { x: number; y: number },
  opts: ShowMenuOptions,
) => Promise<MenuResult>;

export interface ContextMenuRegistry {
  /** Register a menu. Returns a handle consumers hand back to
   *  showMenu. */
  registerMenu(menu: Menu): MenuHandle;

  /** Remove a menu + its handle. Returns true when the handle
   *  was known. Calling showMenu on an unregistered handle
   *  rejects. */
  unregisterMenu(handle: MenuHandle): boolean;

  /** Read the current menu shape. Returns null when the handle
   *  is unknown. */
  getMenu(handle: MenuHandle): Menu | null;

  /** Replace the menu data behind a handle. Returns true on
   *  success. Lets widgets toggle a checkbox or update a label
   *  without re-registering. */
  updateMenu(handle: MenuHandle, next: Menu): boolean;

  /** Open the menu at the given anchor. Resolves with the user's
   *  pick / dismissal reason. Rejects when the handle is unknown
   *  or the registry is disposed. */
  showMenu(
    handle: MenuHandle,
    pos: { x: number; y: number },
    opts?: ShowMenuOptions,
  ): Promise<MenuResult>;

  /** True while a menu is open (between showMenu start and
   *  resolve). Mirrored to ContextKeys.contextMenuOpen via
   *  wireRegistryToContextKeys. */
  readonly isOpen: boolean;

  /** Subscribe to open/close transitions. Fires immediately with
   *  the current state. Returns a dispose fn. */
  onOpenChange(listener: (open: boolean) => void): () => void;

  /** Swap the presenter. Useful for tests + for phases that
   *  change the rendering backend (ASCII fallback vs rich). */
  setPresenter(presenter: MenuPresenter | null): void;

  /** Tear down — cancel any pending showMenu with 'disposed',
   *  drop listeners, drop registered menus. */
  dispose(): void;
}

export interface ContextMenuRegistryOptions {
  presenter?: MenuPresenter;
  /** Random id generator — tests pass a deterministic one. */
  nextId?: () => string;
}

const DEFAULT_PRESENTER: MenuPresenter = async () => ({
  value: null,
  reason: 'disposed',
});

export function createContextMenuRegistry(
  opts: ContextMenuRegistryOptions = {},
): ContextMenuRegistry {
  const store = new Map<MenuHandle, Menu>();
  const openListeners = new Set<(open: boolean) => void>();
  let presenter: MenuPresenter = opts.presenter ?? DEFAULT_PRESENTER;
  let openCount = 0;
  let disposed = false;
  let idCounter = 0;
  const genId =
    opts.nextId ??
    (() => {
      idCounter++;
      return `menu-${idCounter}-${Math.random().toString(36).slice(2, 10)}`;
    });

  function setOpen(open: boolean): void {
    for (const fn of openListeners) {
      try {
        fn(open);
      } catch {
        // Swallow — see hover-tracker / context-keys pattern.
      }
    }
  }

  return {
    registerMenu(menu) {
      if (disposed) {
        // Post-dispose registrations are rejected by returning an
        // unusable handle. Consumers detect via getMenu === null.
        return genId() as MenuHandle;
      }
      const handle = genId() as MenuHandle;
      store.set(handle, cloneMenu(menu));
      return handle;
    },

    unregisterMenu(handle) {
      return store.delete(handle);
    },

    getMenu(handle) {
      const menu = store.get(handle);
      return menu ? cloneMenu(menu) : null;
    },

    updateMenu(handle, next) {
      if (!store.has(handle)) return false;
      store.set(handle, cloneMenu(next));
      return true;
    },

    async showMenu(handle, pos, showOpts = {}) {
      if (disposed) {
        return { value: null, reason: 'disposed' };
      }
      const menu = store.get(handle);
      if (!menu) {
        return { value: null, reason: 'disposed' };
      }
      openCount++;
      if (openCount === 1) setOpen(true);
      try {
        const result = await presenter(cloneMenu(menu), pos, showOpts);
        return result;
      } finally {
        openCount = Math.max(0, openCount - 1);
        if (openCount === 0) setOpen(false);
      }
    },

    get isOpen() {
      return openCount > 0;
    },

    onOpenChange(listener) {
      openListeners.add(listener);
      try {
        listener(openCount > 0);
      } catch {
        // Swallow.
      }
      return () => {
        openListeners.delete(listener);
      };
    },

    setPresenter(next) {
      presenter = next ?? DEFAULT_PRESENTER;
    },

    dispose() {
      disposed = true;
      store.clear();
      openListeners.clear();
      openCount = 0;
      presenter = DEFAULT_PRESENTER;
    },
  };
}

/** Deep-clone a menu so caller mutations don't leak into the
 *  registry's copy. Shallow is not enough — items array + submenu
 *  are references. */
function cloneMenu(menu: Menu): Menu {
  return {
    id: menu.id,
    title: menu.title,
    items: menu.items.map(cloneItem),
  };
}

function cloneItem(item: MenuItem): MenuItem {
  if (item.kind === 'command') {
    return {
      kind: 'command',
      id: item.id,
      label: item.label,
      shortcut: item.shortcut,
      disabled: item.disabled,
      hidden: item.hidden,
      payload: item.payload,
      submenu: item.submenu ? cloneMenu(item.submenu) : undefined,
    };
  }
  if (item.kind === 'separator') return { kind: 'separator', hidden: item.hidden };
  if (item.kind === 'checkbox') return { ...item };
  return { ...item };
}

/** Bridge a registry's open/close transitions into ContextKeys.
 *  `contextMenuOpen` tracks the aggregate — if any menu is open,
 *  the key is true. Returns a dispose fn. */
export function wireRegistryToContextKeys(
  registry: ContextMenuRegistry,
  ctx: ContextKeyService,
): () => void {
  return registry.onOpenChange((open) => {
    ctx.update({ contextMenuOpen: open } as never);
  });
}

// ---------------------------------------------------------------------
// 3-site builder helpers — IDX-5 Phase 2 adoption targets.
//
// These produce ready-to-register Menu objects for the primary
// right-click surfaces. Widgets call them at mount time and pass
// the resulting menu to registry.registerMenu(). The dashboard's
// right-click dispatcher looks up the handle and calls showMenu.
//
// Keeping builders here (instead of inside each widget file)
// ensures consistent labels + ordering across the app. Localisation
// will slot in later by routing label strings through a future
// translator — the structure is preserved.
// ---------------------------------------------------------------------

export interface PaneTitleMenuOptions {
  paneId: string;
  canClose?: boolean;
  canRename?: boolean;
  canSplit?: boolean;
  canDetach?: boolean;
}

/** Pane title right-click — close / rename / split / detach.
 *  Non-applicable actions can be suppressed via the opts flags
 *  so callers get a menu that reflects the pane's capabilities.
 *
 *  @template Builder producing a canonical pane-title menu shape
 *  with stable ids (`pane.close` / `pane.rename` / `pane.split.h`
 *  / `pane.split.v` / `pane.detach`). CMX-2 (2026-04-22) browser
 *  pane provider is the first production consumer. Other pane
 *  owners should import this builder instead of re-declaring ids
 *  so LLM tools + keybinding layers see a consistent action
 *  namespace across the app. */
export function buildPaneTitleMenu(opts: PaneTitleMenuOptions): Menu {
  const items: MenuItem[] = [];
  if (opts.canClose !== false) {
    items.push({ kind: 'command', id: 'pane.close', label: 'Close pane', shortcut: 'w' });
  }
  if (opts.canRename !== false) {
    items.push({ kind: 'command', id: 'pane.rename', label: 'Rename…', shortcut: 'r' });
  }
  if (opts.canSplit !== false) {
    items.push({ kind: 'separator' });
    items.push({ kind: 'command', id: 'pane.split.h', label: 'Split horizontally', shortcut: 'h' });
    items.push({ kind: 'command', id: 'pane.split.v', label: 'Split vertically', shortcut: 'v' });
  }
  if (opts.canDetach !== false) {
    items.push({ kind: 'separator' });
    items.push({ kind: 'command', id: 'pane.detach', label: 'Detach to new window', shortcut: 'd' });
  }
  return { id: `pane-title:${opts.paneId}`, title: 'Pane', items };
}

export interface SelectViewRowMenuOptions {
  rowValue: string;
  rowLabel?: string;
  canCopy?: boolean;
  canOpen?: boolean;
  canRemove?: boolean;
}

/** SelectView row right-click — copy / open / remove. Label
 *  truncation is the caller's job; we just render whatever they
 *  pass.
 *
 *  @template Builder producing a canonical row-context-menu shape
 *  (`row.copy` / `row.open` / `row.remove`). No production call
 *  sites yet — CMX-5 follow-on phase wires this to model picker
 *  / wd picker rows so users can right-click a rotation entry to
 *  pin / remove it. Until then: preserved as a ready-to-use
 *  template with stable ids. */
export function buildSelectViewRowMenu(opts: SelectViewRowMenuOptions): Menu {
  const items: MenuItem[] = [];
  if (opts.canCopy !== false) {
    items.push({ kind: 'command', id: 'row.copy', label: 'Copy value', shortcut: 'c' });
  }
  if (opts.canOpen !== false) {
    items.push({ kind: 'command', id: 'row.open', label: 'Open', shortcut: 'o' });
  }
  if (opts.canRemove !== false) {
    items.push({ kind: 'separator' });
    items.push({ kind: 'command', id: 'row.remove', label: 'Remove', shortcut: 'r' });
  }
  const title = opts.rowLabel ? truncate(opts.rowLabel, 40) : 'Row';
  return { id: `row:${opts.rowValue}`, title, items };
}

export interface PillMenuOptions {
  pillName: string;
  canSwitch?: boolean;
  canOpenSettings?: boolean;
  /** 2026-05-05 — show "Remove …" item that drops the currently active
   *  entry from the underlying list (e.g. model pill removes the active
   *  rotation entry). Caller wires the action via the showMenu result
   *  consumer; this helper only emits the menu item. */
  canRemove?: boolean;
  /** Override the menu title (default: pillName). 활성 entry 의 라벨
   *  같이 dynamic 정보를 노출할 때 사용 (e.g. 'Model · claude/sonnet'). */
  title?: string;
  /** Override the Switch item's label (default: `Switch ${pillName}…`).
   *  메뉴 폭 축소를 원할 때 사용. */
  switchLabel?: string;
  /** Override the Remove item's label (default: `Remove ${pillName} from rotation`). */
  removeLabel?: string;
  /** Override the Settings item's label (default: `${pillName} settings…`). */
  settingsLabel?: string;
}

/** Status-bar pill right-click — switch / remove / settings. `pillName`
 *  personalises the title (e.g. 'Model', 'Working dir'). */
export function buildPillMenu(opts: PillMenuOptions): Menu {
  const items: MenuItem[] = [];
  if (opts.canSwitch !== false) {
    items.push({
      kind: 'command',
      id: 'pill.switch',
      label: opts.switchLabel ?? `Switch ${opts.pillName}…`,
      shortcut: 's',
    });
  }
  if (opts.canRemove) {
    items.push({
      kind: 'command',
      id: 'pill.remove',
      label: opts.removeLabel ?? `Remove ${opts.pillName} from rotation`,
      shortcut: 'r',
    });
  }
  if (opts.canOpenSettings !== false) {
    items.push({ kind: 'separator' });
    items.push({
      kind: 'command',
      id: 'pill.settings',
      label: opts.settingsLabel ?? `${opts.pillName} settings…`,
      shortcut: ',',
    });
  }
  return {
    id: `pill:${opts.pillName}`,
    title: opts.title ?? opts.pillName,
    items,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
