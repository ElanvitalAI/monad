// H6 P6 · Browser CDP provider.
//
// Wraps `src/browser-cdp/client.ts::CdpClient` so the source registry
// can enumerate + snapshot a live Chrome page. v1 is single-page:
// one CDP client, one descriptor ('browser-cdp:page-0'). Bundle 2
// extends via `Target.attachToTarget` for multi-tab.
//
// Chrome not installed / CDP not launched / client dead →
// `list()` returns empty (D10 isolation); `snapshot` throws clear
// "no client attached" error.

import { buildSourceId } from '../source-registry.js';
import { buildBrowserObservationInputSourceRef } from '../../input/input-source-kind.js';
import { getBrowserCdpAvailability } from '../../browser-cdp/availability.js';
import type {
  CaptureSourceDescriptor,
  CaptureSourceProvider,
  SnapshotOpts,
  SnapshotResult,
} from './types.js';
import type { CaptureFormat } from '../types.js';
import type { CdpClient } from '../../browser-cdp/client.js';

const PAGE_ID = 'page-0';
const SUPPORTED_FORMATS: readonly CaptureFormat[] = ['png'];

export interface BrowserCdpProviderDeps {
  /** Accessor for the current CDP client · undefined when Chrome
   *  hasn't been launched or the client has been closed. Using a
   *  getter (rather than a concrete handle) lets the provider
   *  observe lifecycle changes without re-registering. */
  readonly getClient: () => CdpClient | undefined;
}

export function createBrowserCdpProvider(deps: BrowserCdpProviderDeps): CaptureSourceProvider {
  return {
    type: 'browser-cdp',
    list() {
      const client = safeGetAlive(deps);
      if (!client) return [];
      return [{
        id: buildSourceId('browser-cdp', PAGE_ID),
        type: 'browser-cdp',
        label: `browser-cdp · port ${client.port}`,
        summary: `pid ${client.pid} · alive`,
        formats: SUPPORTED_FORMATS,
        sourceRef: buildBrowserObservationInputSourceRef({
          provider: 'cdp',
          capabilities: ['observe', 'verify'],
        }),
        meta: { pid: client.pid, port: client.port },
      }];
    },
    async snapshot(id, opts): Promise<SnapshotResult> {
      if (id !== buildSourceId('browser-cdp', PAGE_ID)) {
        throw new Error(`browser-cdp provider: only page id '${PAGE_ID}' supported in v1 · got '${id}'`);
      }
      const client = safeGetAlive(deps);
      if (!client) {
        const availability = getBrowserCdpAvailability();
        throw new Error(`browser-cdp provider: no client attached · ${availability.note}`);
      }
      const format = opts.format ?? 'png';
      if (format !== 'png') {
        throw new Error(`browser-cdp provider: only 'png' format in v1 · got '${format}'`);
      }
      const warnings: string[] = [];
      if (opts.at !== undefined) warnings.push('historical-not-supported');
      const bytes = await client.screenshot({ format: 'png' });
      const capturedAt = Date.now();
      const base64 = Buffer.from(bytes).toString('base64');
      return {
        sourceId: id,
        format: 'png',
        body: '',
        bodyBase64: base64,
        bytes: bytes.length,
        dims: opts.dims ?? { cols: 0, rows: 0 },
        capturedAt,
        sourceRef: buildBrowserObservationInputSourceRef({
          provider: 'cdp',
          capabilities: ['observe', 'verify'],
        }),
        warnings,
      };
    },
  };
}

/** Read the optional getter without throwing on null/disposed clients.
 *  A provider should never panic the registry just because Chrome
 *  isn't running. */
function safeGetAlive(deps: BrowserCdpProviderDeps): CdpClient | null {
  try {
    const c = deps.getClient();
    if (!c) return null;
    if (!c.isAlive) return null;
    return c;
  } catch {
    return null;
  }
}
