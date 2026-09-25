// IDX-6 Phase 4/5 — dashboard-level theme integration helpers.
//
// Phases 1-4 produced:
//   - hierarchical tokens + 5 presets (src/themes/*)
//   - ThemeService singleton (src/theme-service.ts)
//   - /theme slash commands (src/theme-slash-commands.ts)
//   - Button + Dialog theme-aware rendering (src/ui/widgets/*.ts)
//
// This module is the glue the dashboard imports. It owns the module-
// scope ThemeService singleton + ergonomic painter factories that
// StatusBar, pane-title, and other dashboard surfaces opt into
// without each re-implementing their own theme resolution path.
//
// Nothing here mutates dashboard.ts directly — the dashboard picks
// up `getDashboardThemeService()` at boot and passes the returned
// theme (or subscribes) to its widgets. Keeping integration in a
// standalone module lets us test without booting the dashboard.

import type { ContextKeyService } from '../input-core/context-keys.js';
import {
  createThemeService,
  defaultThemeConfigPath,
  type ThemeService,
} from './service.js';
import {
  paintPair,
  resolveWidgetTokens,
  type ThemeTokens,
  type WidgetState,
} from './tokens.js';

let _singleton: ThemeService | null = null;

export interface DashboardThemeServiceOptions {
  /** Override the persist path (tests point at a temp file). Defaults
   *  to ~/.monad/theme.json. */
  persistPath?: string;
  /** Context-keys service — when supplied, the singleton mirrors
   *  themeName/themeIsDark/themeIsPastel on every switch. */
  contextKeys?: ContextKeyService;
}

/** Get-or-create the process-wide dashboard ThemeService. First call
 *  constructs; subsequent calls return the same instance. Tests
 *  reset state via __resetDashboardThemeServiceForTests. */
export async function getDashboardThemeService(
  opts: DashboardThemeServiceOptions = {},
): Promise<ThemeService> {
  if (_singleton) return _singleton;
  _singleton = await createThemeService({
    persistPath: opts.persistPath ?? defaultThemeConfigPath(),
    contextKeys: opts.contextKeys,
  });
  return _singleton;
}

/** Test-only reset. Production never calls this. */
export function __resetDashboardThemeServiceForTests(): void {
  if (_singleton) _singleton.dispose();
  _singleton = null;
}

// ---------------------------------------------------------------------
// Painter factories — turn a theme token slot into a reusable painter
// function. These stay thin so surfaces can either subscribe to the
// service (re-creating the painter on each switch) or bind the
// current theme once at boot.
// ---------------------------------------------------------------------

export type PillState = 'idle' | 'active' | 'hovered';

/** Produce a painter for the status-bar pill based on the theme's
 *  statusBar.pill tokens. The painter takes (text, state) and
 *  returns an ANSI-wrapped string.
 *
 *  State mapping:
 *    idle     → statusBar.pill
 *    active   → statusBar.pillActive
 *    hovered  → statusBar.pillHovered (falls back to pill)
 */
export function createPillPainter(
  theme: ThemeTokens,
): (text: string, state?: PillState) => string {
  const tokens = resolveWidgetTokens(theme, 'statusBar');
  const idle = paintPair(tokens.pill);
  const active = paintPair(tokens.pillActive);
  const hovered = paintPair(tokens.pillHovered ?? tokens.pill);
  return (text, state = 'idle') => {
    if (state === 'active') return active(text);
    if (state === 'hovered') return hovered(text);
    return idle(text);
  };
}

export type PaneTitleState = 'active' | 'inactive' | 'hovered';

/** Produce a painter for pane titles. Focused = active, unfocused =
 *  inactive. `hovered` is optional — when the theme doesn't ship a
 *  hovered variant we reuse active with faint attribute.
 *
 *  IDX-6 Phase 5 polish: active titles render bold + accent;
 *  inactive dim. This is the first visible-focus-indicator seed. */
export function createPaneTitlePainter(
  theme: ThemeTokens,
): (text: string, state?: PaneTitleState) => string {
  const tokens = resolveWidgetTokens(theme, 'paneTitle');
  const active = paintPair(tokens.active);
  const inactive = paintPair(tokens.inactive);
  const hovered = paintPair(tokens.hovered ?? { ...tokens.active });
  return (text, state = 'inactive') => {
    if (state === 'active') return active(text);
    if (state === 'hovered') return hovered(text);
    return inactive(text);
  };
}

/** Produce a painter for dialog/modal borders. Used by surfaces
 *  that don't go through BoxView directly (e.g. raw ANSI borders
 *  in the modal-adapter). */
export function createModalBorderPainter(
  theme: ThemeTokens,
): (text: string) => string {
  const tokens = resolveWidgetTokens(theme, 'modal');
  return paintPair(tokens.border);
}

/** Produce a painter for a specific button state. Thin wrapper that
 *  returns a function taking only text — useful for surfaces that
 *  always render in one state (e.g. a custom header with a single
 *  highlighted label). */
export function createButtonStatePainter(
  theme: ThemeTokens,
  state: WidgetState = 'normal',
): (text: string) => string {
  const tokens = resolveWidgetTokens(theme, 'button');
  const pair = tokens[state] ?? tokens.normal;
  return paintPair(pair);
}

// ---------------------------------------------------------------------
// Subscription helper — wire a re-render callback so a surface can
// repaint when the theme changes.
// ---------------------------------------------------------------------

/** Subscribe to theme changes via the service and invoke a re-render
 *  callback whenever the theme switches. Returns a dispose fn. The
 *  callback receives the newly-active theme so it can rebuild its
 *  painter cache. */
export function subscribeThemeReRender(
  service: ThemeService,
  onRender: (theme: ThemeTokens) => void,
): () => void {
  return service.subscribe(onRender);
}
