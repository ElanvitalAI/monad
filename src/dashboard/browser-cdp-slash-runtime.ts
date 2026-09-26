import { Buffer } from 'node:buffer';

import { getBrowserCdpAvailability, type BrowserCdpAvailability } from '../browser-cdp/availability.js';
import type { ControlSignalBus } from '../input/control-signal.js';
import type { InputSourceRef } from '../input/input-source-kind.js';
import {
  dispatchBrowserNavigate,
  dispatchBrowserRead,
  type BrowserNavigateResult,
  type BrowserReadResult,
} from '../tool-runtime/browser-runtime.js';

export interface DashboardBrowserCdpSlashRuntimeDeps {
  accent: (text: string) => string;
  muted: (text: string) => string;
  warning: (text: string) => string;
  getAvailability?: () => BrowserCdpAvailability;
  navigate?: (args: { url: string; waitForLoad?: boolean; timeoutMs?: number }) => Promise<BrowserNavigateResult>;
  read?: (args: { mode?: 'text' | 'html' | 'screenshot'; selector?: string; maxChars?: number }) => Promise<BrowserReadResult>;
  signalBus?: ControlSignalBus;
  source?: InputSourceRef;
}

export interface DashboardBrowserCdpSlashRuntime {
  usageLines(): string[];
  statusLines(): string[];
  smokeLines(): Promise<string[]>;
  stopLines(): string[];
}

function buildBrowserCdpSmokeUrl(): string {
  const html = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>Elanous Browser CDP Smoke</title></head>',
    '<body>',
    '<main>',
    '<h1>Elanous Browser CDP Smoke</h1>',
    '<p id="status">browser runtime smoke ok</p>',
    '</main>',
    '</body></html>',
  ].join('');
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function defaultSlashSource(): InputSourceRef {
  return { kind: 'keyboard', surface: 'dashboard-chat-main' };
}

export function createDashboardBrowserCdpSlashRuntime(
  deps: DashboardBrowserCdpSlashRuntimeDeps,
): DashboardBrowserCdpSlashRuntime {
  const getAvailability = deps.getAvailability ?? getBrowserCdpAvailability;
  const navigate = deps.navigate ?? dispatchBrowserNavigate;
  const read = deps.read ?? dispatchBrowserRead;

  return {
    usageLines: () => [
      '',
      deps.accent('❯ /browser-cdp'),
      deps.muted('  /browser-cdp status'),
      deps.muted('  /browser-cdp smoke'),
      deps.muted('  /browser-cdp stop'),
    ],
    statusLines: () => {
      const availability = getAvailability();
      if (!availability.available) {
        return [
          deps.warning(`  browser-cdp unavailable · ${availability.reason}`),
          deps.muted(`  ${availability.note}`),
        ];
      }
      return [
        deps.muted('  browser-cdp available'),
        deps.muted(`  binary: ${availability.binary ?? '(unknown)'}`),
        deps.muted(`  note: ${availability.note}`),
      ];
    },
    smokeLines: async () => {
      const availability = getAvailability();
      if (!availability.available) {
        return [
          deps.warning(`  browser-cdp unavailable · ${availability.reason}`),
          deps.muted(`  ${availability.note}`),
          deps.muted('  smoke skipped — degraded mode is expected when Chrome is absent'),
        ];
      }
      const nav = await navigate({
        url: buildBrowserCdpSmokeUrl(),
        waitForLoad: false,
        timeoutMs: 3_000,
      });
      if (!nav.finalUrl) {
        return [
          deps.warning('  browser-cdp smoke failed during navigate'),
          ...nav.output.split('\n').map((line) => deps.muted(`  ${line}`)),
        ];
      }
      const text = await read({ mode: 'text', selector: '#status', maxChars: 240 });
      const screenshot = await read({ mode: 'screenshot' });
      const screenshotBytes = screenshot.screenshotBase64
        ? Buffer.from(screenshot.screenshotBase64, 'base64').byteLength
        : 0;
      return [
        deps.muted('  browser-cdp smoke: ok'),
        deps.muted(`  navigate: ${nav.title || '(empty title)'} · ${nav.finalUrl}`),
        deps.muted(`  text: ${(text.text ?? '').trim() || '(empty)'}`),
        deps.muted(`  screenshot bytes: ${screenshotBytes}`),
      ];
    },
    stopLines: () => {
      if (!deps.signalBus) {
        return [deps.warning('  browser-cdp stop unavailable: no control signal bus wired')];
      }
      const signal = deps.signalBus.emit({
        kind: 'browser-cdp-stop',
        urgency: 'quick-pass',
        mayPreempt: true,
        source: deps.source ?? defaultSlashSource(),
        scope: { surface: 'browser', channel: 'dashboard' },
        payload: { reason: 'dashboard-slash-stop' },
      });
      return [
        deps.muted(`  emitted ${signal.kind} · ${signal.urgency} · surface=browser · channel=dashboard`),
      ];
    },
  };
}
