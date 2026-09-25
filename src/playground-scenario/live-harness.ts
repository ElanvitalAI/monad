// F-B2 — Live `PlaygroundHarness` implementation.
//
// Drives scenarios against the real DisplayCoordinator +
// ContextKeyService + theme service. Unlike `FakeHarness` (in-
// memory state), mutations here actually push modals onto the
// coordinator stack, update context keys, and synthesize
// key/mouse events to mounted surfaces.
//
// Scope intentionally narrow for the F-B2 landing:
//   • mount / dismiss — real `coordinator.pushModal`.
//   • setTheme — delegates to the injected theme service.
//   • setContextKey / getContextKey — delegates to the shared
//     ContextKeyService.
//   • getModalStack — reads from coordinator.
//   • click / key — synthesized and dispatched directly to the
//     mounted target modal (via `modal.onMouse` / `modal.onKey`).
//     NOT routed through the full mouse-wiring pipeline — that
//     requires a terminal-level synthesis we can add in F-B3 if
//     a scenario actually needs it.
//   • getLastRender — returns '' for now. F-B3 can wire a
//     writeOverlay tap to populate.

import type { ContextKeyService, ContextKeys } from '../input-core/context-keys.js';
import type { DisplayCoordinator } from '../display/coordinator.js';
import type { ModalSurface } from '../display/modal-stack.js';
import type { DisplayMouseEvent, SurfaceId } from '../display/types.js';
import type { KeyEvent } from '../plugins/core/types.js';

import type {
  ClickTarget,
  MountSpec,
  PlaygroundHarness,
} from './types.js';
import { buildSurfaceForMountSpec } from './mount-builder.js';

export interface LiveHarnessDeps {
  coordinator: DisplayCoordinator;
  contextKeys: ContextKeyService;
  /** Theme switch callback. Omit for tests that don't exercise
   *  `setTheme`. Scenarios that try to switch when this is null
   *  silently no-op (still recorded as 'pass' — no assertion
   *  fires on a missing hook). */
  setTheme?: (name: string) => void;
  /** Terminal size getter — passed to modal layout resolution so
   *  above-input / overlay-center anchors compute against the
   *  real viewport. */
  termSize?: () => { rows: number; cols: number };
  /** Click handler — fired when the harness records a click on a
   *  registered `componentId`. Used by scenarios that want to
   *  observe "was this button pressed?" without reading through a
   *  context key. Optional; defaults to the internal
   *  `lastClickedComponentId` cache. */
  onComponentClick?: (componentId: string) => void;
}

export function createLivePlaygroundHarness(deps: LiveHarnessDeps): PlaygroundHarness & {
  /** Dispose every currently-mounted scenario modal. Test
   *  teardown should always call this so nothing survives across
   *  cases. */
  disposeAll(): void;
} {
  const handles = new Map<string, { dispose: () => void; surface: ModalSurface }>();
  let lastClickedComponentId: string | null = null;

  const mount = (spec: MountSpec): void => {
    const surface = buildSurfaceForMountSpec(spec, {
      termSize: deps.termSize ? deps.termSize() : { rows: 24, cols: 80 },
      onClick: (componentId: string) => {
        lastClickedComponentId = componentId;
        deps.onComponentClick?.(componentId);
      },
    });
    const handle = deps.coordinator.pushModal(surface);
    handles.set(spec.id, { dispose: handle.dispose, surface });
  };

  const dismiss = (modalId?: string): void => {
    if (modalId) {
      const entry = handles.get(modalId);
      if (entry) {
        try { entry.dispose(); } catch { /* isolate */ }
        handles.delete(modalId);
      }
      return;
    }
    // Dismiss topmost — iterate the real focus stack looking for
    // any id we own. Ensures we don't pop modals we didn't
    // mount (e.g. an unrelated dialog the user opened).
    const stack = deps.coordinator.modalStack();
    for (let i = stack.length - 1; i >= 0; i--) {
      const id = stack[i]!;
      if (handles.has(id)) {
        const entry = handles.get(id)!;
        try { entry.dispose(); } catch { /* isolate */ }
        handles.delete(id);
        return;
      }
    }
  };

  const click = (target: ClickTarget, button: 'left' | 'right' | 'double'): void => {
    const ev: DisplayMouseEvent = {
      type: button === 'right' ? 'right-click'
         : button === 'double' ? 'double-click'
         : 'click',
      row: 1,
      col: 1,
    };
    // Compute target (row, col) + resolve target surface. For
    // 'coords' we use the literal values; 'component' resolves by
    // id + calls onClick directly (preserves the component-id
    // query); 'hit' attaches the HitTarget so onMouse handlers
    // read it from ev.hitTarget.
    if (target.kind === 'coords') {
      ev.row = target.row;
      ev.col = target.col;
    } else if (target.kind === 'hit') {
      ev.hitTarget = target.hitTarget;
    } else {
      // component click — fire the internal click record directly;
      // scenarios that want the modal's own onMouse to run should
      // use 'hit' or 'coords' kinds.
      lastClickedComponentId = target.componentId;
      deps.onComponentClick?.(target.componentId);
      return;
    }
    // Dispatch directly to the topmost mounted surface that this
    // harness owns. Scenarios that need cross-modal routing use
    // explicit hit targets instead.
    const topId = [...handles.keys()].pop();
    if (!topId) return;
    const entry = handles.get(topId);
    if (entry?.surface.onMouse) {
      try { entry.surface.onMouse(ev); } catch { /* isolate */ }
    }
  };

  const key = (event: KeyEvent): void => {
    // Dispatch to the topmost mounted surface's onKey, mirroring
    // the coordinator routing behaviour without going through the
    // full routing pipeline. Scenarios that need routing / preKey
    // / picker dispatch can use `waitFor` + rely on the live
    // coordinator's own key loop under test drivers that feed
    // stdin synthetically.
    const topId = [...handles.keys()].pop();
    if (!topId) return;
    const entry = handles.get(topId);
    if (entry?.surface.onKey) {
      try { void entry.surface.onKey(event); } catch { /* isolate */ }
    }
  };

  const harness: PlaygroundHarness = {
    mount,
    dismiss,
    click,
    key,
    setTheme(name: string): void {
      deps.setTheme?.(name);
    },
    setContextKey<K extends keyof ContextKeys>(k: K, v: ContextKeys[K]): void {
      deps.contextKeys.update({ [k]: v } as never);
    },
    getContextKey<K extends keyof ContextKeys>(k: K): ContextKeys[K] | undefined {
      return deps.contextKeys.keys[k];
    },
    getModalStack(): string[] {
      return deps.coordinator.modalStack();
    },
    getLastClickedComponentId(): string | null {
      return lastClickedComponentId;
    },
    getLastRender(): string {
      // F-B3 can wire a writeOverlay tap here. For now scenarios
      // that want to assert on ANSI use hit-target / context-key
      // signals instead.
      return '';
    },
    async waitFor(ms: number): Promise<void> {
      await new Promise<void>(resolve => setTimeout(resolve, ms));
    },
  };

  return {
    ...harness,
    disposeAll(): void {
      for (const [id, entry] of handles) {
        try { entry.dispose(); } catch { /* isolate */ }
        void id;
      }
      handles.clear();
      lastClickedComponentId = null;
    },
  };
}

// ── Re-export helpers for consumers ─────────────────────────────

export type { SurfaceId };
