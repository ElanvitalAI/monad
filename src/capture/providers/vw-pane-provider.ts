// H6 P6 · VW pane provider.
//
// Enumerates every live VirtualWindow's panes and delegates snapshot
// requests to the existing `createPaneSource` + `captureImage` path.
// No new encoders · no new rendering logic · just a registry-shaped
// façade over what capture-tools.ts already does for `Screenshot`.
//
// Id format: `vw-pane:<windowId>/<paneId>`. Both parts are registry-
// minted · `<windowId>` is numeric · `<paneId>` is `p<n>`. Neither
// contains `:` so the registry's single-colon split works.

import { captureImage } from '../engine.js';
import { createPaneSource, paneRefOf } from '../sources/pane-source.js';
import { buildSourceId } from '../source-registry.js';
import type {
  CaptureSourceDescriptor,
  CaptureSourceProvider,
  SnapshotOpts,
  SnapshotResult,
} from './types.js';
import type { CaptureFormat } from '../types.js';
import { buildTerminalObservationInputSourceRef } from '../../input/input-source-kind.js';

export interface VwPaneWindowSnapshot {
  readonly id: number;
  readonly title?: string;
  readonly panes: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly kind: string;
  }>;
}

export interface VwPaneProviderDeps {
  /** Enumerate currently-live VWs + their panes. In prod this wraps
   *  `WindowRegistry.list()` + each `VirtualWindow.listPanes()`. Tests
   *  supply deterministic fixtures. */
  readonly getWindows: () => readonly VwPaneWindowSnapshot[];
}

const SUPPORTED_FORMATS: readonly CaptureFormat[] = ['text', 'ansi', 'png', 'svg', 'asciicast'];

export function createVwPaneProvider(deps: VwPaneProviderDeps): CaptureSourceProvider {
  return {
    type: 'vw-pane',
    list() {
      const out: CaptureSourceDescriptor[] = [];
      let windows: readonly VwPaneWindowSnapshot[] = [];
      try { windows = deps.getWindows(); } catch { windows = []; }
      for (const w of windows) {
        for (const p of w.panes) {
          const native = `${w.id}/${p.id}`;
          const labelExtras = [w.title, p.title].filter((x) => !!x).join(' · ');
          out.push({
            id: buildSourceId('vw-pane', native),
            type: 'vw-pane',
            label: labelExtras
              ? `vw-pane ${w.id}/${p.id} · ${labelExtras}`
              : `vw-pane ${w.id}/${p.id}`,
            summary: `kind=${p.kind}`,
            formats: SUPPORTED_FORMATS,
            sourceRef: buildTerminalObservationInputSourceRef({
              provider: 'tui',
              deviceId: String(w.id),
              sessionId: p.id,
              capabilities: ['observe', 'render'],
            }),
          });
        }
      }
      return out;
    },
    async snapshot(id, opts): Promise<SnapshotResult> {
      const { windowId, paneId } = parseVwPaneId(id);
      const format = opts.format ?? 'text';
      const source = createPaneSource({ windowId, paneId });
      const ansi = await source();
      const dims = opts.dims ?? { cols: 80, rows: 24 };
      const result = await captureImage({
        target: {
          kind: 'pane',
          paneId,
          ref: paneRefOf({ windowId, paneId }),
        },
        format,
        dims,
        source: () => ansi,
        ...(opts.title ? { title: opts.title } : {}),
        ...(opts.theme ? { theme: opts.theme } : {}),
      });
      const warnings: string[] = [];
      if (opts.at !== undefined) warnings.push('historical-not-supported');
      if (ansi.length === 0) warnings.push('source-empty');
      const snapshot: SnapshotResult = {
        sourceId: id,
        format: result.format,
        body: format === 'png' ? '' : result.body,
        ...(format === 'png'
          ? { bodyBase64: result.bodyBytes.toString('base64') }
          : {}),
        bytes: result.bytes,
        dims: result.dims,
        capturedAt: result.capturedAt,
        sourceRef: buildTerminalObservationInputSourceRef({
          provider: 'tui',
          deviceId: String(windowId),
          sessionId: paneId,
          capabilities: ['observe', 'render'],
        }),
        warnings,
      };
      return snapshot;
    },
  };
}

/** Parse the native suffix of a `vw-pane:...` id into its two parts. */
export function parseVwPaneId(id: string): { windowId: string; paneId: string } {
  const prefix = 'vw-pane:';
  if (!id.startsWith(prefix)) {
    throw new Error(`vw-pane provider: expected id to start with '${prefix}' · got '${id}'`);
  }
  const native = id.slice(prefix.length);
  const slash = native.indexOf('/');
  if (slash < 1) {
    throw new Error(`vw-pane provider: invalid native id '${native}' · expected <windowId>/<paneId>`);
  }
  return {
    windowId: native.slice(0, slash),
    paneId: native.slice(slash + 1),
  };
}
