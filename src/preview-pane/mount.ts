import type { DisplayCoordinator } from '../display/coordinator.js';
import type { Action, DisplayMouseEvent, KeyEvent } from '../display/types.js';
import {
  showLivePaneMultiModal,
  showPaneMultiModal,
  type LivePaneMultiModalHandle,
  type PaneMultiModalChromeAction,
  type PaneMultiModalChromeSpec,
  type PaneMultiModalHandle,
  type ShowLivePaneMultiModalParams,
  type ShowPaneMultiModalParams,
} from '../dashboard/modals/pane-multi.js';
import {
  resolvePaneMultiLiveSnapshotChrome,
} from '../dashboard/modals/pane-multi-chrome.js';
import type { ThemeTokens } from '../theme/tokens.js';
import { mintPaneId } from '../virtual-windows/addressing.js';
import type { PaneBroadcast, PaneContent, PaneUnsubscribe } from '../virtual-windows/pane-content.js';
import type { WidgetHost } from '../widgets/host.js';
import type { PreviewPaneModel } from './model.js';
import type { PreviewPaneRegistry } from './registry.js';
import { pad, truncate, visibleWidth } from '../tui.js';

export interface OpenPreviewPaneModalDeps {
  preview: PreviewPaneModel;
  previewWidgetInstanceId: string;
  modalPreviewWidgetInstanceId?: string;
  title?: string;
  liveMode: boolean;
  widgetHost: Pick<WidgetHost, 'get' | 'spawn' | 'dispose' | 'disposeById' | 'defFor'>;
  coordinator: DisplayCoordinator;
  termCols: number;
  termRows: number;
  captureSnapshot(): string;
  theme: ThemeTokens;
  onDispose?(): void;
  onCancel?(): void;
}

export interface PreviewPaneContentSpec {
  kind: 'vw-preview';
  previewId: string;
  title?: string;
}

export interface PreviewPaneMountDeps {
  previewPaneRegistry: PreviewPaneRegistry;
}

export function createPreviewPaneModalWidgetId(
  previewWidgetInstanceId: string,
): string {
  return `${previewWidgetInstanceId}::preview-pane-modal`;
}

export function createPreviewPaneModalChrome(
  theme: ThemeTokens,
  liveMode: boolean,
): PaneMultiModalChromeSpec {
  return resolvePaneMultiLiveSnapshotChrome({
    theme,
    titlePrefix: '◫',
    controlMode: 'close-only',
    subject: 'preview',
    liveMode,
  });
}

export function syncPreviewPaneWidgetFromModel(
  widgetHost: Pick<WidgetHost, 'get'>,
  widgetInstanceId: string,
  preview: PreviewPaneModel,
): boolean {
  const widget = widgetHost.get(widgetInstanceId) as {
    state?: {
      text?: string;
      scroll?: number;
      focused?: boolean;
      preformatted?: boolean;
    };
    character?: string;
  } | null;
  if (!widget?.state) return false;
  widget.state.text = preview.previewLines.join('\n');
  widget.state.scroll = preview.previewOffset;
  widget.state.focused = false;
  widget.state.preformatted = true;
  widget.character = 'Preview';
  return true;
}

export function disposePreviewPaneModalWidgetInstance(
  widgetHost: Pick<WidgetHost, 'dispose' | 'disposeById'>,
  modalWidgetInstanceId: string,
  reason: string,
): void {
  try { widgetHost.disposeById(modalWidgetInstanceId, reason); }
  catch {
    try { widgetHost.dispose(modalWidgetInstanceId); } catch { /* ignore */ }
  }
}

export function replacePreviewPaneModalWidgetInstance(
  widgetHost: Pick<WidgetHost, 'get' | 'spawn' | 'dispose' | 'disposeById'>,
  sourceWidgetInstanceId: string,
  modalWidgetInstanceId: string,
): boolean {
  disposePreviewPaneModalWidgetInstance(widgetHost, modalWidgetInstanceId, 'preview-pane-modal-replace');
  const sourceWidget = widgetHost.get(sourceWidgetInstanceId);
  if (!sourceWidget) return false;
  widgetHost.spawn({
    id: modalWidgetInstanceId,
    type: sourceWidget.type,
    character: sourceWidget.character,
    config: sourceWidget.config,
  });
  return true;
}

export function resolvePreviewPaneModalChromeAction(
  action: PaneMultiModalChromeAction,
  callbacks: { onClose(): void },
): boolean {
  if (action.controlId !== 'close') return false;
  callbacks.onClose();
  return true;
}

function createObserver(): {
  emit: () => void;
  on: (event: 'update' | 'output' | 'exit', cb: () => void) => PaneUnsubscribe;
} {
  const subs = new Map<'update' | 'output' | 'exit', Set<() => void>>();
  return {
    emit() {
      for (const cb of subs.get('update') ?? []) {
        try { cb(); } catch { /* ignore */ }
      }
    },
    on(event, cb) {
      const set = subs.get(event) ?? new Set<() => void>();
      set.add(cb);
      subs.set(event, set);
      return () => { set.delete(cb); };
    },
  };
}

function clampPreviewOffset(preview: PreviewPaneModel, rows: number): void {
  const maxOffset = Math.max(0, preview.previewLines.length - Math.max(1, rows));
  preview.previewOffset = Math.max(0, Math.min(preview.previewOffset, maxOffset));
}

function formatPreviewLine(line: string, width: number): string {
  return visibleWidth(line) > width ? truncate(line, width) : pad(line, width);
}

export function createPreviewPaneContent(
  spec: PreviewPaneContentSpec,
  deps: PreviewPaneMountDeps,
): PaneContent {
  const preview = deps.previewPaneRegistry.get(spec.previewId);
  if (!preview) {
    throw new Error(`createPreviewPaneContent: unknown preview id "${spec.previewId}"`);
  }
  const obs = createObserver();
  let lastRows = 8;

  return {
    id: mintPaneId(),
    kind: spec.kind,
    title: spec.title ?? 'preview',
    focusPolicy: 'interactive',
    start() {},
    stop() {},
    render(ctx) {
      lastRows = Math.max(1, ctx.rows);
      clampPreviewOffset(preview, ctx.rows);
      const lines: string[] = [];
      for (let i = 0; i < Math.max(1, ctx.rows); i++) {
        const line = preview.previewLines[preview.previewOffset + i] ?? '';
        lines.push(formatPreviewLine(line, ctx.cols));
      }
      return lines.join('\n');
    },
    onKey(ev: KeyEvent): Action {
      const step = Math.max(1, lastRows);
      if (ev.name === 'up' || ev.name === 'k') {
        preview.previewOffset = Math.max(0, preview.previewOffset - 1);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'down' || ev.name === 'j') {
        preview.previewOffset += 1;
        clampPreviewOffset(preview, step);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'pageup') {
        preview.previewOffset = Math.max(0, preview.previewOffset - step);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'pagedown') {
        preview.previewOffset += step;
        clampPreviewOffset(preview, step);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'home' || ev.name === 'g') {
        preview.previewOffset = 0;
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'end' || (ev.name === 'G' && ev.shift)) {
        preview.previewOffset = Math.max(0, preview.previewLines.length - step);
        clampPreviewOffset(preview, step);
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    onMouse(ev: DisplayMouseEvent): Action {
      if (ev.type === 'scroll-up') {
        preview.previewOffset = Math.max(0, preview.previewOffset - 3);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.type === 'scroll-down') {
        preview.previewOffset += 3;
        clampPreviewOffset(preview, lastRows);
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    write(bytes: string) {
      preview.previewLines = bytes.split('\n');
      preview.previewOffset = 0;
      obs.emit();
    },
    acceptBroadcast(input: PaneBroadcast) {
      preview.previewLines = input.text.split('\n');
      preview.previewOffset = 0;
      obs.emit();
    },
    capture() {
      return preview.previewLines.join('\n');
    },
    get isAlive() { return true; },
    on: obs.on,
    dispose() {},
  };
}

export function openPreviewPaneModal(
  deps: OpenPreviewPaneModalDeps,
): { dispose(): void; id: string; bounds: { row: number; col: number; width: number; height: number } } {
  const modalPreviewWidgetInstanceId =
    deps.modalPreviewWidgetInstanceId
    ?? createPreviewPaneModalWidgetId(deps.previewWidgetInstanceId);
  const title = deps.title ?? 'Preview';
  const chrome = createPreviewPaneModalChrome(deps.theme, deps.liveMode);
  const routeChromeAction = (
    action: PaneMultiModalChromeAction,
    _ev: DisplayMouseEvent,
    handle: { dispose(): void },
  ): void => {
    resolvePreviewPaneModalChromeAction(action, {
      onClose: () => { handle.dispose(); },
    });
  };

  if (deps.liveMode) {
    const hasWidget = replacePreviewPaneModalWidgetInstance(
      deps.widgetHost,
      deps.previewWidgetInstanceId,
      modalPreviewWidgetInstanceId,
    );
    if (hasWidget) {
      syncPreviewPaneWidgetFromModel(
        deps.widgetHost,
        modalPreviewWidgetInstanceId,
        deps.preview,
      );
    }
    let handle: LivePaneMultiModalHandle | null = null;
    const params: ShowLivePaneMultiModalParams = {
      title,
      columns: [{
        title: 'preview',
        widgetInstanceId: hasWidget ? modalPreviewWidgetInstanceId : deps.previewWidgetInstanceId,
        weight: 1,
      }],
      widgetHost: deps.widgetHost,
      coordinator: deps.coordinator,
      termCols: deps.termCols,
      termRows: deps.termRows,
      ttlMs: 0,
      group: 'preview-pane-modal',
      chrome,
      onCancel: deps.onCancel,
      onDispose: () => {
        disposePreviewPaneModalWidgetInstance(
          deps.widgetHost,
          modalPreviewWidgetInstanceId,
          'preview-pane-modal-close',
        );
        deps.onDispose?.();
      },
      onChromeAction: (action, ev) => {
        if (!handle) return;
        routeChromeAction(action, ev, handle);
      },
    };
    handle = showLivePaneMultiModal(params);
    return handle;
  }

  let handle: PaneMultiModalHandle | null = null;
  const params: ShowPaneMultiModalParams = {
    title,
    columns: [{
      title: 'preview',
      lines: deps.captureSnapshot().split('\n'),
      weight: 1,
    }],
    coordinator: deps.coordinator,
    termCols: deps.termCols,
    termRows: deps.termRows,
    ttlMs: 0,
    group: 'preview-pane-modal',
    chrome,
    onCancel: deps.onCancel,
    onDispose: deps.onDispose,
    onChromeAction: (action, ev) => {
      if (!handle) return;
      routeChromeAction(action, ev, handle);
    },
  };
  handle = showPaneMultiModal(params);
  return handle;
}
