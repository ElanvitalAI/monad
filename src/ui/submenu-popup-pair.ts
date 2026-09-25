import type { ModalShadowSpec, ViewSurfaceHandle } from './modal-adapter.js';
import { mountViewAsModalSurface } from './modal-adapter.js';
import type { ThemeTokens } from '../theme/tokens.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from './view.js';

export interface SubmenuPopupPairRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SubmenuPopupPairBounds {
  row: number;
  col: number;
  width: number;
  height: number;
}

export interface SubmenuPopupPairSpec {
  id: string;
  parentBounds: SubmenuPopupPairBounds;
  expandedBounds: SubmenuPopupPairBounds | (() => SubmenuPopupPairBounds);
  parentRect: (size: Size) => SubmenuPopupPairRect;
  childRect: (size: Size) => SubmenuPopupPairRect;
  createParentView: () => View;
  createChildView: () => View;
  isChildVisible: () => boolean;
  isChildFocused: () => boolean;
  onHandleKey?: (name: string) => boolean;
  onStateMayHaveChanged?: () => void;
  priority?: number;
  shadow?: ModalShadowSpec;
  theme?: ThemeTokens;
  backdrop?: boolean;
  freezeBottomArea?: boolean;
  backgroundInteractionPolicy?: 'allow' | 'block';
  tier?: import('../display/types.js').ModalTier;
  onClose?: () => void;
}

function copyBounds(
  target: SubmenuPopupPairBounds | undefined,
  next: SubmenuPopupPairBounds,
  includeShadow: boolean,
): void {
  if (!target) return;
  target.row = next.row;
  target.col = next.col;
  target.width = next.width + (includeShadow ? 1 : 0);
  target.height = next.height + (includeShadow ? 1 : 0);
}

function resolveExpandedBounds(
  expandedBounds: SubmenuPopupPairBounds | (() => SubmenuPopupPairBounds),
): SubmenuPopupPairBounds {
  return typeof expandedBounds === 'function'
    ? expandedBounds()
    : expandedBounds;
}

export function mountSubmenuPopupPairSurface(
  spec: SubmenuPopupPairSpec,
): ViewSurfaceHandle {
  const dynamicBounds = { ...spec.parentBounds };
  let size: Size = { width: dynamicBounds.width, height: dynamicBounds.height };

  const composite: View = {
    draw(p): void {
      size = { width: p.width, height: p.height };
      const parent = spec.createParentView();
      const parentRect = spec.parentRect(size);
      parent.layout({ width: parentRect.width, height: parentRect.height });
      parent.draw(p.sub(parentRect.x, parentRect.y, parentRect.width, parentRect.height, { focused: !spec.isChildFocused() }));
      if (!spec.isChildVisible()) return;
      const child = spec.createChildView();
      const childRect = spec.childRect(size);
      child.layout({ width: childRect.width, height: childRect.height });
      child.draw(p.sub(childRect.x, childRect.y, childRect.width, childRect.height, { focused: spec.isChildFocused() }));
    },
    onEvent(ev): EventResult {
      if (spec.onHandleKey?.(ev.name)) {
        spec.onStateMayHaveChanged?.();
        return Consumed();
      }
      spec.onStateMayHaveChanged?.();
      if (spec.isChildVisible() && spec.isChildFocused()) {
        const rect = spec.childRect(size);
        const view = spec.createChildView();
        view.layout({ width: rect.width, height: rect.height });
        return view.onEvent(ev);
      }
      const rect = spec.parentRect(size);
      const view = spec.createParentView();
      view.layout({ width: rect.width, height: rect.height });
      return view.onEvent(ev);
    },
    onMouse(ev) {
      const route = (view: View, rect: SubmenuPopupPairRect): EventResult => {
        if (ev.x < rect.x || ev.y < rect.y || ev.x >= rect.x + rect.width || ev.y >= rect.y + rect.height) {
          return Ignored;
        }
        view.layout({ width: rect.width, height: rect.height });
        return view.onMouse?.({
          ...ev,
          x: ev.x - rect.x,
          y: ev.y - rect.y,
          absX: ev.absX,
          absY: ev.absY,
        }) ?? Ignored;
      };
      if (spec.isChildVisible()) {
        const childResult = route(spec.createChildView(), spec.childRect(size));
        if (childResult.kind === 'consumed') return childResult;
      }
      return route(spec.createParentView(), spec.parentRect(size));
    },
    layout(nextSize): void {
      size = nextSize;
    },
    requiredSize(): Size {
      const active = spec.isChildVisible() ? resolveExpandedBounds(spec.expandedBounds) : spec.parentBounds;
      return { width: active.width, height: active.height };
    },
    takeFocus(source?: FocusSource): boolean {
      return spec.createParentView().takeFocus?.(source) ?? true;
    },
  };

  const handle = mountViewAsModalSurface({
    id: spec.id,
    bounds: dynamicBounds,
    view: composite,
    priority: spec.priority ?? 260,
    shadow: spec.shadow,
    theme: spec.theme,
    backdrop: spec.backdrop,
    freezeBottomArea: spec.freezeBottomArea,
    backgroundInteractionPolicy: spec.backgroundInteractionPolicy,
    tier: spec.tier ?? 'popup',
    chromeControls: {
      closeButton: true,
      onClose: spec.onClose,
    },
  });

  const syncBounds = (): void => {
    const next = spec.isChildVisible() ? resolveExpandedBounds(spec.expandedBounds) : spec.parentBounds;
    dynamicBounds.row = next.row;
    dynamicBounds.col = next.col;
    dynamicBounds.width = next.width;
    dynamicBounds.height = next.height;
    copyBounds(handle.surface.interactiveBounds, next, false);
    copyBounds(handle.surface.backdropBounds, next, false);
    copyBounds(handle.surface.visualBounds, next, !!spec.shadow);
  };

  syncBounds();

  return {
    ...handle,
    handleKey(ev) {
      const result = handle.handleKey(ev);
      spec.onStateMayHaveChanged?.();
      syncBounds();
      return result;
    },
    handleMouse(ev) {
      const result = handle.handleMouse(ev);
      spec.onStateMayHaveChanged?.();
      syncBounds();
      return result;
    },
  };
}
