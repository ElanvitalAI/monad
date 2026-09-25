import type { PreviewSource, WorkingDirView } from '../workspace-types.js';

export type PreviewLastFocus = 'browser' | 'obsidian' | 'skill-file';
export type EffectivePreviewBrowser = 'working' | 'obsidian' | 'skill';
export type PreviewBindingMode = 'follow' | 'pinned';

export interface PreviewPaneModel {
  id: string;
  mode: 'docked' | 'modal' | 'vw';
  followCursor: boolean;
  pinned: boolean;
  sourceMode: PreviewSource;
  lastBrowserFocus: PreviewLastFocus;
  previewPath: string | null;
  previewLines: string[];
  previewOffset: number;
}

export function createPreviewPaneModel(
  id: string,
  opts?: Partial<Pick<PreviewPaneModel, 'mode' | 'followCursor' | 'pinned' | 'sourceMode' | 'lastBrowserFocus'>>,
): PreviewPaneModel {
  return {
    id,
    mode: opts?.mode ?? 'docked',
    followCursor: opts?.followCursor ?? true,
    pinned: opts?.pinned ?? false,
    sourceMode: opts?.sourceMode ?? 'smart',
    lastBrowserFocus: opts?.lastBrowserFocus ?? 'browser',
    previewPath: null,
    previewLines: [],
    previewOffset: 0,
  };
}

export function resolveEffectivePreviewBrowser(
  source: PreviewSource,
  view: WorkingDirView,
  last: PreviewLastFocus,
): EffectivePreviewBrowser {
  if (source === 'obsidian') return view === 2 ? 'obsidian' : 'working';
  if (source === 'skill') return view === 3 ? 'skill' : 'working';
  if (source === 'working') return 'working';
  if (view === 2 && last === 'obsidian') return 'obsidian';
  if (view === 3 && last === 'skill-file') return 'skill';
  return 'working';
}

export function cyclePreviewSourceForView(
  view: WorkingDirView,
  source: PreviewSource,
): PreviewSource {
  const ring: PreviewSource[] =
    view === 2 ? ['working', 'obsidian', 'smart']
      : view === 3 ? ['working', 'skill', 'smart']
        : ['working', 'smart'];
  const i = Math.max(0, ring.indexOf(source));
  return ring[(i + 1) % ring.length]!;
}

export function normalizePreviewSourceForView(
  source: PreviewSource,
  view: WorkingDirView,
): PreviewSource {
  if (source === 'obsidian' && view !== 2) return 'smart';
  if (source === 'skill' && view !== 3) return 'smart';
  return source;
}

export function formatPreviewSourceLabel(
  source: PreviewSource,
  view: WorkingDirView,
  last: PreviewLastFocus,
): string {
  const eff = resolveEffectivePreviewBrowser(source, view, last);
  const tag = eff === 'obsidian' ? 'OB' : eff === 'skill' ? 'SK' : 'WD';
  return source === 'smart' ? `SMART→${tag}` : tag;
}

export function resolvePreviewBindingMode(
  preview: Pick<PreviewPaneModel, 'followCursor' | 'pinned'>,
): PreviewBindingMode {
  return preview.pinned || !preview.followCursor ? 'pinned' : 'follow';
}

export function setPreviewBindingMode(
  preview: Pick<PreviewPaneModel, 'followCursor' | 'pinned'>,
  mode: PreviewBindingMode,
): PreviewBindingMode {
  preview.followCursor = mode === 'follow';
  preview.pinned = mode === 'pinned';
  return mode;
}

export function shouldAutoRefreshPreview(
  preview: Pick<PreviewPaneModel, 'followCursor' | 'pinned'>,
): boolean {
  return resolvePreviewBindingMode(preview) === 'follow';
}

export function setPreviewSourceForView(
  preview: Pick<PreviewPaneModel, 'sourceMode' | 'followCursor' | 'pinned'>,
  source: PreviewSource,
  view: WorkingDirView,
): PreviewSource {
  preview.sourceMode = normalizePreviewSourceForView(source, view);
  setPreviewBindingMode(preview, 'follow');
  return preview.sourceMode;
}
