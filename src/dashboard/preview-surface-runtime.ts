import type { PreviewBindingMode, PreviewLastFocus } from '../preview-pane/model.js';
import type { PreviewSource } from '../workspace-types.js';

export interface DashboardPreviewSurfaceRuntimeDeps {
  // method 문법(bivariant) — 구체 formatPreviewSourceLabel 이 view 를
  // WorkingDirView(number 의 부분집합)로 받아도 수용(런타임 값은 1..4).
  formatPreviewSourceLabel(
    sourceMode: PreviewSource,
    view: number,
    lastBrowserFocus: PreviewLastFocus,
  ): string;
}

export interface DashboardPreviewSurfaceRuntime {
  buildPlainTitle(
    sourceMode: PreviewSource,
    view: number,
    lastBrowserFocus: PreviewLastFocus,
    bindingMode: PreviewBindingMode,
  ): string;
}

export function createDashboardPreviewSurfaceRuntime(
  deps: DashboardPreviewSurfaceRuntimeDeps,
): DashboardPreviewSurfaceRuntime {
  return {
    buildPlainTitle(sourceMode, view, lastBrowserFocus, bindingMode) {
      const srcLabel = deps.formatPreviewSourceLabel(sourceMode, view, lastBrowserFocus);
      const bindingLabel = bindingMode === 'pinned' ? ' · PIN' : '';
      return `Preview · ${srcLabel}${bindingLabel}`;
    },
  };
}
